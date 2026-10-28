import { Router } from "express";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import authenticate from "../middleware/authenticate.js";
import Document from "../models/Document.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import { embedTexts } from "../services/documentProcessing.js";
import { generateGeminiAnswer } from "../services/gemini.js";
import { vectorStore } from "../services/vectorStore.js";

const router = Router();
const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

const askLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

function publicQuestion(question) {
  return {
    id: question.id,
    question: question.question,
    answer: question.answer,
    sources: question.sources,
    createdAt: question.createdAt,
  };
}

async function reserveQuestion(ownerId, limit) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - thirtyDaysMs);
  const reset = await User.findOneAndUpdate(
    { _id: ownerId, questionPeriodStart: { $lt: cutoff } },
    { $set: { questionPeriodStart: now, questionCount: 1 } },
    { new: true },
  );
  if (reset) return reset;
  return User.findOneAndUpdate(
    {
      _id: ownerId,
      questionPeriodStart: { $gte: cutoff },
      questionCount: { $lt: limit },
    },
    { $inc: { questionCount: 1 } },
    { new: true },
  );
}

router.use(authenticate);
router.get("/history", async (req, res, next) => {
  try {
    const pageInput = Number(req.query.page || 1);
    const limitInput = Number(req.query.limit || 20);
    if (!Number.isSafeInteger(pageInput) || pageInput < 1 || !Number.isSafeInteger(limitInput) || limitInput < 1) {
      return res.status(400).json({ error: "Page and limit must be positive integers." });
    }
    const page = Math.min(pageInput, 1_000_000);
    const limit = Math.min(50, limitInput);
    const filter = { owner: req.user.id, status: "ready" };
    const [questions, total] = await Promise.all([
      Question.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Question.countDocuments(filter),
    ]);
    res.json({ questions: questions.map(publicQuestion), page, limit, total });
  } catch (error) {
    next(error);
  }
});

router.post("/ask", askLimiter, async (req, res, next) => {
  const { question, documentId } = req.body ?? {};
  const suppliedIdempotencyKey = req.get("Idempotency-Key");
  if (
    suppliedIdempotencyKey &&
    (suppliedIdempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(suppliedIdempotencyKey))
  ) {
    return res.status(400).json({ error: "Idempotency-Key contains invalid characters or is too long." });
  }
  const idempotencyKey = suppliedIdempotencyKey || randomUUID();
  if (typeof question !== "string" || !question.trim() || question.trim().length > 2000) {
    return res.status(400).json({ error: "Question must contain 1-2000 characters." });
  }
  if (documentId && !mongoose.isValidObjectId(documentId)) {
    return res.status(400).json({ error: "Invalid document ID." });
  }
  if (!process.env.GEMINI_API_KEY || !process.env.CHROMA_URL) {
    return res.status(503).json({
      error: "Question answering is not configured. Set GEMINI_API_KEY and CHROMA_URL in the backend environment.",
    });
  }

  try {
    try {
      await vectorStore.checkVectorStore();
    } catch (error) {
      console.error("ChromaDB health check failed:", error.message);
      return res.status(503).json({ error: "Question answering is unavailable because ChromaDB could not be reached." });
    }

    const docFilter = { owner: req.user.id, status: "ready" };
    if (documentId) docFilter._id = documentId;
    const authorizedDocuments = await Document.find(docFilter).select("_id filename");
    if (documentId && authorizedDocuments.length === 0) {
      return res.status(404).json({ error: "Ready document not found." });
    }
    if (!authorizedDocuments.length) {
      return res.status(409).json({ error: "Upload a ready document before asking a question." });
    }

    let record;
    try {
      record = await Question.create({
        owner: req.user.id,
        idempotencyKey,
        question: question.trim(),
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const previous = await Question.findOne({
        owner: req.user.id,
        idempotencyKey,
      });
      if (!previous) throw error;
      if (previous.status !== "ready") {
        return res.status(409).json({
          error: "A request with this Idempotency-Key is already processing or previously failed.",
        });
      }
      const currentUser = await User.findById(req.user.id);
      const previousLimit =
        currentUser.plan === "pro"
          ? Number(process.env.PRO_QUESTION_LIMIT) || 1000
          : Number(process.env.FREE_QUESTION_LIMIT) || 20;
      return res.status(200).json({
        question: publicQuestion(previous),
        usage: {
          questionsUsed: currentUser.questionCount,
          questionsRemaining: Math.max(0, previousLimit - currentUser.questionCount),
          periodDays: 30,
        },
      });
    }

    const questionLimits = {
      free: Number(process.env.FREE_QUESTION_LIMIT) || 20,
      pro: Number(process.env.PRO_QUESTION_LIMIT) || 1000,
    };
    const limit = questionLimits[req.user.plan] || questionLimits.free;
    const user = await reserveQuestion(req.user.id, limit);
    if (!user) {
      await Question.deleteOne({ _id: record._id });
      return res.status(429).json({ error: "Question quota exceeded for the current 30-day period." });
    }

    try {
      const [queryEmbedding] = await embedTexts([question.trim()], "RETRIEVAL_QUERY");
      const matches = await vectorStore.searchChunks({
        ownerId: req.user.id,
        documentId: documentId || undefined,
        embedding: queryEmbedding,
        limit: Math.min(10, Math.max(1, Number(process.env.TOP_K) || 5)),
      });

      const ids = matches.ids?.[0] || [];
      const texts = matches.documents?.[0] || [];
      const metadatas = matches.metadatas?.[0] || [];
      const distances = matches.distances?.[0] || [];
      const allowed = new Map(authorizedDocuments.map((item) => [item.id, item]));
      const maxDistance = Number(process.env.MAX_VECTOR_DISTANCE) || 1.2;
      const sources = ids.flatMap((_id, index) => {
        const metadata = metadatas[index];
        const document = allowed.get(metadata?.documentId);
        if (!document || metadata.ownerId !== req.user.id || !texts[index]) return [];
        if (typeof distances[index] === "number" && distances[index] > maxDistance) return [];
        return [{
          documentId: document.id,
          filename: document.filename,
          chunkIndex: Number(metadata.chunkIndex),
          excerpt: texts[index].slice(0, 1500),
        }];
      });

      let answer = "I couldn't find enough relevant information in your documents to answer that question.";
      if (sources.length) {
        const context = sources
          .map((source, index) => `[S${index + 1}] ${source.filename} (chunk ${source.chunkIndex}):\n${source.excerpt}`)
          .join("\n\n")
          .slice(0, 12000);
        const generatedAnswer = await generateGeminiAnswer({
          question: question.trim(),
          context,
        });
        answer = generatedAnswer
          .replace(/\[S(\d+)\]/g, (_match, number) =>
            Number(number) <= sources.length ? `[S${number}]` : "",
          )
          .slice(0, 10000);
      }

      record.answer = answer;
      record.sources = sources;
      record.status = "ready";
      await record.save();
      return res.status(200).json({
        question: publicQuestion(record),
        usage: {
          questionsUsed: user.questionCount,
          questionsRemaining: Math.max(0, limit - user.questionCount),
          periodDays: 30,
        },
      });
    } catch (error) {
      record.status = "failed";
      await record.save();
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

export default router;
