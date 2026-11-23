import { Router } from "express";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { reviews, tuitions, applications } from "../config/db.js";

export const router = Router();

// ======================================================
// 1. GET ALL REVIEWS (PUBLIC)
// ======================================================

router.get("/:tuitionId", async (req, res) => {
  try {
    const { tuitionId } = req.params;

    if (!ObjectId.isValid(tuitionId)) {
      return res.status(400).send({ message: "Invalid tuition ID" });
    }

    // Pagination
    const requestedPage = Number(req.query.page ?? 1);
    const page =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;

    const limit = 3;
    const skip = (page - 1) * limit;

    if (!Number.isSafeInteger(skip)) {
      return res.status(400).send({ message: "Invalid page number" });
    }

    // Sorting: newest by default
    const sort = req.query.sort === "oldest" ? 1 : -1;

    const query = {
      tuitionId: new ObjectId(tuitionId).toString(),
    };

    // Get paginated reviews
    const result = await reviews
      .find(query, {
        projection: {
          studentName: 1,
          rating: 1,
          comment: 1,
          createdAt: 1,
        },
      })
      .sort({ createdAt: sort, _id: sort })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Calculate total reviews and overall average
    const ratings = await reviews
      .find(query, { projection: { rating: 1 } })
      .toArray();

    const total = ratings.length;

    const averageRating = total
      ? ratings.reduce((sum, review) => sum + review.rating, 0) / total
      : 0;

    res.send({
      reviews: result,
      total,
      averageRating: Number(averageRating.toFixed(1)),
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load reviews" });
  }
});


// ======================================================
// 2. GET LOGGED-IN STUDENT'S OWN REVIEW (PRIVATE)
// ======================================================

router.get(
  "/:tuitionId/mine",
  verifyToken,
  verifyStudent,
  async (req, res) => {
    try {
      const { tuitionId } = req.params;
      const studentId = req.user._id.toString();

      if (!ObjectId.isValid(tuitionId)) {
        return res.status(400).send({
          message: "Invalid tuition ID",
        });
      }

      const review = await reviews.findOne(
        {
          tuitionId: new ObjectId(tuitionId).toString(),
          studentId,
        },
        {
          projection: {
            studentName: 1,
            rating: 1,
            comment: 1,
            createdAt: 1,
          },
        }
      );

      res.json(review);
    } catch (error) {
      console.error(error);
      res.status(500).send({
        message: "Failed to load your review",
      });
    }
  }
);


// ======================================================
// 3. POST REVIEW (PRIVATE)
// ======================================================

router.post("/", verifyToken, verifyStudent, async (req, res) => {
  try {
    const { tuitionId, rating, comment } = req.body;
    const studentId = req.user._id.toString();

    // Validate input
    if (
      typeof tuitionId !== "string" ||
      !ObjectId.isValid(tuitionId) ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5 ||
      typeof comment !== "string" ||
      !comment.trim() ||
      comment.trim().length > 500
    ) {
      return res.status(400).send({
        message: "Invalid review data",
      });
    }

    // Find tuition to get tutorId
    const tuition = await tuitions.findOne({
      _id: new ObjectId(tuitionId),
    });

    if (!tuition) {
      return res.status(404).send({
        message: "Tuition not found",
      });
    }

    // Check accepted application
    const application = await applications.findOne({
      tuitionId: tuition._id.toString(),
      applicantId: studentId,
      status: "accepted",
    });

    if (!application) {
      return res.status(403).send({
        message: "Only accepted students can submit reviews",
      });
    }

    // Create review
    const review = {
      tuitionId: tuition._id.toString(),
      tutorId: tuition.tutorId,
      studentId,
      studentName: req.user.name,
      rating,
      comment: comment.trim(),
      createdAt: new Date(),
    };

    const result = await reviews.insertOne(review);

    res.status(201).send(result);
  } catch (error) {
    // Duplicate review
    if (error.code === 11000) {
      return res.status(409).send({
        message: "You have already reviewed this tuition",
      });
    }

    console.error(error);
    res.status(500).send({
      message: "Failed to add review",
    });
  }
});


// ======================================================
// 4. DELETE OWN REVIEW (PRIVATE)
// ======================================================

router.delete("/:id", verifyToken, verifyStudent, async (req, res) => {
  try {
    const { id } = req.params;
    const studentId = req.user._id.toString();

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid review ID",
      });
    }

    // Delete only the authenticated student's review
    const result = await reviews.deleteOne({
      _id: new ObjectId(id),
      studentId,
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Review not found",
      });
    }

    res.send({
      message: "Review deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message: "Failed to delete review",
    });
  }
});
