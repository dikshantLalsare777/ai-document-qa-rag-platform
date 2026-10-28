import assert from "node:assert/strict";
import { test } from "node:test";
import {
  embedTexts,
  geminiEmbeddingDimensions,
} from "../src/services/documentProcessing.js";
import {
  generateGeminiAnswer,
  geminiClientFactory,
  normalizeGeminiError,
  requestGemini,
} from "../src/services/gemini.js";

process.env.GEMINI_API_KEY = "test-provider-key";

test("uses one configured Gemini embedding model and dimension for both retrieval tasks", async (t) => {
  const requests = [];
  t.mock.method(geminiClientFactory, "create", () => ({
    models: {
      async embedContent(params) {
        requests.push(params);
        return {
          embeddings: params.contents.map(() => ({
            values: Array(geminiEmbeddingDimensions).fill(0.125),
          })),
        };
      },
    },
  }));

  const documentVectors = await embedTexts(["A document passage."], "RETRIEVAL_DOCUMENT");
  const queryVectors = await embedTexts(["A search question."], "RETRIEVAL_QUERY");

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ model }) => model), [
    "gemini-embedding-001",
    "gemini-embedding-001",
  ]);
  assert.deepEqual(requests.map(({ config }) => config), [
    { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: geminiEmbeddingDimensions },
    { taskType: "RETRIEVAL_QUERY", outputDimensionality: geminiEmbeddingDimensions },
  ]);
  assert.equal(documentVectors[0].length, geminiEmbeddingDimensions);
  assert.equal(queryVectors[0].length, geminiEmbeddingDimensions);
});

test("generates grounded answers with GEMINI_CHAT_MODEL", async (t) => {
  const previousModel = process.env.GEMINI_CHAT_MODEL;
  process.env.GEMINI_CHAT_MODEL = "gemini-test-chat";
  let generationRequest;
  t.mock.method(geminiClientFactory, "create", () => ({
    models: {
      async generateContent(params) {
        generationRequest = params;
        return { text: "The policy lasts 30 days. [S1]" };
      },
    },
  }));

  try {
    const answer = await generateGeminiAnswer({
      question: "How long is the policy?",
      context: "[S1] Policy excerpt: The policy lasts 30 days.",
    });

    assert.equal(generationRequest.model, "gemini-test-chat");
    assert.match(generationRequest.contents, /How long is the policy/);
    assert.match(generationRequest.contents, /The policy lasts 30 days/);
    assert.match(generationRequest.config.systemInstruction, /using only the retrieved source excerpts/i);
    assert.equal(answer, "The policy lasts 30 days. [S1]");
  } finally {
    if (previousModel === undefined) delete process.env.GEMINI_CHAT_MODEL;
    else process.env.GEMINI_CHAT_MODEL = previousModel;
  }
});

test("rejects embedding responses with incompatible dimensions", async (t) => {
  t.mock.method(geminiClientFactory, "create", () => ({
    models: {
      async embedContent() {
        return { embeddings: [{ values: [0.25, 0.5] }] };
      },
    },
  }));

  await assert.rejects(embedTexts(["A passage."]), /expected 3072 numeric dimensions/);
});

test("normalizes Gemini key, model, quota, timeout, and provider errors without raw details", () => {
  const cases = [
    {
      error: Object.assign(new Error("API key not valid: SECRET_VALUE"), { status: 400 }),
      status: 503,
      code: "GEMINI_CREDENTIALS",
      providerStatus: "UNKNOWN",
    },
    {
      error: Object.assign(
        new Error(JSON.stringify({
          error: {
            code: 404,
            message: "model unavailable",
            status: "NOT_FOUND",
            detail: "SECRET_VALUE",
          },
        })),
        { status: 404 },
      ),
      status: 503,
      code: "GEMINI_MODEL",
      providerStatus: "NOT_FOUND",
    },
    {
      error: Object.assign(new Error("quota exceeded: SECRET_VALUE"), { status: 429 }),
      status: 503,
      code: "GEMINI_RATE_LIMIT",
      providerStatus: "UNKNOWN",
    },
    {
      error: Object.assign(new Error(JSON.stringify({
        error: {
          code: 503,
          message: "This model is currently experiencing high demand. SECRET_VALUE",
          status: "UNAVAILABLE",
        },
      })), { status: 503 }),
      status: 503,
      code: "GEMINI_OVERLOADED",
      providerStatus: "UNAVAILABLE",
    },
    {
      error: Object.assign(new Error("API key lacks access: SECRET_VALUE"), { status: 403 }),
      status: 503,
      code: "GEMINI_PERMISSION",
      providerStatus: "UNKNOWN",
    },
    {
      error: Object.assign(new Error("request timed out: SECRET_VALUE"), { code: "ETIMEDOUT" }),
      status: 504,
      code: "GEMINI_TIMEOUT",
      providerStatus: "UNKNOWN",
    },
    {
      error: Object.assign(new Error("provider internal detail: SECRET_VALUE"), { status: 503 }),
      status: 503,
      code: "GEMINI_UNAVAILABLE",
      providerStatus: "UNKNOWN",
    },
  ];

  for (const { error, status, code, providerStatus } of cases) {
    const normalized = normalizeGeminiError(error);
    assert.equal(normalized.status, status);
    assert.equal(normalized.code, code);
    assert.equal(normalized.providerStatus, providerStatus);
    assert.equal(normalized.publicMessage.includes("SECRET_VALUE"), false);
    assert.equal(normalized.message.includes("SECRET_VALUE"), false);
    assert.ok(normalized.message.length <= 180);
    assert.doesNotMatch(normalized.message, /^\s*[{[]/);
  }
});

test("logs Gemini diagnostics without logging raw provider messages or secrets", async (t) => {
  const warning = t.mock.method(console, "warn");
  await assert.rejects(
    requestGemini(
      async () => {
        throw Object.assign(new Error(JSON.stringify({
          error: {
            code: 503,
            message: "Model currently experiencing high demand. API_KEY=SECRET_VALUE",
            status: "UNAVAILABLE",
          },
        })), { status: 503 });
      },
      "generateContent",
    ),
    (error) => {
      assert.equal(error.code, "GEMINI_OVERLOADED");
      assert.match(error.publicMessage, /high demand/i);
      return true;
    },
  );
  assert.equal(warning.mock.calls.length, 1);
  const diagnostic = warning.mock.calls[0].arguments.join(" ");
  assert.match(diagnostic, /operation=generateContent/);
  assert.match(diagnostic, /provider_status=UNAVAILABLE/);
  assert.match(diagnostic, /detail=provider_high_demand/);
  assert.doesNotMatch(diagnostic, /SECRET_VALUE|high demand|API_KEY/i);
});
