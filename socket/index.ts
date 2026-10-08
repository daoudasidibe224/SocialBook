import { Server } from "socket.io";
import type { Request } from "express";
import Session from "../models/session.model";
import User from "../models/user.model";
import { verifySession } from "../utils/session";
import type { Message } from "../shared/contracts";
export interface ServerEvents {
  getMessage: (message: Message) => void;
  sessionReady: () => void;
}
export interface SocketIdentity {
  userId: string;
  sessionId: string;
  expiresAt: number;
}
export type RealtimeServer = Server<
  Record<string, never>,
  ServerEvents,
  Record<string, never>,
  SocketIdentity
>;
export function socketServer(req: Request): RealtimeServer | undefined {
  const server: unknown = req.app.get("io");
  return server instanceof Server ? server : undefined;
}
export default function initializeSocket(io: RealtimeServer) {
  io.use(async (socket, next) => {
    try {
      const token = (socket.request.headers.cookie ?? "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("jwt="))
        ?.slice(4);
      const verified = await verifySession(
        token ? decodeURIComponent(token) : undefined,
      );
      if (!verified) throw new Error("Session invalide");
      const user = await User.findById(verified.session.userId).select("_id");
      if (!user) throw new Error("Compte introuvable");
      socket.data = {
        userId: String(user._id),
        sessionId: verified.session._id,
        expiresAt: verified.expiresAt,
      };
      next();
    } catch {
      next(new Error("Connectez-vous pour ouvrir la messagerie."));
    }
  });
  io.on("connection", (socket) => {
    // Register the revocation room before the final asynchronous validation.
    socket.join(`session:${socket.data.sessionId}`);
    void (async () => {
      const session = await Session.findOne({
        _id: socket.data.sessionId,
        userId: socket.data.userId,
        expiresAt: { $gt: new Date() },
      });
      if (!session || !socket.connected) {
        socket.disconnect(true);
        return;
      }
      const expiresAt = Math.min(
        socket.data.expiresAt,
        session.expiresAt.getTime(),
      );
      if (expiresAt <= Date.now()) {
        socket.disconnect(true);
        return;
      }
      socket.join(`user:${socket.data.userId}`);
      const expiry = setTimeout(
        () => socket.disconnect(true),
        expiresAt - Date.now(),
      );
      expiry.unref();
      socket.on("disconnect", () => clearTimeout(expiry));
      socket.emit("sessionReady");
    })().catch(() => socket.disconnect(true));
  });
}
