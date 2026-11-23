import { Router } from "express";
import { optionalVerifyToken } from "../middleware/auth.js";
import { applications, users, tuitions } from "../config/db.js";
import { publicTuitionFields } from "../config/tuition-fields.js";

export const router = Router();

// GET /new-tuitions: latest 7 approved, active tuitions.
// Tutor names are included only for authenticated users.
router.get("/new-tuitions", optionalVerifyToken, async (req, res) => {
  try {
    const projection = req.user
      ? { ...publicTuitionFields, tutorName: 1 }
      : publicTuitionFields

    const result = await tuitions
      .find(
        {
          approvalStatus: "approved",
          isActive: true,
        },
        { projection }
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(7)
      .toArray()

    // The response differs depending on the signed-in user.
    res.set("Cache-Control", "private, no-store")
    res.status(200).json(result)
  } catch (error) {
    console.error("Failed to fetch new tuitions:", error)
    res.status(500).json({
      message: "Failed to fetch new tuitions",
    })
  }
})

// Api for platform stats in homepage

router.get("/platform-stats", async (req, res) => {
  try {
    const [topSubjects, students, tutors, tuitionsCount] =
      await Promise.all([
        applications.aggregate([
          {
            $match: {
              subject: { $type: "string", $ne: "" },
            },
          },
          {
            $group: {
              _id: "$subject",
              applicationCount: { $sum: 1 },
            },
          },
          { $sort: { applicationCount: -1, _id: 1 } },
          { $limit: 4 },
          {
            $project: {
              _id: 0,
              subject: "$_id",
              applicationCount: 1,
            },
          },
        ]).toArray(),

        users.countDocuments({ role: "student" }),
        users.countDocuments({ role: "tutor" }),
        tuitions.countDocuments({
          approvalStatus: "approved",
          isActive: true,
        }),
      ])

    res.json({
      topSubjects,
      students,
      tutors,
      tuitions: tuitionsCount,
    })
  } catch (error) {
    console.error("Failed to fetch platform statistics:", error)
    res.status(500).json({ message: "Failed to fetch platform statistics" })
  }
})
