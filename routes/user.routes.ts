import { Router } from "express";
const router = Router();
import * as auth from "../controllers/auth.controller";
import * as user from "../controllers/user.controller";
import { requireAuth } from "../middleware/auth.middleware";
import { upload } from "../utils/upload";
import { uploadProfil } from "../controllers/upload.controller";
import { rateLimit } from "express-rate-limit";
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Trop de tentatives. Réessayez dans quelques minutes." },
});
router.post("/register", loginLimit, auth.signUp);
router.post("/login", loginLimit, auth.signIn);
router.post("/logout", auth.logout);
router.use(requireAuth);
router.get("/", user.getAllUsers);
router.get("/followings/:id", user.getFollowings);
router.post("/upload", upload.single("file"), uploadProfil);
router.get("/:id", user.userInfo);
router.put("/:id", user.updateUser);
router.delete("/:id", user.deleteUser);
router.patch("/follow/:id", user.follow);
router.patch("/unfollow/:id", user.unfollow);
export default router;
