const mongoose = require("mongoose");

const ChallengeSchema = new mongoose.Schema(
  {
    language: { type: String, enum: ["python", "javascript", "c"], default: "python", index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    problemIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Challenge", ChallengeSchema);
