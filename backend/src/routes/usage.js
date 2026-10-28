import { Router } from "express";
import authenticate from "../middleware/authenticate.js";
import Document from "../models/Document.js";
import User from "../models/User.js";

const router = Router();
router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    const documentLimits = {
      free: Number(process.env.FREE_DOCUMENT_LIMIT) || 5,
      pro: Number(process.env.PRO_DOCUMENT_LIMIT) || 100,
    };
    const questionLimits = {
      free: Number(process.env.FREE_QUESTION_LIMIT) || 20,
      pro: Number(process.env.PRO_QUESTION_LIMIT) || 1000,
    };
    const documentCount = await Document.countDocuments({ owner: req.user.id });
    const periodIsCurrent =
      user.questionPeriodStart &&
      user.questionPeriodStart.getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000;
    const questionCount = periodIsCurrent ? user.questionCount : 0;
    const plan = user.plan in documentLimits ? user.plan : "free";
    res.json({
      plan,
      documents: {
        used: documentCount,
        limit: documentLimits[plan],
        remaining: Math.max(0, documentLimits[plan] - documentCount),
      },
      questions: {
        used: questionCount,
        limit: questionLimits[plan],
        remaining: Math.max(0, questionLimits[plan] - questionCount),
        periodDays: 30,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
