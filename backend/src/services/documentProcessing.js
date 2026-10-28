import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { createGeminiClient, requestGemini } from "./gemini.js";

function numberSetting(name, fallback) {
  const configured = process.env[name];
  return configured === undefined || configured === "" ? fallback : Number(configured);
}

const chunkSize = numberSetting("CHUNK_SIZE", 1200);
const chunkOverlap = numberSetting("CHUNK_OVERLAP", 150);
const maxChunks = numberSetting("MAX_DOCUMENT_CHUNKS", 500);
const maxExtractedTextChars = numberSetting("MAX_EXTRACTED_TEXT_CHARS", 2_000_000);
const embeddingBatchSize = 64;
export const geminiEmbeddingDimensions = 3072;

if (!Number.isSafeInteger(chunkSize) || chunkSize < 100) {
  throw new Error("CHUNK_SIZE must be an integer of at least 100 characters.");
}
if (!Number.isSafeInteger(chunkOverlap) || chunkOverlap < 0 || chunkOverlap >= chunkSize) {
  throw new Error("CHUNK_OVERLAP must be a non-negative integer smaller than CHUNK_SIZE.");
}
if (!Number.isSafeInteger(maxChunks) || maxChunks < 1) {
  throw new Error("MAX_DOCUMENT_CHUNKS must be a positive integer.");
}
if (!Number.isSafeInteger(maxExtractedTextChars) || maxExtractedTextChars < 1) {
  throw new Error("MAX_EXTRACTED_TEXT_CHARS must be a positive integer.");
}

function assertTextSize(text) {
  if (text.length > maxExtractedTextChars) {
    throw Object.assign(
      new Error(`Extracted text exceeds the ${maxExtractedTextChars}-character processing limit.`),
      { status: 413 },
    );
  }
  return text;
}

function splitIntoChunks(text) {
  const cleanText = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
  if (!cleanText) return [];
  const chunks = [];
  const step = chunkSize - chunkOverlap;
  for (let start = 0; start < cleanText.length; start += step) {
    const content = cleanText.slice(start, start + chunkSize).trim();
    if (content) chunks.push(content);
    if (chunks.length > maxChunks) {
      throw Object.assign(new Error(`Document exceeds the ${maxChunks}-chunk processing limit.`), {
        status: 413,
      });
    }
  }
  return chunks;
}

export async function extractText(filePath, extension) {
  if (extension === ".pdf") {
    const buffer = await fs.readFile(filePath);
    if (buffer.subarray(0, 5).toString() !== "%PDF-") {
      throw Object.assign(new Error("The uploaded file is not a valid PDF."), { status: 400 });
    }
    let parsed;
    try {
      parsed = await pdfParse(Uint8Array.from(buffer));
    } catch {
      throw Object.assign(new Error("The uploaded PDF could not be parsed."), { status: 422 });
    }
    if (parsed.numpages === 0 || !parsed.text.trim()) {
      throw Object.assign(new Error("No extractable text found; scanned PDFs require OCR."), {
        status: 422,
      });
    }
    return assertTextSize(parsed.text);
  }

  if (extension === ".docx") {
    let result;
    try {
      result = await mammoth.extractRawText({ path: filePath });
    } catch {
      throw Object.assign(new Error("The DOCX document could not be parsed."), { status: 422 });
    }
    if (!result.value.trim()) {
      throw Object.assign(new Error("The DOCX document contains no extractable text."), {
        status: 422,
      });
    }
    return assertTextSize(result.value);
  }

  const text = await fs.readFile(filePath, "utf8");
  if (!text.trim()) {
    throw Object.assign(new Error("The text document is empty."), { status: 422 });
  }
  return assertTextSize(text);
}

export async function embedTexts(texts, taskType = "RETRIEVAL_DOCUMENT") {
  const genAI = createGeminiClient();
  const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
  const embeddings = [];
  for (let offset = 0; offset < texts.length; offset += embeddingBatchSize) {
    const batch = texts.slice(offset, offset + embeddingBatchSize);
    const result = await requestGemini(
      () => genAI.models.embedContent({
        model,
        contents: batch,
        config: { taskType, outputDimensionality: geminiEmbeddingDimensions },
      }),
      "embedContent",
    );
    const batchEmbeddings = result.embeddings?.map((item) => item.values);
    if (
      !batchEmbeddings ||
      batchEmbeddings.length !== batch.length ||
      batchEmbeddings.some((embedding) =>
        !Array.isArray(embedding) ||
        embedding.length !== geminiEmbeddingDimensions ||
        embedding.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new Error(
        `Gemini returned invalid embeddings; expected ${geminiEmbeddingDimensions} numeric dimensions per input.`,
      );
    }
    embeddings.push(...batchEmbeddings);
  }
  return embeddings;
}

export async function buildChunks({ text, ownerId, documentId, filename }) {
  const parts = splitIntoChunks(text);
  if (!parts.length) {
    throw Object.assign(new Error("The document contains no extractable text."), { status: 422 });
  }
  const embeddings = await embedTexts(parts);
  const chunks = parts.map((content, chunkIndex) => ({
    id: `${documentId}:${chunkIndex}`,
    text: content,
    ownerId,
    documentId,
    filename,
    chunkIndex,
  }));
  return { chunks, embeddings };
}

export function safeUploadName(extension) {
  return `${randomUUID()}${extension}`;
}

export function uploadDirectory() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"));
}
