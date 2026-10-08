import { Router } from "express";
const router = Router();
import { requireAuth } from "../middleware/auth.middleware";
router.use(requireAuth);
import * as messageController from "../controllers/message.controller";

router.post("/", messageController.postMessage);
router.get("/:conversationId", messageController.getMessage);

export default router;
