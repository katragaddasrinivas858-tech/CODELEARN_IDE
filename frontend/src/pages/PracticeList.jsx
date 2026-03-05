import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { apiRequest } from "../lib/api";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { getLanguageConfig, normalizeLanguage, withLanguageQuery } from "../lib/languages";

export default function PracticeList() {
  const { topicId } = useParams();
  const [searchParams] = useSearchParams();
  const [learningLanguage] = useLearningLanguage();
  const activeLanguage = normalizeLanguage(searchParams.get("language") || learningLanguage);
  const [problems, setProblems] = useState([]);
  const [topic, setTopic] = useState(null);
  const [error, setError] = useState("");
  const languageConfig = getLanguageConfig(activeLanguage);

  useEffect(() => {
    const load = async () => {
      try {
        const [topicData, problemData] = await Promise.all([
          apiRequest(withLanguageQuery(`/api/topics/${topicId}`, activeLanguage)),
          apiRequest(withLanguageQuery(`/api/problems?topicId=${topicId}`, activeLanguage)),
        ]);
        setTopic(topicData);
        setProblems(problemData);
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [topicId, activeLanguage]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-2xl font-semibold">{topic?.title || `${languageConfig.label} Questions`}</div>
        <div className="text-sm text-slate-400">{problems.length} questions</div>
        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {problems.map((problem, index) => (
            <div
              key={problem._id}
              className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
            >
              <div className="text-xs text-slate-400">Problem {index + 1}</div>
              <div className="mt-1 text-sm font-semibold text-white">{problem.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {problem.difficulty} | {problem.complexity}
              </div>
              <Link
                to={`/practice/${topicId}/${problem._id}?language=${encodeURIComponent(
                  activeLanguage
                )}`}
                className="mt-3 inline-flex rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
              >
                Solve
              </Link>
            </div>
          ))}
          {problems.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
              No problems yet. Ask a teacher to seed the {languageConfig.label} problem set.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
