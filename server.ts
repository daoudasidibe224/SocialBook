import path from "node:path";
import dotenv from "dotenv";
import { createServer } from "node:http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import { createApp } from "./app";
import connect from "./config/db";
import type { ServerEvents, SocketIdentity } from "./socket";
import initializeSocket from "./socket";
import { purgeOrphanImages } from "./utils/image-storage";
import { runtimeConfiguration, imageConfiguration } from "./config/runtime";
dotenv.config({ path: [path.join(process.cwd(), ".env")], quiet: true });
async function start() {
  const configuration = runtimeConfiguration();
  imageConfiguration();
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
  const io = new Server<
    Record<string, never>,
    ServerEvents,
    Record<string, never>,
    SocketIdentity
  >(server, {
    cors: { origin: process.env.CLIENT_URL, credentials: true },
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin || req.headers.origin === process.env.CLIENT_URL,
      ),
  });
  app.set("io", io);
  initializeSocket(io);
  server.listen(configuration.PORT, configuration.HOST, () =>
    console.log(`Communauté sportive écoute sur le port ${configuration.PORT}`),
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
