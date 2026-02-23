export const ensurePyFilename = (value, fallback = "main.py") => {
  const raw = typeof value === "string" ? value.trim() : "";
  const base = raw || fallback;
  return /\.py$/i.test(base) ? base : `${base}.py`;
};

export const isLikelyPythonPath = (relativePath) => {
  const normalized = typeof relativePath === "string" ? relativePath.replace(/\\/g, "/").trim() : "";
  if (!normalized) return false;
  if (/\.py$/i.test(normalized)) return true;

  const lastSegment = normalized.split("/").filter(Boolean).pop() || "";
  return !!lastSegment && !lastSegment.includes(".");
};

export const toWorkspacePyDownloadName = (relativePath) => {
  const normalized = typeof relativePath === "string" ? relativePath.replace(/\\/g, "/") : "";
  const flattened = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("__");
  return ensurePyFilename(flattened || "main.py");
};

const downloadTextContent = (filename, content, mimeType) => {
  if (typeof window === "undefined") return;

  const blob = new Blob([typeof content === "string" ? content : ""], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const downloadPyFile = (name, content, fallback = "main.py") => {
  downloadTextContent(ensurePyFilename(name, fallback), content, "text/x-python;charset=utf-8");
};
