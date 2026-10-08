import jwt from "jsonwebtoken";
import User from "../models/user.model";
import { id, secret, type Handler } from "../utils/http";
export const checkUser: Handler = async (req, _res, next) => {
  const cookie: unknown = req.cookies?.jwt;
  req.user = null;
  if (typeof cookie === "string") {
    let decoded;
    try {
      decoded = jwt.verify(cookie, secret(), { algorithms: ["HS256"] });
    } catch {
      next();
      return;
    }
    if (typeof decoded === "object") {
      let userId: string;
      try {
        userId = id(decoded.id);
      } catch {
        next();
        return;
      }
      req.user = await User.findById(userId).select("-password");
    }
  }
  next();
};
export const requireAuth: Handler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ message: "Connectez-vous pour continuer." });
    return;
  }
  next();
};
