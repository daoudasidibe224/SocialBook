import { randomUUID } from "node:crypto";
import type { Response } from "express";
import Session from "../models/session.model";
import { socketServer } from "../socket";
import type { Handler } from "../utils/http";
import User, { loginUser } from "../models/user.model";
import jwt from "jsonwebtoken";
import { text, fail, secret } from "../utils/http";
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});
async function issueSession(res: Response, userId: string) {
  const session = await Session.create({
    userId: userId,
    expiresAt: new Date(Date.now() + 259200000),
  });
  const token = jwt.sign({ id: userId, sid: session._id }, secret(), {
    algorithm: "HS256",
    expiresIn: "3d",
  });
  res.cookie("jwt", token, {
    ...cookieOptions(),
    maxAge: 3 * 24 * 60 * 60 * 1000,
  });
}
export const signUp: Handler = async (req, res) => {
  const pseudo =
    req.body.pseudo === undefined || req.body.pseudo === ""
      ? `membre-${randomUUID().replaceAll("-", "").slice(0, 12)}`
      : text(req.body.pseudo, 55);
  const email = text(req.body.email, 254).toLowerCase();
  const password = req.body.password;
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    Buffer.byteLength(password) > 72
  )
    throw fail(
      400,
      "Le mot de passe doit contenir au moins 8 caractères et au maximum 72 octets.",
    );
  const user = await User.create({ pseudo, email, password });
  await issueSession(res, String(user._id));
  res.status(201).json({ user: user._id });
};
export const signIn: Handler = async (req, res) => {
  const email = text(req.body.email, 254).toLowerCase();
  if (
    typeof req.body.password !== "string" ||
    Buffer.byteLength(req.body.password) > 72
  )
    throw fail(400, "Mot de passe invalide.");
  const user = await loginUser(email, req.body.password);
  if (!user) throw fail(401, "Adresse e-mail ou mot de passe incorrect.");
  await issueSession(res, String(user._id));
  res.json({ user: user._id });
};
export const logout: Handler = async (req, res) => {
  if (req.authSession) {
    await Session.deleteOne({ _id: req.authSession._id });
    socketServer(req)
      ?.in(`session:${req.authSession._id}`)
      .disconnectSockets(true);
  }
  res.clearCookie("jwt", cookieOptions());
  res.status(204).end();
};
