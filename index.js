import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";

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


app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Users related api

app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

// Users related api

app.get("/users", async (req, res) => {
  const cursor = users.find({});
  const result = await cursor.toArray();
  res.send(result);
});

app.patch('/users/:id/role', async (req, res) => {
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
app.post("/tuitions", async (req, res) => {
  const tuition = req.body;
  const result = await tuitions.insertOne(tuition);
  res.send(result);
});

const PAGE_SIZE = 6

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
      .find(query)
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

app.get("/tuitions/:id", async (req, res) => {
  const { id } = req.params;
  const result = await tuitions.findOne({
    _id: new ObjectId(id),
  });
  res.send(result);
});

app.get("/tuitions/tutor/:tutorId", async (req, res) => {
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

app.patch("/tuitions/:id/active", async (req, res) => {
  try {
    const result = await tuitions.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { isActive: req.body.isActive } }
    )

    res.send(result)
  } catch (error) {
    res.status(500).send({
      message: "Failed to update tuition availability.",
    })
  }
})


app.patch("/tuitions/:id", async (req, res) => {
  try {
    const { role, approvalStatus } = req.body;

    // Check admin
    if (role !== "admin") {
      return res.status(403).send({
        message: "Only admin can update tuition status.",
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

// Get api for admin filtering 

app.get("/admin/tuitions", async (req, res) => {
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

app.post("/applications", async (req, res) => {
  try {
    const application = req.body
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

app.get("/applications/student/:applicantId", async (req, res) => {
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

app.get("/applications/tutor/:tutorId", async (req, res) => {
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

app.patch("/applications/:id/status", async (req, res) => {
  try {
    const { status } = req.body

    if (status !== "accepted" && status !== "rejected") {
      return res.status(400).json({
        message: "Select accepted or rejected.",
      })
    }

    const result = await applications.updateOne(
      { _id: new ObjectId(req.params.id) },
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


// Saved tuitions api route 
app.post("/saved-tuitions", async (req, res) => {
  try {
    const { studentId, tuitionId } = req.body

    if (
      typeof studentId !== "string" ||
      !studentId.trim() ||
      typeof tuitionId !== "string" ||
      !ObjectId.isValid(tuitionId)
    ) {
      return res.status(400).json({
        message: "Student ID and valid tuition ID are required.",
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

app.get("/saved-tuitions/student/:studentId", async (req, res) => {
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


if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;