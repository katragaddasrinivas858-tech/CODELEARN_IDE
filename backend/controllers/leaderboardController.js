const Submission = require("../models/Submission");
const User = require("../models/User");
const { buildLanguageFilter, normalizeLanguage } = require("../constants/languages");

const getLeaderboard = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const teacherId = user.role === "teacher" ? user._id : user.teacherId;
  if (!teacherId) return res.status(400).json({ error: "Teacher not assigned" });
  const selectedLanguage = normalizeLanguage(req.query.language || user.learningLanguage);

  const stats = await Submission.aggregate([
    { $match: { teacherId, status: "Accepted", ...buildLanguageFilter(selectedLanguage) } },
    {
      $group: {
        _id: "$userId",
        solvedProblems: { $addToSet: "$problemId" },
        avgRuntime: { $avg: "$runtimeMs" },
        avgComplexityScore: { $avg: "$complexityScore" },
        lastSubmission: { $max: "$createdAt" },
      },
    },
    {
      $project: {
        solvedCount: { $size: "$solvedProblems" },
        avgRuntime: { $ifNull: ["$avgRuntime", 0] },
        avgComplexityScore: { $ifNull: ["$avgComplexityScore", 0] },
        lastSubmission: 1,
      },
    },
    { $sort: { solvedCount: -1, avgRuntime: 1, avgComplexityScore: 1 } },
  ]);

  const userIds = stats.map((s) => s._id);
  const users = await User.find({ _id: { $in: userIds } });
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const leaderboard = stats.map((s, index) => {
    const profile = userMap.get(s._id.toString());
    return {
      rank: index + 1,
      studentId: s._id,
      name: profile?.displayName || profile?.email || "Student",
      email: profile?.email,
      solvedCount: s.solvedCount,
      avgRuntime: Math.round(s.avgRuntime),
      avgComplexityScore: Math.round(s.avgComplexityScore * 100) / 100,
      lastSubmission: s.lastSubmission,
    };
  });

  return res.json({ teacherId, language: selectedLanguage, leaderboard });
};

module.exports = { getLeaderboard };
