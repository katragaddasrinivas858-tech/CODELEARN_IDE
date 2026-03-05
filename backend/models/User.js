const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["student", "teacher"], default: "student" },
    displayName: { type: String, default: "" },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    teacherEmail: { type: String, default: "" },
    emailVerified: { type: Boolean, default: false },
    verificationToken: { type: String, default: "" },
    verificationTokenExpires: { type: Date, default: null },
    learningLanguage: {
      type: String,
      enum: ["python", "javascript", "c"],
      default: "python",
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
