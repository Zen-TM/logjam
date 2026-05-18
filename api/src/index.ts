import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/errorHandler";
import usersRouter from "./routes/users";
import canyonsRouter from "./routes/canyons";
import tripLogsRouter from "./routes/tripLogs";
import tripLogsGlobalRouter from "./routes/tripLogsGlobal";
import tripLogsBulkRouter from "./routes/tripLogsBulk";
import sharingRouter from "./routes/sharing";
import friendsRouter from "./routes/friends";
import notificationsRouter from "./routes/notifications";
import ropewikiRouter from "./routes/ropewiki";
import topoJobsRouter from "./routes/topoJobs";
import geoPdfTemplatesRouter from "./routes/geoPdfTemplates";
import geoPdfRouter from "./routes/geoPdf";
import analyticsRouter from "./routes/analytics";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
  : "*";

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Fake-Auth"],
    credentials: true,
  }),
);
app.use(helmet());
app.use(express.json());

// Routes
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/users", usersRouter);
app.use("/canyons", canyonsRouter);
app.use("/canyons/:canyonId/trips", tripLogsRouter);
app.use("/trips/bulk", tripLogsBulkRouter);
app.use("/trips", tripLogsGlobalRouter);
app.use("/canyons", sharingRouter);
app.use("/friends", friendsRouter);
app.use("/notifications", notificationsRouter);
app.use("/ropewiki", ropewikiRouter);
app.use("/topo-jobs", topoJobsRouter);
app.use("/geo-pdf-templates", geoPdfTemplatesRouter);
app.use("/geo-pdf", geoPdfRouter);
app.use("/analytics", analyticsRouter);

// Error handler — must be last
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Logjam API running on port ${PORT}`);
});

export default app;
