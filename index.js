import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import Stripe from 'stripe';
import { createRemoteJWKSet, jwtVerify } from "jose";

// The URL where your Next.js BetterAuth server runs
const authURL = process.env.BETTER_AUTH_URL;
const authOrigin = new URL(authURL).origin;

// Create the public-key verifier once
const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", authOrigin)
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(
  `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b8dfpo9.mongodb.net/`,
);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("MentorLagbeDB");
const users = database.collection("user");
const tuitions = database.collection("tuitions");
const applications = database.collection("applications");
const payments = database.collection("payments");
const savedTuitions = database.collection("savedTuitions")
const reviews = database.collection("reviewCollection")


// GET /: Returns a simple server response.
app.get("/", (req, res) => {
  res.send("Hello World!");
});

//First verify the token

const verifyToken = async (req, res, next) => {
  try {
    // 1. Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).send({
        message: "Unauthorized",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).send({
        message: "Unauthorized",
      });
    }

    // 2. Verify the JWT
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: authOrigin,
      audience: authOrigin,
    });

    // 3. Get the verified user's ID
    const userId = payload.sub;

    if (!userId || !ObjectId.isValid(userId)) {
      return res.status(401).send({
        message: "Invalid user identity",
      });
    }

    // 4. Find the current user in MongoDB
    const user = await users.findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      return res.status(401).send({
        message: "User not found",
      });
    }

    if (user.banned === true) {
      return res.status(403).send({
        message: "Your account has been suspended",
      });
    }

    if (user.roleSelectionRequired === true) {
      return res.status(403).send({
        message: "Please select your account role first",
      });
    }

    // 5. Attach the verified user to Express request
    req.user = user;

    // 6. Continue to the next middleware
    next();
  } catch (error) {
    console.error("JWT verification failed:", error);

    return res.status(401).send({
      message: "Invalid or expired JWT",
    });
  }
};


// must call this middleware after verifyToken
const verifyStudent = async (req, res, next) => {
  if (req.user.role !== 'student') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }
  next();
}

const verifyTutor = async (req, res, next) => {
  if (req.user.role !== 'tutor') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }
  next();
}

const verifyAdmin = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    res.status(403).send({ message: 'Forbidden' });
    return;
  }
  next();
}

const validateId = (req, res, next) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).send({ message: "Invalid ID" })
  }
  next()
}

const requireOwnId = (param) => (req, res, next) => {
  if (req.params[param] !== req.user._id.toString()) {
    return res.status(403).send({ message: "Forbidden" })
  }
  next()
}

// An allowlist prevents new private fields from leaking through public listings.
const publicTuitionFields = {
  title: 1, subject: 1, classLevel: 1, mode: 1, location: 1,
  monthlyFee: 1, daysPerWeek: 1, classTimes: 1, description: 1,
  bannerImage: 1, approvalStatus: 1, isActive: 1, createdAt: 1,
}

// Users related api

// GET /users: Fetches all users.
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const cursor = users.find({}, {
    projection: {
      name: 1, email: 1, image: 1, role: 1, createdAt: 1, banned: 1,
    }
  });
  const result = await cursor.toArray();
  res.send(result);
});

// GET /users/:id/premium : Confirm if a user is premium or not 
app.get("/users/:id/premium", verifyToken, validateId, requireOwnId("id"), async (req, res) => {
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

app.patch("/users/:id", verifyToken, validateId, requireOwnId("id"), async (req, res) => {
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
app.patch('/users/:id/role', verifyToken, verifyAdmin, validateId, async (req, res) => {
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

// tuitions related api
// POST /tuitions: Creates a tuition listing using the request body.
app.post("/tuitions", verifyToken, verifyTutor, async (req, res) => {
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
app.get("/tuitions", async (req, res) => {
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
app.get("/tuitions/:id", validateId, async (req, res) => {
  const { id } = req.params;
  const result = await tuitions.findOne(
    { _id: new ObjectId(id), approvalStatus: "approved", isActive: true },
    { projection: publicTuitionFields }
  );
  if (!result) return res.status(404).send({ message: "Tuition not found" });
  res.send(result);
});

app.get("/tuitions/:id/mentor", verifyToken, validateId, async (req, res) => {
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
app.get("/tuitions/tutor/:tutorId", verifyToken, verifyTutor, requireOwnId("tutorId"), async (req, res) => {
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
app.patch("/tuitions/:id/active", verifyToken, verifyTutor, validateId, async (req, res) => {
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
app.patch("/tuitions/:id/details", verifyToken, verifyTutor, validateId, async (req, res) => {
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
app.patch("/tuitions/:id", verifyToken, verifyAdmin, validateId, async (req, res) => {
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

// GET /admin/tuitions: Fetches listings with class, subject, mode, and approval filters and sorting.

app.get("/admin/tuitions", verifyToken, verifyAdmin, async (req, res) => {
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

// DELETE /tuitions/:id: Deletes a tuition listing by ID.
app.delete("/tuitions/:id", verifyToken, verifyTutor, validateId, async (req, res) => {
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

// applications related api 
await applications.createIndex(
  { tuitionId: 1, applicantId: 1 },
  { unique: true }
)

await savedTuitions.createIndex(
  { studentId: 1, tuitionId: 1 },
  { unique: true }
)

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
app.post("/applications", verifyToken, verifyStudent, async (req, res) => {
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
app.get("/applications/student/:applicantId", verifyToken, verifyStudent, requireOwnId("applicantId"), async (req, res) => {
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
app.get("/applications/tutor/:tutorId", verifyToken, verifyTutor, requireOwnId("tutorId"), async (req, res) => {
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
app.patch("/applications/:id/status", verifyToken, verifyTutor, validateId, async (req, res) => {
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
app.delete("/applications/:id", verifyToken, verifyStudent, validateId, async (req, res) => {
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


// Saved tuitions api route 
// POST /saved-tuitions: Saves a tuition for a student or reports that it was already saved.
app.post("/saved-tuitions", verifyToken, verifyStudent, async (req, res) => {
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
app.get("/saved-tuitions/student/:studentId", verifyToken, verifyStudent, requireOwnId("studentId"), async (req, res) => {
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
app.delete("/saved-tuitions/:id", verifyToken, verifyStudent, validateId, async (req, res) => {
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

// payments related api

// Get all payments data

app.get("/payments", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const transactions = await payments
      .find()
      .sort({ paidDate: -1 })
      .toArray()

    res.send(transactions)
  } catch (error) {
    console.error("Could not load transactions:", error)
    res.status(500).send({ message: "Could not load transactions" })
  }
})

// Prevent duplicate payment records.
await payments.createIndex({ sessionId: 1 }, { unique: true })

app.post("/payments/checkout-verify", verifyToken, async (req, res) => {
  const { sessionId } = req.body

  if (!sessionId) {
    return res.status(400).send({
      success: false,
      message: "Session ID is required",
    })
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return res.status(400).send({
        success: false,
        message: "Payment verification failed",
      })
    }

    const { userId, role, plan } = session.metadata || {}

    if (!ObjectId.isValid(userId) || !["student", "tutor"].includes(role)) {
      return res.status(400).send({
        success: false,
        message: "Invalid payment information",
      })
    }

    if (userId !== req.user._id.toString()) {
      return res.status(403).send({ success: false, message: "Forbidden" })
    }

    const expectedPrice = role === "student"
      ? process.env.STRIPE_STUDENT_PRICE_ID
      : process.env.STRIPE_TUTOR_PRICE_ID
    if (!expectedPrice) {
      console.error("Stripe price ID is not configured for", role)
      return res.status(500).send({ success: false, message: "Payment configuration error" })
    }
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 2 })
    if (role !== req.user.role || plan !== "pro" || session.mode !== "payment" ||
      lineItems.has_more || lineItems.data.length !== 1 ||
      lineItems.data[0].price?.id !== expectedPrice || lineItems.data[0].quantity !== 1) {
      return res.status(400).send({ success: false, message: "Invalid payment plan" })
    }

    const user = await users.findOne({ _id: new ObjectId(userId) })

    if (!user) {
      return res.status(404).send({
        success: false,
        message: "User not found",
      })
    }

    const payment = {
      sessionId,
      userId,
      userName: user.name,
      userEmail: user.email,
      role,
      plan: role === "tutor" ? "Pro Tutor Plan" : "Pro Student Plan",
      amount: session.amount_total,
      currency: session.currency,
      transactionId: session.payment_intent,
      status: "paid",
      paidDate: new Date(),
    }

    // Save once; refreshing the success page won't create another record.
    await payments.updateOne(
      { sessionId },
      { $setOnInsert: payment },
      { upsert: true }
    )

    await users.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { premium: true } }
    )

    return res.send({
      success: true,
      message: "Payment verified and premium activated",
    })
  } catch (error) {
    console.error(error)
    return res.status(500).send({
      success: false,
      message: "Could not verify payment",
    })
  }
})

// Allow guests, but verify the token when one is provided.
const optionalVerifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return next()
  }

  return verifyToken(req, res, next)
}

// GET /new-tuitions: latest 7 approved, active tuitions.
// Tutor names are included only for authenticated users.
app.get("/new-tuitions", optionalVerifyToken, async (req, res) => {
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

app.get("/platform-stats", async (req, res) => {
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

// Review and rating related apis

await reviews.createIndex(
  { tuitionId: 1, studentId: 1 },
  { unique: true }
);

// ======================================================
// 1. GET ALL REVIEWS (PUBLIC)
// ======================================================

app.get("/reviews/:tuitionId", async (req, res) => {
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

app.get(
  "/reviews/:tuitionId/mine",
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

app.post("/reviews", verifyToken, verifyStudent, async (req, res) => {
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

app.delete("/reviews/:id", verifyToken, verifyStudent, async (req, res) => {
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


if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;
