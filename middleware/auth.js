import { ObjectId } from "mongodb";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { users } from "../config/db.js";

// The URL where your Next.js BetterAuth server runs
const authURL = process.env.BETTER_AUTH_URL;
const authOrigin = new URL(authURL).origin;

// Create the public-key verifier once
const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", authOrigin)
);

export const verifyToken = async (req, res, next) => {
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

// Allow guests, but verify the token when one is provided.
export const optionalVerifyToken = (req, res, next) => {
  if (!req.headers.authorization) {
    return next()
  }

  return verifyToken(req, res, next)
}
