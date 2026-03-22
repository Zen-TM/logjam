import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/errorHandler";
import usersRouter from "./routes/users";
import canyonsRouter from "./routes/canyons";
import tripLogsRouter from "./routes/tripLogs";
import sharingRouter from "./routes/sharing";
import friendsRouter from "./routes/friends";
import notificationsRouter from "./routes/notifications";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json());

// Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/users", usersRouter);
app.use("/canyons", canyonsRouter);
app.use("/canyons/:canyonId/trips", tripLogsRouter);
app.use("/canyons", sharingRouter);
app.use("/friends", friendsRouter);
app.use("/notifications", notificationsRouter);

// Error handler — must be last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Logjam API running on port ${PORT}`);
});

export default app;
