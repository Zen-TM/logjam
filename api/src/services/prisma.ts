import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { dbConnectionConfig } from "../lib/dbConnection";

const adapter = new PrismaPg(dbConnectionConfig());

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
});

export default prisma;
