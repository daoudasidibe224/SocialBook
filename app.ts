import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "node:path";
import { currentUser } from "./utils/http";
import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import userRoutes from "./routes/user.routes";
import postRoutes from "./routes/post.routes";
import messageRoutes from "./routes/messages.routes";
import conversationRoutes from "./routes/conversations.routes";
import { uploadDirectory } from "./utils/image-storage";
import { checkUser, requireAuth } from "./middleware/auth.middleware";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: (origin, callback) =>
        callback(null, !origin || origin === process.env.CLIENT_URL),
      credentials: true,
    }),
  );
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") &&
      req.get("origin") !== process.env.CLIENT_URL
    )
      return res.status(403).json({ message: "Origine non autorisée." });
    next();
  });
  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/uploads", express.static(uploadDirectory()));
  app.use(
    "/uploads",
    express.static(path.join(process.cwd(), "client/public/uploads")),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};
    if (!z.record(z.string(), z.unknown()).safeParse(req.body).success) {
      res.status(400).json({ message: "Corps de requête invalide." });
      return;
    }
    next();
  });
  app.use(cookieParser());
  app.use(checkUser);
  app.get("/jwtid", requireAuth, (req, res) =>
    res.json(String(currentUser(req)._id)),
  );
  app.use("/api/user", userRoutes);
  app.use("/api/post", postRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/conversations", conversationRoutes);
  if (process.env.NODE_ENV === "production") {
    const clientDirectory = path.join(process.cwd(), "client/dist");
    app.use(express.static(clientDirectory));
    app.get("/{*path}", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDirectory, "index.html"));
    });
  }
  app.use((req, res) =>
    res.status(404).json({ message: "Route introuvable." }),
  );
  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    next,
  ) => {
    const parsed = z
      .object({
        code: z.union([z.number(), z.string()]).optional(),
        name: z.string().optional(),
        status: z.number().int().min(400).max(599).optional(),
        message: z.string().optional(),
      })
      .safeParse(error);
    const err = parsed.success ? parsed.data : {};

    if (res.headersSent) return next(error);
    const status =
      err.code === "LIMIT_FILE_SIZE"
        ? 413
        : err.code === 11000
          ? 409
          : err.name === "ValidationError" ||
              err.name === "CastError" ||
              err.name === "MulterError"
            ? 400
            : err.status || 500;
    const message =
      status === 413
        ? "La photo ne doit pas dépasser 500 Ko."
        : status === 409
          ? "Ce pseudo ou cette adresse e-mail est déjà utilisé."
          : status === 500
            ? "Le serveur ne peut pas traiter cette demande."
            : err.name === "ValidationError"
              ? "Vérifiez les informations saisies."
              : err.message;
    if (status === 500) console.error(error);
    res.status(status).json({ message });
  };
  app.use(errorHandler);
  return app;
}
export default createApp();
