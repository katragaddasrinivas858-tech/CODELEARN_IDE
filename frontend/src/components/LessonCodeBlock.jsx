import { useState } from "react";
import Editor from "@monaco-editor/react";
import ConsolePanel from "./ConsolePanel";
import useInteractiveRun from "../hooks/useInteractiveRun";
import { applyVscodeTheme, editorOptions } from "../lib/monaco";

const lessonCodeOptions = {
  ...editorOptions,
  minimap: { enabled: false },
  glyphMargin: false,
  lineNumbers: "on",
  fontSize: 13,
};

export default function LessonCodeBlock({ block }) {
  const initialCode = String(block?.code || "");
  const bootInput = String(block?.stdin || "");
  const [code, setCode] = useState(initialCode);
  const [runError, setRunError] = useState("");

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

  const runSnippet = async () => {
    setRunError("");
    try {
      await startRun({ code, initialInput: bootInput });
    } catch (err) {
      setRunError(err.message || "Unable to run code block");
    }
  };

  const resetSnippet = () => {
    setCode(initialCode);
    clearOutput();
    setRunError("");
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-emerald-200">
            {block?.title || "Interactive Code Block"}
          </div>
          <div className="text-[11px] text-slate-500">Python</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-500">{runState.toUpperCase()}</div>
          <button
            type="button"
            onClick={resetSnippet}
            className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={runSnippet}
            disabled={isRunning}
            className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {isRunning ? "Running..." : "Run"}
          </button>
        </div>
      </div>

      <div className="h-[260px] border-b border-slate-800">
        <Editor
          height="100%"
          language="python"
          theme="vscode-dark-plus"
          value={code}
          onChange={(value) => setCode(value ?? "")}
          beforeMount={applyVscodeTheme}
          options={lessonCodeOptions}
        />
      </div>

      {runError && <div className="px-4 pt-3 text-xs text-rose-300">{runError}</div>}

      <ConsolePanel
        output={output}
        onSendInput={sendInput}
        interactiveRunning={isRunning}
        runState={runState}
        runMessage={runMessage}
        onStop={stopRun}
        onClear={clearOutput}
      />
    </div>
  );
}
