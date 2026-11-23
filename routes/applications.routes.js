import { Router } from "express";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { validateId, requireOwnId } from "../middleware/ownership.js";
import { applications, tuitions } from "../config/db.js";

export const router = Router();

async function getApplicationCounts(query) {
  return {
    all: await applications.countDocuments(query),
    pending: await applications.countDocuments({
      ...query,
      status: "pending",
    }),
    accepted: await applications.countDocuments({
      ...query,
      status: "accepted",
    }),
    rejected: await applications.countDocuments({
      ...query,
      status: "rejected",
    }),
  }
}

// POST /applications: Submits an application and rejects duplicate applications for the same tuition.
router.post("/", verifyToken, verifyStudent, async (req, res) => {
  try {
    const { tuitionId, phone, preferredSchedule, learningNote } = req.body
    if (typeof tuitionId !== "string" || !ObjectId.isValid(tuitionId)) {
      return res.status(400).send({ message: "Invalid tuition ID." })
    }
    const tuition = await tuitions.findOne({
      _id: new ObjectId(tuitionId), approvalStatus: "approved", isActive: true,
    })
    if (!tuition) return res.status(404).send({ message: "Tuition not found." })
    const application = {
      tuitionId: tuition._id.toString(),
      applicantId: req.user._id.toString(),
      applicantName: req.user.name,
      applicantEmail: req.user.email,
      tutorId: tuition.tutorId,
      tutorName: tuition.tutorName,
      tutorEmail: tuition.tutorEmail,
      tuitionTitle: tuition.title,
      bannerImage: tuition.bannerImage,
      subject: tuition.subject,
      classLevel: tuition.classLevel,
      monthlyFee: tuition.monthlyFee,
      phone, preferredSchedule, learningNote,
      status: "pending",
      createdAt: new Date().toISOString(),
    }
    const result = await applications.insertOne(application)

    res.send(result)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).send({
        message: "You have already applied for this tuition.",
      })
    }

    res.status(500).send({
      message: "Failed to submit application.",
    })
  }
})

// GET /applications/student/:applicantId: Fetches a student's applications with search, status filtering, and counts.
router.get("/student/:applicantId", verifyToken, verifyStudent, requireOwnId("applicantId"), async (req, res) => {
  try {
    const query = {
      applicantId: req.params.applicantId,
    }

    const search = String(req.query.search || "").trim()

    if (search) {
      const escapedSearch = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )

      query.$or = [
        { tuitionTitle: { $regex: escapedSearch, $options: "i" } },
        { subject: { $regex: escapedSearch, $options: "i" } },
        { tutorName: { $regex: escapedSearch, $options: "i" } },
        { tutorEmail: { $regex: escapedSearch, $options: "i" } },
      ]
    }

    // Count across all statuses before adding the selected status.
    const counts = await getApplicationCounts(query)

    if (["pending", "accepted", "rejected"].includes(req.query.status)) {
      query.status = req.query.status
    }

    const result = await applications
      .find(query)
      .sort({ createdAt: -1 })
      .toArray()

    res.json({
      applications: result,
      counts,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to load your applications.",
    })
  }
})

// GET /applications/tutor/:tutorId: Fetches a tutor's applications with search, status filtering, and counts.
router.get("/tutor/:tutorId", verifyToken, verifyTutor, requireOwnId("tutorId"), async (req, res) => {
  try {
    const query = {
      tutorId: req.params.tutorId,
    }

    const search = String(req.query.search || "").trim()

    if (search) {
      const escapedSearch = search.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )

      query.$or = [
        { applicantName: { $regex: escapedSearch, $options: "i" } },
        { applicantEmail: { $regex: escapedSearch, $options: "i" } },
        { tuitionTitle: { $regex: escapedSearch, $options: "i" } },
        { subject: { $regex: escapedSearch, $options: "i" } },
      ]
    }

    const counts = await getApplicationCounts(query)

    if (["pending", "accepted", "rejected"].includes(req.query.status)) {
      query.status = req.query.status
    }

    const result = await applications
      .find(query)
      .sort({ createdAt: -1 })
      .toArray()

    res.json({
      applications: result,
      counts,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to load applicants.",
    })
  }
})

// PATCH /applications/:id/status: Sets an application status to accepted or rejected.
router.patch("/:id/status", verifyToken, verifyTutor, validateId, async (req, res) => {
  try {
    const { status } = req.body

    if (status !== "accepted" && status !== "rejected") {
      return res.status(400).json({
        message: "Select accepted or rejected.",
      })
    }

    const application = await applications.findOne({
      _id: new ObjectId(req.params.id), tutorId: req.user._id.toString(),
    })
    if (!application || !ObjectId.isValid(application.tuitionId)) {
      return res.status(404).send({ message: "Application not found." })
    }
    const tuition = await tuitions.findOne({
      _id: new ObjectId(application.tuitionId), tutorId: req.user._id.toString(),
    })
    if (!tuition) return res.status(404).send({ message: "Application not found." })

    const result = await applications.updateOne(
      { _id: application._id, tutorId: req.user._id.toString() },
      { $set: { status } }
    )

    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to update application status.",
    })
  }
})

// DELETE /applications/:id: Cancels an application only if its status is pending.
router.delete("/:id", verifyToken, verifyStudent, validateId, async (req, res) => {
  try {
    const result = await applications.deleteOne({
      _id: new ObjectId(req.params.id),
      applicantId: req.user._id.toString(),
      status: "pending",
    })

    res.send(result)
  } catch (error) {
    res.status(500).send({
      message: "Failed to cancel application.",
    })
  }
})
