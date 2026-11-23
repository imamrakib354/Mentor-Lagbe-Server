import { Router } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";
import { verifyToken } from "../middleware/auth.js";
import { verifyStudent, verifyTutor, verifyAdmin } from "../middleware/roles.js";
import { payments, users } from "../config/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export const router = Router();

// payments related api

// Get all payments data

router.get("/", verifyToken, verifyAdmin, async (req, res) => {
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

router.post("/checkout-verify", verifyToken, async (req, res) => {
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
