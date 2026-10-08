import { Router } from "express";
const router = Router();
import { requireAuth } from "../middleware/auth.middleware";
router.use(requireAuth);
import * as conversationController from "../controllers/conversation.controller";

//new conv
router.post("/", conversationController.newConversation);

router.patch("/:id/pin", conversationController.setPinned);

//get conv of a user
router.get("/:id", conversationController.getUserConv);

// get conv includes two userId
router.get(
  "/find/:firstUserId/:secondUserId",
  conversationController.getUsersConv,
);

export default router;
