import User from "../models/user.model";
import { verifySession } from "../utils/session";
import type { Handler } from "../utils/http";
export const checkUser: Handler = async (req, _res, next) => {
  req.user = null;
  req.authSession = null;
  const verified = await verifySession(req.cookies?.jwt);
  if (verified) {
    const user = await User.findById(verified.session.userId).select(
      "-password",
    );
    if (user) {
      req.user = user;
      req.authSession = verified.session;
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
