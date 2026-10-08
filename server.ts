import path from "node:path";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { createApp } from "./app";
import connect from "./config/db";
import initializeSocket from "./socket";
import { purgeOrphanImages } from "./utils/image-storage";
dotenv.config({ path: [path.join(process.cwd(), ".env")], quiet: true });
async function start() {
  if (
    !process.env.MONGODB_URI ||
    !process.env.CLIENT_URL ||
    !process.env.TOKEN_SECRET ||
    process.env.TOKEN_SECRET.length < 32
  )
    throw new Error(
      "Renseignez MONGODB_URI, CLIENT_URL et un TOKEN_SECRET de 32 caractères minimum dans .env.",
    );
  await connect();
  let purging = false;
  const purge = async () => {
    if (purging) return;
    purging = true;
    try {
      await purgeOrphanImages();
    } catch (error: unknown) {
      console.error("Purge des photos à réessayer.", error);
    } finally {
      purging = false;
    }
  };
  await purge();
  const purgeTimer = setInterval(() => {
    void purge();
  }, 3_600_000);
  purgeTimer.unref();
  const app = createApp();
  const server = createServer(app);
  const io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL, credentials: true },
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin || req.headers.origin === process.env.CLIENT_URL,
      ),
  });
  app.set("io", io);
  initializeSocket(io);
  server.listen(process.env.PORT || 5000, () =>
    console.log(`SocialBook écoute sur le port ${process.env.PORT || 5000}`),
  );
  const stop = () => {
    clearInterval(purgeTimer);
    io.close(() => {
      mongoose.disconnect().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
