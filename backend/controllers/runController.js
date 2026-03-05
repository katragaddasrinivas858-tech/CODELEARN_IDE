const { spawn, spawnSync } = require("child_process");
const { randomUUID } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Project = require("../models/Project");
const { findNode } = require("../utils/tree");
const {
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  isSupportedLanguage,
} = require("../constants/languages");

const MAX_OUTPUT_BYTES = 1024 * 1024;
const LEGACY_TIMEOUT_MS = 5000;
const C_COMPILE_TIMEOUT_MS = 15000;
const DEFAULT_SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_SESSION_TIMEOUT_MS = 30 * 1000;
const SESSION_TIMEOUT_MS = (() => {
  const raw = Number(process.env.RUN_SESSION_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SESSION_TIMEOUT_MS;
  return Math.max(raw, MIN_SESSION_TIMEOUT_MS);
})();
const SESSION_TTL_MS = 30000;
const runSessions = new Map();
const PY_DEPS_CACHE_ROOT = path.join(os.tmpdir(), "codelearn-pydeps-cache");
const MODULE_CHECK_TIMEOUT_MS = 15000;
const DEFAULT_PIP_INSTALL_TIMEOUT_MS = 120000;
const PIP_INSTALL_TIMEOUT_MS = (() => {
  const raw = Number(process.env.RUN_PIP_INSTALL_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PIP_INSTALL_TIMEOUT_MS;
  return Math.max(raw, 10000);
})();
const SUPPORTED_PYPI_POLICIES = new Set(["allow-all", "allowlist", "disabled"]);
const PYPI_INSTALL_POLICY = (() => {
  const raw = String(process.env.PYPI_INSTALL_POLICY || "allow-all").trim().toLowerCase();
  return SUPPORTED_PYPI_POLICIES.has(raw) ? raw : "allow-all";
})();
const normalizePackageName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
const PYPI_ALLOWLIST = new Set(
  String(process.env.PYPI_ALLOWLIST || "")
    .split(",")
    .map((pkg) => normalizePackageName(pkg))
    .filter(Boolean)
);
const IMPORT_TO_PIP_PACKAGE = Object.freeze({
  bs4: "beautifulsoup4",
  cv2: "opencv-python",
  dateutil: "python-dateutil",
  pil: "Pillow",
  yaml: "PyYAML",
  sklearn: "scikit-learn",
  crypto: "pycryptodome",
});

const inferLanguageFromPath = (relativePath) => {
  const normalized = String(relativePath || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return SUPPORTED_LANGUAGES.JAVASCRIPT;
  }
  if (normalized.endsWith(".py")) {
    return SUPPORTED_LANGUAGES.PYTHON;
  }
  if (normalized.endsWith(".c")) {
    return SUPPORTED_LANGUAGES.C;
  }
  return null;
};

const resolveRunLanguage = ({ requestedLanguage, entryFile, workspaceFiles = [] }) => {
  if (requestedLanguage) {
    return normalizeLanguage(requestedLanguage);
  }

  const fromEntry = inferLanguageFromPath(entryFile);
  if (fromEntry) return fromEntry;

  for (const file of workspaceFiles) {
    const inferred = inferLanguageFromPath(file?.path);
    if (inferred) return inferred;
  }

  return SUPPORTED_LANGUAGES.PYTHON;
};

const invalidInputError = (message) => {
  const err = new Error(message);
  err.status = 400;
  return err;
};

const mergePythonPath = (entries = []) => {
  const deduped = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    deduped.push(normalized);
  };

  for (const entry of entries) add(entry);
  for (const entry of String(process.env.PYTHONPATH || "").split(path.delimiter)) add(entry);

  return deduped.join(path.delimiter);
};

const buildPythonEnv = (pythonPathEntries = []) => {
  const env = { ...process.env };
  const mergedPath = mergePythonPath(pythonPathEntries);
  if (mergedPath) {
    env.PYTHONPATH = mergedPath;
  }
  return env;
};

const isValidModuleIdentifier = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

const parseImportedModules = (codeText) => {
  if (typeof codeText !== "string" || !codeText.trim()) return [];

  const modules = new Set();
  const lines = codeText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.split("#")[0];
    if (!line.trim()) continue;

    const importMatch = line.match(/^\s*import\s+(.+)$/);
    if (importMatch?.[1]) {
      const tokens = importMatch[1].split(",");
      for (const token of tokens) {
        const withoutAlias = token.split(/\s+as\s+/i)[0].trim();
        const root = withoutAlias.split(".")[0].trim();
        if (isValidModuleIdentifier(root)) modules.add(root);
      }
      continue;
    }

    const fromMatch = line.match(/^\s*from\s+([A-Za-z_][A-Za-z0-9_\.]*)\s+import\s+/);
    if (fromMatch?.[1]) {
      const root = fromMatch[1].split(".")[0].trim();
      if (isValidModuleIdentifier(root)) modules.add(root);
    }
  }

  modules.delete("__future__");
  return [...modules].sort();
};

const collectLocalWorkspaceModuleRoots = (workspaceFiles = []) => {
  const roots = new Set();
  for (const file of workspaceFiles) {
    if (!file || typeof file.path !== "string") continue;
    const segments = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (!segments.length) continue;
    const first = segments[0];
    if (/\.py$/i.test(first)) {
      const moduleName = first.slice(0, -3);
      if (isValidModuleIdentifier(moduleName)) roots.add(moduleName);
      continue;
    }
    if (!first.includes(".") && isValidModuleIdentifier(first)) {
      roots.add(first);
    }
  }
  return roots;
};

const canImportModule = (moduleName, pythonPathEntries = []) => {
  const probe = spawnSync(
    "python",
    [
      "-c",
      "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(sys.argv[1]) else 1)",
      moduleName,
    ],
    {
      env: buildPythonEnv(pythonPathEntries),
      stdio: "ignore",
      timeout: MODULE_CHECK_TIMEOUT_MS,
    }
  );
  return probe.status === 0;
};

const sanitizeCacheDirName = (value) => normalizePackageName(value).replace(/[^a-z0-9._-]/g, "-");

const getPackageCacheDir = (packageName) =>
  path.join(PY_DEPS_CACHE_ROOT, sanitizeCacheDirName(packageName));

const installPipPackage = (packageName, pythonPathEntries = []) => {
  const normalized = normalizePackageName(packageName);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw invalidInputError(`Invalid package name '${packageName}'.`);
  }

  const targetDir = getPackageCacheDir(packageName);
  fs.mkdirSync(targetDir, { recursive: true });

  const install = spawnSync(
    "python",
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--target",
      targetDir,
      packageName,
    ],
    {
      env: buildPythonEnv(pythonPathEntries),
      encoding: "utf8",
      timeout: PIP_INSTALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (install.status === 0) {
    return targetDir;
  }

  if (install.error?.code === "ETIMEDOUT") {
    throw invalidInputError(`Installing '${packageName}' timed out.`);
  }

  const details = (install.stderr || install.stdout || install.error?.message || "")
    .toString()
    .trim();
  throw invalidInputError(
    `Failed to install package '${packageName}'.${details ? ` ${details.slice(0, 300)}` : ""}`
  );
};

const resolvePackageCandidates = (moduleName) => {
  const candidates = [];
  const mapped = IMPORT_TO_PIP_PACKAGE[moduleName.toLowerCase()];
  if (mapped) candidates.push(mapped);
  candidates.push(moduleName);

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = normalizePackageName(candidate);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const ensureRuntimeDependencies = ({ source, workspaceFiles }) => {
  const requestedModules = new Set(parseImportedModules(source));
  for (const file of workspaceFiles || []) {
    for (const mod of parseImportedModules(file?.content)) {
      requestedModules.add(mod);
    }
  }
  if (!requestedModules.size) return [];

  const localRoots = collectLocalWorkspaceModuleRoots(workspaceFiles);
  const pythonPathEntries = [];

  for (const moduleName of [...requestedModules].sort()) {
    if (localRoots.has(moduleName)) continue;
    if (canImportModule(moduleName, pythonPathEntries)) continue;

    if (PYPI_INSTALL_POLICY === "disabled") {
      throw invalidInputError(
        `Module '${moduleName}' is not installed. Web package installs are disabled on this server.`
      );
    }

    const candidates = resolvePackageCandidates(moduleName);
    let installed = false;
    let lastError = null;

    for (const packageName of candidates) {
      const normalizedPackage = normalizePackageName(packageName);
      if (PYPI_INSTALL_POLICY === "allowlist" && !PYPI_ALLOWLIST.has(normalizedPackage)) {
        lastError = invalidInputError(
          `Package '${packageName}' is blocked by server allowlist policy.`
        );
        continue;
      }

      const cachedDir = getPackageCacheDir(packageName);
      if (!pythonPathEntries.includes(cachedDir)) {
        pythonPathEntries.push(cachedDir);
      }
      if (canImportModule(moduleName, pythonPathEntries)) {
        installed = true;
        break;
      }

      try {
        const targetDir = installPipPackage(packageName, pythonPathEntries);
        if (!pythonPathEntries.includes(targetDir)) {
          pythonPathEntries.push(targetDir);
        }
        if (canImportModule(moduleName, pythonPathEntries)) {
          installed = true;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!installed) {
      if (lastError) throw lastError;
      throw invalidInputError(`Unable to resolve module '${moduleName}'.`);
    }
  }

  return pythonPathEntries;
};

const isValidPathSegment = (segment) =>
  typeof segment === "string" &&
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !/[\\/]/.test(segment) &&
  !segment.includes("\0");

const normalizeRelativePath = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return null;
  if (!segments.every(isValidPathSegment)) return null;
  return segments.join("/");
};

const normalizeWorkspaceFiles = (files) => {
  if (!Array.isArray(files) || !files.length) return [];

  const seen = new Set();
  return files.map((file) => {
    if (!file || typeof file !== "object") {
      throw invalidInputError("Workspace files must be objects.");
    }

    const relativePath = normalizeRelativePath(file.path);
    if (!relativePath) {
      throw invalidInputError("Workspace file paths are invalid.");
    }

    if (seen.has(relativePath)) {
      throw invalidInputError(`Duplicate workspace file path: ${relativePath}`);
    }
    seen.add(relativePath);

    return {
      path: relativePath,
      content: typeof file.content === "string" ? file.content : "",
    };
  });
};

const flattenProjectWorkspace = (
  nodes,
  parentSegments = [],
  files = [],
  idToPath = new Map(),
  seenPaths = new Set()
) => {
  for (const node of nodes || []) {
    const rawName = typeof node?.name === "string" ? node.name.trim() : "";
    if (!isValidPathSegment(rawName)) {
      throw invalidInputError("Project contains invalid file or folder names.");
    }

    const nextSegments = [...parentSegments, rawName];

    if (node.type === "folder") {
      flattenProjectWorkspace(node.children || [], nextSegments, files, idToPath, seenPaths);
      continue;
    }

    if (node.type !== "file") continue;

    const relativePath = nextSegments.join("/");
    if (seenPaths.has(relativePath)) {
      throw invalidInputError(`Duplicate project file path: ${relativePath}`);
    }
    seenPaths.add(relativePath);

    files.push({
      path: relativePath,
      content: typeof node.content === "string" ? node.content : "",
    });
    if (typeof node.id === "string") {
      idToPath.set(node.id, relativePath);
    }
  }

  return { files, idToPath };
};

const resolveExecutionContext = async ({
  code,
  projectId,
  fileId,
  files,
  entryFile,
  userId,
  language,
}) => {
  if (language && !isSupportedLanguage(language)) {
    throw invalidInputError("Unsupported run language.");
  }

  let source = code;
  let workspaceFiles = normalizeWorkspaceFiles(files);
  let entryRelativePath = null;

  if (workspaceFiles.length) {
    entryRelativePath = normalizeRelativePath(entryFile) || workspaceFiles[0].path;
    const workspacePaths = new Set(workspaceFiles.map((file) => file.path));
    if (!workspacePaths.has(entryRelativePath)) {
      throw invalidInputError("Entry file is missing from workspace files.");
    }

    if (typeof source !== "string") {
      source =
        workspaceFiles.find((file) => file.path === entryRelativePath)?.content || "";
    }
  } else if (!source && projectId && fileId) {
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      const err = new Error("Project not found");
      err.status = 404;
      throw err;
    }

    const node = findNode(project.files, fileId);
    if (!node || node.type !== "file") {
      const err = new Error("File not found");
      err.status = 404;
      throw err;
    }

    source = node.content || "";
    const flattened = flattenProjectWorkspace(project.files || []);
    workspaceFiles = flattened.files;
    entryRelativePath = flattened.idToPath.get(fileId) || null;
  }

  if (typeof source !== "string") {
    throw invalidInputError("Code required");
  }

  const resolvedLanguage = resolveRunLanguage({
    requestedLanguage: language,
    entryFile: entryRelativePath,
    workspaceFiles,
  });

  return {
    source,
    workspaceFiles,
    entryRelativePath,
    language: resolvedLanguage,
  };
};

const writeTempFile = (source, language) => {
  const extension =
    language === SUPPORTED_LANGUAGES.JAVASCRIPT
      ? "js"
      : language === SUPPORTED_LANGUAGES.C
        ? "c"
        : "py";
  const tempFile = path.join(
    os.tmpdir(),
    `codelearn-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`
  );
  fs.writeFileSync(tempFile, source, "utf8");
  return tempFile;
};

const createTempWorkspace = (workspaceFiles, entryRelativePath) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codelearn-"));

  try {
    for (const file of workspaceFiles) {
      const absolutePath = path.resolve(tempDir, ...file.path.split("/"));
      if (!absolutePath.startsWith(`${path.resolve(tempDir)}${path.sep}`)) {
        throw invalidInputError("Invalid workspace file path.");
      }
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, file.content, "utf8");
    }

    const selectedEntry = entryRelativePath || workspaceFiles[0]?.path;
    const entryPath = normalizeRelativePath(selectedEntry);
    if (!entryPath) {
      throw invalidInputError("Entry file is invalid.");
    }

    const tempFile = path.resolve(tempDir, ...entryPath.split("/"));
    if (!tempFile.startsWith(`${path.resolve(tempDir)}${path.sep}`) || !fs.existsSync(tempFile)) {
      throw invalidInputError("Entry file not found in workspace.");
    }

    return { tempFile, tempDir };
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }
};

const createExecutionTarget = ({ source, workspaceFiles, entryRelativePath, language }) => {
  if (workspaceFiles.length) {
    const target = createTempWorkspace(workspaceFiles, entryRelativePath);
    return { ...target, compiledBinary: null };
  }
  return { tempFile: writeTempFile(source, language), tempDir: null, compiledBinary: null };
};

const summarizeCompileFailure = (result) =>
  String(result?.stderr || result?.stdout || result?.error?.message || "")
    .trim()
    .slice(0, 400);

const collectCSourceFiles = ({ workspaceFiles = [], tempFile, baseDir }) => {
  const sourceFiles = [];
  const seen = new Set();

  const pushSource = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    sourceFiles.push(normalized);
  };

  for (const file of workspaceFiles) {
    if (!file || typeof file.path !== "string") continue;
    if (!file.path.toLowerCase().endsWith(".c")) continue;
    const absolutePath = path.resolve(baseDir, ...file.path.split("/"));
    if (fs.existsSync(absolutePath)) pushSource(absolutePath);
  }

  if (!sourceFiles.length && String(tempFile || "").toLowerCase().endsWith(".c")) {
    pushSource(tempFile);
  }

  return sourceFiles;
};

const buildRuntimeProcess = ({ context, tempFile, tempDir }) => {
  const runtimeCwd = tempDir || path.dirname(tempFile);

  if (context.language === SUPPORTED_LANGUAGES.PYTHON) {
    const dependencyPythonPaths = ensureRuntimeDependencies(context);
    return {
      command: "python",
      args: ["-u", tempFile],
      cwd: runtimeCwd,
      env: buildPythonEnv(dependencyPythonPaths),
      compiledBinary: null,
    };
  }

  if (context.language === SUPPORTED_LANGUAGES.JAVASCRIPT) {
    return {
      command: "node",
      args: [tempFile],
      cwd: runtimeCwd,
      env: { ...process.env },
      compiledBinary: null,
    };
  }

  if (context.language === SUPPORTED_LANGUAGES.C) {
    const sourceFiles = collectCSourceFiles({
      workspaceFiles: context.workspaceFiles,
      tempFile,
      baseDir: runtimeCwd,
    });
    if (!sourceFiles.length) {
      throw invalidInputError("No C source file found to compile.");
    }

    const outputBinary = path.join(
      runtimeCwd,
      `codelearn-bin-${Date.now()}-${Math.random().toString(16).slice(2)}${
        process.platform === "win32" ? ".exe" : ""
      }`
    );

    const compile = spawnSync(
      "gcc",
      [...sourceFiles, "-O2", "-std=c11", "-lm", "-o", outputBinary],
      {
        cwd: runtimeCwd,
        encoding: "utf8",
        timeout: C_COMPILE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      }
    );

    if (compile.error?.code === "ETIMEDOUT") {
      throw invalidInputError("C compilation timed out.");
    }
    if (compile.error) {
      throw invalidInputError(`C compiler error: ${compile.error.message}`);
    }
    if (compile.status !== 0) {
      const details = summarizeCompileFailure(compile);
      throw invalidInputError(
        `C compilation failed.${details ? ` ${details}` : ""}`
      );
    }

    return {
      command: outputBinary,
      args: [],
      cwd: runtimeCwd,
      env: { ...process.env },
      compiledBinary: outputBinary,
    };
  }

  throw invalidInputError("Unsupported run language.");
};

const cleanupTempArtifacts = ({ tempFile, tempDir, compiledBinary }) => {
  if (tempDir) {
    fs.rm(tempDir, { recursive: true, force: true }, () => {});
    return;
  }
  if (tempFile) {
    fs.unlink(tempFile, () => {});
  }
  if (compiledBinary && compiledBinary !== tempFile) {
    fs.unlink(compiledBinary, () => {});
  }
};

const sendSse = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const emitSessionEvent = (session, event, data) => {
  session.events.push({ event, data });
  for (const client of session.clients) {
    try {
      sendSse(client, event, data);
    } catch {
      session.clients.delete(client);
    }
  }
};

const cleanupSession = (session) => {
  for (const client of session.clients) {
    if (!client.writableEnded) {
      client.end();
    }
  }
  session.clients.clear();
  runSessions.delete(session.id);
};

const finishSession = (session, payload) => {
  if (session.finished) return;
  session.finished = true;
  clearTimeout(session.killTimer);
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  cleanupTempArtifacts({
    tempFile: session.tempFile,
    tempDir: session.tempDir,
    compiledBinary: session.compiledBinary,
  });

  emitSessionEvent(session, "end", payload);

  for (const client of session.clients) {
    if (!client.writableEnded) {
      client.end();
    }
  }
  session.clients.clear();

  session.cleanupTimer = setTimeout(() => {
    cleanupSession(session);
  }, SESSION_TTL_MS);
};

const runPython = async (req, res) => {
  let tempFile = null;
  let tempDir = null;
  let compiledBinary = null;

  try {
    const { code, projectId, fileId, input, files, entryFile, language } = req.body;
    const context = await resolveExecutionContext({
      code,
      projectId,
      fileId,
      files,
      entryFile,
      userId: req.user.id,
      language,
    });
    const target = createExecutionTarget(context);
    tempFile = target.tempFile;
    tempDir = target.tempDir;
    const runtime = buildRuntimeProcess({ context, tempFile, tempDir });
    compiledBinary = runtime.compiledBinary;

    const child = spawn(runtime.command, runtime.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: runtime.cwd,
      env: runtime.env,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let completed = false;

    const killTimer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, LEGACY_TIMEOUT_MS);

    const finish = (output) => {
      if (completed) return null;
      completed = true;
      clearTimeout(killTimer);
      cleanupTempArtifacts({ tempFile, tempDir, compiledBinary });
      return res.json({ output });
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) {
        killed = true;
        child.kill("SIGKILL");
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT_BYTES) {
        killed = true;
        child.kill("SIGKILL");
      }
    });

    child.on("error", (err) => {
      return finish(err.message);
    });

    child.on("close", () => {
      if (killed) {
        return finish("Execution timed out or output was too large.");
      }
      return finish(stderr || stdout);
    });

    if (typeof input === "string" && input.length) {
      child.stdin.write(input);
    }
    child.stdin.end();
  } catch (err) {
    cleanupTempArtifacts({ tempFile, tempDir, compiledBinary });
    return res.status(err.status || 500).json({ error: err.message || "Run failed" });
  }
};

const startRunSession = async (req, res) => {
  let tempFile = null;
  let tempDir = null;
  let compiledBinary = null;

  try {
    const { code, projectId, fileId, input, files, entryFile, language } = req.body;
    const context = await resolveExecutionContext({
      code,
      projectId,
      fileId,
      files,
      entryFile,
      userId: req.user.id,
      language,
    });
    const target = createExecutionTarget(context);
    tempFile = target.tempFile;
    tempDir = target.tempDir;
    const runtime = buildRuntimeProcess({ context, tempFile, tempDir });
    compiledBinary = runtime.compiledBinary;

    const child = spawn(runtime.command, runtime.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: runtime.cwd,
      env: runtime.env,
    });
    const sessionId = randomUUID();

    const session = {
      id: sessionId,
      userId: req.user.id,
      child,
      tempFile,
      tempDir,
      compiledBinary,
      clients: new Set(),
      events: [],
      outputBytes: 0,
      finished: false,
      terminatedReason: "",
      killTimer: null,
      cleanupTimer: null,
    };

    runSessions.set(sessionId, session);

    emitSessionEvent(session, "session", {
      sessionId,
      status: "running",
      timeoutMs: SESSION_TIMEOUT_MS,
      language: context.language,
    });

    const handleOutput = (stream, chunk) => {
      if (session.finished) return;
      session.outputBytes += Buffer.byteLength(chunk);
      if (session.outputBytes > MAX_OUTPUT_BYTES) {
        session.terminatedReason = "Execution output was too large.";
        child.kill("SIGKILL");
        return;
      }
      emitSessionEvent(session, "output", { stream, chunk: chunk.toString() });
    };

    child.stdout.on("data", (chunk) => handleOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => handleOutput("stderr", chunk));

    child.on("error", (err) => {
      finishSession(session, { status: "error", message: err.message });
    });

    child.on("close", (exitCode, signal) => {
      if (session.finished) return;
      if (session.terminatedReason) {
        finishSession(session, { status: "killed", message: session.terminatedReason });
        return;
      }
      if (exitCode === 0) {
        finishSession(session, { status: "ok", exitCode: 0 });
        return;
      }
      finishSession(session, {
        status: "runtime_error",
        exitCode,
        signal,
        message: `Process exited with code ${exitCode}${signal ? ` (signal ${signal})` : ""}.`,
      });
    });

    session.killTimer = setTimeout(() => {
      if (session.finished) return;
      session.terminatedReason = `Execution timed out after ${Math.round(
        SESSION_TIMEOUT_MS / 1000
      )} seconds.`;
      child.kill("SIGKILL");
    }, SESSION_TIMEOUT_MS);

    if (typeof input === "string" && input.length) {
      child.stdin.write(input);
    }

    return res.status(201).json({ sessionId, timeoutMs: SESSION_TIMEOUT_MS });
  } catch (err) {
    cleanupTempArtifacts({ tempFile, tempDir, compiledBinary });
    return res.status(err.status || 500).json({ error: err.message || "Run failed" });
  }
};

const streamRunSession = (req, res) => {
  const session = runSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({
      error: "Run session not found (expired or unavailable on this server instance).",
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write(": connected\n\n");

  for (const evt of session.events) {
    sendSse(res, evt.event, evt.data);
  }

  if (session.finished) {
    return res.end();
  }

  session.clients.add(res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": ping\n\n");
    }
  }, 3000);

  req.on("close", () => {
    clearInterval(heartbeat);
    session.clients.delete(res);
  });
};

const sendRunInput = (req, res) => {
  const session = runSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({
      error: "Run session not found (expired or unavailable on this server instance).",
    });
  }
  if (session.finished) {
    return res.status(409).json({ error: "Run session already finished" });
  }

  const { input } = req.body;
  if (typeof input !== "string") {
    return res.status(400).json({ error: "Input must be a string" });
  }

  try {
    if (input.length) {
      session.child.stdin.write(input);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Unable to write to stdin" });
  }
};

const stopRunSession = (req, res) => {
  const session = runSessions.get(req.params.sessionId);
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({
      error: "Run session not found (expired or unavailable on this server instance).",
    });
  }
  if (!session.finished) {
    session.terminatedReason = "Execution stopped by user.";
    session.child.kill("SIGKILL");
  }
  return res.json({ stopped: true });
};

module.exports = {
  runPython,
  startRunSession,
  streamRunSession,
  sendRunInput,
  stopRunSession,
};
