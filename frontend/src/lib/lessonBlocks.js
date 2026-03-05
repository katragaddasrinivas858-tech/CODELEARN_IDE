import { normalizeLanguage } from "./languages";

const LESSON_BLOCK_TYPES = Object.freeze({
  HEADING: "heading",
  PARAGRAPH: "paragraph",
  IMAGE: "image",
  CODE: "code",
});

const MAX_BLOCKS = 120;
const SUPPORTED_CODE_LANGUAGES = new Set(["python", "javascript", "c"]);

export const createBlockId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeSingleLine = (value, maxLength) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const normalizeMultiline = (value, maxLength) =>
  String(value || "")
    .replace(/\r/g, "")
    .slice(0, maxLength);

const clampInt = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

export const isSafeImageSource = (value) => {
  const source = String(value || "").trim();
  if (!source) return false;
  if (/^https?:\/\/\S+$/i.test(source)) {
    return source.length <= 2000;
  }
  if (!/^data:image\//i.test(source)) return false;
  const compact = source.replace(/\s+/g, "");
  return /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(compact);
};

export const createDefaultLessonBlock = (type) => {
  if (type === LESSON_BLOCK_TYPES.HEADING) {
    return { id: createBlockId(), type, level: 2, text: "New heading" };
  }
  if (type === LESSON_BLOCK_TYPES.PARAGRAPH) {
    return { id: createBlockId(), type, text: "" };
  }
  if (type === LESSON_BLOCK_TYPES.IMAGE) {
    return { id: createBlockId(), type, src: "", alt: "", caption: "", width: 80 };
  }
  if (type === LESSON_BLOCK_TYPES.CODE) {
    return {
      id: createBlockId(),
      type,
      language: "python",
      title: "",
      code: "print('Hello, lesson!')",
      stdin: "",
    };
  }
  return { id: createBlockId(), type: LESSON_BLOCK_TYPES.PARAGRAPH, text: "" };
};

export const normalizeLessonBlocks = (rawBlocks) => {
  if (!Array.isArray(rawBlocks)) return [];

  const sanitized = [];
  for (const raw of rawBlocks.slice(0, MAX_BLOCKS)) {
    if (!raw || typeof raw !== "object") continue;
    const type = normalizeSingleLine(raw.type, 24).toLowerCase();
    if (!Object.values(LESSON_BLOCK_TYPES).includes(type)) continue;
    const id = normalizeSingleLine(raw.id, 80) || createBlockId();

    if (type === LESSON_BLOCK_TYPES.HEADING) {
      const text = normalizeSingleLine(raw.text, 220);
      sanitized.push({ id, type, level: clampInt(raw.level, 2, 4, 2), text });
      continue;
    }

    if (type === LESSON_BLOCK_TYPES.PARAGRAPH) {
      const text = normalizeMultiline(raw.text, 20000);
      sanitized.push({ id, type, text });
      continue;
    }

    if (type === LESSON_BLOCK_TYPES.IMAGE) {
      const src = normalizeMultiline(raw.src, 3_000_000).trim();
      const compactSource = /^data:image\//i.test(src) ? src.replace(/\s+/g, "") : src;
      sanitized.push({
        id,
        type,
        src: compactSource,
        alt: normalizeSingleLine(raw.alt, 200),
        caption: normalizeSingleLine(raw.caption, 400),
        width: clampInt(raw.width, 20, 100, 80),
      });
      continue;
    }

    if (type === LESSON_BLOCK_TYPES.CODE) {
      const language = normalizeLanguage(raw.language || "python");
      sanitized.push({
        id,
        type,
        language: SUPPORTED_CODE_LANGUAGES.has(language) ? language : "python",
        title: normalizeSingleLine(raw.title, 160),
        code: normalizeMultiline(raw.code, 50000),
        stdin: normalizeMultiline(raw.stdin, 4000),
      });
    }
  }

  return sanitized;
};

export const blocksFromPlainText = (content) => {
  const text = normalizeMultiline(content, 50000).trim();
  if (!text) return [];
  return [{ id: createBlockId(), type: LESSON_BLOCK_TYPES.PARAGRAPH, text }];
};

export const lessonBlocksToPlainText = (blocks) => {
  const normalized = normalizeLessonBlocks(blocks);
  const chunks = [];
  for (const block of normalized) {
    if (block.type === LESSON_BLOCK_TYPES.HEADING && block.text.trim()) {
      chunks.push(block.text);
      continue;
    }
    if (block.type === LESSON_BLOCK_TYPES.PARAGRAPH && block.text.trim()) {
      chunks.push(block.text);
      continue;
    }
    if (block.type === LESSON_BLOCK_TYPES.IMAGE && block.caption) {
      chunks.push(`Image: ${block.caption}`);
      continue;
    }
    if (block.type === LESSON_BLOCK_TYPES.CODE && block.code) {
      chunks.push("Code example:");
      chunks.push(block.code);
    }
  }
  return normalizeMultiline(chunks.join("\n\n"), 50000);
};

export { LESSON_BLOCK_TYPES };
