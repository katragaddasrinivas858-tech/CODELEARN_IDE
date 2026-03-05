const mongoose = require("mongoose");

const SubmissionSchema = new mongoose.Schema(
  {
    language: { type: String, enum: ["python", "javascript", "c"], default: "python", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    problemId: { type: mongoose.Schema.Types.ObjectId, ref: "Problem", index: true },
    challengeId: { type: mongoose.Schema.Types.ObjectId, ref: "Challenge", default: null, index: true },
    status: { type: String, default: "Rejected" },
    runtimeMs: { type: Number, default: 0 },
    passedCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    estimatedComplexity: { type: String, default: "O(n)" },
    complexityScore: { type: Number, default: 3 },
    expectedComplexity: { type: String, default: "O(n)" },
    expectedComplexityScore: { type: Number, default: 3 },
    sourceLength: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Submission", SubmissionSchema);
