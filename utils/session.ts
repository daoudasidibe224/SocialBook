import jwt from "jsonwebtoken";
import { z } from "zod";
import Session from "../models/session.model";
import { secret } from "./http";
const payloadSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
  sid: z.uuid(),
  exp: z.number().int().positive(),
});
export async function verifySession(token: unknown) {
  if (typeof token !== "string") return null;
  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(
      jwt.verify(token, secret(), { algorithms: ["HS256"] }),
    );
  } catch {
    return null;
  }
  const session = await Session.findOne({
    _id: payload.sid,
    userId: payload.id,
    expiresAt: { $gt: new Date() },
  });
  return session
    ? {
        session,
        expiresAt: Math.min(session.expiresAt.getTime(), payload.exp * 1000),
      }
    : null;
}
