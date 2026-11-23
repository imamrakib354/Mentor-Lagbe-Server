import { MongoClient } from "mongodb";

let client;

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

export let users, tuitions, applications, payments, savedTuitions, reviews;

export async function initializeDatabase() {
  client = new MongoClient(
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.b8dfpo9.mongodb.net/`,
  );
  const connectedClient = await connectToMongoDB();
  const database = connectedClient.db("MentorLagbeDB");
  users = database.collection("user");
  tuitions = database.collection("tuitions");
  applications = database.collection("applications");
  payments = database.collection("payments");
  savedTuitions = database.collection("savedTuitions");
  reviews = database.collection("reviewCollection");
}

export async function createApplicationAndSavedIndexes() {
  await applications.createIndex(
    { tuitionId: 1, applicantId: 1 },
    { unique: true }
  )

  await savedTuitions.createIndex(
    { studentId: 1, tuitionId: 1 },
    { unique: true }
  )
}

export async function createPaymentIndex() {
  await payments.createIndex({ sessionId: 1 }, { unique: true })
}

export async function createReviewIndex() {
  await reviews.createIndex(
    { tuitionId: 1, studentId: 1 },
    { unique: true }
  );
}
