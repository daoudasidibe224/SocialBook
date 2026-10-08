import mongoose from "mongoose";
import type { Request, RequestHandler } from "express";
import type { HydratedDocument, InferSchemaType } from "mongoose";
import Session from "../models/session.model";
import User from "../models/user.model";
export type Account = HydratedDocument<InferSchemaType<typeof User.schema>>;
declare module "express-serve-static-core" {
  interface Request {
    user: Account | null;
    authSession: HydratedDocument<
      InferSchemaType<typeof Session.schema>
    > | null;
  }
}
export type Handler = RequestHandler<
  Record<string, string>,
  unknown,
  Record<string, unknown>
>;
export const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status });
export const currentUser = (req: Request): Account => {
  if (!req.user) throw fail(401, "Connectez-vous pour continuer.");
  return req.user;
};
export const id = (value: unknown): string => {
  if (typeof value !== "string" || !mongoose.isObjectIdOrHexString(value))
    throw fail(400, "Identifiant invalide.");
  return value;
};
export const text = (value: unknown, max: number, optional = false): string => {
  if (optional && value == null) return "";
  if (
    typeof value !== "string" ||
    (!optional && !value.trim()) ||
    value.trim().length > max
  )
    throw fail(400, `Texte requis, limité à ${max} caractères.`);
  return value.trim();
};
export const found = <T>(value: T): NonNullable<T> => {
  if (value == null) throw fail(404, "Élément introuvable.");
  return value;
};
export const owns = (owner: unknown, req: Request) => {
  if (String(owner) !== String(currentUser(req)._id))
    throw fail(403, "Cette action ne vous est pas autorisée.");
};
export const secret = (): string => {
  const value = process.env.TOKEN_SECRET;
  if (!value || value.length < 32)
    throw new Error("TOKEN_SECRET doit contenir au moins 32 caractères.");
  return value;
};
