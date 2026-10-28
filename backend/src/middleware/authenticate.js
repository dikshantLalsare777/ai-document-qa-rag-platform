import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";

export default async function authenticate(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "This feature is unavailable while MongoDB is disconnected." });
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    return res.status(503).json({ error: "Authentication is unavailable until JWT_SECRET is configured." });
  }
  const authorization = req.get("authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);

  if (!match) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const token = match[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    const user = await User.findById(payload.sub).select(
      "name email plan documentCount questionCount",
    );
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token." });
    }
    return next(error);
  }
}
