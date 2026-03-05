export const DEFAULT_LANGUAGE = "python";

export const SUPPORTED_LANGUAGES = Object.freeze([
  {
    id: "python",
    label: "Python",
    shortLabel: "Py",
    monaco: "python",
    fileExtension: "py",
    downloadExt: ".py",
  },
  {
    id: "javascript",
    label: "JavaScript",
    shortLabel: "JS",
    monaco: "javascript",
    fileExtension: "js",
    downloadExt: ".js",
  },
  {
    id: "c",
    label: "C",
    shortLabel: "C",
    monaco: "c",
    fileExtension: "c",
    downloadExt: ".c",
  },
]);

const SUPPORTED_LANGUAGE_IDS = new Set(SUPPORTED_LANGUAGES.map((item) => item.id));

const LANGUAGE_ALIASES = Object.freeze({
  py: "python",
  python: "python",
  js: "javascript",
  javascript: "javascript",
  node: "javascript",
  nodejs: "javascript",
  c: "c",
  clang: "c",
  gcc: "c",
  c11: "c",
});

export const normalizeLanguage = (value, fallback = DEFAULT_LANGUAGE) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  const normalized = LANGUAGE_ALIASES[raw] || raw;
  return SUPPORTED_LANGUAGE_IDS.has(normalized) ? normalized : fallback;
};

export const getLanguageConfig = (language) => {
  const normalized = normalizeLanguage(language);
  return SUPPORTED_LANGUAGES.find((item) => item.id === normalized) || SUPPORTED_LANGUAGES[0];
};

export const getStoredLearningLanguage = () => {
  try {
    const explicit = localStorage.getItem("learningLanguage");
    if (explicit) return normalizeLanguage(explicit);

    const rawUser = localStorage.getItem("user");
    if (!rawUser) return DEFAULT_LANGUAGE;
    const parsed = JSON.parse(rawUser);
    return normalizeLanguage(parsed?.learningLanguage, DEFAULT_LANGUAGE);
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

export const persistLearningLanguage = (language) => {
  const normalized = normalizeLanguage(language);
  localStorage.setItem("learningLanguage", normalized);

  try {
    const rawUser = localStorage.getItem("user");
    if (!rawUser) return normalized;
    const parsed = JSON.parse(rawUser);
    localStorage.setItem("user", JSON.stringify({ ...parsed, learningLanguage: normalized }));
  } catch {
    // Keep fallback storage only.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("codelearn:language-changed", { detail: { language: normalized } })
    );
  }

  return normalized;
};

export const withLanguageQuery = (path, language) => {
  const normalized = normalizeLanguage(language);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}language=${encodeURIComponent(normalized)}`;
};
