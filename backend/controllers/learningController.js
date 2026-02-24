const crypto = require("crypto");
const Topic = require("../models/Topic");
const Problem = require("../models/Problem");
const Challenge = require("../models/Challenge");
const Submission = require("../models/Submission");
const User = require("../models/User");
const { percentileLowerBetter } = require("../utils/performance");
const { pickCuratedSourceForLesson, scrapeLessonContent } = require("../utils/webContent");

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

const normalizeSingleLine = (value, maxLength) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const normalizeMultiline = (value, maxLength) =>
  String(value || "")
    .replace(/\r/g, "")
    .slice(0, maxLength);

const listTopics = async (req, res) => {
  const topics = await Topic.find().sort({ order: 1 });
  return res.json(topics);
};

const getTopic = async (req, res) => {
  const topic = await Topic.findById(req.params.id);
  if (!topic) return res.status(404).json({ error: "Topic not found" });
  return res.json(topic);
};

const listProblems = async (req, res) => {
  const { topicId } = req.query;
  const filter = topicId ? { topicId } : {};
  const problems = await Problem.find(filter)
    .select("-solution -testCases")
    .sort({ createdAt: 1 });
  return res.json(problems);
};

const getProblem = async (req, res) => {
  const problem = await Problem.findById(req.params.id).select("-solution -testCases");
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  return res.json(problem);
};

const listChallenges = async (req, res) => {
  const now = new Date();
  const challenges = await Challenge.find({
    active: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
    ],
  }).sort({ createdAt: -1 });
  return res.json(challenges);
};

const getChallenge = async (req, res) => {
  const now = new Date();
  const challenge = await Challenge.findOne({
    _id: req.params.id,
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

  const problems = await Problem.find().sort({ createdAt: 1 }).select("_id");
  if (problems.length < CHALLENGE_BLUEPRINTS.length) {
    return res.status(400).json({
      error:
        "Not enough problems to build challenges. Seed topics/problems first with POST /api/seed/python.",
    });
  }

  let existingChallenges = await Challenge.find().select("title");
  const forceReset = req.query.force === "true";
  if (forceReset && process.env.ALLOW_SEED_FORCE_RESET !== "true") {
    return res.status(403).json({
      error: "Force reset is disabled. Set ALLOW_SEED_FORCE_RESET=true to enable it.",
    });
  }

  if (forceReset) {
    await Challenge.deleteMany({});
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
  return res.json({ message: "Challenges seeded", count: created.length, challenges: created });
};

const seedTopicContentFromWeb = async (req, res) => {
  const user = await User.findById(req.user?.id);
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
  }

  const { topicId = "", replaceExisting = true } = req.body || {};
  const filter = topicId ? { _id: topicId } : {};

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
    message: "Topic content import finished",
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
  const user = await User.findById(req.user?.id).select("role");
  if (!user || user.role !== "teacher") {
    return res.status(403).json({ error: "Teacher access required" });
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

  const [problemDocs, challengeDocs] = await Promise.all([
    Problem.find().select("_id").lean(),
    Challenge.find().select("_id").lean(),
  ]);
  const problemIds = problemDocs.map((doc) => doc._id);
  const challengeIds = challengeDocs.map((doc) => doc._id);

  const submissionFilters = [];
  if (problemIds.length) submissionFilters.push({ problemId: { $in: problemIds } });
  if (challengeIds.length) submissionFilters.push({ challengeId: { $in: challengeIds } });

  const [topicsResult, problemsResult, challengesResult, submissionsResult] = await Promise.all([
    Topic.deleteMany({}),
    Problem.deleteMany({}),
    Challenge.deleteMany({}),
    submissionFilters.length
      ? Submission.deleteMany({ $or: submissionFilters })
      : Promise.resolve({ deletedCount: 0 }),
  ]);

  return res.json({
    message: "Seeded curriculum removed",
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

  const viewer = await User.findById(req.user.id);
  if (!viewer) return res.status(404).json({ error: "User not found" });

  const teacherId = viewer.role === "teacher" ? viewer._id : viewer.teacherId;
  if (!teacherId) return res.status(400).json({ error: "Teacher not assigned" });

  const submissions = await Submission.find({
    challengeId: challenge._id,
    teacherId,
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
    leaderboard,
    rankingRule:
      "Ranked by solved count, then lower penalty time (solve elapsed + 5m per wrong attempt), then runtime, then complexity score.",
  });
};

const seedPython = async (req, res) => {
  if (req.user && req.user.id) {
    const user = await User.findById(req.user.id);
    if (!user || user.role !== "teacher") {
      return res.status(403).json({ error: "Teacher access required" });
    }
  }

  const topicsCount = await Topic.countDocuments();
  const problemsCount = await Problem.countDocuments();
  if (topicsCount > 0 || problemsCount > 0) {
    return res.json({ message: "Already seeded" });
  }

  const topics = await Topic.insertMany([
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
  ]);

  const topicMap = new Map(topics.map((t) => [t.slug, t._id]));

  const buildProblems = (topicSlug, templates) => {
    const problems = [];
    for (let i = 1; i <= 50; i += 1) {
      const template = templates[(i - 1) % templates.length];
      const data = template(i);
      problems.push({
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
  return res.json({ message: "Seeded", topics, problems: problems.length });
};

module.exports = {
  listTopics,
  getTopic,
  listProblems,
  getProblem,
  listChallenges,
  getChallenge,
  getChallengeLeaderboard,
  seedPython,
  seedChallenges,
  seedTopicContentFromWeb,
  updateTopicContent,
  resetSeededCurriculum,
};
