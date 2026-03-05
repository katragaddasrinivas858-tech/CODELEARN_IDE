const mongoose = require("mongoose");

const LessonSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    content: { type: String, default: "" },
    blocks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const TopicSchema = new mongoose.Schema(
  {
    language: { type: String, enum: ["python", "javascript", "c"], default: "python", index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    order: { type: Number, default: 0 },
    lessons: { type: [LessonSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Topic", TopicSchema);
