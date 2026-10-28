import { ChromaClient } from "chromadb";
import { geminiEmbeddingDimensions } from "./documentProcessing.js";

let client;
let collectionPromise;

function validateEmbedding(embedding) {
  if (
    !Array.isArray(embedding) ||
    embedding.length !== geminiEmbeddingDimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `Embedding dimension mismatch: expected ${geminiEmbeddingDimensions} numeric values.`,
    );
  }
}

function chromaClient() {
  if (!process.env.CHROMA_URL) throw new Error("CHROMA_URL is not configured.");
  if (!client) {
    const url = new URL(process.env.CHROMA_URL);
    client = new ChromaClient({
      host: url.hostname,
      port: Number(url.port) || (url.protocol === "https:" ? 443 : 8000),
      ssl: url.protocol === "https:",
    });
  }
  return client;
}

async function getCollection() {
  if (!collectionPromise) {
    const name = process.env.CHROMA_COLLECTION || "document_chunks";
    const model = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
    const dimensions = geminiEmbeddingDimensions;
    collectionPromise = chromaClient()
      .getOrCreateCollection({
        name,
        embeddingFunction: null,
        metadata: {
          embedding_provider: "google-gemini",
          embedding_model: model,
          embedding_dimensions: dimensions,
        },
      })
      .then(async (collection) => {
        const metadata = collection.metadata || {};
        if (
          metadata.embedding_provider !== "google-gemini" ||
          metadata.embedding_model !== model
        ) {
          throw new Error(
            `Chroma collection "${name}" has incompatible or unknown embedding metadata. Create a fresh collection and re-upload its documents before using Gemini embeddings.`,
          );
        }
        if (metadata.embedding_dimensions === undefined) {
          const count = await collection.count();
          if (count > 0) {
            const sample = await collection.get({ limit: 1, include: ["embeddings"] });
            if (sample.embeddings?.[0]?.length !== dimensions) {
              throw new Error(
                `Chroma collection "${name}" contains vectors with an unknown or incompatible dimension. Create a fresh collection and re-upload its documents.`,
              );
            }
          }
          await collection.modify({
            metadata: { ...metadata, embedding_dimensions: dimensions },
          });
        } else if (metadata.embedding_dimensions !== dimensions) {
          throw new Error(
            `Chroma collection "${name}" uses ${metadata.embedding_dimensions} embedding dimensions; expected ${dimensions}. Create a fresh collection and re-upload its documents.`,
          );
        }
        return collection;
      })
      .catch((error) => {
        collectionPromise = undefined;
        throw error;
      });
  }
  return collectionPromise;
}

export async function checkVectorStore() {
  await chromaClient().heartbeat();
  return true;
}

export async function upsertChunks(chunks, embeddings) {
  if (!Array.isArray(embeddings) || embeddings.length !== chunks.length) {
    throw new Error("Embedding count must match the number of document chunks.");
  }
  embeddings.forEach(validateEmbedding);
  const collection = await getCollection();
  await collection.upsert({
    ids: chunks.map((chunk) => chunk.id),
    documents: chunks.map((chunk) => chunk.text),
    embeddings,
    metadatas: chunks.map(({ ownerId, documentId, filename, chunkIndex }) => ({
      ownerId,
      documentId,
      filename,
      chunkIndex,
    })),
  });
}

export async function removeDocumentVectors(ownerId, documentId) {
  const collection = await getCollection();
  await collection.delete({
    where: { $and: [{ ownerId }, { documentId }] },
  });
}

export async function searchChunks({ ownerId, documentId, embedding, limit }) {
  validateEmbedding(embedding);
  const collection = await getCollection();
  const where = documentId
    ? { $and: [{ ownerId }, { documentId }] }
    : { ownerId };
  return collection.query({
    queryEmbeddings: [embedding],
    nResults: limit,
    where,
    include: ["documents", "metadatas", "distances"],
  });
}

export const vectorStore = {
  checkVectorStore,
  upsertChunks,
  removeDocumentVectors,
  searchChunks,
};
