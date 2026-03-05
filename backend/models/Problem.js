const mongoose = require("mongoose");

const TestCaseSchema = new mongoose.Schema(
  {
    input: { type: mongoose.Schema.Types.Mixed, default: [] },
    output: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const ProblemSchema = new mongoose.Schema(
  {
    language: { type: String, enum: ["python", "javascript", "c"], default: "python", index: true },
    topicId: { type: mongoose.Schema.Types.ObjectId, ref: "Topic", index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    difficulty: { type: String, default: "Easy" },
    prompt: { type: String, default: "" },
    entryType: { type: String, enum: ["function", "class"], default: "function" },
    entryName: { type: String, required: true },
    starter: { type: String, default: "" },
    solution: { type: String, default: "" },
    complexity: { type: String, default: "O(n)" },
    testCases: { type: [TestCaseSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Problem", ProblemSchema);
