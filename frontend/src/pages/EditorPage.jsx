import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import Navbar from "../components/Navbar";
import Sidebar from "../components/Sidebar";
import EditorTabs from "../components/EditorTabs";
import ConsolePanel from "../components/ConsolePanel";
import TutorialPanel from "../components/TutorialPanel";
import Modal from "../components/Modal";
import ActivityBar from "../components/ActivityBar";
import { apiRequest } from "../lib/api";
import { findNode, flattenFiles } from "../lib/tree";
import { tutorials } from "../data/tutorials";
import { applyVscodeTheme, editorOptions } from "../lib/monaco";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { getLanguageConfig, normalizeLanguage } from "../lib/languages";

const updateContent = (nodes, nodeId, content) =>
  nodes.map((node) => {
    if (node.id === nodeId) return { ...node, content };
    if (node.type === "folder" && node.children?.length) {
      return { ...node, children: updateContent(node.children, nodeId, content) };
    }
    return node;
  });

const inferLanguageFromFilename = (filename, fallback = "python") => {
  const normalized = String(filename || "").trim().toLowerCase();
  if (normalized.endsWith(".js") || normalized.endsWith(".mjs") || normalized.endsWith(".cjs")) {
    return "javascript";
  }
  if (normalized.endsWith(".c") || normalized.endsWith(".h")) return "c";
  if (normalized.endsWith(".py")) return "python";
  return normalizeLanguage(fallback);
};

export default function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [learningLanguage] = useLearningLanguage();
  const defaultLanguageConfig = getLanguageConfig(learningLanguage);

  const [project, setProject] = useState(null);
  const [tree, setTree] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [editorValue, setEditorValue] = useState("");
  const [output, setOutput] = useState("");
  const [stdin, setStdin] = useState("");
  const [showTutorial, setShowTutorial] = useState(true);
  const [selectedTutorial, setSelectedTutorial] = useState(tutorials[0]);
  const [modal, setModal] = useState({ open: false, type: "", target: null, parentId: null });
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [fileError, setFileError] = useState("");

  const saveTimer = useRef(null);
  const editorRef = useRef(null);

  const activeFile = useMemo(() => findNode(tree, activeFileId), [tree, activeFileId]);
  const activeLanguage = useMemo(
    () => inferLanguageFromFilename(activeFile?.name, learningLanguage),
    [activeFile?.name, learningLanguage]
  );
  const activeLanguageConfig = useMemo(() => getLanguageConfig(activeLanguage), [activeLanguage]);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const data = await apiRequest(`/api/projects/${id}`);
        await apiRequest(`/api/projects/${id}/opened`, { method: "PUT" });
        setProject(data);
        setTree(data.files || []);

        const files = flattenFiles(data.files || []);
        if (files.length) {
          setActiveFileId(files[0].id);
          setTabs([{ id: files[0].id, name: files[0].name }]);
          setEditorValue(files[0].content || "");
        }
      } catch {
        navigate("/dashboard");
      }
    };
    loadProject();
  }, [id, navigate]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (activeFile?.type === "file") {
      setEditorValue(activeFile.content || "");
      window.setTimeout(() => editorRef.current?.focus(), 0);
      return;
    }
    setEditorValue("");
  }, [activeFile?.id]);

  const scheduleSave = (value) => {
    if (!activeFileId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await apiRequest(`/api/files/${id}/content`, {
          method: "PUT",
          body: JSON.stringify({ nodeId: activeFileId, content: value }),
        });
      } finally {
        setSaving(false);
      }
    }, 800);
  };

  const handleSelectFile = (node) => {
    if (node.type !== "file") return;
    setActiveFileId(node.id);
    setTabs((prev) =>
      prev.some((tab) => tab.id === node.id) ? prev : [...prev, { id: node.id, name: node.name }]
    );
  };

  const handleEditorChange = (value) => {
    if (!activeFileId) return;
    const next = value ?? "";
    setEditorValue(next);
    setTree((prev) => updateContent(prev, activeFileId, next));
    scheduleSave(next);
  };

  const runCode = async () => {
    if (!activeFileId) return;
    try {
      const runtimeLanguage = inferLanguageFromFilename(activeFile?.name, learningLanguage);
      const res = await apiRequest("/api/run", {
        method: "POST",
        body: JSON.stringify({ code: editorValue, input: stdin, language: runtimeLanguage }),
      });
      setOutput(res.output);
    } catch (err) {
      setOutput(err.message);
    }
  };

  const loadExample = () => {
    if (!activeFileId || !selectedTutorial?.example) return;
    setEditorValue(selectedTutorial.example);
    setTree((prev) => updateContent(prev, activeFileId, selectedTutorial.example));
    scheduleSave(selectedTutorial.example);
  };

  const openModal = (type, target = null, parentId = null) => {
    const defaultName =
      type === "new-file" ? `untitled.${defaultLanguageConfig.fileExtension}` : target?.name || "";
    setModal({ open: true, type, target, parentId });
    setNameInput(defaultName);
  };

  const closeModal = () => {
    setModal({ open: false, type: "", target: null, parentId: null });
    setNameInput("");
  };

  const confirmModal = async () => {
    const name = nameInput.trim();
    if (!name) return;

    setFileError("");

    try {
      if (modal.type === "new-file" || modal.type === "new-folder") {
        const type = modal.type === "new-file" ? "file" : "folder";
        const data = await apiRequest(`/api/files/${id}/create`, {
          method: "POST",
          body: JSON.stringify({ parentId: modal.parentId, type, name }),
        });
        setTree(data.tree);
        if (type === "file" && data.node) {
          setActiveFileId(data.node.id);
          setTabs((prev) =>
            prev.some((tab) => tab.id === data.node.id)
              ? prev
              : [...prev, { id: data.node.id, name: data.node.name }]
          );
          window.setTimeout(() => editorRef.current?.focus(), 0);
        }
      }

      if (modal.type === "rename" && modal.target) {
        const data = await apiRequest(`/api/files/${id}/rename`, {
          method: "PUT",
          body: JSON.stringify({ nodeId: modal.target.id, name }),
        });
        setTree(data.tree);
        setTabs((prev) =>
          prev.map((tab) => (tab.id === modal.target.id ? { ...tab, name } : tab))
        );
      }
    } catch (err) {
      setFileError(err.message);
    } finally {
      closeModal();
    }
  };

  const deleteNode = async (node) => {
    if (!confirm(`Delete ${node.name}?`)) return;
    setFileError("");
    try {
      const data = await apiRequest(`/api/files/${id}/delete`, {
        method: "DELETE",
        body: JSON.stringify({ nodeId: node.id }),
      });
      setTree(data.tree);
      setTabs((prev) => prev.filter((tab) => tab.id !== node.id));
      if (activeFileId === node.id) {
        const next = flattenFiles(data.tree || [])[0];
        setActiveFileId(next?.id || null);
        setEditorValue(next?.content || "");
      }
    } catch (err) {
      setFileError(err.message);
    }
  };

  const closeTab = (tabId) => {
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeFileId === tabId) {
      const nextTab = tabs.find((tab) => tab.id !== tabId);
      setActiveFileId(nextTab?.id || null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      <Navbar onToggleTutorial={() => setShowTutorial((prev) => !prev)} showTutorialToggle />

      <div className="flex flex-1 overflow-hidden">
        {showTutorial && <TutorialPanel tutorial={selectedTutorial} />}

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
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2">
            <div>
              <div className="text-sm font-semibold">{project?.projectName || "Project"}</div>
              <div className="text-xs text-slate-400">{activeFile?.name || "No file selected"}</div>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none transition hover:border-slate-600"
                value={selectedTutorial?.id}
                onChange={(event) =>
                  setSelectedTutorial(
                    tutorials.find((tutorial) => tutorial.id === event.target.value) || tutorials[0]
                  )
                }
              >
                {tutorials.map((tutorial) => (
                  <option key={tutorial.id} value={tutorial.id}>
                    {tutorial.title}
                  </option>
                ))}
              </select>
              <button
                onClick={runCode}
                disabled={!activeFileId}
                className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                Run
              </button>
              <button
                onClick={loadExample}
                disabled={!activeFileId}
                className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
              >
                Load Example
              </button>
              <div className="text-xs text-slate-500">{saving ? "Saving..." : "Saved"}</div>
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
              language={activeLanguageConfig.monaco}
              theme="vscode-dark-plus"
              value={editorValue}
              onChange={handleEditorChange}
              onMount={(editor) => {
                editorRef.current = editor;
                editor.focus();
              }}
              beforeMount={applyVscodeTheme}
              options={editorOptions}
            />
          </div>

          <ConsolePanel output={output} stdin={stdin} onStdinChange={setStdin} />
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400">
            <div>
              {activeFile?.name || "No file"} | {activeLanguageConfig.label}
            </div>
            <div>UTF-8 | LF | VSCode-style</div>
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
          className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-emerald-400"
          placeholder="Name"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
        />
      </Modal>
    </div>
  );
}
