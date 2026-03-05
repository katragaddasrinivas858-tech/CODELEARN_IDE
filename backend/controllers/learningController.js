const crypto = require("crypto");
const Topic = require("../models/Topic");
const Problem = require("../models/Problem");
const Challenge = require("../models/Challenge");
const Submission = require("../models/Submission");
const User = require("../models/User");
const { percentileLowerBetter } = require("../utils/performance");
const { pickCuratedSourceForLesson, scrapeLessonContent } = require("../utils/webContent");
const {
  SUPPORTED_LANGUAGES,
  buildLanguageFilter,
  normalizeLanguage,
  isSupportedLanguage,
} = require("../constants/languages");

const CHALLENGE_BLUEPRINTS = [
  { title: "Warmup Sprint I", description: "Fast easy set focused on fundamentals." },
  { title: "Warmup Sprint II", description: "Another quick round on core syntax and loops." },
  { title: "Array Patterns", description: "Work through common array and list workflows." },
  { title: "String Patterns", description: "Classic string and text manipulation practice." },
  { title: "Hashing Essentials", description: "Dictionary/set usage for linear-time solutions." },
  { title: "Two-Pointer Circuit", description: "Pointer movement and window-style patterns." },
  { title: "Sliding Window Rush", description: "Optimize subarray and substring traversals." },
  { title: "Sorting and Searching", description: "Sorting-based and binary-search-style exercises." },
  { title: "Stack and Queue Lab", description: "LIFO/FIFO mechanics and monotonic ideas." },
  { title: "Recursion Drill", description: "Recursive decomposition and backtracking basics." },
  { title: "Dynamic Programming I", description: "Intro DP states and transitions." },
  { title: "Dynamic Programming II", description: "Extended DP with optimization patterns." },
  { title: "Greedy Decisions", description: "Pick local optimum strategies with proofs." },
  { title: "Intervals and Events", description: "Merge, overlap, and scheduling style tasks." },
  { title: "Prefix and Difference", description: "Prefix sum and range-update techniques." },
  { title: "Math and Number Theory", description: "GCD, modular tricks, and numeric logic." },
  { title: "Binary Tree Basics", description: "Tree traversal and recursive tree state." },
  { title: "Graph Starter", description: "BFS/DFS basics and adjacency representation." },
  { title: "Performance Gauntlet", description: "Same correctness, tighter runtime pressure." },
  { title: "Final Ranked Contest", description: "Mixed difficulty contest ranked like LeetCode." },
];

const pickChallengeProblems = (problemIds, challengeIndex, countPerChallenge = 10) => {
  if (!problemIds.length) return [];
  const used = new Set();
  const selected = [];
  let cursor = (challengeIndex * 17) % problemIds.length;

  while (selected.length < countPerChallenge && used.size < problemIds.length) {
    const id = problemIds[cursor];
    const key = id.toString();
    if (!used.has(key)) {
      used.add(key);
      selected.push(id);
    }
    cursor = (cursor + 7) % problemIds.length;
  }

  return selected;
};

const round2 = (value) => Math.round(value * 100) / 100;
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const LESSON_BLOCK_TYPES = new Set(["heading", "paragraph", "image", "code"]);
const LESSON_CODE_LANGUAGES = new Set([
  SUPPORTED_LANGUAGES.PYTHON,
  SUPPORTED_LANGUAGES.JAVASCRIPT,
  SUPPORTED_LANGUAGES.C,
]);
const MAX_LESSON_BLOCKS = 120;
const MAX_LESSON_BLOCK_BYTES = 8 * 1024 * 1024;
const MAX_LESSON_IMAGE_DATA_URL_LENGTH = 2_500_000;

const resolveLanguageFromRequest = (req, fallbackLanguage = SUPPORTED_LANGUAGES.PYTHON) => {
  const raw = req.query.language || req.params?.language || req.body?.language || fallbackLanguage;
  return normalizeLanguage(raw, fallbackLanguage);
};

const normalizeSingleLine = (value, maxLength) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const normalizeMultiline = (value, maxLength) =>
  String(value || "")
    .replace(/\r/g, "")
    .slice(0, maxLength);

const clampInteger = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

const isSafeImageSource = (value) => {
  const source = String(value || "").trim();
  if (!source) return false;

  if (/^https?:\/\/\S+$/i.test(source)) {
    return source.length <= 2000;
  }

  if (!/^data:image\//i.test(source)) return false;
  const compact = source.replace(/\s+/g, "");
  return (
    /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(compact) &&
    compact.length <= MAX_LESSON_IMAGE_DATA_URL_LENGTH
  );
};

const lessonBlocksToText = (blocks = []) => {
  const chunks = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.text) {
      chunks.push(block.text);
      continue;
    }

    if (block.type === "paragraph" && block.text) {
      chunks.push(block.text);
      continue;
    }

    if (block.type === "image" && block.caption) {
      chunks.push(`Image: ${block.caption}`);
      continue;
    }

    if (block.type === "code" && block.code) {
      chunks.push("Code example:");
      chunks.push(block.code);
    }
  }
  return normalizeMultiline(chunks.join("\n\n"), 50000);
};

const sanitizeLessonBlocks = (rawBlocks = []) => {
  if (!Array.isArray(rawBlocks)) {
    return { error: "Lesson blocks must be an array" };
  }

  if (rawBlocks.length > MAX_LESSON_BLOCKS) {
    return { error: `Lesson blocks cannot exceed ${MAX_LESSON_BLOCKS} items` };
  }

  const sanitized = [];
  let encodedLength = 0;

  for (let index = 0; index < rawBlocks.length; index += 1) {
    const raw = rawBlocks[index];
    if (!raw || typeof raw !== "object") {
      return { error: `Invalid block at position ${index + 1}` };
    }

    const type = normalizeSingleLine(raw.type, 24).toLowerCase();
    if (!LESSON_BLOCK_TYPES.has(type)) {
      return { error: `Unsupported lesson block type '${type || "unknown"}'` };
    }

    const id = normalizeSingleLine(raw.id, 80) || crypto.randomUUID();
    let block = null;

    if (type === "heading") {
      const text = normalizeSingleLine(raw.text, 220);
      if (!text) {
        return { error: `Heading block at position ${index + 1} cannot be empty` };
      }
      block = {
        id,
        type,
        level: clampInteger(raw.level, 2, 4, 2),
        text,
      };
    }

    if (type === "paragraph") {
      const text = normalizeMultiline(raw.text, 20000).trim();
      if (!text) continue;
      block = {
        id,
        type,
        text,
      };
    }

    if (type === "image") {
      const source = String(raw.src || "").trim();
      const compactSource = /^data:image\//i.test(source) ? source.replace(/\s+/g, "") : source;
      if (!isSafeImageSource(compactSource)) {
        return { error: `Image block at position ${index + 1} has an invalid source` };
      }
      block = {
        id,
        type,
        src: compactSource,
        alt: normalizeSingleLine(raw.alt, 200),
        caption: normalizeSingleLine(raw.caption, 400),
        width: clampInteger(raw.width, 20, 100, 80),
      };
    }

    if (type === "code") {
      const language = normalizeSingleLine(raw.language || "python", 24).toLowerCase() || "python";
      if (!LESSON_CODE_LANGUAGES.has(language)) {
        return { error: "Only Python, JavaScript, and C code blocks are supported in lessons" };
      }

      block = {
        id,
        type,
        language,
        title: normalizeSingleLine(raw.title, 160),
        code: normalizeMultiline(raw.code, 50000),
        stdin: normalizeMultiline(raw.stdin, 4000),
      };
    }

    if (!block) continue;

    encodedLength += Buffer.byteLength(JSON.stringify(block), "utf8");
    if (encodedLength > MAX_LESSON_BLOCK_BYTES) {
      return { error: "Lesson blocks payload is too large" };
    }

    sanitized.push(block);
  }

  return { blocks: sanitized };
};

const listTopics = async (req, res) => {
  const language = resolveLanguageFromRequest(req);
  const includeFull = req.query.full === "true";
  const query = Topic.find(buildLanguageFilter(language)).sort({ order: 1 });
  if (!includeFull) {
    query.select("language title slug description order lessons.id lessons.title lessons.order");
  }
  const topics = await query;
  return res.json(topics);
};

const getTopic = async (req, res) => {
  const language = resolveLanguageFromRequest(req);
  const topic = await Topic.findOne({ _id: req.params.id, ...buildLanguageFilter(language) });
  if (!topic) return res.status(404).json({ error: "Topic not found" });
  return res.json(topic);
};

const listProblems = async (req, res) => {
  const language = resolveLanguageFromRequest(req);
  const { topicId } = req.query;
  const filter = topicId ? { topicId, ...buildLanguageFilter(language) } : buildLanguageFilter(language);
  const problems = await Problem.find(filter)
    .select("-solution -testCases")
    .sort({ createdAt: 1 });
  return res.json(problems);
};

const getProblem = async (req, res) => {
  const language = resolveLanguageFromRequest(req);
  const problem = await Problem.findOne({ _id: req.params.id, ...buildLanguageFilter(language) }).select(
    "-solution -testCases"
  );
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  return res.json(problem);
};

const listChallenges = async (req, res) => {
  const language = resolveLanguageFromRequest(req);
  const now = new Date();
  const challenges = await Challenge.find({
    ...buildLanguageFilter(language),
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  }).sort({ createdAt: -1 });
  return res.json(challenges);
};

const getChallenge = async (req, res) => {
  const language = resolveLanguageFromRequest(req);
  const now = new Date();
  const challenge = await Challenge.findOne({
    _id: req.params.id,
    ...buildLanguageFilter(language),
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  });
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });
  return res.json(challenge);
};

const seedChallenges = async (req, res) => {
  const user = await User.findById(req.user?.id);
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  const language = resolveLanguageFromRequest(req, user.learningLanguage);
  if (!isSupportedLanguage(language)) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  const problems = await Problem.find(buildLanguageFilter(language)).sort({ createdAt: 1 }).select("_id");
  if (problems.length < CHALLENGE_BLUEPRINTS.length) {
    return res.status(400).json({
      error:
        `Not enough problems to build challenges for ${language}. Seed topics/problems first with POST /api/seed/${language}.`,
    });
  }

  let existingChallenges = await Challenge.find(buildLanguageFilter(language)).select("title");
  const forceReset = req.query.force === "true";
  if (forceReset && process.env.ALLOW_SEED_FORCE_RESET !== "true") {
    return res.status(403).json({
      error: "Force reset is disabled. Set ALLOW_SEED_FORCE_RESET=true to enable it.",
    });
  }

  if (forceReset) {
    await Challenge.deleteMany(buildLanguageFilter(language));
    existingChallenges = [];
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90);
  const problemIds = problems.map((p) => p._id);
  const existingTitles = new Set(existingChallenges.map((c) => c.title));
  const remaining = CHALLENGE_BLUEPRINTS.filter((b) => !existingTitles.has(b.title));

  if (!remaining.length) {
    return res.json({
      message: "Challenges already seeded",
      count: existingChallenges.length,
    });
  }

  const payload = remaining.map((blueprint) => ({
    language,
    title: blueprint.title,
    description:
      `${blueprint.description} ` +
      "Submission counts only after all test cases pass. Ranked by solved count, solve time, runtime, and complexity efficiency.",
    problemIds: pickChallengeProblems(
      problemIds,
      CHALLENGE_BLUEPRINTS.findIndex((b) => b.title === blueprint.title),
      10
    ),
    startsAt: now,
    endsAt,
    active: true,
  }));

  const created = await Challenge.insertMany(payload);
  return res.json({
    message: `Challenges seeded for ${language}`,
    language,
    count: created.length,
    challenges: created,
  });
};

const seedTopicContentFromWeb = async (req, res) => {
  const user = await User.findById(req.user?.id);
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  const language = resolveLanguageFromRequest(req, user.learningLanguage);
  if (language !== SUPPORTED_LANGUAGES.PYTHON) {
    return res.status(400).json({
      error: "Web content import is currently available only for Python curriculum.",
    });
  }

  const { topicId = "", replaceExisting = true } = req.body || {};
  const filter = topicId
    ? { _id: topicId, ...buildLanguageFilter(language) }
    : buildLanguageFilter(language);

  const topics = await Topic.find(filter).sort({ order: 1 });
  if (!topics.length) {
    return res.status(404).json({ error: "No topics found for import" });
  }

  let updatedTopics = 0;
  let updatedLessons = 0;
  const report = [];

  for (const topic of topics) {
    const lessonResults = [];
    let topicChanged = false;

    const orderedLessons = [...(topic.lessons || [])].sort((a, b) => a.order - b.order);
    for (let index = 0; index < orderedLessons.length; index += 1) {
      const lesson = orderedLessons[index];
      const currentContent = (lesson.content || "").trim();

      if (!replaceExisting && currentContent.length >= 80) {
        lessonResults.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          status: "skipped",
          reason: "Already has content",
        });
        continue;
      }

      const sourceUrl = pickCuratedSourceForLesson(topic.slug, index);
      if (!sourceUrl) {
        lessonResults.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          status: "skipped",
          reason: `No curated source mapping found for topic slug '${topic.slug}'`,
        });
        continue;
      }

      try {
        const scraped = await scrapeLessonContent({
          url: sourceUrl,
          topicTitle: topic.title,
          lessonTitle: lesson.title,
        });
        lesson.content = scraped.content;
        lesson.blocks = [];
        topicChanged = true;
        updatedLessons += 1;

        lessonResults.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          status: "updated",
          sourceUrl: scraped.sourceUrl,
          sourceTitle: scraped.sourceTitle,
        });
      } catch (err) {
        lessonResults.push({
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          status: "failed",
          sourceUrl,
          reason: err.message || "Unable to scrape source",
        });
      }
    }

    if (topicChanged) {
      topic.markModified("lessons");
      await topic.save();
      updatedTopics += 1;
    }

    report.push({
      topicId: topic._id,
      topicSlug: topic.slug,
      topicTitle: topic.title,
      lessons: lessonResults,
    });
  }

  return res.json({
    message: `Topic content import finished for ${language}`,
    language,
    updatedTopics,
    updatedLessons,
    report,
  });
};

const updateTopicContent = async (req, res) => {
  const user = await User.findById(req.user?.id).select("role");
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
  }

  const topic = await Topic.findById(req.params.id);
  if (!topic) {
    return res.status(404).json({ error: "Topic not found" });
  }

  let changed = false;

  if (hasOwn(req.body, "title")) {
    const title = normalizeSingleLine(req.body.title, 120);
    if (!title) {
      return res.status(400).json({ error: "Topic title cannot be empty" });
    }
    topic.title = title;
    changed = true;
  }

  if (hasOwn(req.body, "description")) {
    topic.description = normalizeMultiline(req.body.description, 6000).trim();
    changed = true;
  }

  if (hasOwn(req.body, "lessons") && !Array.isArray(req.body.lessons)) {
    return res.status(400).json({ error: "Lessons must be an array" });
  }

  if (Array.isArray(req.body?.lessons)) {
    const lessonMap = new Map((topic.lessons || []).map((lesson) => [String(lesson.id), lesson]));
    const seen = new Set();

    for (const patch of req.body.lessons) {
      const lessonId = normalizeSingleLine(patch?.id, 80);
      if (!lessonId) {
        return res.status(400).json({ error: "Each lesson update must include a valid id" });
      }
      if (seen.has(lessonId)) {
        return res.status(400).json({ error: `Duplicate lesson id '${lessonId}' in payload` });
      }
      seen.add(lessonId);

      const lesson = lessonMap.get(lessonId);
      if (!lesson) {
        return res.status(404).json({ error: `Lesson not found for id '${lessonId}'` });
      }

      if (hasOwn(patch, "title")) {
        const lessonTitle = normalizeSingleLine(patch.title, 160);
        if (!lessonTitle) {
          return res.status(400).json({ error: "Lesson title cannot be empty" });
        }
        lesson.title = lessonTitle;
        changed = true;
      }

      if (hasOwn(patch, "content")) {
        lesson.content = normalizeMultiline(patch.content, 50000);
        changed = true;
      }

      if (hasOwn(patch, "blocks")) {
        const { blocks, error } = sanitizeLessonBlocks(patch.blocks);
        if (error) {
          return res.status(400).json({ error });
        }
        lesson.blocks = blocks;
        if (!hasOwn(patch, "content")) {
          lesson.content = lessonBlocksToText(blocks);
        }
        changed = true;
      }

      if (hasOwn(patch, "order")) {
        const parsedOrder = Number(patch.order);
        if (!Number.isInteger(parsedOrder) || parsedOrder < 1 || parsedOrder > 9999) {
          return res.status(400).json({ error: "Lesson order must be an integer between 1 and 9999" });
        }
        lesson.order = parsedOrder;
        changed = true;
      }
    }

    if (req.body.lessons.length > 0) {
      topic.markModified("lessons");
    }
  }

  if (!changed) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  await topic.save();
  return res.json({ message: "Topic content updated", topic });
};

const resetSeededCurriculum = async (req, res) => {
  const user = await User.findById(req.user?.id).select("role learningLanguage");
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
  }
  const language = resolveLanguageFromRequest(req, user.learningLanguage);
  if (!isSupportedLanguage(language)) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  if (process.env.ALLOW_SEED_FORCE_RESET !== "true") {
    return res.status(403).json({
      error: "Curriculum reset is disabled. Set ALLOW_SEED_FORCE_RESET=true to enable it.",
    });
  }

  if (req.body?.confirm !== "RESET_CURRICULUM") {
    return res.status(400).json({
      error: "Reset not confirmed. Send {\"confirm\":\"RESET_CURRICULUM\"} in request body.",
    });
  }

  const languageFilter = buildLanguageFilter(language);
  const [problemDocs, challengeDocs] = await Promise.all([
    Problem.find(languageFilter).select("_id").lean(),
    Challenge.find(languageFilter).select("_id").lean(),
  ]);
  const problemIds = problemDocs.map((doc) => doc._id);
  const challengeIds = challengeDocs.map((doc) => doc._id);

  const submissionFilters = [];
  if (problemIds.length) submissionFilters.push({ problemId: { $in: problemIds } });
  if (challengeIds.length) submissionFilters.push({ challengeId: { $in: challengeIds } });

  const [topicsResult, problemsResult, challengesResult, submissionsResult] = await Promise.all([
    Topic.deleteMany(languageFilter),
    Problem.deleteMany(languageFilter),
    Challenge.deleteMany(languageFilter),
    submissionFilters.length
      ? Submission.deleteMany({ $or: submissionFilters })
      : Promise.resolve({ deletedCount: 0 }),
  ]);

  return res.json({
    message: `Seeded curriculum removed for ${language}`,
    language,
    deleted: {
      topics: topicsResult.deletedCount || 0,
      problems: problemsResult.deletedCount || 0,
      challenges: challengesResult.deletedCount || 0,
      submissions: submissionsResult.deletedCount || 0,
    },
  });
};

const getChallengeLeaderboard = async (req, res) => {
  const challenge = await Challenge.findById(req.params.id);
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });
  const challengeLanguage = normalizeLanguage(challenge.language);

  const viewer = await User.findById(req.user.id);
  if (!viewer) return res.status(404).json({ error: "User not found" });

  const teacherId = viewer.role === "teacher" ? viewer._id : viewer.teacherId;
  if (!teacherId) return res.status(400).json({ error: "Teacher not assigned" });

  const submissions = await Submission.find({
    challengeId: challenge._id,
    teacherId,
    ...buildLanguageFilter(challengeLanguage),
  })
    .sort({ createdAt: 1 })
    .lean();

  const challengeProblemSet = new Set((challenge.problemIds || []).map((id) => id.toString()));
  const userMap = new Map();

  for (const sub of submissions) {
    const problemKey = sub.problemId?.toString();
    if (!challengeProblemSet.has(problemKey)) continue;
    const userKey = sub.userId.toString();

    if (!userMap.has(userKey)) {
      userMap.set(userKey, {
        userId: userKey,
        startedAt: sub.createdAt,
        lastSubmission: sub.createdAt,
        problems: new Map(),
      });
    }

    const bucket = userMap.get(userKey);
    if (sub.createdAt < bucket.startedAt) bucket.startedAt = sub.createdAt;
    if (sub.createdAt > bucket.lastSubmission) bucket.lastSubmission = sub.createdAt;

    if (!bucket.problems.has(problemKey)) {
      bucket.problems.set(problemKey, {
        wrongBeforeAccepted: 0,
        firstAcceptedAt: null,
        bestRuntimeMs: Number.POSITIVE_INFINITY,
        bestComplexityScore: Number.POSITIVE_INFINITY,
      });
    }

    const stat = bucket.problems.get(problemKey);
    if (sub.status === "Accepted") {
      if (!stat.firstAcceptedAt) {
        stat.firstAcceptedAt = sub.createdAt;
      }
      stat.bestRuntimeMs = Math.min(stat.bestRuntimeMs, sub.runtimeMs || 0);
      stat.bestComplexityScore = Math.min(stat.bestComplexityScore, sub.complexityScore || 3);
    } else if (!stat.firstAcceptedAt) {
      stat.wrongBeforeAccepted += 1;
    }
  }

  const rows = [];
  for (const [, entry] of userMap) {
    const solved = Array.from(entry.problems.values()).filter((p) => p.firstAcceptedAt);
    if (!solved.length) continue;

    const solvedCount = solved.length;
    const avgRuntimeMs = solved.reduce((acc, p) => acc + p.bestRuntimeMs, 0) / solvedCount;
    const avgComplexityScore =
      solved.reduce((acc, p) => acc + p.bestComplexityScore, 0) / solvedCount;
    const penaltyMinutes = solved.reduce((acc, p) => {
      const elapsedMs = new Date(p.firstAcceptedAt).getTime() - new Date(entry.startedAt).getTime();
      const wrongPenalty = p.wrongBeforeAccepted * 5;
      return acc + elapsedMs / 60000 + wrongPenalty;
    }, 0);

    rows.push({
      userId: entry.userId,
      solvedCount,
      avgRuntimeMs,
      avgComplexityScore,
      penaltyMinutes,
      startedAt: entry.startedAt,
      lastSubmission: entry.lastSubmission,
    });
  }

  rows.sort((a, b) => {
    if (b.solvedCount !== a.solvedCount) return b.solvedCount - a.solvedCount;
    if (a.penaltyMinutes !== b.penaltyMinutes) return a.penaltyMinutes - b.penaltyMinutes;
    if (a.avgRuntimeMs !== b.avgRuntimeMs) return a.avgRuntimeMs - b.avgRuntimeMs;
    return a.avgComplexityScore - b.avgComplexityScore;
  });

  const runtimeValues = rows.map((r) => r.avgRuntimeMs);
  const complexityValues = rows.map((r) => r.avgComplexityScore);
  const speedValues = rows.map((r) => r.penaltyMinutes);

  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select(
    "_id email displayName"
  );
  const profiles = new Map(users.map((u) => [u._id.toString(), u]));

  const leaderboard = rows.map((row, index) => ({
    rank: index + 1,
    userId: row.userId,
    name: profiles.get(row.userId)?.displayName || profiles.get(row.userId)?.email || "Student",
    email: profiles.get(row.userId)?.email || "",
    solvedCount: row.solvedCount,
    totalProblems: challenge.problemIds.length,
    avgRuntimeMs: Math.round(row.avgRuntimeMs),
    avgComplexityScore: Math.round(row.avgComplexityScore * 100) / 100,
    runtimePercentile: percentileLowerBetter(runtimeValues, row.avgRuntimeMs),
    complexityPercentile: percentileLowerBetter(complexityValues, row.avgComplexityScore),
    speedPercentile: percentileLowerBetter(speedValues, row.penaltyMinutes),
    penaltyMinutes: round2(row.penaltyMinutes),
    startedAt: row.startedAt,
    lastSubmission: row.lastSubmission,
  }));

  return res.json({
    challengeId: challenge._id,
    challengeTitle: challenge.title,
    language: challengeLanguage,
    leaderboard,
    rankingRule:
      "Ranked by solved count, then lower penalty time (solve elapsed + 5m per wrong attempt), then runtime, then complexity score.",
  });
};

const seedPython = async (req, res) => {
  const language = SUPPORTED_LANGUAGES.PYTHON;
  if (req.user && req.user.id) {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ error: "Teacher access required" });
    }
  }

  const languageFilter = buildLanguageFilter(language);
  const topicsCount = await Topic.countDocuments(languageFilter);
  const problemsCount = await Problem.countDocuments(languageFilter);
  if (topicsCount > 0 || problemsCount > 0) {
    return res.json({ message: `Already seeded for ${language}`, language });
  }

  const pythonTopics = [
    {
      title: "Python Basics",
      slug: "python-basics",
      description: "Syntax, print, inputs, and foundational operations.",
      order: 1,
      lessons: [
        {
          id: crypto.randomUUID(),
          title: "Hello Python",
          content: "Learn print statements and basic syntax.",
          order: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Numbers and Strings",
          content: "Work with integers, floats, and string operations.",
          order: 2,
        },
        {
          id: crypto.randomUUID(),
          title: "Input and Output",
          content: "Collect input and format output.",
          order: 3,
        },
      ],
    },
    {
      title: "Variables & Data Types",
      slug: "variables-data-types",
      description: "Variables, lists, dicts, tuples, and type handling.",
      order: 2,
      lessons: [
        {
          id: crypto.randomUUID(),
          title: "Variables",
          content: "Assign and reassign values.",
          order: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Collections",
          content: "Lists, tuples, and dictionaries.",
          order: 2,
        },
      ],
    },
    {
      title: "Conditionals & Loops",
      slug: "conditionals-loops",
      description: "if/else logic, for/while loops, and flow control.",
      order: 3,
      lessons: [
        {
          id: crypto.randomUUID(),
          title: "If Statements",
          content: "Branch logic with if/elif/else.",
          order: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Loops",
          content: "Iterate with for and while loops.",
          order: 2,
        },
      ],
    },
    {
      title: "Functions",
      slug: "functions",
      description: "Reusable logic, parameters, return values, and helpers.",
      order: 4,
      lessons: [
        {
          id: crypto.randomUUID(),
          title: "Defining Functions",
          content: "Create and call functions.",
          order: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Parameters",
          content: "Use positional and keyword arguments.",
          order: 2,
        },
      ],
    },
    {
      title: "OOP",
      slug: "oop",
      description: "Classes, objects, methods, and encapsulation.",
      order: 5,
      lessons: [
        {
          id: crypto.randomUUID(),
          title: "Classes and Objects",
          content: "Define classes and instantiate objects.",
          order: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Methods",
          content: "Create instance methods and properties.",
          order: 2,
        },
      ],
    },
    {
      title: "Modules & Packages",
      slug: "modules-packages",
      description: "Importing modules, using standard libraries, packaging code.",
      order: 6,
      lessons: [
        {
          id: crypto.randomUUID(),
          title: "Importing Modules",
          content: "Use import statements and aliases.",
          order: 1,
        },
        {
          id: crypto.randomUUID(),
          title: "Standard Library",
          content: "Math, random, and datetime modules.",
          order: 2,
        },
      ],
    },
  ];

  const topics = await Topic.insertMany(pythonTopics.map((topic) => ({ ...topic, language })));

  const topicMap = new Map(topics.map((t) => [t.slug, t._id]));

  const buildProblems = (topicSlug, templates) => {
    const problems = [];
    for (let i = 1; i <= 50; i += 1) {
      const template = templates[(i - 1) % templates.length];
      const data = template(i);
      problems.push({
        language,
        topicId: topicMap.get(topicSlug),
        title: `${data.title} ${i}`,
        slug: `${topicSlug}-${data.slug}-${i}`,
        difficulty: data.difficulty,
        prompt: data.prompt,
        entryType: data.entryType || "function",
        entryName: data.entryName,
        starter: data.starter,
        solution: data.solution,
        complexity: data.complexity || "O(n)",
        testCases: data.testCases,
      });
    }
    return problems;
  };

  const basicTemplates = [
    (i) => ({
      title: "Add Two Numbers",
      slug: "add-two",
      difficulty: "Easy",
      prompt: "Return the sum of two integers.",
      entryName: "add_numbers",
      starter: "def add_numbers(a, b):\n    # TODO\n    return 0\n",
      solution: "def add_numbers(a, b):\n    return a + b\n",
      testCases: [
        { input: [i, i + 1], output: i + i + 1 },
        { input: [10, -5], output: 5 },
      ],
    }),
    (i) => ({
      title: "Square Value",
      slug: "square",
      difficulty: "Easy",
      prompt: "Return the square of the input.",
      entryName: "square",
      starter: "def square(n):\n    # TODO\n    return 0\n",
      solution: "def square(n):\n    return n * n\n",
      testCases: [
        { input: [i], output: i * i },
        { input: [4], output: 16 },
      ],
    }),
    (i) => ({
      title: "Greeting",
      slug: "greet",
      difficulty: "Easy",
      prompt: "Return a greeting for the given name.",
      entryName: "greet",
      starter: 'def greet(name):\n    # TODO\n    return ""\n',
      solution: 'def greet(name):\n    return f"Hello, {name}!"\n',
      testCases: [
        { input: ["Ada"], output: "Hello, Ada!" },
        { input: ["CodeLearn"], output: "Hello, CodeLearn!" },
      ],
    }),
  ];

  const variableTemplates = [
    (i) => ({
      title: "List Sum",
      slug: "list-sum",
      difficulty: "Easy",
      prompt: "Return the sum of all numbers in a list.",
      entryName: "sum_list",
      starter: "def sum_list(nums):\n    # TODO\n    return 0\n",
      solution: "def sum_list(nums):\n    return sum(nums)\n",
      testCases: [
        { input: [[i, i + 1, i + 2]], output: i + i + 1 + i + 2 },
        { input: [[1, 2, 3]], output: 6 },
      ],
    }),
    (i) => ({
      title: "Dictionary Lookup",
      slug: "dict-lookup",
      difficulty: "Easy",
      prompt: "Return the value for a key in the dictionary or 0 if missing.",
      entryName: "get_value",
      starter: "def get_value(data, key):\n    # TODO\n    return 0\n",
      solution: "def get_value(data, key):\n    return data.get(key, 0)\n",
      testCases: [
        { input: [{ a: i }, "a"], output: i },
        { input: [{ b: 2 }, "a"], output: 0 },
      ],
    }),
    (i) => ({
      title: "String Length",
      slug: "string-length",
      difficulty: "Easy",
      prompt: "Return the length of the string.",
      entryName: "string_length",
      starter: 'def string_length(text):\n    # TODO\n    return 0\n',
      solution: "def string_length(text):\n    return len(text)\n",
      testCases: [
        { input: ["python"], output: 6 },
        { input: ["loop" + "s" * (i % 3)], output: 4 + (i % 3) },
      ],
    }),
  ];

  const loopTemplates = [
    (i) => ({
      title: "Sum to N",
      slug: "sum-to-n",
      difficulty: "Easy",
      prompt: "Return the sum of integers from 1 to n.",
      entryName: "sum_to_n",
      starter: "def sum_to_n(n):\n    # TODO\n    return 0\n",
      solution: "def sum_to_n(n):\n    return int((n * (n + 1)) / 2)\n",
      testCases: [
        { input: [i], output: Math.floor((i * (i + 1)) / 2) },
        { input: [10], output: 55 },
      ],
    }),
    (i) => ({
      title: "Count Evens",
      slug: "count-evens",
      difficulty: "Easy",
      prompt: "Count how many even numbers are in the list.",
      entryName: "count_evens",
      starter: "def count_evens(nums):\n    # TODO\n    return 0\n",
      solution: "def count_evens(nums):\n    return sum(1 for n in nums if n % 2 == 0)\n",
      testCases: [
        { input: [[1, 2, 3, 4]], output: 2 },
        {
          input: [[i, i + 1, i + 2]],
          output: [i, i + 1, i + 2].filter((n) => n % 2 === 0).length,
        },
      ],
    }),
    (i) => ({
      title: "Factorial",
      slug: "factorial",
      difficulty: "Medium",
      prompt: "Return n factorial.",
      entryName: "factorial",
      starter: "def factorial(n):\n    # TODO\n    return 1\n",
      solution:
        "def factorial(n):\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result\n",
      testCases: [
        { input: [5], output: 120 },
        { input: [i % 6], output: [1, 1, 2, 6, 24, 120][i % 6] },
      ],
    }),
  ];

  const functionTemplates = [
    (i) => ({
      title: "Power Function",
      slug: "power",
      difficulty: "Easy",
      prompt: "Return base raised to exponent.",
      entryName: "power",
      starter: "def power(base, exp):\n    # TODO\n    return 0\n",
      solution: "def power(base, exp):\n    return base ** exp\n",
      testCases: [
        { input: [2, i % 5], output: 2 ** (i % 5) },
        { input: [3, 2], output: 9 },
      ],
    }),
    (i) => ({
      title: "Average",
      slug: "average",
      difficulty: "Easy",
      prompt: "Return the average of the list.",
      entryName: "average",
      starter: "def average(nums):\n    # TODO\n    return 0\n",
      solution: "def average(nums):\n    return sum(nums) / len(nums) if nums else 0\n",
      testCases: [
        { input: [[i, i + 2, i + 4]], output: (i + i + 2 + i + 4) / 3 },
        { input: [[1, 2, 3, 4]], output: 2.5 },
      ],
    }),
    (i) => ({
      title: "Palindrome Check",
      slug: "palindrome",
      difficulty: "Easy",
      prompt: "Return True if the string is a palindrome.",
      entryName: "is_palindrome",
      starter: "def is_palindrome(text):\n    # TODO\n    return False\n",
      solution: "def is_palindrome(text):\n    return text == text[::-1]\n",
      testCases: [
        { input: ["level"], output: true },
        { input: ["code"], output: false },
      ],
    }),
  ];

  const oopTemplates = [
    (i) => ({
      title: "Counter Class",
      slug: "counter",
      difficulty: "Medium",
      prompt:
        "Create a Counter class with methods inc(n=1) and value(). Return outputs for the calls.",
      entryType: "class",
      entryName: "Counter",
      starter:
        "class Counter:\n    def __init__(self, start=0):\n        self.count = start\n\n    def inc(self, n=1):\n        # TODO\n        pass\n\n    def value(self):\n        # TODO\n        return 0\n",
      solution:
        "class Counter:\n    def __init__(self, start=0):\n        self.count = start\n\n    def inc(self, n=1):\n        self.count += n\n        return None\n\n    def value(self):\n        return self.count\n",
      testCases: [
        {
          input: { init: [i], calls: [["inc", [2]], ["value", []]] },
          output: [null, i + 2],
        },
      ],
      complexity: "O(1)",
    }),
    (i) => ({
      title: "Bank Account",
      slug: "bank-account",
      difficulty: "Medium",
      prompt:
        "Implement BankAccount with deposit(amount), withdraw(amount), balance(). Return outputs for calls.",
      entryType: "class",
      entryName: "BankAccount",
      starter:
        "class BankAccount:\n    def __init__(self, balance=0):\n        self.amount = balance\n\n    def deposit(self, amount):\n        # TODO\n        pass\n\n    def withdraw(self, amount):\n        # TODO\n        pass\n\n    def balance(self):\n        # TODO\n        return 0\n",
      solution:
        "class BankAccount:\n    def __init__(self, balance=0):\n        self.amount = balance\n\n    def deposit(self, amount):\n        self.amount += amount\n        return None\n\n    def withdraw(self, amount):\n        if amount <= self.amount:\n            self.amount -= amount\n        return None\n\n    def balance(self):\n        return self.amount\n",
      testCases: [
        {
          input: { init: [100], calls: [["deposit", [i]], ["withdraw", [30]], ["balance", []]] },
          output: [null, null, 100 + i - 30],
        },
      ],
      complexity: "O(1)",
    }),
  ];

  const moduleTemplates = [
    (i) => ({
      title: "Square Root",
      slug: "sqrt",
      difficulty: "Easy",
      prompt: "Return the square root of n rounded to 2 decimals.",
      entryName: "sqrt_two",
      starter: "import math\n\ndef sqrt_two(n):\n    # TODO\n    return 0\n",
      solution: "import math\n\ndef sqrt_two(n):\n    return round(math.sqrt(n), 2)\n",
      testCases: [
        { input: [i * i], output: i },
        { input: [2], output: 1.41 },
      ],
      complexity: "O(1)",
    }),
    (i) => ({
      title: "GCD",
      slug: "gcd",
      difficulty: "Easy",
      prompt: "Return the greatest common divisor of a and b.",
      entryName: "gcd",
      starter: "import math\n\ndef gcd(a, b):\n    # TODO\n    return 1\n",
      solution: "import math\n\ndef gcd(a, b):\n    return math.gcd(a, b)\n",
      testCases: [
        { input: [i + 2, (i + 2) * 3], output: i + 2 },
        { input: [12, 18], output: 6 },
      ],
      complexity: "O(log n)",
    }),
  ];

  const problems = [
    ...buildProblems("python-basics", basicTemplates),
    ...buildProblems("variables-data-types", variableTemplates),
    ...buildProblems("conditionals-loops", loopTemplates),
    ...buildProblems("functions", functionTemplates),
    ...buildProblems("oop", oopTemplates),
    ...buildProblems("modules-packages", moduleTemplates),
  ];

  await Problem.insertMany(problems);
  return res.json({ message: `Seeded ${language} curriculum`, language, topics, problems: problems.length });
};

const seedJavaScript = async (req, res) => {
  const language = SUPPORTED_LANGUAGES.JAVASCRIPT;
  if (req.user && req.user.id) {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ error: "Teacher access required" });
    }
  }

  const languageFilter = buildLanguageFilter(language);
  const topicsCount = await Topic.countDocuments(languageFilter);
  const problemsCount = await Problem.countDocuments(languageFilter);
  if (topicsCount > 0 || problemsCount > 0) {
    return res.json({ message: `Already seeded for ${language}`, language });
  }

  const jsTopics = [
    {
      title: "JavaScript Basics",
      slug: "javascript-basics",
      description: "Syntax, variables, output, and basic operators.",
      order: 1,
      lessons: [
        { id: crypto.randomUUID(), title: "Hello JavaScript", content: "Use console.log and expressions.", order: 1 },
        { id: crypto.randomUUID(), title: "Numbers and Strings", content: "Work with primitive values.", order: 2 },
      ],
    },
    {
      title: "Arrays & Objects",
      slug: "javascript-arrays-objects",
      description: "Core data structures and common operations.",
      order: 2,
      lessons: [
        { id: crypto.randomUUID(), title: "Array Basics", content: "Push, pop, map, and reduce.", order: 1 },
        { id: crypto.randomUUID(), title: "Object Patterns", content: "Read and write object keys safely.", order: 2 },
      ],
    },
    {
      title: "Conditionals & Loops",
      slug: "javascript-conditionals-loops",
      description: "if/else logic and iterative patterns.",
      order: 3,
      lessons: [
        { id: crypto.randomUUID(), title: "Branching", content: "Choose execution paths with if/else.", order: 1 },
        { id: crypto.randomUUID(), title: "Looping", content: "for, while, and for...of loops.", order: 2 },
      ],
    },
    {
      title: "Functions & Scope",
      slug: "javascript-functions-scope",
      description: "Function declarations, arrow functions, and closures.",
      order: 4,
      lessons: [
        { id: crypto.randomUUID(), title: "Function Syntax", content: "Arguments, return values, and defaults.", order: 1 },
        { id: crypto.randomUUID(), title: "Scope", content: "let/const scope rules and closures.", order: 2 },
      ],
    },
    {
      title: "Classes & OOP",
      slug: "javascript-classes-oop",
      description: "Constructor functions, classes, and methods.",
      order: 5,
      lessons: [
        { id: crypto.randomUUID(), title: "Class Basics", content: "Create and instantiate classes.", order: 1 },
        { id: crypto.randomUUID(), title: "Methods", content: "Encapsulation with class methods.", order: 2 },
      ],
    },
    {
      title: "Built-ins & Utilities",
      slug: "javascript-builtins",
      description: "Math, string, and array helper methods.",
      order: 6,
      lessons: [
        { id: crypto.randomUUID(), title: "Math and Number", content: "Use built-in numeric helpers.", order: 1 },
        { id: crypto.randomUUID(), title: "String Utilities", content: "Split, join, trim, and formatting.", order: 2 },
      ],
    },
  ];

  const topics = await Topic.insertMany(jsTopics.map((topic) => ({ ...topic, language })));
  const topicMap = new Map(topics.map((t) => [t.slug, t._id]));

  const buildProblems = (topicSlug, templates) => {
    const problems = [];
    for (let i = 1; i <= 30; i += 1) {
      const template = templates[(i - 1) % templates.length];
      const data = template(i);
      problems.push({
        language,
        topicId: topicMap.get(topicSlug),
        title: `${data.title} ${i}`,
        slug: `${topicSlug}-${data.slug}-${i}`,
        difficulty: data.difficulty,
        prompt: data.prompt,
        entryType: data.entryType || "function",
        entryName: data.entryName,
        starter: data.starter,
        solution: data.solution,
        complexity: data.complexity || "O(n)",
        testCases: data.testCases,
      });
    }
    return problems;
  };

  const basicsTemplates = [
    (i) => ({
      title: "Add Two Numbers",
      slug: "add-two",
      difficulty: "Easy",
      prompt: "Return the sum of two integers.",
      entryName: "addNumbers",
      starter: "function addNumbers(a, b) {\n  // TODO\n  return 0;\n}\n",
      solution: "function addNumbers(a, b) {\n  return a + b;\n}\n",
      testCases: [
        { input: [i, i + 1], output: i + i + 1 },
        { input: [7, -2], output: 5 },
      ],
    }),
    (i) => ({
      title: "Square Number",
      slug: "square",
      difficulty: "Easy",
      prompt: "Return the square of n.",
      entryName: "square",
      starter: "function square(n) {\n  // TODO\n  return 0;\n}\n",
      solution: "function square(n) {\n  return n * n;\n}\n",
      testCases: [
        { input: [i], output: i * i },
        { input: [4], output: 16 },
      ],
    }),
    (i) => ({
      title: "Create Greeting",
      slug: "greeting",
      difficulty: "Easy",
      prompt: "Return 'Hello, <name>!' for the input string.",
      entryName: "greet",
      starter: "function greet(name) {\n  // TODO\n  return \"\";\n}\n",
      solution: "function greet(name) {\n  return `Hello, ${name}!`;\n}\n",
      testCases: [
        { input: ["Ada"], output: "Hello, Ada!" },
        { input: [`Dev${i}`], output: `Hello, Dev${i}!` },
      ],
    }),
  ];

  const collectionTemplates = [
    (i) => ({
      title: "Array Sum",
      slug: "array-sum",
      difficulty: "Easy",
      prompt: "Return the sum of all numbers in an array.",
      entryName: "sumArray",
      starter: "function sumArray(nums) {\n  // TODO\n  return 0;\n}\n",
      solution: "function sumArray(nums) {\n  return nums.reduce((acc, n) => acc + n, 0);\n}\n",
      testCases: [
        { input: [[i, i + 1, i + 2]], output: i + i + 1 + i + 2 },
        { input: [[1, 2, 3]], output: 6 },
      ],
    }),
    (i) => ({
      title: "Object Lookup",
      slug: "object-lookup",
      difficulty: "Easy",
      prompt: "Return data[key] if present, else 0.",
      entryName: "lookup",
      starter: "function lookup(data, key) {\n  // TODO\n  return 0;\n}\n",
      solution: "function lookup(data, key) {\n  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : 0;\n}\n",
      testCases: [
        { input: [{ a: i }, "a"], output: i },
        { input: [{ b: 2 }, "a"], output: 0 },
      ],
    }),
    (i) => ({
      title: "Unique Count",
      slug: "unique-count",
      difficulty: "Easy",
      prompt: "Return number of distinct values in an array.",
      entryName: "countUnique",
      starter: "function countUnique(nums) {\n  // TODO\n  return 0;\n}\n",
      solution: "function countUnique(nums) {\n  return new Set(nums).size;\n}\n",
      testCases: [
        { input: [[1, 2, 2, 3]], output: 3 },
        { input: [[i, i, i + 1]], output: 2 },
      ],
    }),
  ];

  const loopTemplates = [
    (i) => ({
      title: "Sum to N",
      slug: "sum-to-n",
      difficulty: "Easy",
      prompt: "Return the sum from 1 to n.",
      entryName: "sumToN",
      starter: "function sumToN(n) {\n  // TODO\n  return 0;\n}\n",
      solution: "function sumToN(n) {\n  return (n * (n + 1)) / 2;\n}\n",
      testCases: [
        { input: [10], output: 55 },
        { input: [i], output: (i * (i + 1)) / 2 },
      ],
    }),
    (i) => ({
      title: "Count Evens",
      slug: "count-evens",
      difficulty: "Easy",
      prompt: "Count even values in an array.",
      entryName: "countEvens",
      starter: "function countEvens(nums) {\n  // TODO\n  return 0;\n}\n",
      solution: "function countEvens(nums) {\n  return nums.filter((n) => n % 2 === 0).length;\n}\n",
      testCases: [
        { input: [[1, 2, 3, 4]], output: 2 },
        { input: [[i, i + 1, i + 2]], output: [i, i + 1, i + 2].filter((n) => n % 2 === 0).length },
      ],
    }),
    (i) => ({
      title: "Factorial",
      slug: "factorial",
      difficulty: "Medium",
      prompt: "Return n factorial.",
      entryName: "factorial",
      starter: "function factorial(n) {\n  // TODO\n  return 1;\n}\n",
      solution: "function factorial(n) {\n  let result = 1;\n  for (let i = 2; i <= n; i += 1) result *= i;\n  return result;\n}\n",
      testCases: [
        { input: [5], output: 120 },
        { input: [i % 6], output: [1, 1, 2, 6, 24, 120][i % 6] },
      ],
    }),
  ];

  const functionTemplates = [
    (i) => ({
      title: "Power Function",
      slug: "power",
      difficulty: "Easy",
      prompt: "Return base raised to exponent.",
      entryName: "power",
      starter: "function power(base, exp) {\n  // TODO\n  return 0;\n}\n",
      solution: "function power(base, exp) {\n  return base ** exp;\n}\n",
      testCases: [
        { input: [2, i % 5], output: 2 ** (i % 5) },
        { input: [3, 2], output: 9 },
      ],
    }),
    (i) => ({
      title: "Average",
      slug: "average",
      difficulty: "Easy",
      prompt: "Return average of array values.",
      entryName: "average",
      starter: "function average(nums) {\n  // TODO\n  return 0;\n}\n",
      solution: "function average(nums) {\n  return nums.length ? nums.reduce((acc, n) => acc + n, 0) / nums.length : 0;\n}\n",
      testCases: [
        { input: [[1, 2, 3, 4]], output: 2.5 },
        { input: [[i, i + 2, i + 4]], output: (i + i + 2 + i + 4) / 3 },
      ],
    }),
    (i) => ({
      title: "Palindrome Check",
      slug: "palindrome",
      difficulty: "Easy",
      prompt: "Return true if text is palindrome.",
      entryName: "isPalindrome",
      starter: "function isPalindrome(text) {\n  // TODO\n  return false;\n}\n",
      solution: "function isPalindrome(text) {\n  return text === text.split(\"\").reverse().join(\"\");\n}\n",
      testCases: [
        { input: ["level"], output: true },
        { input: [`code${i}`], output: false },
      ],
    }),
  ];

  const oopTemplates = [
    (i) => ({
      title: "Counter Class",
      slug: "counter",
      difficulty: "Medium",
      prompt: "Implement Counter with inc(n=1) and value() methods.",
      entryType: "class",
      entryName: "Counter",
      starter:
        "class Counter {\n  constructor(start = 0) {\n    this.count = start;\n  }\n\n  inc(n = 1) {\n    // TODO\n  }\n\n  value() {\n    // TODO\n    return 0;\n  }\n}\n",
      solution:
        "class Counter {\n  constructor(start = 0) {\n    this.count = start;\n  }\n\n  inc(n = 1) {\n    this.count += n;\n    return null;\n  }\n\n  value() {\n    return this.count;\n  }\n}\n",
      testCases: [
        { input: { init: [i], calls: [["inc", [2]], ["value", []]] }, output: [null, i + 2] },
      ],
      complexity: "O(1)",
    }),
    (i) => ({
      title: "Bank Account",
      slug: "bank-account",
      difficulty: "Medium",
      prompt: "Implement BankAccount with deposit, withdraw, and balance methods.",
      entryType: "class",
      entryName: "BankAccount",
      starter:
        "class BankAccount {\n  constructor(balance = 0) {\n    this.amount = balance;\n  }\n\n  deposit(value) {\n    // TODO\n  }\n\n  withdraw(value) {\n    // TODO\n  }\n\n  balance() {\n    // TODO\n    return 0;\n  }\n}\n",
      solution:
        "class BankAccount {\n  constructor(balance = 0) {\n    this.amount = balance;\n  }\n\n  deposit(value) {\n    this.amount += value;\n    return null;\n  }\n\n  withdraw(value) {\n    if (value <= this.amount) this.amount -= value;\n    return null;\n  }\n\n  balance() {\n    return this.amount;\n  }\n}\n",
      testCases: [
        {
          input: { init: [100], calls: [["deposit", [i]], ["withdraw", [30]], ["balance", []]] },
          output: [null, null, 100 + i - 30],
        },
      ],
      complexity: "O(1)",
    }),
  ];

  const utilityTemplates = [
    (i) => ({
      title: "Round Square Root",
      slug: "sqrt",
      difficulty: "Easy",
      prompt: "Return square root rounded to 2 decimals.",
      entryName: "sqrtTwo",
      starter: "function sqrtTwo(n) {\n  // TODO\n  return 0;\n}\n",
      solution: "function sqrtTwo(n) {\n  return Number(Math.sqrt(n).toFixed(2));\n}\n",
      testCases: [
        { input: [i * i], output: i },
        { input: [2], output: 1.41 },
      ],
    }),
    (i) => ({
      title: "Greatest Common Divisor",
      slug: "gcd",
      difficulty: "Easy",
      prompt: "Return GCD of a and b.",
      entryName: "gcd",
      starter: "function gcd(a, b) {\n  // TODO\n  return 1;\n}\n",
      solution: "function gcd(a, b) {\n  let x = Math.abs(a);\n  let y = Math.abs(b);\n  while (y !== 0) {\n    const next = x % y;\n    x = y;\n    y = next;\n  }\n  return x;\n}\n",
      testCases: [
        { input: [12, 18], output: 6 },
        { input: [i + 2, (i + 2) * 3], output: i + 2 },
      ],
      complexity: "O(log n)",
    }),
  ];

  const problems = [
    ...buildProblems("javascript-basics", basicsTemplates),
    ...buildProblems("javascript-arrays-objects", collectionTemplates),
    ...buildProblems("javascript-conditionals-loops", loopTemplates),
    ...buildProblems("javascript-functions-scope", functionTemplates),
    ...buildProblems("javascript-classes-oop", oopTemplates),
    ...buildProblems("javascript-builtins", utilityTemplates),
  ];

  await Problem.insertMany(problems);
  return res.json({
    message: `Seeded ${language} curriculum`,
    language,
    topics,
    problems: problems.length,
  });
};

const seedC = async (req, res) => {
  const language = SUPPORTED_LANGUAGES.C;
  if (req.user && req.user.id) {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ error: "Teacher access required" });
    }
  }

  const languageFilter = buildLanguageFilter(language);
  const topicsCount = await Topic.countDocuments(languageFilter);
  const problemsCount = await Problem.countDocuments(languageFilter);
  if (topicsCount > 0 || problemsCount > 0) {
    return res.json({ message: `Already seeded for ${language}`, language });
  }

  const cTopics = [
    {
      title: "C Basics",
      slug: "c-basics",
      description: "Primitive types, operators, and simple functions.",
      order: 1,
      lessons: [
        { id: crypto.randomUUID(), title: "Hello C", content: "Use printf and return from main.", order: 1 },
        { id: crypto.randomUUID(), title: "Numbers and Operators", content: "Work with ints and arithmetic.", order: 2 },
      ],
    },
    {
      title: "Control Flow",
      slug: "c-control-flow",
      description: "if/else branches and loop patterns.",
      order: 2,
      lessons: [
        { id: crypto.randomUUID(), title: "Branching", content: "Select execution paths with if/else.", order: 1 },
        { id: crypto.randomUUID(), title: "Looping", content: "for and while loops in C.", order: 2 },
      ],
    },
    {
      title: "Functions",
      slug: "c-functions",
      description: "Reusable logic with arguments and return values.",
      order: 3,
      lessons: [
        { id: crypto.randomUUID(), title: "Function Signatures", content: "Declare and define functions.", order: 1 },
        { id: crypto.randomUUID(), title: "Utility Helpers", content: "Build small reusable helpers.", order: 2 },
      ],
    },
    {
      title: "Strings",
      slug: "c-strings",
      description: "Character arrays, traversal, and string utilities.",
      order: 4,
      lessons: [
        { id: crypto.randomUUID(), title: "C Strings", content: "Null-terminated character arrays.", order: 1 },
        { id: crypto.randomUUID(), title: "Character Processing", content: "Count and scan text safely.", order: 2 },
      ],
    },
    {
      title: "Math Patterns",
      slug: "c-math-patterns",
      description: "Classic number-theory and digit-manipulation tasks.",
      order: 5,
      lessons: [
        { id: crypto.randomUUID(), title: "GCD and LCM", content: "Euclidean algorithm practice.", order: 1 },
        { id: crypto.randomUUID(), title: "Digit Tricks", content: "Reverse and inspect numbers.", order: 2 },
      ],
    },
    {
      title: "Core Algorithms",
      slug: "c-core-algorithms",
      description: "Foundational iterative patterns for interviews.",
      order: 6,
      lessons: [
        { id: crypto.randomUUID(), title: "Fibonacci", content: "Build iterative dynamic updates.", order: 1 },
        { id: crypto.randomUUID(), title: "Prime and Summations", content: "Use loops for efficient checks.", order: 2 },
      ],
    },
  ];

  const topics = await Topic.insertMany(cTopics.map((topic) => ({ ...topic, language })));
  const topicMap = new Map(topics.map((topic) => [topic.slug, topic._id]));

  const buildProblems = (topicSlug, templates) => {
    const problems = [];
    for (let i = 1; i <= 30; i += 1) {
      const template = templates[(i - 1) % templates.length];
      const data = template(i);
      problems.push({
        language,
        topicId: topicMap.get(topicSlug),
        title: `${data.title} ${i}`,
        slug: `${topicSlug}-${data.slug}-${i}`,
        difficulty: data.difficulty,
        prompt: data.prompt,
        entryType: "function",
        entryName: data.entryName,
        starter: data.starter,
        solution: data.solution,
        complexity: data.complexity || "O(n)",
        testCases: data.testCases,
      });
    }
    return problems;
  };

  const basicsTemplates = [
    (i) => ({
      title: "Add Two Numbers",
      slug: "add-two",
      difficulty: "Easy",
      prompt: "Return the sum of two integers.",
      entryName: "add_numbers",
      starter: "int add_numbers(int a, int b) {\n  // TODO\n  return 0;\n}\n",
      solution: "int add_numbers(int a, int b) {\n  return a + b;\n}\n",
      testCases: [
        { input: [i, i + 2], output: i + i + 2 },
        { input: [10, -3], output: 7 },
      ],
    }),
    (i) => ({
      title: "Absolute Value",
      slug: "absolute",
      difficulty: "Easy",
      prompt: "Return the absolute value of n.",
      entryName: "absolute_value",
      starter: "int absolute_value(int n) {\n  // TODO\n  return 0;\n}\n",
      solution: "int absolute_value(int n) {\n  return n < 0 ? -n : n;\n}\n",
      testCases: [
        { input: [i % 2 === 0 ? i : -i], output: i },
        { input: [-15], output: 15 },
      ],
    }),
    (i) => ({
      title: "Is Even",
      slug: "is-even",
      difficulty: "Easy",
      prompt: "Return 1 if n is even, otherwise return 0.",
      entryName: "is_even",
      starter: "int is_even(int n) {\n  // TODO\n  return 0;\n}\n",
      solution: "int is_even(int n) {\n  return n % 2 == 0 ? 1 : 0;\n}\n",
      testCases: [
        { input: [i], output: i % 2 === 0 ? 1 : 0 },
        { input: [17], output: 0 },
      ],
    }),
  ];

  const controlTemplates = [
    (i) => ({
      title: "Sum to N",
      slug: "sum-to-n",
      difficulty: "Easy",
      prompt: "Return the sum from 1 to n.",
      entryName: "sum_to_n",
      starter: "int sum_to_n(int n) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int sum_to_n(int n) {\n  int sum = 0;\n  for (int i = 1; i <= n; i += 1) sum += i;\n  return sum;\n}\n",
      testCases: [
        { input: [10], output: 55 },
        { input: [i], output: Math.floor((i * (i + 1)) / 2) },
      ],
    }),
    (i) => ({
      title: "Factorial",
      slug: "factorial",
      difficulty: "Medium",
      prompt: "Return n factorial.",
      entryName: "factorial",
      starter: "int factorial(int n) {\n  // TODO\n  return 1;\n}\n",
      solution:
        "int factorial(int n) {\n  int result = 1;\n  for (int i = 2; i <= n; i += 1) result *= i;\n  return result;\n}\n",
      testCases: [
        { input: [5], output: 120 },
        { input: [(i % 6) + 1], output: [1, 2, 6, 24, 120, 720][i % 6] },
      ],
    }),
    (i) => ({
      title: "Count Digits",
      slug: "count-digits",
      difficulty: "Easy",
      prompt: "Return the number of digits in n.",
      entryName: "count_digits",
      starter: "int count_digits(int n) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int count_digits(int n) {\n  if (n == 0) return 1;\n  int value = n < 0 ? -n : n;\n  int count = 0;\n  while (value > 0) {\n    count += 1;\n    value /= 10;\n  }\n  return count;\n}\n",
      testCases: [
        { input: [i * 11], output: String(i * 11).length },
        { input: [1000], output: 4 },
      ],
    }),
  ];

  const functionTemplates = [
    (i) => ({
      title: "Max of Two",
      slug: "max-of-two",
      difficulty: "Easy",
      prompt: "Return the larger of a and b.",
      entryName: "max_of_two",
      starter: "int max_of_two(int a, int b) {\n  // TODO\n  return 0;\n}\n",
      solution: "int max_of_two(int a, int b) {\n  return a > b ? a : b;\n}\n",
      testCases: [
        { input: [i, i - 4], output: i },
        { input: [3, 9], output: 9 },
      ],
    }),
    (i) => ({
      title: "Power Integer",
      slug: "power-int",
      difficulty: "Easy",
      prompt: "Return base raised to exponent exp.",
      entryName: "power_int",
      starter: "int power_int(int base, int exp) {\n  // TODO\n  return 1;\n}\n",
      solution:
        "int power_int(int base, int exp) {\n  int result = 1;\n  for (int i = 0; i < exp; i += 1) result *= base;\n  return result;\n}\n",
      testCases: [
        { input: [2, i % 5], output: 2 ** (i % 5) },
        { input: [3, 3], output: 27 },
      ],
    }),
    (i) => ({
      title: "Absolute Difference",
      slug: "abs-diff",
      difficulty: "Easy",
      prompt: "Return |a - b|.",
      entryName: "abs_diff",
      starter: "int abs_diff(int a, int b) {\n  // TODO\n  return 0;\n}\n",
      solution: "int abs_diff(int a, int b) {\n  int diff = a - b;\n  return diff < 0 ? -diff : diff;\n}\n",
      testCases: [
        { input: [i, i + 3], output: 3 },
        { input: [20, 7], output: 13 },
      ],
    }),
  ];

  const stringTemplates = [
    (i) => ({
      title: "String Length",
      slug: "string-length",
      difficulty: "Easy",
      prompt: "Return the length of the string.",
      entryName: "string_length",
      starter:
        "#include <string.h>\n\nint string_length(const char *text) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "#include <string.h>\n\nint string_length(const char *text) {\n  return (int)strlen(text);\n}\n",
      testCases: [
        { input: [`code${i}`], output: `code${i}`.length },
        { input: ["algorithm"], output: 9 },
      ],
    }),
    () => ({
      title: "Count Vowels",
      slug: "count-vowels",
      difficulty: "Easy",
      prompt: "Return how many vowels are in the string.",
      entryName: "count_vowels",
      starter: "int count_vowels(const char *text) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int count_vowels(const char *text) {\n  int count = 0;\n  for (int i = 0; text[i] != '\\0'; i += 1) {\n    char c = text[i];\n    if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u' || c == 'A' || c == 'E' || c == 'I' || c == 'O' || c == 'U') {\n      count += 1;\n    }\n  }\n  return count;\n}\n",
      testCases: [
        { input: ["education"], output: 5 },
        { input: ["codelearn"], output: 4 },
      ],
    }),
    () => ({
      title: "ASCII Sum",
      slug: "ascii-sum",
      difficulty: "Easy",
      prompt: "Return the sum of ASCII values of all characters.",
      entryName: "ascii_sum",
      starter: "int ascii_sum(const char *text) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int ascii_sum(const char *text) {\n  int total = 0;\n  for (int i = 0; text[i] != '\\0'; i += 1) {\n    total += (unsigned char)text[i];\n  }\n  return total;\n}\n",
      testCases: [
        { input: ["ABC"], output: 198 },
        { input: ["Az"], output: 187 },
      ],
    }),
  ];

  const mathTemplates = [
    (i) => ({
      title: "Greatest Common Divisor",
      slug: "gcd",
      difficulty: "Easy",
      prompt: "Return GCD of a and b.",
      entryName: "gcd",
      starter: "int gcd(int a, int b) {\n  // TODO\n  return 1;\n}\n",
      solution:
        "int gcd(int a, int b) {\n  int x = a < 0 ? -a : a;\n  int y = b < 0 ? -b : b;\n  while (y != 0) {\n    int next = x % y;\n    x = y;\n    y = next;\n  }\n  return x;\n}\n",
      testCases: [
        { input: [12, 18], output: 6 },
        { input: [i + 10, (i + 10) * 2], output: i + 10 },
      ],
      complexity: "O(log n)",
    }),
    (i) => ({
      title: "Least Common Multiple",
      slug: "lcm",
      difficulty: "Medium",
      prompt: "Return LCM of a and b.",
      entryName: "lcm",
      starter: "int lcm(int a, int b) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int lcm(int a, int b) {\n  int x = a < 0 ? -a : a;\n  int y = b < 0 ? -b : b;\n  int p = x;\n  int q = y;\n  while (q != 0) {\n    int next = p % q;\n    p = q;\n    q = next;\n  }\n  return (x / p) * y;\n}\n",
      testCases: [
        { input: [4, 6], output: 12 },
        {
          input: [i + 2, i + 3],
          output: (() => {
            const a = i + 2;
            const b = i + 3;
            let x = Math.abs(a);
            let y = Math.abs(b);
            while (y !== 0) {
              const next = x % y;
              x = y;
              y = next;
            }
            return Math.abs((a / x) * b);
          })(),
        },
      ],
    }),
    (i) => ({
      title: "Reverse Number",
      slug: "reverse-number",
      difficulty: "Easy",
      prompt: "Return digits of n in reverse order.",
      entryName: "reverse_number",
      starter: "int reverse_number(int n) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int reverse_number(int n) {\n  int value = n;\n  int result = 0;\n  while (value > 0) {\n    result = result * 10 + (value % 10);\n    value /= 10;\n  }\n  return result;\n}\n",
      testCases: [
        {
          input: [100 + i],
          output: Number(String(100 + i).split("").reverse().join("")),
        },
        { input: [1234], output: 4321 },
      ],
    }),
  ];

  const algorithmTemplates = [
    (i) => ({
      title: "Fibonacci Number",
      slug: "fibonacci",
      difficulty: "Medium",
      prompt: "Return the nth Fibonacci number where fib(0)=0, fib(1)=1.",
      entryName: "fib_n",
      starter: "int fib_n(int n) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int fib_n(int n) {\n  if (n <= 1) return n;\n  int a = 0;\n  int b = 1;\n  for (int i = 2; i <= n; i += 1) {\n    int next = a + b;\n    a = b;\n    b = next;\n  }\n  return b;\n}\n",
      testCases: [
        { input: [i % 10], output: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34][i % 10] },
        { input: [8], output: 21 },
      ],
    }),
    (i) => ({
      title: "Is Prime",
      slug: "is-prime",
      difficulty: "Medium",
      prompt: "Return 1 if n is prime, else return 0.",
      entryName: "is_prime",
      starter: "int is_prime(int n) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int is_prime(int n) {\n  if (n < 2) return 0;\n  for (int i = 2; i * i <= n; i += 1) {\n    if (n % i == 0) return 0;\n  }\n  return 1;\n}\n",
      testCases: [
        {
          input: [i + 2],
          output: (() => {
            const value = i + 2;
            if (value < 2) return 0;
            for (let factor = 2; factor * factor <= value; factor += 1) {
              if (value % factor === 0) return 0;
            }
            return 1;
          })(),
        },
        { input: [29], output: 1 },
      ],
    }),
    (i) => ({
      title: "Sum of Squares",
      slug: "sum-of-squares",
      difficulty: "Easy",
      prompt: "Return 1^2 + 2^2 + ... + n^2.",
      entryName: "sum_of_squares",
      starter: "int sum_of_squares(int n) {\n  // TODO\n  return 0;\n}\n",
      solution:
        "int sum_of_squares(int n) {\n  int total = 0;\n  for (int i = 1; i <= n; i += 1) total += i * i;\n  return total;\n}\n",
      testCases: [
        { input: [i], output: Math.floor((i * (i + 1) * (2 * i + 1)) / 6) },
        { input: [5], output: 55 },
      ],
    }),
  ];

  const problems = [
    ...buildProblems("c-basics", basicsTemplates),
    ...buildProblems("c-control-flow", controlTemplates),
    ...buildProblems("c-functions", functionTemplates),
    ...buildProblems("c-strings", stringTemplates),
    ...buildProblems("c-math-patterns", mathTemplates),
    ...buildProblems("c-core-algorithms", algorithmTemplates),
  ];

  await Problem.insertMany(problems);
  return res.json({
    message: `Seeded ${language} curriculum`,
    language,
    topics,
    problems: problems.length,
  });
};

const seedCurriculum = async (req, res) => {
  const rawLanguage = req.params.language || req.query.language || req.body?.language;
  if (rawLanguage && !isSupportedLanguage(rawLanguage)) {
    return res.status(400).json({ error: "Unsupported language" });
  }
  const requestedLanguage = normalizeLanguage(rawLanguage);

  if (requestedLanguage === SUPPORTED_LANGUAGES.PYTHON) {
    return seedPython(req, res);
  }

  if (requestedLanguage === SUPPORTED_LANGUAGES.JAVASCRIPT) {
    return seedJavaScript(req, res);
  }

  if (requestedLanguage === SUPPORTED_LANGUAGES.C) {
    return seedC(req, res);
  }

  return res.status(400).json({ error: "Unsupported language" });
};

module.exports = {
  listTopics,
  getTopic,
  listProblems,
  getProblem,
  listChallenges,
  getChallenge,
  getChallengeLeaderboard,
  seedCurriculum,
  seedPython,
  seedJavaScript,
  seedC,
  seedChallenges,
  seedTopicContentFromWeb,
  updateTopicContent,
  resetSeededCurriculum,
};
