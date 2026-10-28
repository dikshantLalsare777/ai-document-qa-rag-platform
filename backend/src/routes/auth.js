import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import authenticate from "../middleware/authenticate.js";

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const bcryptSaltRounds = 12;

router.use((_req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "Authentication is unavailable while MongoDB is disconnected." });
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    return res.status(503).json({ error: "Authentication is unavailable until JWT_SECRET is configured." });
  }
  return next();
});

function publicProfile(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    plan: user.plan,
    documentCount: user.documentCount,
    questionCount: user.questionCount,
  };
}

function issueToken(user) {
  return jwt.sign({}, process.env.JWT_SECRET, {
    algorithm: "HS256",
    subject: user.id,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function validEmail(email) {
  return typeof email === "string" && email.length <= 254 && emailPattern.test(email.trim());
}

router.post("/register", async (req, res, next) => {
  const { name, email, password } = req.body ?? {};
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    !validEmail(email) ||
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res.status(400).json({
      error: "Provide a name (1-100 characters), valid email, and password (8-72 UTF-8 bytes).",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail }).select("_id");
    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, bcryptSaltRounds);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
    });
    return res.status(201).json({
      token: issueToken(user),
      user: publicProfile(user),
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  const { email, password } = req.body ?? {};
  if (!validEmail(email) || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Provide a valid email and password." });
  }

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
      "+passwordHash",
    );
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    return res.status(200).json({
      token: issueToken(user),
      user: publicProfile(user),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", authenticate, (req, res) => {
  res.status(200).json({ user: publicProfile(req.user) });
});

router.post("/logout", authenticate, (_req, res) => {
  res.status(204).end();
});

export default router;
