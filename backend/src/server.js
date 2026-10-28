import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";

const port = Number(process.env.PORT) || 5000;
const reconnectDelayMs = 5000;
let reconnectTimer;

async function startServer() {
  const mongoUri = process.env.MONGODB_URI;
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret || jwtSecret.length < 32) {
    console.error("JWT_SECRET is missing or too short; authentication endpoints will not work.");
  }

  const server = app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });

  async function connectMongo() {
    if (!mongoUri) {
      console.error("MONGODB_URI is not configured; API is live but database-backed routes are unavailable.");
      return;
    }

    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log("Connected to MongoDB.");
    } catch (error) {
      console.error(`MongoDB connection failed: ${error.message}`);
      reconnectTimer = setTimeout(connectMongo, reconnectDelayMs);
      reconnectTimer.unref();
    }
  }
  void connectMongo();

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      clearTimeout(reconnectTimer);
      server.close(async (error) => {
        if (error) {
          console.error("Error while shutting down the API server:", error);
          process.exitCode = 1;
        }

        try {
          await mongoose.disconnect();
        } catch (disconnectError) {
          console.error("Error while disconnecting from MongoDB:", disconnectError);
          process.exitCode = 1;
        }
      });
    });
  }
}

startServer();
