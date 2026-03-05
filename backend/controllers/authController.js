const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const User = require("../models/User");
const { isSupportedLanguage, normalizeLanguage } = require("../constants/languages");

const signupStudent = async (req, res) => {
  const { email, password, teacherEmail, displayName, learningLanguage } = req.body;
  if (!email || !password || !teacherEmail) {
    return res.status(400).json({ error: "Email, password, and teacher email required" });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedTeacherEmail = String(teacherEmail).trim().toLowerCase();
  if (!validator.isEmail(normalizedEmail) || !validator.isEmail(normalizedTeacherEmail)) {
    return res.status(400).json({ error: "Valid email required" });
  }
  if (learningLanguage && !isSupportedLanguage(learningLanguage)) {
    return res.status(400).json({ error: "Unsupported learning language" });
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "User already exists" });
  }

  const teacher = await User.findOne({ email: normalizedTeacherEmail, role: "teacher" });
  if (!teacher) {
    return res.status(404).json({ error: "Teacher not found" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    email: normalizedEmail,
    password: hashed,
    role: "student",
    displayName: displayName || "",
    teacherId: teacher._id,
    teacherEmail: teacher.email,
    emailVerified: true,
    verificationToken: "",
    verificationTokenExpires: null,
    learningLanguage: normalizeLanguage(learningLanguage),
  });

  return res.json({
    message: "Account created. You can log in now.",
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      teacherEmail,
      learningLanguage: user.learningLanguage,
    },
  });
};

const signupTeacher = async (req, res) => {
  const { email, password, teacherCode, displayName, learningLanguage } = req.body;
  if (!email || !password || !teacherCode) {
    return res.status(400).json({ error: "Email, password, and teacher code required" });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!validator.isEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Valid email required" });
  }
  if (learningLanguage && !isSupportedLanguage(learningLanguage)) {
    return res.status(400).json({ error: "Unsupported learning language" });
  }

  const configuredTeacherCode = process.env.TEACHER_CODE;
  if (!configuredTeacherCode) {
    return res.status(500).json({ error: "Teacher signup is not configured on this server." });
  }
  if (teacherCode !== configuredTeacherCode) {
    return res.status(403).json({ error: "Invalid teacher code" });
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "User already exists" });
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await User.create({
    email: normalizedEmail,
    password: hashed,
    role: "teacher",
    displayName: displayName || "",
    emailVerified: true,
    verificationToken: "",
    verificationTokenExpires: null,
    learningLanguage: normalizeLanguage(learningLanguage),
  });

  return res.json({
    message: "Account created. You can log in now.",
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      learningLanguage: user.learningLanguage,
    },
  });
};

const login = async (req, res) => {
  const { email, password, learningLanguage } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!validator.isEmail(normalizedEmail)) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
  if (learningLanguage && !isSupportedLanguage(learningLanguage)) {
    return res.status(400).json({ error: "Unsupported learning language" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid email or password" });

  if (learningLanguage) {
    user.learningLanguage = normalizeLanguage(learningLanguage);
    await user.save();
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res
      .status(500)
      .json({ error: "Authentication is not configured on this server." });
  }

  const token = jwt.sign({ id: user._id }, jwtSecret, {
    expiresIn: "7d",
  });

  return res.json({
    token,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      teacherEmail: user.teacherEmail || "",
      displayName: user.displayName || "",
      learningLanguage: user.learningLanguage || normalizeLanguage(),
    },
  });
};

const verifyEmail = async (req, res) => {
  return res.json({ message: "Email verification is disabled." });
};

const resendVerification = async (req, res) => {
  return res.json({ message: "Email verification is disabled." });
};

module.exports = { signupStudent, signupTeacher, login, verifyEmail, resendVerification };
