import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const questionSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    idempotencyKey: { type: String, required: true, default: randomUUID, select: false },
    status: { type: String, enum: ["processing", "ready", "failed"], default: "processing" },
    question: { type: String, required: true, maxlength: 2000 },
    answer: { type: String, default: "", maxlength: 10000 },
    sources: [
      {
        documentId: { type: mongoose.Schema.Types.ObjectId, required: true },
        filename: { type: String, required: true },
        chunkIndex: { type: Number, required: true },
        excerpt: { type: String, required: true },
      },
    ],
  },
  { timestamps: true },
);

questionSchema.index({ owner: 1, createdAt: -1 });
questionSchema.index({ owner: 1, idempotencyKey: 1 }, { unique: true });

export default mongoose.models.Question || mongoose.model("Question", questionSchema);
