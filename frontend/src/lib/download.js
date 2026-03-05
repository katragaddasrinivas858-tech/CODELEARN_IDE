import { getLanguageConfig, normalizeLanguage } from "./languages";

export const ensureLanguageFilename = (value, language = "python", fallback = "main.py") => {
  const lang = getLanguageConfig(language);
  const raw = typeof value === "string" ? value.trim() : "";
  const base = raw || fallback;
  const extension = `.${lang.fileExtension}`;
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
};

export const ensurePyFilename = (value, fallback = "main.py") =>
  ensureLanguageFilename(value, "python", fallback);

export const isLikelySourcePath = (relativePath, language = "python") => {
  const normalizedLanguage = normalizeLanguage(language);
  const expectedExtension = `.${getLanguageConfig(normalizedLanguage).fileExtension}`;
  const normalized = typeof relativePath === "string" ? relativePath.replace(/\\/g, "/").trim() : "";
  if (!normalized) return false;
  if (normalized.toLowerCase().endsWith(expectedExtension)) return true;

  const lastSegment = normalized.split("/").filter(Boolean).pop() || "";
  return !!lastSegment && !lastSegment.includes(".");
};

export const isLikelyPythonPath = (relativePath) => isLikelySourcePath(relativePath, "python");

export const toWorkspaceDownloadName = (relativePath, language = "python") => {
  const normalized = typeof relativePath === "string" ? relativePath.replace(/\\/g, "/") : "";
  const flattened = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("__");
  return ensureLanguageFilename(flattened || "main", language, "main");
};

export const toWorkspacePyDownloadName = (relativePath) =>
  toWorkspaceDownloadName(relativePath, "python");

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

export const downloadCodeFile = (name, content, language = "python", fallback = "main") => {
  const lang = getLanguageConfig(language);
  const mimeType =
    lang.id === "javascript"
      ? "text/javascript;charset=utf-8"
      : lang.id === "c"
        ? "text/x-csrc;charset=utf-8"
        : "text/x-python;charset=utf-8";
  downloadTextContent(ensureLanguageFilename(name, lang.id, fallback), content, mimeType);
};

export const downloadPyFile = (name, content, fallback = "main.py") =>
  downloadCodeFile(name, content, "python", fallback);
