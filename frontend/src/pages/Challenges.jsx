import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { apiRequest } from "../lib/api";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { getLanguageConfig, withLanguageQuery } from "../lib/languages";

export default function Challenges() {
  const [learningLanguage] = useLearningLanguage();
  const [challenges, setChallenges] = useState([]);
  const [error, setError] = useState("");
  const languageConfig = getLanguageConfig(learningLanguage);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest(withLanguageQuery("/api/challenges", learningLanguage));
        setChallenges(data);
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [learningLanguage]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-2xl font-semibold">{languageConfig.label} Challenges</div>
        <div className="text-sm text-slate-400">
          Compete on timed sprints and ranked challenges.
        </div>
        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {challenges.map((challenge) => (
            <div
              key={challenge._id}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <div className="text-xs uppercase tracking-widest text-emerald-300">
                Challenge
              </div>
              <div className="mt-2 text-xl font-semibold">{challenge.title}</div>
              <div className="mt-2 text-sm text-slate-300">{challenge.description}</div>
              <div className="mt-4 text-xs text-slate-500">
                {challenge.problemIds?.length || 0} problems
              </div>
              <Link
                to={`/challenges/${challenge._id}?language=${encodeURIComponent(learningLanguage)}`}
                className="mt-5 inline-flex rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
              >
                View Challenge
              </Link>
            </div>
          ))}
          {challenges.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
              No challenges available yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
