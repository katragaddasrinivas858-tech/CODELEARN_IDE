const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDb = require("./config/db");
const securityHeaders = require("./middleware/securityHeaders");
const { createRateLimiter } = require("./middleware/rateLimit");

const authRoutes = require("./routes/auth");
const projectRoutes = require("./routes/projects");
const fileRoutes = require("./routes/files");
const runRoutes = require("./routes/run");
const courseRoutes = require("./routes/courses");
const learningRoutes = require("./routes/learning");
const judgeRoutes = require("./routes/judge");
const leaderboardRoutes = require("./routes/leaderboard");
const teacherRoutes = require("./routes/teacher");

dotenv.config();

const app = express();
app.set("trust proxy", 1);

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const skipPreflight = (req) => req.method === "OPTIONS";

const globalApiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: "Too many API requests. Please try again later.",
  skip: skipPreflight,
});
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many authentication attempts. Please try again later.",
  skip: skipPreflight,
});
const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many login attempts. Please try again in 15 minutes.",
  skip: skipPreflight,
});
const executionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Execution rate limit reached. Slow down and try again.",
  skip: skipPreflight,
});

app.use(securityHeaders);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
  })
);
app.use(express.json({ limit: "15mb" }));
app.use("/api", globalApiLimiter);
app.use("/api/auth", authLimiter);
app.post("/api/auth/login", loginLimiter);
app.use("/api/run", executionLimiter);
app.use("/api/judge", executionLimiter);

connectDb()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

app.get("/", (req, res) => {
  res.json({ status: "CodeLearn API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/run", runRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api", learningRoutes);
app.use("/api/judge", judgeRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/teacher", teacherRoutes);

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
