import { Router } from "express";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { tuitions } from "../config/db.js";

export const router = Router();

// GET /admin/tuitions: Fetches listings with class, subject, mode, and approval filters and sorting.

router.get("/tuitions", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const {
      classLevel = "",
      subject = "",
      mode = "",
      sort = "newest",
      approvalStatus = "",
    } = req.query

    const query = {}

    if (classLevel) query.classLevel = String(classLevel)
    if (subject) query.subject = String(subject)

    if (mode === "Online" || mode === "Offline") {
      query.mode = mode
    }

    if (["pending", "approved", "rejected"].includes(approvalStatus)) {
      query.approvalStatus = approvalStatus
    }

    const result = await tuitions
      .find(query)
      .sort({ createdAt: sort === "oldest" ? 1 : -1 })
      .toArray()

    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to load admin tuitions.",
    })
  }
})
