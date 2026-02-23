import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import Navbar from "../components/Navbar";
import ActivityBar from "../components/ActivityBar";
import Sidebar from "../components/Sidebar";
import EditorTabs from "../components/EditorTabs";
import Modal from "../components/Modal";
import ConsolePanel from "../components/ConsolePanel";
import { findNode, flattenFiles } from "../lib/tree";
import { applyVscodeTheme, editorOptions } from "../lib/monaco";
import { downloadPyFile, isLikelyPythonPath, toWorkspacePyDownloadName } from "../lib/download";
import useInteractiveRun from "../hooks/useInteractiveRun";

const STORAGE_KEY = "practice-studio-workspace-v1";

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

const createInitialTree = () => [
  createFile(
    "main.py",
    [
      "# Practice mode workspace",
      "# Write and run code freely. Nothing is submitted.",
      "",
      "print(\"Start practicing\")",
      "",
    ].join("\n")
  ),
];

const createDefaultWorkspace = () => {
  const tree = createInitialTree();
  const mainFile = tree[0];
  return {
    tree,
    tabs: [{ id: mainFile.id, name: mainFile.name }],
    activeFileId: mainFile.id,
  };
};

const updateContent = (nodes, nodeId, content) =>
  nodes.map((node) => {
    if (node.id === nodeId) return { ...node, content };
    if (node.type === "folder" && node.children?.length) {
      return { ...node, children: updateContent(node.children, nodeId, content) };
    }
    return node;
  });

const buildWorkspaceRunPayload = (nodes, activeId) => {
  const files = [];
  let entryFile = "";

  const walk = (items, parentSegments = []) => {
    for (const node of items || []) {
      if (!node || typeof node.name !== "string") continue;
      const nextSegments = [...parentSegments, node.name];
      if (node.type === "folder") {
        walk(node.children || [], nextSegments);
        continue;
      }
      if (node.type !== "file") continue;

      const relativePath = nextSegments.join("/");
      files.push({
        path: relativePath,
        content: typeof node.content === "string" ? node.content : "",
      });

      if (node.id === activeId) {
        entryFile = relativePath;
      }
    }
  };

  walk(nodes);
  return {
    files,
    entryFile: entryFile || files[0]?.path || "",
  };
};

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

const restoreWorkspace = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved?.tree)) return null;

    const files = flattenFiles(saved.tree);
    if (!files.length) return null;

    const fileIds = new Set(files.map((file) => file.id));
    const fallbackActiveId = files[0].id;
    const activeFileId = fileIds.has(saved.activeFileId) ? saved.activeFileId : fallbackActiveId;

    const storedTabs = Array.isArray(saved.tabs) ? saved.tabs : [];
    let tabs = storedTabs
      .filter((tab) => tab && typeof tab.id === "string" && fileIds.has(tab.id))
      .map((tab) => {
        const matchingNode = findNode(saved.tree, tab.id);
        return {
          id: tab.id,
          name: matchingNode?.name || tab.name || "file.py",
        };
      });

    if (!tabs.some((tab) => tab.id === activeFileId)) {
      const activeNode = findNode(saved.tree, activeFileId);
      tabs = [{ id: activeFileId, name: activeNode?.name || "main.py" }, ...tabs];
    }

    return {
      tree: saved.tree,
      tabs,
      activeFileId,
    };
  } catch {
    return null;
  }
};

export default function PracticeStudio() {
  const [tree, setTree] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [editorValue, setEditorValue] = useState("");
  const [fileError, setFileError] = useState("");
  const [workspaceReady, setWorkspaceReady] = useState(false);
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

  useEffect(() => {
    const restored = restoreWorkspace();
    const initial = restored || createDefaultWorkspace();
    setTree(initial.tree);
    setTabs(initial.tabs);
    setActiveFileId(initial.activeFileId);
    setWorkspaceReady(true);
  }, []);

  useEffect(() => {
    if (activeFile?.type === "file") {
      setEditorValue(activeFile.content || "");
      return;
    }
    setEditorValue("");
  }, [activeFile?.id]);

  useEffect(() => {
    if (!workspaceReady) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        tree,
        tabs,
        activeFileId,
      })
    );
  }, [workspaceReady, tree, tabs, activeFileId]);

  const runCode = async () => {
    if (!activeFile || activeFile.type !== "file") {
      setFileError("Select a file tab to run.");
      return;
    }

    setFileError("");
    try {
      const code = (editorValue ?? "").length ? editorValue : activeFile.content || "";
      const workspacePayload = buildWorkspaceRunPayload(tree, activeFileId);
      if (!workspacePayload.files.length) {
        setFileError("Workspace has no files to run.");
        return;
      }

      await startRun({
        code,
        files: workspacePayload.files,
        entryFile: workspacePayload.entryFile,
      });
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

  const downloadWorkspacePyFiles = () => {
    const workspacePayload = buildWorkspaceRunPayload(tree, activeFileId);
    const pythonFiles = workspacePayload.files.filter((file) => isLikelyPythonPath(file.path));
    if (!pythonFiles.length) {
      setFileError("No Python files found in the workspace.");
      return;
    }

    setFileError("");
    for (const file of pythonFiles) {
      downloadPyFile(toWorkspacePyDownloadName(file.path), file.content || "", "main.py");
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
      setFileError("File and folder names cannot include / or \\.");
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
    setTabs((prev) => {
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (activeFileId === tabId) {
        setActiveFileId(nextTabs[0]?.id || null);
      }
      return nextTabs;
    });
  };

  const resetWorkspace = () => {
    const initial = createDefaultWorkspace();
    setTree(initial.tree);
    setTabs(initial.tabs);
    setActiveFileId(initial.activeFileId);
    setEditorValue(initial.tree[0]?.content || "");
    setFileError("");
    stopRun();
    clearOutput();
  };

  return (
    <div className="flex h-screen flex-col bg-[#080d14] text-white">
      <Navbar />

      <div className="border-y border-slate-800 bg-slate-950/70 px-4 py-2 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <div className="uppercase tracking-[0.18em]">Practice Workspace</div>
          <div>Run freely. No submission required.</div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <ActivityBar />

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
              <div className="font-semibold text-slate-200">Scratchpad</div>
              <div>{activeFile?.name || "No file selected"}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-500">{runState.toUpperCase()}</div>
              <button
                onClick={resetWorkspace}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600"
              >
                Reset
              </button>
              <button
                onClick={downloadActiveFile}
                disabled={!activeFileId}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
              >
                Download .py
              </button>
              <button
                onClick={downloadWorkspacePyFiles}
                disabled={!tree.length}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:opacity-50"
              >
                Download All .py
              </button>
              <button
                onClick={runCode}
                disabled={!activeFileId || isRunning}
                className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {isRunning ? "Running..." : "Run"}
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

      <Modal
        open={modal.open}
        title={
          modal.type === "rename"
            ? "Rename"
            : modal.type === "new-folder"
            ? "New Folder"
            : "New File"
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
