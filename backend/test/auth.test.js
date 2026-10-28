import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import {
  embedTexts,
  geminiEmbeddingDimensions,
} from "../src/services/documentProcessing.js";
import { geminiClientFactory } from "../src/services/gemini.js";
import { vectorStore } from "../src/services/vectorStore.js";

process.env.JWT_SECRET = "integration-test-secret-with-at-least-32-characters";
process.env.NODE_ENV = "test";
process.env.GEMINI_API_KEY = "";
process.env.CHROMA_URL = "";

let mongo;
let mongoose;
let server;
let baseUrl;
let app;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  ({ default: mongoose } = await import("mongoose"));
  ({ default: app } = await import("../src/app.js"));
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (mongoose) await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

async function request(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    body: response.status === 204 ? null : await response.json(),
  };
}

test("register, validate, login, and protect the user profile", async (t) => {
  await t.test("requires a Gemini API key for embedding requests", async () => {
    await assert.rejects(embedTexts(["a test sentence"]), /GEMINI_API_KEY is not configured/);
  });

  await t.test("rejects invalid registration inputs", async () => {
    const { response } = await request("/api/auth/register", {
      method: "POST",
      body: { name: "", email: "not-an-email", password: "short" },
    });
    assert.equal(response.status, 400);
  });

  let token;
  let userId;
  await t.test("registers a user and returns a token without the password hash", async () => {
    const { response, body } = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Test User", email: "TEST@example.com", password: "correct-horse-42" },
    });
    assert.equal(response.status, 201);
    assert.ok(body.token);
    userId = body.user.id;
    assert.deepEqual(body.user, {
      id: body.user.id,
      name: "Test User",
      email: "test@example.com",
      plan: "free",
      documentCount: 0,
      questionCount: 0,
    });
    assert.equal(JSON.stringify(body).includes("passwordHash"), false);
    token = body.token;

    const User = (await import("../src/models/User.js")).default;
    const savedUser = await User.findById(body.user.id).select("+passwordHash");
    assert.notEqual(savedUser.passwordHash, "correct-horse-42");
    assert.ok(await (await import("bcryptjs")).default.compare(
      "correct-horse-42",
      savedUser.passwordHash,
    ));
  });

  await t.test("rejects duplicate email registration", async () => {
    const { response } = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Another User", email: "test@example.com", password: "correct-horse-42" },
    });
    assert.equal(response.status, 409);
  });

  await t.test("logs in with valid credentials", async () => {
    const { response, body } = await request("/api/auth/login", {
      method: "POST",
      body: { email: "test@example.com", password: "correct-horse-42" },
    });
    assert.equal(response.status, 200);
    assert.ok(body.token);
    assert.equal(body.user.email, "test@example.com");
    assert.equal(JSON.stringify(body).includes("passwordHash"), false);
  });

  await t.test("rejects invalid credentials", async () => {
    const { response } = await request("/api/auth/login", {
      method: "POST",
      body: { email: "test@example.com", password: "wrong-password" },
    });
    assert.equal(response.status, 401);
  });

  await t.test("requires a token and returns the authenticated profile", async () => {
    const unauthenticated = await request("/api/auth/me");
    assert.equal(unauthenticated.response.status, 401);

    const authenticated = await request("/api/auth/me", { token });
    assert.equal(authenticated.response.status, 200);
    assert.equal(authenticated.body.user.email, "test@example.com");
    assert.equal(JSON.stringify(authenticated.body).includes("passwordHash"), false);
  });

  await t.test("reports liveness separately from dependency readiness", async () => {
    const health = await request("/api/health");
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, "ok");
    assert.equal(health.body.dependencies.mongodb, "connected");
    assert.equal(health.body.ready, true);

    const readiness = await request("/api/ready");
    assert.equal(readiness.response.status, 200);
    assert.equal(readiness.body.status, "ready");
  });

  await t.test("rejects malformed or expired tokens and protects document routes", async () => {
    const unauthorized = await request("/api/documents");
    assert.equal(unauthorized.response.status, 401);

    const malformed = await request("/api/auth/me", { token: "not-a-valid-token extra" });
    assert.equal(malformed.response.status, 401);

    const jwt = (await import("jsonwebtoken")).default;
    const expiredToken = jwt.sign({ sub: "507f1f77bcf86cd799439011" }, process.env.JWT_SECRET, {
      expiresIn: -1,
    });
    const expired = await request("/api/auth/me", { token: expiredToken });
    assert.equal(expired.response.status, 401);
  });

  await t.test("supports authenticated client logout", async () => {
    const { response } = await request("/api/auth/logout", { method: "POST", token });
    assert.equal(response.status, 204);
  });

  await t.test("rejects unsupported uploads and reports missing processing services", async () => {
    const unsupported = new FormData();
    unsupported.append("file", new Blob(["not a supported document"]), "unsafe.exe");
    const unsupportedResponse = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: unsupported,
    });
    assert.equal(unsupportedResponse.status, 415);

    const validTextFile = new FormData();
    validTextFile.append("file", new Blob(["A supported text file."], { type: "text/plain" }), "notes.txt");
    const unavailableResponse = await fetch(`${baseUrl}/api/documents/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: validTextFile,
    });
    assert.equal(unavailableResponse.status, 503);
    assert.match((await unavailableResponse.json()).error, /GEMINI_API_KEY and CHROMA_URL/);
  });

  await t.test("reports unavailable question answering without Gemini or Chroma configuration", async () => {
    const invalid = await request("/api/questions/ask", {
      method: "POST",
      token,
      body: { question: "" },
    });
    assert.equal(invalid.response.status, 400);

    const { response, body } = await request("/api/questions/ask", {
      method: "POST",
      token,
      body: { question: "What is in my file?" },
    });
    assert.equal(response.status, 503);
    assert.match(body.error, /GEMINI_API_KEY and CHROMA_URL/);
  });

  await t.test("tests multi-document RAG, abstention, citations, and isolation with mocked Gemini and Chroma", async (t) => {
    const originalKey = process.env.GEMINI_API_KEY;
    const originalChatModel = process.env.GEMINI_CHAT_MODEL;
    const originalChromaUrl = process.env.CHROMA_URL;
    const originalDocumentLimit = process.env.FREE_DOCUMENT_LIMIT;
    const originalQuestionLimit = process.env.FREE_QUESTION_LIMIT;
    process.env.GEMINI_API_KEY = "mock-provider-key";
    process.env.GEMINI_CHAT_MODEL = "gemini-test-chat";
    process.env.CHROMA_URL = "http://127.0.0.1:8000";
    process.env.FREE_DOCUMENT_LIMIT = "2";
    process.env.FREE_QUESTION_LIMIT = "3";

    const upsertedChunks = [];
    const searchRequests = [];
    const generatedRequests = [];
    const embeddingRequests = [];
    t.mock.method(vectorStore, "checkVectorStore", async () => true);
    t.mock.method(vectorStore, "upsertChunks", async (chunks, embeddings) => {
      upsertedChunks.push(...chunks);
      assert.equal(embeddings.length, chunks.length);
      assert.ok(embeddings.every((embedding) => embedding.length === geminiEmbeddingDimensions));
    });
    t.mock.method(vectorStore, "removeDocumentVectors", async () => {});
    t.mock.method(vectorStore, "searchChunks", async ({ ownerId, documentId, embedding }) => {
      assert.equal(ownerId, userId);
      assert.equal(embedding.length, geminiEmbeddingDimensions);
      searchRequests.push({ ownerId, documentId });
      const selectedChunks = embedding[0] > 0.5
        ? upsertedChunks.slice(0, 1)
        : upsertedChunks.filter((chunk) => !documentId || chunk.documentId === documentId);
      return {
        ids: [selectedChunks.map((chunk) => chunk.id)],
        documents: [selectedChunks.map((chunk) => chunk.text)],
        metadatas: [selectedChunks.map((chunk) => ({
          ownerId,
          documentId: chunk.documentId,
          filename: chunk.filename,
          chunkIndex: chunk.chunkIndex,
        }))],
        distances: [selectedChunks.map(() => (embedding[0] > 0.5 ? 2 : 0.1))],
      };
    });
    t.mock.method(geminiClientFactory, "create", (apiKey) => {
      assert.equal(apiKey, "mock-provider-key");
      return {
        models: {
          async embedContent(params) {
            embeddingRequests.push(params);
            return {
              embeddings: params.contents.map(() => ({
                values: Array(geminiEmbeddingDimensions).fill(
                  params.contents[0].includes("unanswerable") ? 0.9 : 0.1,
                ),
              })),
            };
          },
          async generateContent(params) {
            generatedRequests.push(params);
            if (params.contents.includes("Travel reimbursement is capped at $450.")) {
              return {
                text: "The retention period is 30 days [S1], and travel reimbursement is capped at $450 [S2].",
              };
            }
            return { text: "The retention period is 30 days. [S1]" };
          },
        },
      };
    });
    const uploadText = async (text, filename) => {
      const form = new FormData();
      form.append("file", new Blob([text], { type: "text/plain" }), filename);
      const headers = { authorization: ["Bearer", token].join(" ") };
      return fetch(`${baseUrl}/api/documents/upload`, {
        method: "POST",
        headers,
        body: form,
      });
    };

    try {
      const invalidPdf = new FormData();
      invalidPdf.append(
        "file",
        new Blob(["not a PDF"], { type: "application/pdf" }),
        "invalid.pdf",
      );
      const invalidPdfResponse = await fetch(`${baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: invalidPdf,
      });
      assert.equal(invalidPdfResponse.status, 400);

      const upload = new FormData();
      upload.append(
        "file",
        new Blob(["The retention period is 30 days."], { type: "text/plain" }),
        "retention.txt",
      );
      const uploadResponse = await fetch(`${baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: upload,
      });
      assert.equal(uploadResponse.status, 201);
      const { document } = await uploadResponse.json();
      assert.equal(document.status, "ready");
      assert.equal(document.chunkCount, 1);
      assert.equal(upsertedChunks[0].ownerId, userId);
      assert.equal(embeddingRequests[0].config.taskType, "RETRIEVAL_DOCUMENT");
      assert.equal(embeddingRequests[0].model, "gemini-embedding-001");

      const duplicate = new FormData();
      duplicate.append(
        "file",
        new Blob(["The retention period is 30 days."], { type: "text/plain" }),
        "duplicate.txt",
      );
      const duplicateResponse = await fetch(`${baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: duplicate,
      });
      assert.equal(duplicateResponse.status, 409);

      const empty = new FormData();
      empty.append("file", new Blob([], { type: "text/plain" }), "empty.txt");
      const emptyResponse = await fetch(`${baseUrl}/api/documents/upload`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: empty,
      });
      assert.equal(emptyResponse.status, 422);

      const secondUpload = await uploadText(
        "Travel reimbursement is capped at $450.",
        "travel.txt",
      );
      assert.equal(secondUpload.status, 201);
      const { document: secondDocument } = await secondUpload.json();
      assert.equal(secondDocument.status, "ready");
      assert.equal(secondDocument.chunkCount, 1);
      assert.equal(upsertedChunks[1].filename, "travel.txt");

      const specificDocumentQuestion = await request("/api/questions/ask", {
        method: "POST",
        token,
        body: { question: "How long is the retention period?", documentId: document.id },
      });
      assert.equal(specificDocumentQuestion.response.status, 200);
      assert.equal(specificDocumentQuestion.body.question.answer, "The retention period is 30 days. [S1]");
      assert.equal(specificDocumentQuestion.body.question.sources.length, 1);
      assert.equal(specificDocumentQuestion.body.question.sources[0].filename, "retention.txt");
      assert.equal(specificDocumentQuestion.body.question.sources[0].documentId, document.id);
      assert.equal(searchRequests[0].documentId, document.id);
      assert.equal(embeddingRequests[2].config.taskType, "RETRIEVAL_QUERY");
      assert.equal(embeddingRequests[2].model, embeddingRequests[0].model);
      assert.equal(generatedRequests[0].model, "gemini-test-chat");
      assert.match(generatedRequests[0].contents, /The retention period is 30 days/);
      assert.doesNotMatch(generatedRequests[0].contents, /Travel reimbursement/);
      assert.match(generatedRequests[0].config.systemInstruction, /using only the retrieved source excerpts/i);

      const multiDocumentQuestion = await request("/api/questions/ask", {
        method: "POST",
        token,
        body: { question: "Summarize the retention and travel policies." },
      });
      assert.equal(multiDocumentQuestion.response.status, 200);
      assert.match(multiDocumentQuestion.body.question.answer, /30 days \[S1\]/);
      assert.match(multiDocumentQuestion.body.question.answer, /\$450 \[S2\]/);
      assert.deepEqual(
        multiDocumentQuestion.body.question.sources.map((source) => source.filename),
        ["retention.txt", "travel.txt"],
      );
      assert.match(generatedRequests[1].contents, /The retention period is 30 days/);
      assert.match(generatedRequests[1].contents, /Travel reimbursement is capped at \$450/);

      const generatedCountBeforeUnanswerable = generatedRequests.length;
      const unanswerableQuestion = await request("/api/questions/ask", {
        method: "POST",
        token,
        body: { question: "This question is unanswerable from the documents." },
      });
      assert.equal(unanswerableQuestion.response.status, 200);
      assert.equal(
        unanswerableQuestion.body.question.answer,
        "I couldn't find enough relevant information in your documents to answer that question.",
      );
      assert.deepEqual(unanswerableQuestion.body.question.sources, []);
      assert.equal(generatedRequests.length, generatedCountBeforeUnanswerable);

      const overQuestionQuota = await request("/api/questions/ask", {
        method: "POST",
        token,
        body: { question: "A second question with no remaining quota." },
      });
      assert.equal(overQuestionQuota.response.status, 429);

      const otherUser = await request("/api/auth/register", {
        method: "POST",
        body: {
          name: "Other Test User",
          email: `other-${Date.now()}@example.com`,
          password: "another-test-password",
        },
      });
      assert.equal(otherUser.response.status, 201);
      const searchCountBeforeUnauthorizedRequest = searchRequests.length;
      const unauthorizedDocument = await request("/api/questions/ask", {
        method: "POST",
        token: otherUser.body.token,
        body: { question: "Can I read this document?", documentId: document.id },
      });
      assert.equal(unauthorizedDocument.response.status, 404);
      assert.equal(searchRequests.length, searchCountBeforeUnauthorizedRequest);

      const overDocumentQuotaResponse = await uploadText(
        "A different document for quota validation.",
        "third.txt",
      );
      assert.equal(overDocumentQuotaResponse.status, 429);

      const deleted = await request(`/api/documents/${document.id}`, {
        method: "DELETE",
        token,
      });
      assert.equal(deleted.response.status, 204);
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
      if (originalChatModel === undefined) delete process.env.GEMINI_CHAT_MODEL;
      else process.env.GEMINI_CHAT_MODEL = originalChatModel;
      process.env.CHROMA_URL = originalChromaUrl;
      process.env.FREE_DOCUMENT_LIMIT = originalDocumentLimit;
      process.env.FREE_QUESTION_LIMIT = originalQuestionLimit;
    }
  });

  await t.test("validates pagination and preserves usage counts after mocked RAG requests", async () => {
    const invalidPage = await request("/api/documents?page=1.5", { token });
    assert.equal(invalidPage.response.status, 400);

    const usage = await request("/api/usage", { token });
    assert.equal(usage.response.status, 200);
    assert.equal(usage.body.documents.used, 1);
    assert.equal(usage.body.questions.used, 3);
  });
});
