import "dotenv/config";
import express from "express";
import cors from "cors";
import { initializeDatabase, createApplicationAndSavedIndexes, createPaymentIndex, createReviewIndex } from "./config/db.js";
import { router as userRoutes } from "./routes/users.routes.js";
import { router as tuitionRoutes } from "./routes/tuitions.routes.js";
import { router as adminRoutes } from "./routes/admin.routes.js";
import { router as applicationRoutes } from "./routes/applications.routes.js";
import { router as savedTuitionRoutes } from "./routes/saved-tuitions.routes.js";
import { router as paymentRoutes } from "./routes/payments.routes.js";
import { router as homeRoutes } from "./routes/home.routes.js";
import { router as reviewRoutes } from "./routes/reviews.routes.js";
export { connectToMongoDB } from "./config/db.js";

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

await initializeDatabase();

// GET /: Returns a simple server response.
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.use("/users", userRoutes);
app.use("/tuitions", tuitionRoutes);
app.use("/admin", adminRoutes);

await createApplicationAndSavedIndexes();
app.use("/applications", applicationRoutes);
app.use("/saved-tuitions", savedTuitionRoutes);

await createPaymentIndex();
app.use("/payments", paymentRoutes);
app.use(homeRoutes);

await createReviewIndex();
app.use("/reviews", reviewRoutes);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

export default app;
