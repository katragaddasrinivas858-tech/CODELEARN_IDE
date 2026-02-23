import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import EditorTabs from "../components/EditorTabs";
import Modal from "../components/Modal";
import ConsolePanel from "../components/ConsolePanel";
import { apiRequest } from "../lib/api";
import { findNode, flattenFiles } from "../lib/tree";
import { applyVscodeTheme, editorOptions } from "../lib/monaco";
import { downloadPyFile } from "../lib/download";
import useInteractiveRun from "../hooks/useInteractiveRun";

const createNodeId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createFile = (name, content = "") => ({
  id: createNodeId(),
  name,
  type: "file",
  content,
});

const createFolder = (name) => ({
  id: createNodeId(),
  name,
  type: "folder",
  children: [],
});

const createInitialTree = (starter = "") => [createFile("main.py", starter)];

const updateContent = (nodes, nodeId, content) =>
  nodes.map((node) => {
    if (node.id === nodeId) return { ...node, content };
    if (node.type === "folder" && node.children?.length) {
      return { ...node, children: updateContent(node.children, nodeId, content) };
    }
    return node;
  });

const addNode = (nodes, parentId, newNode) => {
  if (!parentId) return [...nodes, newNode];
  return nodes.map((node) => {
    if (node.id === parentId && node.type === "folder") {
      return {
        ...node,
        children: [...(node.children || []), newNode],
      };
    }
    if (node.type === "folder" && node.children?.length) {
      return {
        ...node,
        children: addNode(node.children, parentId, newNode),
      };
    }
    return node;
  });
};

const renameNode = (nodes, nodeId, name) =>
  nodes.map((node) => {
    if (node.id === nodeId) return { ...node, name };
    if (node.type === "folder" && node.children?.length) {
      return { ...node, children: renameNode(node.children, nodeId, name) };
    }
    return node;
  });

const removeNode = (nodes, nodeId) => {
  const next = [];
  for (const node of nodes) {
    if (node.id === nodeId) continue;
    if (node.type === "folder" && node.children?.length) {
      next.push({ ...node, children: removeNode(node.children, nodeId) });
    } else {
      next.push(node);
    }
  }
  return next;
};

const nodeContainsId = (node, targetId) => {
  if (node.id === targetId) return true;
  if (node.type !== "folder" || !node.children?.length) return false;
  return node.children.some((child) => nodeContainsId(child, targetId));
};

const formatLiteral = (value) => {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseParamsFromStarter = (starter, entryName) => {
  if (!starter || !entryName) return [];
  const pattern = new RegExp(`def\\s+${escapeRegExp(entryName)}\\s*\\(([^)]*)\\)`);
  const match = starter.match(pattern);
  if (!match) return [];

  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== "self")
    .map((part) => {
      let name = part.replace(/^\*+/, "").trim();
      const equalsIndex = name.indexOf("=");
      if (equalsIndex >= 0) name = name.slice(0, equalsIndex).trim();
      const colonIndex = name.indexOf(":");
      if (colonIndex >= 0) name = name.slice(0, colonIndex).trim();
      return name;
    })
    .filter(Boolean);
};

const inferParamsFromTests = (testCases) => {
  const sampleInput = testCases?.[0]?.input;
  if (Array.isArray(sampleInput)) {
    return sampleInput.map((_, index) => `arg${index + 1}`);
  }
  if (sampleInput === undefined) return [];
  return ["value"];
};

const buildLeetCodeStarter = (problem) => {
  if (!problem) return "";
  if (problem.entryType === "class") {
    return problem.starter || "class Solution:\n    def __init__(self):\n        pass\n";
  }

  const paramsFromStarter = parseParamsFromStarter(problem.starter || "", problem.entryName);
  const paramNames = paramsFromStarter.length
    ? paramsFromStarter
    : inferParamsFromTests(problem.testCases || []);
  const argSection = paramNames.length ? `, ${paramNames.join(", ")}` : "";

  return [
    "class Solution:",
    `    def ${problem.entryName}(self${argSection}):`,
    "        # Write your solution here",
    "        pass",
    "",
  ].join("\n");
};

const buildExamples = (problem) => {
  if (!problem) return [];

  const paramsFromStarter = parseParamsFromStarter(problem.starter || "", problem.entryName);
  const paramNames = paramsFromStarter.length
    ? paramsFromStarter
    : inferParamsFromTests(problem.testCases || []);

  return (problem.testCases || []).slice(0, 2).map((test, index) => {
    const inputValue = test?.input;
    let inputLabel = "";

    if (problem.entryType === "class" && inputValue && typeof inputValue === "object") {
      const initArgs = formatLiteral(inputValue.init || []);
      const calls = formatLiteral(inputValue.calls || []);
      inputLabel = `init = ${initArgs}, calls = ${calls}`;
    } else if (Array.isArray(inputValue)) {
      const names =
        paramNames.length === inputValue.length
          ? paramNames
          : inputValue.map((_, i) => `arg${i + 1}`);
      inputLabel = names
        .map((name, i) => `${name} = ${formatLiteral(inputValue[i])}`)
        .join(", ");
    } else {
      const name = paramNames[0] || "value";
      inputLabel = `${name} = ${formatLiteral(inputValue)}`;
    }

    return {
      title: `Example ${index + 1}`,
      input: inputLabel,
      output: formatLiteral(test?.output),
    };
  });
};

export default function ProblemSolver() {
  const { topicId, problemId } = useParams();
  const [searchParams] = useSearchParams();
  const challengeId = searchParams.get("challengeId");

  const [problem, setProblem] = useState(null);
  const [tree, setTree] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [editorValue, setEditorValue] = useState("");
  const [result, setResult] = useState(null);
  const [showSolution, setShowSolution] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [modal, setModal] = useState({ open: false, type: "", target: null, parentId: null });
  const [nameInput, setNameInput] = useState("");

  const {
    output,
    runState,
    runMessage,
    isRunning,
    startRun,
    sendInput,
    stopRun,
    clearOutput,
  } = useInteractiveRun();

  const activeFile = useMemo(() => findNode(tree, activeFileId), [tree, activeFileId]);
  const leetStarter = useMemo(() => buildLeetCodeStarter(problem), [problem]);
  const examples = useMemo(() => buildExamples(problem), [problem]);
  const hasReferenceSolution =
    typeof problem?.solution === "string" && problem.solution.trim().length > 0;

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest(`/api/problems/${problemId}`);
        setProblem(data);
      } catch (err) {
        setFileError(err.message || "Unable to load problem");
      }
    };
    load();
  }, [problemId]);

  useEffect(() => {
    if (!problem) return;
    const initialTree = createInitialTree(leetStarter);
    const mainFile = initialTree[0];
    setTree(initialTree);
    setTabs([{ id: mainFile.id, name: mainFile.name }]);
    setActiveFileId(mainFile.id);
    setEditorValue(mainFile.content || "");
    setFileError("");
    clearOutput();
  }, [problem?.id, leetStarter, clearOutput]);

  useEffect(() => {
    if (activeFile?.type === "file") {
      setEditorValue(activeFile.content || "");
      return;
    }
    setEditorValue("");
  }, [activeFile?.id]);

  const runCode = async () => {
    if (!activeFile || activeFile.type !== "file") {
      setFileError("Select a file to run.");
      return;
    }

    setFileError("");
    try {
      const code = (editorValue ?? "").length ? editorValue : activeFile.content || "";
      await startRun({ code });
    } catch (err) {
      setFileError(err.message || "Unable to run code");
    }
  };

  const downloadActiveFile = () => {
    if (!activeFile || activeFile.type !== "file") {
      setFileError("Select a file tab to download.");
      return;
    }

    setFileError("");
    const content = (editorValue ?? "").length ? editorValue : activeFile.content || "";
    downloadPyFile(activeFile.name || "main.py", content, "main.py");
  };

  const submitCode = async () => {
    if (!activeFile || activeFile.type !== "file") {
      setFileError("Select a file tab to submit.");
      return;
    }

    const code = (editorValue ?? "").length ? editorValue : activeFile.content || "";

    setLoading(true);
    setResult(null);
    setFileError("");

    try {
      const res = await apiRequest("/api/judge", {
        method: "POST",
        body: JSON.stringify({ problemId, code, challengeId }),
      });
      setResult(res);
      if (res.challengeMessage) {
        setFileError(res.challengeMessage);
      }
    } catch (err) {
      setFileError(err.message || "Submit failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectFile = (node) => {
    if (node.type !== "file") return;
    setActiveFileId(node.id);
    if (!tabs.find((tab) => tab.id === node.id)) {
      setTabs((prev) => [...prev, { id: node.id, name: node.name }]);
    }
  };

  const handleEditorChange = (value) => {
    if (!activeFileId) return;
    const next = value ?? "";
    setEditorValue(next);
    setTree((prev) => updateContent(prev, activeFileId, next));
  };

  const openModal = (type, target = null, parentId = null) => {
    setModal({ open: true, type, target, parentId });
    setNameInput(target?.name || "");
  };

  const closeModal = () => {
    setModal({ open: false, type: "", target: null, parentId: null });
    setNameInput("");
  };

  const confirmModal = () => {
    const name = nameInput.trim();
    if (!name) return;
    if (/[/\\]/.test(name)) {
      setFileError("File and folder names cannot include / or \\\\.");
      return;
    }

    setFileError("");

    if (modal.type === "new-file" || modal.type === "new-folder") {
      const newNode = modal.type === "new-file" ? createFile(name) : createFolder(name);
      setTree((prev) => addNode(prev, modal.parentId, newNode));
      if (newNode.type === "file") {
        setActiveFileId(newNode.id);
        if (!tabs.find((tab) => tab.id === newNode.id)) {
          setTabs((prev) => [...prev, { id: newNode.id, name: newNode.name }]);
        }
      }
      closeModal();
      return;
    }

    if (modal.type === "rename" && modal.target) {
      setTree((prev) => renameNode(prev, modal.target.id, name));
      setTabs((prev) =>
        prev.map((tab) => (tab.id === modal.target.id ? { ...tab, name } : tab))
      );
      closeModal();
    }
  };

  const deleteNode = (node) => {
    if (!confirm(`Delete ${node.name}?`)) return;

    const deletingActive = nodeContainsId(node, activeFileId);
    const idsToClose = new Set();

    const collectIds = (target) => {
      idsToClose.add(target.id);
      if (target.type === "folder" && target.children?.length) {
        target.children.forEach(collectIds);
      }
    };
    collectIds(node);

    setTree((prev) => {
      const next = removeNode(prev, node.id);
      const nextFiles = flattenFiles(next);
      if (deletingActive) {
        const fallback = nextFiles[0];
        setActiveFileId(fallback?.id || null);
        setEditorValue(fallback?.content || "");
      }
      return next;
    });

    setTabs((prev) => prev.filter((tab) => !idsToClose.has(tab.id)));
  };

  const closeTab = (tabId) => {
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeFileId === tabId) {
      const nextTab = tabs.find((tab) => tab.id !== tabId);
      setActiveFileId(nextTab?.id || null);
    }
  };

  const resetWorkspace = () => {
    if (!problem) return;
    const initialTree = createInitialTree(leetStarter);
    const mainFile = initialTree[0];
    setTree(initialTree);
    setTabs([{ id: mainFile.id, name: mainFile.name }]);
    setActiveFileId(mainFile.id);
    setEditorValue(mainFile.content || "");
    clearOutput();
    setFileError("");
  };

  if (!problem) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-slate-400">
          Loading problem...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080d14] text-white">
      <Navbar />
      <div className="border-y border-slate-800 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto max-w-[1700px] px-4 py-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <div className="uppercase tracking-[0.2em]">Practice Workspace</div>
            <div>{challengeId ? "Challenge Mode Enabled" : "Standard Practice Mode"}</div>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1700px] gap-5 px-4 py-6 lg:grid-cols-[1.02fr_1.38fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-emerald-300">
                {problem.difficulty}
              </div>
              <div className="mt-2 text-4xl font-semibold leading-tight">{problem.title}</div>
            </div>
            <Link to={`/practice/${topicId}`} className="text-sm text-slate-400 hover:text-white">
              Back to list
            </Link>
          </div>
          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4">
            <div className="text-xs uppercase tracking-widest text-slate-500">Problem Statement</div>
            <p className="mt-3 text-lg leading-8 text-slate-200">{problem.prompt}</p>
            <div className="mt-4 text-xs text-slate-500">
              Expected Complexity: {problem.complexity}
            </div>
          </div>
          {problem.entryType === "function" && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">
                Function Signature (LeetCode Style)
              </div>
              <pre className="mt-3 whitespace-pre-wrap rounded-md bg-slate-950 p-3 text-xs text-emerald-200">
{`class Solution:
    def ${problem.entryName}(self, ...):
        ...`}
              </pre>
            </div>
          )}
          {examples.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4">
              <div className="text-xs uppercase tracking-widest text-slate-500">Examples</div>
              <div className="mt-3 space-y-3">
                {examples.map((example) => (
                  <div key={example.title} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                    <div className="text-sm font-semibold text-slate-200">{example.title}</div>
                    <div className="mt-1 text-xs text-slate-400">Input: {example.input}</div>
                    <div className="text-xs text-slate-400">Output: {example.output}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {challengeId && (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              Challenge mode enabled. Submission counts only when all tests pass.
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {hasReferenceSolution && (
              <button
                onClick={() => setShowSolution((prev) => !prev)}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600"
              >
                {showSolution ? "Hide Solution" : "Show Solution"}
              </button>
            )}
            <button
              onClick={resetWorkspace}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600"
            >
              Reset Workspace
            </button>
          </div>

          {showSolution && hasReferenceSolution && (
            <pre className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-emerald-200">
              {problem.solution}
            </pre>
          )}

          {result && (
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/90 p-4 text-sm">
              <div className="text-sm font-semibold text-white">Submission Result</div>
              <div className="mt-2 text-xs text-slate-400">
                Status: <span className="text-emerald-300">{result.status}</span>
              </div>
              <div className="text-xs text-slate-400">
                Runtime: {result.runtimeMs} ms | Passed {result.passed}/{result.total}
              </div>
              {typeof result.runtimePercentile === "number" && result.runtimePercentile > 0 && (
                <div className="text-xs text-slate-400">
                  Runtime percentile: {result.runtimePercentile}th
                </div>
              )}
              {result.complexity?.estimated && (
                <div className="text-xs text-slate-400">
                  Complexity: {result.complexity.estimated} vs expected {result.complexity.expected}
                  {result.complexity.percentile
                    ? ` (${result.complexity.percentile}th percentile)`
                    : ""}
                </div>
              )}
              {result.resolverUsed && (
                <div className="text-xs text-slate-500">Evaluated entry: {result.resolverUsed}</div>
              )}
              {result.details?.length > 0 && (
                <div className="mt-3 space-y-2 text-xs text-slate-500">
                  <div>Showing first failed cases.</div>
                  {result.details.map((detail, index) => (
                    <div
                      key={`detail-${index}`}
                      className="rounded-md border border-slate-800 bg-slate-900/60 p-2"
                    >
                      <div>Input: {JSON.stringify(detail.input)}</div>
                      {detail.expected !== undefined && (
                        <div>Expected: {JSON.stringify(detail.expected)}</div>
                      )}
                      {detail.output !== undefined && (
                        <div>Output: {JSON.stringify(detail.output)}</div>
                      )}
                      {detail.error && <div>Error: {detail.error}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-[740px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <Sidebar
            tree={tree}
            activeFileId={activeFileId}
            onSelectFile={handleSelectFile}
            onCreateFile={(parentId) => openModal("new-file", null, parentId)}
            onCreateFolder={(parentId) => openModal("new-folder", null, parentId)}
            onRenameNode={(node) => openModal("rename", node)}
            onDeleteNode={deleteNode}
            onCreateRootFile={() => openModal("new-file", null, null)}
            onCreateRootFolder={() => openModal("new-folder", null, null)}
          />

          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400">
              <div>
                <div className="font-semibold text-slate-200">Practice Sandbox</div>
                <div>{activeFile?.name || "No file selected"}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500">{runState.toUpperCase()}</div>
                <button
                  onClick={runCode}
                  disabled={!activeFileId || isRunning}
                  className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
                >
                  {isRunning ? "Running..." : "Run"}
                </button>
                <button
                  onClick={downloadActiveFile}
                  disabled={!activeFileId}
                  className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
                >
                  Download .py
                </button>
                <button
                  onClick={submitCode}
                  disabled={loading}
                  className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                >
                  {loading ? "Submitting..." : "Submit"}
                </button>
              </div>
            </div>

            {fileError && (
              <div className="border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs text-rose-300">
                {fileError}
              </div>
            )}

            <EditorTabs
              tabs={tabs}
              activeId={activeFileId}
              onSelect={setActiveFileId}
              onClose={closeTab}
            />

            <div className="flex-1 bg-slate-950">
              <Editor
                height="100%"
                language="python"
                theme="vscode-dark-plus"
                value={editorValue}
                onChange={handleEditorChange}
                beforeMount={applyVscodeTheme}
                options={editorOptions}
              />
            </div>

            <ConsolePanel
              output={output}
              onSendInput={sendInput}
              interactiveRunning={isRunning}
              runState={runState}
              runMessage={runMessage}
              onStop={stopRun}
              onClear={clearOutput}
            />
            <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400">
              <div>{activeFile?.name || "No file"} | Python</div>
              <div>UTF-8 | LF | VSCode-style practice workspace</div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={modal.open}
        title={
          modal.type === "rename" ? "Rename" : modal.type === "new-folder" ? "New Folder" : "New File"
        }
        description="Use clear, descriptive names."
        onClose={closeModal}
        onConfirm={confirmModal}
      >
        <input
          className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
          placeholder="Name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
      </Modal>
    </div>
  );
}
