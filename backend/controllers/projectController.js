const crypto = require("crypto");
const Project = require("../models/Project");
const User = require("../models/User");
const { SUPPORTED_LANGUAGES, normalizeLanguage } = require("../constants/languages");

const defaultFiles = (language) => [
  {
    id: crypto.randomUUID(),
    name:
      language === SUPPORTED_LANGUAGES.JAVASCRIPT
        ? "main.js"
        : language === SUPPORTED_LANGUAGES.C
          ? "main.c"
          : "main.py",
    type: "file",
    content:
      language === SUPPORTED_LANGUAGES.JAVASCRIPT
        ? 'console.log("Hello from CodeLearn");'
        : language === SUPPORTED_LANGUAGES.C
          ? '#include <stdio.h>\n\nint main(void) {\n  printf("Hello from CodeLearn\\n");\n  return 0;\n}\n'
        : 'print("Hello from CodeLearn")',
  },
];

const createProject = async (req, res) => {
  const { name, files, language } = req.body;
  if (!name) return res.status(400).json({ error: "Project name required" });
  const user = await User.findById(req.user.id).select("learningLanguage");
  const preferredLanguage = normalizeLanguage(language || user?.learningLanguage);

  const project = await Project.create({
    userId: req.user.id,
    projectName: name,
    files: Array.isArray(files) && files.length ? files : defaultFiles(preferredLanguage),
    lastOpened: new Date(),
  });

  return res.json(project);
};

const getProjects = async (req, res) => {
  const projects = await Project.find({ userId: req.user.id }).sort({ updatedAt: -1 });
  return res.json(projects);
};

const getProject = async (req, res) => {
  const project = await Project.findOne({ _id: req.params.id, userId: req.user.id });
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(project);
};

const deleteProject = async (req, res) => {
  const project = await Project.findOneAndDelete({
    _id: req.params.id,
    userId: req.user.id,
  });
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json({ success: true });
};

const updateProjectTree = async (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files)) {
    return res.status(400).json({ error: "Files tree required" });
  }
  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { files } },
    { new: true }
  );
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(project);
};

const markOpened = async (req, res) => {
  const project = await Project.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { lastOpened: new Date() } },
    { new: true }
  );
  if (!project) return res.status(404).json({ error: "Project not found" });
  return res.json(project);
};

module.exports = {
  createProject,
  getProjects,
  getProject,
  deleteProject,
  updateProjectTree,
  markOpened,
};
