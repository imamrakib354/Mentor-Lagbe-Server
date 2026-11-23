import { Router } from "express";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { validateId, requireOwnId } from "../middleware/ownership.js";
import { tuitions, users } from "../config/db.js";
import { publicTuitionFields } from "../config/tuition-fields.js";

export const router = Router();

// tuitions related api
// POST /tuitions: Creates a tuition listing using the request body.
router.post("/", verifyToken, verifyTutor, async (req, res) => {
  const { title, subject, classLevel, mode, location, monthlyFee, daysPerWeek,
    classTimes, description, bannerImage, isActive } = req.body;
  const tuition = {
    title, subject, classLevel, mode, location, monthlyFee, daysPerWeek,
    classTimes, description, bannerImage,
    isActive: typeof isActive === "boolean" ? isActive : true,
    tutorId: req.user._id.toString(),
    tutorName: req.user.name,
    tutorEmail: req.user.email,
    approvalStatus: "pending",
    createdAt: new Date().toISOString(),
  };
  const result = await tuitions.insertOne(tuition);
  res.send(result);
});

const PAGE_SIZE = 6

// GET /tuitions: Fetches a page of approved, active listings with search, filters, and sorting.
router.get("/", async (req, res) => {
  try {
    const {
      search = "",
      subject = "",
      classLevel = "",
      mode = "",
      sort = "newest",
    } = req.query

    const requestedPage = Math.max(Number(req.query.page) || 1, 1)

    // Public listings must always be approved and active.
    const query = {
      approvalStatus: "approved",
      isActive: true,
    }

    if (subject) query.subject = String(subject)
    if (classLevel) query.classLevel = String(classLevel)

    if (mode === "Online" || mode === "Offline") {
      query.mode = mode
    }

    if (search.trim()) {
      const escapedSearch = String(search)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

      query.$or = [
        { title: { $regex: escapedSearch, $options: "i" } },
        { subject: { $regex: escapedSearch, $options: "i" } },
      ]
    }

    const total = await tuitions.countDocuments(query)
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
    const page = Math.min(requestedPage, totalPages)

    const result = await tuitions
      .find(query, { projection: publicTuitionFields })
      .sort({ createdAt: sort === "oldest" ? 1 : -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .toArray()

    res.json({
      tuitions: result,
      total,
      page,
      pageSize: PAGE_SIZE,
      totalPages,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Failed to load tuitions." })
  }
})

// GET /tuitions/:id: Fetches one tuition listing by ID.
router.get("/:id", validateId, async (req, res) => {
  const { id } = req.params;
  const result = await tuitions.findOne(
    { _id: new ObjectId(id), approvalStatus: "approved", isActive: true },
    { projection: publicTuitionFields }
  );
  if (!result) return res.status(404).send({ message: "Tuition not found" });
  res.send(result);
});

router.get("/:id/mentor", verifyToken, validateId, async (req, res) => {
  const tuition = await tuitions.findOne(
    { _id: new ObjectId(req.params.id), approvalStatus: "approved", isActive: true },
    { projection: { tutorId: 1 } }
  )
  if (!tuition || !ObjectId.isValid(tuition.tutorId)) {
    return res.status(404).send({ message: "Mentor not found" })
  }
  const mentor = await users.findOne(
    { _id: new ObjectId(tuition.tutorId) },
    { projection: { _id: 0, name: 1, image: 1, email: 1, phone: 1, bio: 1 } }
  )
  if (!mentor) return res.status(404).send({ message: "Mentor not found" })
  res.send(mentor)
})

// GET /tuitions/tutor/:tutorId: Fetches a tutor's listings, newest first.
router.get("/tutor/:tutorId", verifyToken, verifyTutor, requireOwnId("tutorId"), async (req, res) => {
  try {
    const result = await tuitions
      .find({ tutorId: req.params.tutorId })
      .sort({ createdAt: -1 })
      .toArray()

    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to load tutor tuitions.",
    })
  }
})

// PATCH /tuitions/:id/active: Updates a listing's active availability.
router.patch("/:id/active", verifyToken, verifyTutor, validateId, async (req, res) => {
  try {
    if (typeof req.body.isActive !== "boolean") {
      return res.status(400).send({ message: "isActive must be a boolean" })
    }
    const result = await tuitions.updateOne(
      { _id: new ObjectId(req.params.id), tutorId: req.user._id.toString() },
      { $set: { isActive: req.body.isActive } }
    )

    res.send(result)
  } catch (error) {
    res.status(500).send({
      message: "Failed to update tuition availability.",
    })
  }
})

// PATCH /tuitions/:id/details: Updates a listing's location, fee, schedule, mode, image, and description.
router.patch("/:id/details", verifyToken, verifyTutor, validateId, async (req, res) => {
  try {
    const {
      location,
      monthlyFee,
      daysPerWeek,
      mode,
      bannerImage,
      description,
    } = req.body

    if (typeof location !== "string" || !location.trim() ||
      typeof description !== "string" || description.trim().length < 20 ||
      typeof bannerImage !== "string" ||
      !Number.isFinite(monthlyFee) || monthlyFee <= 0 ||
      !Number.isInteger(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7 ||
      !["Online", "Offline"].includes(mode)) {
      return res.status(400).send({ message: "Invalid tuition details" })
    }

    const result = await tuitions.updateOne(
      { _id: new ObjectId(req.params.id), tutorId: req.user._id.toString() },
      {
        $set: {
          location,
          monthlyFee,
          daysPerWeek,
          mode,
          bannerImage,
          description,
        },
      }
    )

    res.send(result)
  } catch (error) {
    res.status(500).send({
      message: "Failed to update tuition details.",
    })
  }
})


// PATCH /tuitions/:id: Updates approval status as an admin.
router.patch("/:id", verifyToken, verifyAdmin, validateId, async (req, res) => {
  try {
    const { approvalStatus } = req.body;

    if (!["pending", "approved", "rejected"].includes(approvalStatus)) {
      return res.status(400).send({
        message: "Invalid approval status.",
      });
    }

    const id = req.params.id;
    const query = { _id: new ObjectId(id) };

    const updatedDoc = {
      $set: {
        approvalStatus: approvalStatus,
      },
    };

    const result = await tuitions.updateOne(query, updatedDoc);

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to update tuition status.",
    });
  }
});


// DELETE /tuitions/:id: Deletes a tuition listing by ID.
router.delete("/:id", verifyToken, verifyTutor, validateId, async (req, res) => {
  try {
    const result = await tuitions.deleteOne({
      _id: new ObjectId(req.params.id),
      tutorId: req.user._id.toString(),
    })

    res.send(result)
  } catch (error) {
    res.status(500).send({
      message: "Failed to delete tuition.",
    })
  }
})
