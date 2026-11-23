import { Router } from "express";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { validateId, requireOwnId } from "../middleware/ownership.js";
import { savedTuitions, tuitions } from "../config/db.js";

export const router = Router();

// Saved tuitions api route 
// POST /saved-tuitions: Saves a tuition for a student or reports that it was already saved.
router.post("/", verifyToken, verifyStudent, async (req, res) => {
  try {
    const { tuitionId } = req.body
    const studentId = req.user._id.toString()

    if (
      typeof tuitionId !== "string" ||
      !ObjectId.isValid(tuitionId)
    ) {
      return res.status(400).json({
        message: "A valid tuition ID is required.",
      })
    }

    const normalizedTuitionId = new ObjectId(tuitionId).toString()

    const result = await savedTuitions.updateOne(
      {
        studentId,
        tuitionId: normalizedTuitionId,
      },
      {
        $setOnInsert: {
          createdAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    )

    res.json({
      saved: true,
      alreadySaved: result.upsertedCount === 0,
    })
  } catch (error) {
    // Handles two simultaneous requests for the same bookmark.
    if (error.code === 11000) {
      return res.json({
        saved: true,
        alreadySaved: true,
      })
    }

    console.error(error)
    res.status(500).json({
      message: "Failed to save tuition.",
    })
  }
})

// GET /saved-tuitions/student/:studentId: Fetches a student's saved tuitions and their listing details.
router.get("/student/:studentId", verifyToken, verifyStudent, requireOwnId("studentId"), async (req, res) => {
  try {
    const bookmarks = await savedTuitions
      .find({ studentId: req.params.studentId })
      .sort({ createdAt: -1 })
      .toArray()

    const tuitionIds = bookmarks.map(
      (bookmark) => new ObjectId(bookmark.tuitionId)
    )

    const tuitionRecords = await tuitions
      .find({ _id: { $in: tuitionIds } })
      .toArray()

    const result = bookmarks.map((bookmark) => ({
      ...bookmark,
      tuition:
        tuitionRecords.find(
          (tuition) => tuition._id.toString() === bookmark.tuitionId
        ) || null,
    }))

    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to load saved tuitions.",
    })
  }
})

// DELETE /saved-tuitions/:id: Removes a saved tuition by bookmark ID.
router.delete("/:id", verifyToken, verifyStudent, validateId, async (req, res) => {
  try {
    const result = await savedTuitions.deleteOne({
      _id: new ObjectId(req.params.id),
      studentId: req.user._id.toString(),
    })

    res.send(result)
  } catch (error) {
    res.status(500).send({
      message: "Failed to remove saved tuition.",
    })
  }
})
