import type { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/user.model";
import { id, secret } from "../utils/http";
export default function initializeSocket(io: Server) {
  io.use(async (socket, next) => {
    try {
      const cookie = socket.request.headers.cookie || "";
      const token = cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("jwt="))
        ?.slice(4);
      if (!token) throw new Error("Connexion requise");
      const decoded = jwt.verify(token, secret(), { algorithms: ["HS256"] });
      if (typeof decoded !== "object") throw new Error("Session invalide");
      const user = await User.findById(id(decoded.id)).select("_id");
      if (!user) throw new Error("Compte introuvable");
      socket.data.userId = String(user._id);
      next();
    } catch {
      next(new Error("Connexion requise"));
    }
  });
  io.on("connection", (socket) => {
    socket.join(`user:${String(socket.data.userId)}`);
  });
}
