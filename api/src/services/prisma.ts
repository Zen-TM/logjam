import { PrismaClient } from "@prisma/client";

// Single shared Prisma instance across the app
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});

export default prisma;
