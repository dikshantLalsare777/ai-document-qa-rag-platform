import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import authenticate from "../middleware/authenticate.js";
import Document from "../models/Document.js";
import User from "../models/User.js";
import { buildChunks, extractText, safeUploadName, uploadDirectory } from "../services/documentProcessing.js";
import { vectorStore } from "../services/vectorStore.js";

const router = Router();
const uploadRoot = uploadDirectory();
const tempDirectory = path.join(uploadRoot, ".tmp");
const maxFileSizeMb =
  process.env.MAX_FILE_SIZE_MB === undefined || process.env.MAX_FILE_SIZE_MB === ""
    ? 10
    : Number(process.env.MAX_FILE_SIZE_MB);
if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0 || maxFileSizeMb > 100) {
  throw new Error("MAX_FILE_SIZE_MB must be a number greater than 0 and no greater than 100.");
}
const maxFileSize = maxFileSizeMb * 1024 * 1024;
const acceptedMimeTypes = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".txt": ["text/plain"],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        await fs.mkdir(tempDirectory, { recursive: true });
        callback(null, tempDirectory);
      } catch (error) {
        callback(error);
      }
    },
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`),
  }),
  limits: { fileSize: maxFileSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!acceptedMimeTypes[extension]?.includes(file.mimetype)) {
      return callback(Object.assign(new Error("Only PDF, DOCX, and TXT files are supported."), {
        status: 415,
      }));
    }
    return callback(null, true);
  },
});

function publicDocument(document) {
  return {
    id: document.id,
    filename: document.filename,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    status: document.status,
    chunkCount: document.chunkCount,
    processingError: document.processingError,
    createdAt: document.createdAt,
  };
}

router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const pageInput = Number(req.query.page || 1);
    const limitInput = Number(req.query.limit || 20);
    if (!Number.isSafeInteger(pageInput) || pageInput < 1 || !Number.isSafeInteger(limitInput) || limitInput < 1) {
      return res.status(400).json({ error: "Page and limit must be positive integers." });
    }
    const page = Math.min(pageInput, 1_000_000);
    const limit = Math.min(50, limitInput);
    const filter = { owner: req.user.id };
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      filter.filename = { $regex: req.query.search.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    const [documents, total] = await Promise.all([
      Document.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Document.countDocuments(filter),
    ]);
    res.json({ documents: documents.map(publicDocument), page, limit, total });
  } catch (error) {
    next(error);
  }
});

router.post("/upload", (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (error) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : error.status || 400;
      return res.status(status).json({
        error: status === 413 ? "File exceeds the configured size limit." : error.message,
      });
    }
    next();
  });
}, async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "Select a document to upload." });
  if (!req.file.size) {
    await fs.rm(req.file.path, { force: true });
    return res.status(422).json({ error: "The uploaded file is empty." });
  }
  if (!process.env.GEMINI_API_KEY || !process.env.CHROMA_URL) {
    await fs.rm(req.file.path, { force: true });
    return res.status(503).json({
      error: "Document processing requires GEMINI_API_KEY and CHROMA_URL to be configured.",
    });
  }
  try {
    await vectorStore.checkVectorStore();
  } catch (error) {
    console.error("ChromaDB health check failed:", error.message);
    await fs.rm(req.file.path, { force: true });
    return res.status(503).json({ error: "Document processing is unavailable because ChromaDB could not be reached." });
  }

  const limits = {
    free: Number(process.env.FREE_DOCUMENT_LIMIT) || 5,
    pro: Number(process.env.PRO_DOCUMENT_LIMIT) || 100,
  };
  const maxDocuments = limits[req.user.plan] || limits.free;
  let reserved = false;
  let storedPath;
  let document;
  const temporaryPath = req.file.path;

  try {
    const contentHash = createHash("sha256")
      .update(await fs.readFile(temporaryPath))
      .digest("hex");
    const duplicate = await Document.findOne({
      owner: req.user.id,
      contentHash,
    }).select("_id");
    if (duplicate) {
      return res.status(409).json({ error: "This document has already been uploaded." });
    }

    const owner = await User.findOneAndUpdate(
      { _id: req.user.id, documentCount: { $lt: maxDocuments } },
      { $inc: { documentCount: 1 } },
      { new: true },
    );
    if (!owner) {
      await fs.unlink(temporaryPath);
      return res.status(429).json({ error: "Document quota exceeded." });
    }
    reserved = true;

    const extension = path.extname(req.file.originalname).toLowerCase();
    const ownerDirectory = path.join(uploadRoot, req.user.id);
    await fs.mkdir(ownerDirectory, { recursive: true });
    storedPath = path.join(ownerDirectory, safeUploadName(extension));
    await fs.rename(temporaryPath, storedPath);

    const filename = path.basename(req.file.originalname).replace(/[\u0000-\u001f]/g, "").slice(0, 255);
    document = await Document.create({
      owner: req.user.id,
      filename,
      storedPath,
      contentHash,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      status: "processing",
    });
    const extractedText = await extractText(storedPath, extension);
    const { chunks, embeddings } = await buildChunks({
      text: extractedText,
      ownerId: req.user.id,
      documentId: document.id,
      filename,
    });
    await vectorStore.upsertChunks(chunks, embeddings);
    document.status = "ready";
    document.chunkCount = chunks.length;
    await document.save();
    return res.status(201).json({ document: publicDocument(document) });
  } catch (error) {
    if (document) {
      try {
        await vectorStore.removeDocumentVectors(req.user.id, document.id);
      } catch (cleanupError) {
        console.error("Could not clean up partial vector records:", cleanupError.message);
      }
      await Document.deleteOne({ _id: document._id, owner: req.user.id });
    }
    if (storedPath) await fs.rm(storedPath, { force: true });
    if (reserved) await User.updateOne({ _id: req.user.id }, { $inc: { documentCount: -1 } });
    if (error.code === 11000 && error.keyPattern?.contentHash) {
      return res.status(409).json({ error: "This document has already been uploaded." });
    }
    return next(error);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
});

router.delete("/:id", async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: "Invalid document ID." });
  }
  try {
    const document = await Document.findOne({ _id: req.params.id, owner: req.user.id }).select("+storedPath");
    if (!document) return res.status(404).json({ error: "Document not found." });

    await vectorStore.removeDocumentVectors(req.user.id, document.id);
    await fs.rm(document.storedPath, { force: true });
    await Document.deleteOne({ _id: document._id, owner: req.user.id });
    await User.updateOne({ _id: req.user.id, documentCount: { $gt: 0 } }, { $inc: { documentCount: -1 } });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
