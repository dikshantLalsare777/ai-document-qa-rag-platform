import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import authRouter from "./routes/auth.js";
import documentRouter from "./routes/documents.js";
import questionRouter from "./routes/questions.js";
import usageRouter from "./routes/usage.js";

const app = express();
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);

if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
}

app.disable("x-powered-by");
app.set("trust proxy", trustProxyHops);
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",").map((value) => value.trim())
      : process.env.NODE_ENV === "production"
        ? false
        : "http://localhost:5173",
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "ai-document-qa-rag-api",
    dependencies: {
      mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    },
    ready: mongoose.connection.readyState === 1,
  });
});

app.get("/api/ready", (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    dependencies: { mongodb: ready ? "connected" : "disconnected" },
  });
});

app.use(
  "/api/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
app.use("/api/auth", authRouter);
app.use("/api/documents", documentRouter);
app.use("/api/questions", questionRouter);
app.use("/api/usage", usageRouter);

app.use((_req, res) => {
  res.status(404).json({
    error: "Not Found",
  });
});

app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
  if (status >= 500) {
    const category = /^[A-Z0-9_]+$/.test(String(err.code || ""))
      ? err.code
      : err.name || "InternalError";
    console.error(`[api-error] status=${status} category=${category}`);
  }
  res.status(status).json({
    error:
      err.publicMessage ||
      (status >= 500
        ? process.env.NODE_ENV === "production"
          ? "Internal Server Error"
          : "The request could not be completed."
        : err.message || "Bad Request"),
  });
});

export default app;
