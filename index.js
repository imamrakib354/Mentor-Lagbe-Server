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

// applications related api 
await applications.createIndex(
  { tuitionId: 1, applicantId: 1 },
  { unique: true }
)

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
    const result = await applications
      .find({ applicantId: req.params.applicantId })
      .sort({ createdAt: -1 })
      .toArray()

    res.json(result)
  } catch (error) {
    console.error(error)
    res.status(500).json({
      message: "Failed to load your applications.",
    })
  }
})


if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;