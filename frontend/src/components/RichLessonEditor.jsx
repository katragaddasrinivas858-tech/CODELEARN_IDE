import { useMemo, useState } from "react";
import {
  LESSON_BLOCK_TYPES,
  createDefaultLessonBlock,
  normalizeLessonBlocks,
  isSafeImageSource,
} from "../lib/lessonBlocks";
import { SUPPORTED_LANGUAGES, normalizeLanguage } from "../lib/languages";

const moveItem = (items, fromIndex, toIndex) => {
  if (fromIndex === toIndex) return [...items];
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });

const downscaleImageDataUrl = (source, mimeType) =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const maxDimension = 1600;
      const longest = Math.max(image.width || 0, image.height || 0);
      if (!longest || longest <= maxDimension) {
        resolve(source.replace(/\s+/g, ""));
        return;
      }

      const ratio = maxDimension / longest;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(source.replace(/\s+/g, ""));
        return;
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        const outputType = mimeType === "image/png" ? "image/png" : "image/webp";
        resolve(canvas.toDataURL(outputType, 0.88).replace(/\s+/g, ""));
      } catch {
        resolve(source.replace(/\s+/g, ""));
      }
    };
    image.onerror = () => resolve(source.replace(/\s+/g, ""));
    image.src = source;
  });

const imageFileToBlockData = async (file) => {
  const dataUrl = await readFileAsDataUrl(file);
  const optimized = await downscaleImageDataUrl(dataUrl, file.type);
  return {
    ...createDefaultLessonBlock(LESSON_BLOCK_TYPES.IMAGE),
    src: optimized,
    alt: file.name || "Lesson image",
    caption: "",
    width: 80,
  };
};

const blockTypeLabel = (type) => {
  if (type === LESSON_BLOCK_TYPES.HEADING) return "Heading";
  if (type === LESSON_BLOCK_TYPES.PARAGRAPH) return "Paragraph";
  if (type === LESSON_BLOCK_TYPES.IMAGE) return "Image";
  if (type === LESSON_BLOCK_TYPES.CODE) return "Code";
  return "Block";
};

export default function RichLessonEditor({ blocks, onChange, disabled = false }) {
  const [dropActive, setDropActive] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [draggingBlockId, setDraggingBlockId] = useState("");

  const safeBlocks = useMemo(() => normalizeLessonBlocks(blocks), [blocks]);

  const commit = (nextBlocks) => {
    if (typeof onChange !== "function") return;
    onChange(nextBlocks);
  };

  const updateBlock = (blockId, patch) => {
    commit(
      safeBlocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block))
    );
  };

  const insertBlock = (type, afterBlockId = "") => {
    const nextBlock = createDefaultLessonBlock(type);
    if (!afterBlockId) {
      commit([...safeBlocks, nextBlock]);
      return;
    }
    const index = safeBlocks.findIndex((block) => block.id === afterBlockId);
    if (index < 0) {
      commit([...safeBlocks, nextBlock]);
      return;
    }
    const next = [...safeBlocks];
    next.splice(index + 1, 0, nextBlock);
    commit(next);
  };

  const removeBlock = (blockId) => {
    commit(safeBlocks.filter((block) => block.id !== blockId));
  };

  const moveBlock = (blockId, direction) => {
    const index = safeBlocks.findIndex((block) => block.id === blockId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= safeBlocks.length) return;
    commit(moveItem(safeBlocks, index, nextIndex));
  };

  const handleBlockDrop = (event, targetBlockId) => {
    const sourceId = event.dataTransfer.getData("text/x-codelearn-block-id");
    if (!sourceId || !targetBlockId || sourceId === targetBlockId) return;
    event.preventDefault();

    const fromIndex = safeBlocks.findIndex((block) => block.id === sourceId);
    const toIndex = safeBlocks.findIndex((block) => block.id === targetBlockId);
    if (fromIndex < 0 || toIndex < 0) return;
    commit(moveItem(safeBlocks, fromIndex, toIndex));
    setDraggingBlockId("");
  };

  const onRootDragOver = (event) => {
    if (disabled) return;
    const hasFiles = Array.from(event.dataTransfer?.types || []).includes("Files");
    if (!hasFiles) return;
    event.preventDefault();
    setDropActive(true);
  };

  const onRootDrop = async (event) => {
    if (disabled) return;
    const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
      file.type.startsWith("image/")
    );
    if (!files.length) return;
    event.preventDefault();
    setDropActive(false);
    setUploadError("");

    try {
      const imageBlocks = [];
      for (const file of files.slice(0, 6)) {
        // Keep images compact because lesson data is stored in MongoDB.
        const imageBlock = await imageFileToBlockData(file);
        imageBlocks.push(imageBlock);
      }
      commit([...safeBlocks, ...imageBlocks]);
    } catch (err) {
      setUploadError(err.message || "Unable to process dropped image.");
    }
  };

  const replaceImageFromFile = async (blockId, file) => {
    if (!file) return;
    setUploadError("");
    try {
      const imageBlock = await imageFileToBlockData(file);
      updateBlock(blockId, {
        src: imageBlock.src,
        alt: imageBlock.alt,
      });
    } catch (err) {
      setUploadError(err.message || "Unable to process image file.");
    }
  };

  return (
    <div
      onDragOver={onRootDragOver}
      onDragLeave={() => setDropActive(false)}
      onDrop={onRootDrop}
      className={`rounded-xl border border-slate-800 bg-slate-950/70 p-3 transition ${
        dropActive ? "ring-2 ring-emerald-400/50" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => insertBlock(LESSON_BLOCK_TYPES.HEADING)}
          disabled={disabled}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
        >
          + Heading
        </button>
        <button
          type="button"
          onClick={() => insertBlock(LESSON_BLOCK_TYPES.PARAGRAPH)}
          disabled={disabled}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
        >
          + Paragraph
        </button>
        <button
          type="button"
          onClick={() => insertBlock(LESSON_BLOCK_TYPES.IMAGE)}
          disabled={disabled}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
        >
          + Image
        </button>
        <button
          type="button"
          onClick={() => insertBlock(LESSON_BLOCK_TYPES.CODE)}
          disabled={disabled}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-50"
        >
          + Code Block
        </button>
        <div className="ml-auto text-[11px] text-slate-500">
          Drop images anywhere in this editor to insert them.
        </div>
      </div>

      {uploadError && <div className="mt-2 text-xs text-rose-300">{uploadError}</div>}

      <div className="mt-3 space-y-3">
        {safeBlocks.map((block, index) => (
          <div
            key={block.id}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData("text/x-codelearn-block-id", block.id);
              setDraggingBlockId(block.id);
            }}
            onDragEnd={() => setDraggingBlockId("")}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleBlockDrop(event, block.id)}
            className={`rounded-lg border border-slate-800 bg-slate-900/70 p-3 ${
              draggingBlockId === block.id ? "opacity-50" : ""
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300">
                {blockTypeLabel(block.type)}
              </div>
              <div className="text-[10px] text-slate-500">Drag to reorder</div>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveBlock(block.id, -1)}
                  disabled={disabled || index === 0}
                  className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-50"
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => moveBlock(block.id, 1)}
                  disabled={disabled || index === safeBlocks.length - 1}
                  className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-50"
                >
                  Down
                </button>
                <button
                  type="button"
                  onClick={() => insertBlock(LESSON_BLOCK_TYPES.PARAGRAPH, block.id)}
                  disabled={disabled}
                  className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-slate-500 disabled:opacity-50"
                >
                  Add Below
                </button>
                <button
                  type="button"
                  onClick={() => removeBlock(block.id)}
                  disabled={disabled}
                  className="rounded border border-rose-500/50 px-2 py-1 text-[10px] text-rose-200 hover:border-rose-400 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>

            {block.type === LESSON_BLOCK_TYPES.HEADING && (
              <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                <select
                  value={block.level || 2}
                  disabled={disabled}
                  onChange={(event) =>
                    updateBlock(block.id, { level: Number(event.target.value) || 2 })
                  }
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
                >
                  <option value={2}>H2</option>
                  <option value={3}>H3</option>
                  <option value={4}>H4</option>
                </select>
                <input
                  type="text"
                  value={block.text || ""}
                  disabled={disabled}
                  onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                  placeholder="Heading text"
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </div>
            )}

            {block.type === LESSON_BLOCK_TYPES.PARAGRAPH && (
              <textarea
                rows={5}
                value={block.text || ""}
                disabled={disabled}
                onChange={(event) => updateBlock(block.id, { text: event.target.value })}
                placeholder="Write lesson content..."
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
            )}

            {block.type === LESSON_BLOCK_TYPES.IMAGE && (
              <div className="space-y-3">
                <div className="rounded-lg border border-dashed border-slate-700 bg-slate-950/70 p-3">
                  {block.src ? (
                    <img
                      src={block.src}
                      alt={block.alt || "Lesson image"}
                      style={{ width: `${block.width || 80}%` }}
                      className="mx-auto max-h-[320px] rounded-md object-contain"
                    />
                  ) : (
                    <div className="text-center text-xs text-slate-500">
                      Add an image by URL, file picker, or drag-and-drop.
                    </div>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    type="text"
                    value={block.src || ""}
                    disabled={disabled}
                    onChange={(event) => updateBlock(block.id, { src: event.target.value })}
                    placeholder="https://... or data:image/... URL"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
                  />
                  <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500">
                    Upload
                    <input
                      type="file"
                      accept="image/*"
                      disabled={disabled}
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        replaceImageFromFile(block.id, file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {block.src && !isSafeImageSource(block.src) && (
                  <div className="text-xs text-rose-300">
                    Image source must be a data URL or an http/https URL.
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={block.alt || ""}
                    disabled={disabled}
                    onChange={(event) => updateBlock(block.id, { alt: event.target.value })}
                    placeholder="Alt text"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
                  />
                  <input
                    type="text"
                    value={block.caption || ""}
                    disabled={disabled}
                    onChange={(event) => updateBlock(block.id, { caption: event.target.value })}
                    placeholder="Caption"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
                  />
                </div>
                <div>
                  <div className="mb-1 text-[11px] text-slate-400">Image width ({block.width || 80}%)</div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={block.width || 80}
                    disabled={disabled}
                    onChange={(event) => updateBlock(block.id, { width: Number(event.target.value) })}
                    className="w-full"
                  />
                </div>
              </div>
            )}

            {block.type === LESSON_BLOCK_TYPES.CODE && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
                  <select
                    value={normalizeLanguage(block.language || "python")}
                    disabled={disabled}
                    onChange={(event) => updateBlock(block.id, { language: event.target.value })}
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none"
                  >
                    {SUPPORTED_LANGUAGES.map((language) => (
                      <option key={language.id} value={language.id}>
                        {language.label} (runnable)
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={block.title || ""}
                    disabled={disabled}
                    onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                    placeholder="Code block title"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
                  />
                </div>
                <textarea
                  rows={8}
                  value={block.code || ""}
                  disabled={disabled}
                  onChange={(event) => updateBlock(block.id, { code: event.target.value })}
                  placeholder={`Write runnable ${normalizeLanguage(block.language || "python")} code...`}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-100 outline-none focus:border-emerald-400"
                />
                <textarea
                  rows={3}
                  value={block.stdin || ""}
                  disabled={disabled}
                  onChange={(event) => updateBlock(block.id, { stdin: event.target.value })}
                  placeholder="Optional stdin that preloads when students click Run"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 outline-none focus:border-emerald-400"
                />
              </div>
            )}
          </div>
        ))}

        {safeBlocks.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
            Start by adding a heading, paragraph, image, or code block.
          </div>
        )}
      </div>
    </div>
  );
}
