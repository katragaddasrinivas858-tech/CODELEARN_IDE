import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { apiRequest } from "../lib/api";
import LessonRichRenderer from "../components/LessonRichRenderer";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { getLanguageConfig, normalizeLanguage, withLanguageQuery } from "../lib/languages";

const UPCOMING_COURSES = [
  { title: "System Design Training", startsAt: "Starting from Feb 14, 2026", rating: 4.6 },
  { title: "DevOps Engineering Bootcamp", startsAt: "Starting from Feb 18, 2026", rating: 4.7 },
  { title: "Java Backend Intensive", startsAt: "Starting from Feb 22, 2026", rating: 4.6 },
];

const TRENDING_POSTS = [
  { author: "Vivek Chaudhary", excerpt: "Git & GitHub roadmap for beginner-to-pro developers." },
  { author: "Ravi Kiran Reddy", excerpt: "University projects that sharpen practical coding skills." },
  { author: "Nitin Singh", excerpt: "How AI tools change developer productivity in 2026." },
  { author: "Harini R K", excerpt: "Competitive exam strategy and long-term consistency tips." },
  { author: "Shubham Jain", excerpt: "Breaking down top OCR benchmarks in simple terms." },
];

const initials = (name) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

const renderLessonContent = (content) => {
  const lines = String(content || "")
    .replace(/\r/g, "")
    .split("\n");

  return (
    <div className="space-y-3 text-base leading-8 text-slate-200">
      {lines.map((rawLine, index) => {
        const line = rawLine.trim();

        if (!line) {
          return <div key={`blank-${index}`} className="h-1" />;
        }

        if (/^read full article:/i.test(line)) {
          const url = line.replace(/^read full article:/i, "").trim();
          return (
            <div key={`source-link-${index}`}>
              <span className="text-slate-400">Read full article: </span>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-300 underline decoration-emerald-500/50 underline-offset-4 hover:text-emerald-200"
              >
                {url}
              </a>
            </div>
          );
        }

        if (/^source:/i.test(line)) {
          return (
            <div key={`source-${index}`} className="text-sm font-medium text-emerald-300">
              {line}
            </div>
          );
        }

        if (/^[-*]\s+/.test(line)) {
          return (
            <div key={`bullet-${index}`} className="flex items-start gap-3">
              <span className="mt-3 h-1.5 w-1.5 rounded-full bg-slate-300" />
              <p>{line.replace(/^[-*]\s+/, "")}</p>
            </div>
          );
        }

        if (line.length <= 54 && /^[A-Za-z][A-Za-z0-9\s/&(),:-]+$/.test(line)) {
          return (
            <h3 key={`heading-${index}`} className="pt-3 text-2xl font-semibold text-white">
              {line.replace(/:$/, "")}
            </h3>
          );
        }

        return <p key={`line-${index}`}>{line}</p>;
      })}
    </div>
  );
};

export default function TopicDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [learningLanguage] = useLearningLanguage();
  const activeLanguage = normalizeLanguage(searchParams.get("language") || learningLanguage);
  const [topic, setTopic] = useState(null);
  const [allTopics, setAllTopics] = useState([]);
  const [activeLessonId, setActiveLessonId] = useState("");
  const [error, setError] = useState("");
  const languageConfig = getLanguageConfig(activeLanguage);

  useEffect(() => {
    const load = async () => {
      setError("");
      try {
        const [topicData, topicsData] = await Promise.all([
          apiRequest(withLanguageQuery(`/api/topics/${id}`, activeLanguage)),
          apiRequest(withLanguageQuery("/api/topics", activeLanguage)),
        ]);
        setTopic(topicData);
        setAllTopics(topicsData || []);
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [id, activeLanguage]);

  const orderedLessons = useMemo(() => {
    if (!topic?.lessons?.length) return [];
    return [...topic.lessons].sort((a, b) => a.order - b.order);
  }, [topic]);

  useEffect(() => {
    if (!orderedLessons.length) {
      setActiveLessonId("");
      return;
    }
    if (!activeLessonId || !orderedLessons.find((lesson) => lesson.id === activeLessonId)) {
      setActiveLessonId(orderedLessons[0].id);
    }
  }, [orderedLessons, activeLessonId]);

  const activeLesson =
    orderedLessons.find((lesson) => lesson.id === activeLessonId) || orderedLessons[0] || null;
  const hasRichLessonBlocks = Array.isArray(activeLesson?.blocks) && activeLesson.blocks.length > 0;

  if (!topic) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-400">Loading topic...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b1015] text-white">
      <Navbar />

      <div className="border-y border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto max-w-[1700px] px-4">
          <div className="flex gap-2 overflow-x-auto py-2">
            {allTopics.map((topicNav) => (
              <Link
                key={topicNav._id}
                to={`/topics/${topicNav._id}?language=${encodeURIComponent(activeLanguage)}`}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition ${
                  topicNav._id === topic._id
                    ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {topicNav.title}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1700px] px-4 py-5 lg:py-6">
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)_320px]">
          <aside className="rounded-xl border border-slate-800 bg-slate-950/80">
            <div className="border-b border-slate-800 px-4 py-4">
              <div className="text-xs uppercase tracking-widest text-slate-400">Topic {topic.order}</div>
              <div className="mt-1 text-2xl font-semibold text-white">{topic.title}</div>
              <p className="mt-2 text-sm text-slate-400">{topic.description}</p>
            </div>

            <div className="max-h-[68vh] space-y-1 overflow-auto p-3">
              {orderedLessons.map((lesson) => {
                const active = lesson.id === activeLesson?.id;
                return (
                  <button
                    key={lesson.id}
                    onClick={() => setActiveLessonId(lesson.id)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      active
                        ? "border-emerald-400/40 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                    }`}
                  >
                    <div className="text-xs uppercase tracking-wide text-slate-500">Lesson {lesson.order}</div>
                    <div className="mt-1 text-base font-semibold text-slate-100">{lesson.title}</div>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-slate-800 px-3 py-3">
              <Link
                to={`/practice/${topic._id}?language=${encodeURIComponent(activeLanguage)}`}
                className="inline-flex w-full items-center justify-center rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
              >
                {languageConfig.label} Questions
              </Link>
            </div>
          </aside>

          <main className="rounded-xl border border-slate-800 bg-[#0d1319] p-5 md:p-7">
            {activeLesson ? (
              <>
                <div className="text-sm text-slate-400">
                  {topic.title} / Lesson {activeLesson.order}
                </div>
                <h1 className="mt-2 text-4xl font-bold leading-tight text-white">{activeLesson.title}</h1>
                <div className="mt-6 border-t border-slate-800 pt-6">
                  {hasRichLessonBlocks ? (
                    <LessonRichRenderer blocks={activeLesson.blocks} />
                  ) : (
                    renderLessonContent(activeLesson.content)
                  )}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400">No lessons available for this topic yet.</div>
            )}
            {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}
          </main>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="text-2xl font-semibold text-white">Upcoming Courses</div>
              <div className="mt-4 space-y-3">
                {UPCOMING_COURSES.map((course) => (
                  <div key={course.title} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    <div className="truncate text-lg font-semibold text-emerald-300">{course.title}</div>
                    <div className="mt-1 text-xs text-slate-400">{course.startsAt}</div>
                    <div className="mt-2 inline-flex items-center rounded-md border border-amber-300/50 px-2 py-1 text-xs text-amber-100">
                      Rating {course.rating.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="text-2xl font-semibold text-white">Trending Posts</div>
              <div className="mt-4 space-y-3">
                {TRENDING_POSTS.map((post) => (
                  <div
                    key={post.author}
                    className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-200 ring-1 ring-emerald-500/30">
                      {initials(post.author)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold text-white">{post.author}</div>
                      <div className="line-clamp-2 text-sm text-slate-400">{post.excerpt}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-6 lg:hidden">
          <Link
            to={`/practice/${topic._id}?language=${encodeURIComponent(activeLanguage)}`}
            className="inline-flex items-center rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Solve {languageConfig.label} Questions
          </Link>
        </div>
      </div>

      <div className="pb-2" />
    </div>
  );
}
