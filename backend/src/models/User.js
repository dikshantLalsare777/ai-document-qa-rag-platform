import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    plan: {
      type: String,
      default: "free",
    },
    documentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    questionCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    questionPeriodStart: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

export default mongoose.models.User || mongoose.model("User", userSchema);
