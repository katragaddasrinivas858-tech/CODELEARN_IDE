import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { apiRequest } from "../lib/api";
import { getLanguageConfig, withLanguageQuery } from "../lib/languages";
import useLearningLanguage from "../hooks/useLearningLanguage";

export default function Practice() {
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

  return (
    <div className="min-h-screen bg-slate-950">
      <Navbar onToggleTutorial={() => {}} />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-2xl font-semibold text-white">
          {languageConfig.label} Questions by Topic
        </div>
        <div className="text-sm text-slate-400">
          Choose a {languageConfig.label} topic and solve curated questions.
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
              <div className="mt-2 text-xl font-semibold text-white">{topic.title}</div>
              <div className="mt-2 text-sm text-slate-300">{topic.description}</div>
              <Link
                to={`/practice/${topic._id}?language=${encodeURIComponent(learningLanguage)}`}
                className="mt-5 inline-flex rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
              >
                Solve Questions
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
