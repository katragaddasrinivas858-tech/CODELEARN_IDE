import LessonCodeBlock from "./LessonCodeBlock";
import { LESSON_BLOCK_TYPES, normalizeLessonBlocks, isSafeImageSource } from "../lib/lessonBlocks";

const headingClassByLevel = {
  2: "text-3xl font-bold text-white",
  3: "text-2xl font-semibold text-white",
  4: "text-xl font-semibold text-slate-100",
};

const clampWidth = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 80;
  return Math.min(100, Math.max(20, Math.round(parsed)));
};

export default function LessonRichRenderer({ blocks = [] }) {
  const safeBlocks = normalizeLessonBlocks(blocks);
  if (!safeBlocks.length) return null;

  return (
    <div className="space-y-6">
      {safeBlocks.map((block) => {
        if (block.type === LESSON_BLOCK_TYPES.HEADING) {
          const level = [2, 3, 4].includes(block.level) ? block.level : 2;
          const Tag = level === 2 ? "h2" : level === 3 ? "h3" : "h4";
          return (
            <Tag key={block.id} className={headingClassByLevel[level]}>
              {block.text}
            </Tag>
          );
        }

        if (block.type === LESSON_BLOCK_TYPES.PARAGRAPH) {
          return (
            <p key={block.id} className="whitespace-pre-wrap text-base leading-8 text-slate-200">
              {block.text}
            </p>
          );
        }

        if (block.type === LESSON_BLOCK_TYPES.IMAGE) {
          if (!isSafeImageSource(block.src)) {
            return (
              <div key={block.id} className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-200">
                Image block is unavailable because its source is invalid.
              </div>
            );
          }

          return (
            <figure
              key={block.id}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"
            >
              <img
                src={block.src}
                alt={block.alt || "Lesson image"}
                style={{ width: `${clampWidth(block.width)}%` }}
                className="mx-auto max-h-[500px] rounded-lg object-contain"
              />
              {block.caption && (
                <figcaption className="mt-3 text-center text-sm text-slate-400">
                  {block.caption}
                </figcaption>
              )}
            </figure>
          );
        }

        if (block.type === LESSON_BLOCK_TYPES.CODE) {
          return <LessonCodeBlock key={block.id} block={block} />;
        }

        return null;
      })}
    </div>
  );
}
