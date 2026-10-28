import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    filename: { type: String, required: true, maxlength: 255 },
    storedPath: { type: String, required: true, select: false },
    contentHash: { type: String, select: false },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
      index: true,
    },
    chunkCount: { type: Number, default: 0, min: 0 },
    processingError: { type: String, default: null },
  },
  { timestamps: true },
);

documentSchema.index({ owner: 1, createdAt: -1 });
documentSchema.index(
  { owner: 1, contentHash: 1 },
  { unique: true, partialFilterExpression: { contentHash: { $type: "string" } } },
);

export default mongoose.models.Document || mongoose.model("Document", documentSchema);
