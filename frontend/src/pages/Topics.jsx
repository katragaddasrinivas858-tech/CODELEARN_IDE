import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { isTeacher } from "../lib/auth";
import { apiRequest } from "../lib/api";
import { getLanguageConfig, withLanguageQuery } from "../lib/languages";
import useLearningLanguage from "../hooks/useLearningLanguage";

export default function Topics() {
  const [learningLanguage] = useLearningLanguage();
  const [topics, setTopics] = useState([]);
  const [error, setError] = useState("");
  const languageConfig = getLanguageConfig(learningLanguage);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest(withLanguageQuery("/api/topics", learningLanguage));
        setTopics(data);
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [learningLanguage]);

  const seed = async () => {
    setError("");
    try {
      await apiRequest(`/api/seed/${learningLanguage}`, { method: "POST" });
      const data = await apiRequest(withLanguageQuery("/api/topics", learningLanguage));
      setTopics(data);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold">{languageConfig.label} Learning Paths</div>
            <div className="text-sm text-slate-400">
              Follow structured {languageConfig.label} topics from basics to advanced.
            </div>
          </div>
          {isTeacher() && (
            <button
              onClick={seed}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-emerald-400 hover:text-white"
            >
              Seed {languageConfig.label} Topics
            </button>
          )}
        </div>
        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {topics.map((topic) => (
            <div
              key={topic._id}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <div className="text-xs uppercase tracking-widest text-emerald-300">
                Topic {topic.order}
              </div>
              <div className="mt-2 text-xl font-semibold">{topic.title}</div>
              <div className="mt-2 text-sm text-slate-300">{topic.description}</div>
              <div className="mt-4 text-xs text-slate-500">
                {topic.lessons?.length || 0} lessons
              </div>
              <Link
                to={`/topics/${topic._id}?language=${encodeURIComponent(learningLanguage)}`}
                className="mt-5 inline-flex rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
              >
                Explore Topic
              </Link>
            </div>
          ))}
          {topics.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
              No {languageConfig.label} topics yet. Ask a teacher to seed this curriculum.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
