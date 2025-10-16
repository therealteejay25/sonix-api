import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

interface JwtPayload {
  id: string;
}

export const authMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 1️⃣ Get token from cookies or Authorization header
    const token =
      req.cookies?.token ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.split(" ")[1]
        : null);

    if (!token) {
      return res.status(401).json({ error: "No token provided. Unauthorized." });
    }

    // 2️⃣ Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;

    if (!decoded?.id) {
      return res.status(401).json({ error: "Invalid token payload." });
    }

    // 3️⃣ Attach userId to request object for later use
    (req as any).userId = decoded.id;

    // 4️⃣ Continue request
    next();
  } catch (err: any) {
    console.error("Auth middleware error:", err.message);
    return res.status(403).json({ error: "Invalid or expired token." });
  }
};
