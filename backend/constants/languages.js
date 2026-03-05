const SUPPORTED_LANGUAGES = Object.freeze({
  PYTHON: "python",
  JAVASCRIPT: "javascript",
  C: "c",
});

const DEFAULT_LANGUAGE = SUPPORTED_LANGUAGES.PYTHON;

const LANGUAGE_ALIASES = Object.freeze({
  py: SUPPORTED_LANGUAGES.PYTHON,
  python: SUPPORTED_LANGUAGES.PYTHON,
  js: SUPPORTED_LANGUAGES.JAVASCRIPT,
  javascript: SUPPORTED_LANGUAGES.JAVASCRIPT,
  node: SUPPORTED_LANGUAGES.JAVASCRIPT,
  nodejs: SUPPORTED_LANGUAGES.JAVASCRIPT,
  c: SUPPORTED_LANGUAGES.C,
  clang: SUPPORTED_LANGUAGES.C,
  gcc: SUPPORTED_LANGUAGES.C,
  c11: SUPPORTED_LANGUAGES.C,
});

const normalizeLanguage = (value, fallback = DEFAULT_LANGUAGE) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return fallback;
  return LANGUAGE_ALIASES[raw] || fallback;
};

const isSupportedLanguage = (value) =>
  Object.values(SUPPORTED_LANGUAGES).includes(String(value || "").trim().toLowerCase());

const buildLanguageFilter = (language) => {
  const normalized = normalizeLanguage(language);
  if (normalized === SUPPORTED_LANGUAGES.PYTHON) {
    // Include legacy docs created before the language field existed.
    return { $or: [{ language: normalized }, { language: { $exists: false } }] };
  }
  return { language: normalized };
};

module.exports = {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  isSupportedLanguage,
  buildLanguageFilter,
};
