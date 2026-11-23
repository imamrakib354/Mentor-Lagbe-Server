import { Router } from "express";
import { ObjectId } from "mongodb";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { validateId, requireOwnId } from "../middleware/ownership.js";
import { users } from "../config/db.js";

export const router = Router();

// Users related api

// GET /users: Fetches all users.
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
  const cursor = users.find({}, {
    projection: {
      name: 1, email: 1, image: 1, role: 1, createdAt: 1, banned: 1,
    }
  });
  const result = await cursor.toArray();
  res.send(result);
});

// GET /users/:id/premium : Confirm if a user is premium or not 
router.get("/:id/premium", verifyToken, validateId, requireOwnId("id"), async (req, res) => {
  const { id } = req.params

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid user ID" })
  }

  const user = await users.findOne(
    { _id: new ObjectId(id) },
    { projection: { premium: 1 } }
  )

  if (!user) {
    return res.status(404).send({ message: "User not found" })
  }

  res.send({ premium: user.premium === true })
})

// Update the user profile

router.patch("/:id", verifyToken, validateId, requireOwnId("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ["name", "phone", "bio", "image"];
    const profile = {};
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== "string" &&
          !(field === "image" && req.body[field] === null)) {
          return res.status(400).send({ message: `Invalid ${field}` });
        }
        profile[field] = req.body[field];
      }
    }
    if (!Object.keys(profile).length) {
      return res.status(400).send({ message: "No profile fields provided" });
    }

    const query = { _id: new ObjectId(id) };
    const updatedDoc = { $set: profile };

    const result = await users.updateOne(query, updatedDoc);

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to update profile",
    });
  }
});

// PATCH /users/:id/role: Updates the role of a user by ID.
router.patch('/:id/role', verifyToken, verifyAdmin, validateId, async (req, res) => {
  if (!["student", "tutor", "admin"].includes(req.body.role)) {
    return res.status(400).send({ message: "Invalid role" })
  }
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const updatedDoc = {
    $set: {
      role: req.body.role,
    }
  }
  const result = await users.updateOne(query, updatedDoc);
  res.send(result);
})
