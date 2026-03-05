const express = require("express");
const auth = require("../middleware/auth");
const {
  listTopics,
  getTopic,
  listProblems,
  getProblem,
  listChallenges,
  getChallenge,
  getChallengeLeaderboard,
  seedCurriculum,
  seedChallenges,
  seedTopicContentFromWeb,
  updateTopicContent,
  resetSeededCurriculum,
} = require("../controllers/learningController");

const router = express.Router();

router.get("/topics", listTopics);
router.get("/topics/:id", getTopic);
router.put("/topics/:id/content", auth, updateTopicContent);

router.get("/problems", listProblems);
router.get("/problems/:id", getProblem);

router.get("/challenges", listChallenges);
router.get("/challenges/:id", getChallenge);
router.get("/challenges/:id/leaderboard", auth, getChallengeLeaderboard);

router.post("/seed/challenges", auth, seedChallenges);
router.post("/seed/topic-content", auth, seedTopicContentFromWeb);
router.post("/seed/:language", auth, seedCurriculum);
router.delete("/seed/:language", auth, resetSeededCurriculum);

module.exports = router;
