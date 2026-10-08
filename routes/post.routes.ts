import { Router } from "express";
const router = Router();
import { requireAuth } from "../middleware/auth.middleware";
router.use(requireAuth);
import * as postController from "../controllers/post.controller";
import { upload } from "../utils/upload";

router.get("/", postController.readPost);
router.post("/", upload.single("file"), postController.createPost);
router.put("/:id", postController.updatePost);
router.delete("/:id", postController.deletePost);
router.patch("/like-post/:id", postController.likePost);
router.patch("/unlike-post/:id", postController.unlikePost);

// commentaires
router.patch("/comment-post/:id", postController.commentPost);
router.patch("/edit-comment-post/:id", postController.editCommentPost);
router.patch("/delete-comment-post/:id", postController.deleteCommentPost);

export default router;
