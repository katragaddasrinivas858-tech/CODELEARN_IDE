import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import { apiRequest } from "../lib/api";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { getLanguageConfig, withLanguageQuery } from "../lib/languages";

export default function Leaderboard() {
  const [learningLanguage] = useLearningLanguage();
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState("");
  const languageConfig = getLanguageConfig(learningLanguage);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest(withLanguageQuery("/api/leaderboard", learningLanguage));
        setLeaderboard(data.leaderboard || []);
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
        <div className="text-2xl font-semibold">{languageConfig.label} Leaderboard</div>
        <div className="text-sm text-slate-400">
          Ranked by solved count, runtime, and complexity efficiency.
        </div>
        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Solved</th>
                <th className="px-4 py-3">Avg Runtime</th>
                <th className="px-4 py-3">Complexity</th>
                <th className="px-4 py-3">Last Submission</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr key={row.studentId} className="border-t border-slate-800">
                  <td className="px-4 py-3">{row.rank}</td>
                  <td className="px-4 py-3">
                    <div className="text-white">{row.name}</div>
                    <div className="text-xs text-slate-500">{row.email}</div>
                  </td>
                  <td className="px-4 py-3">{row.solvedCount}</td>
                  <td className="px-4 py-3">{row.avgRuntime} ms</td>
                  <td className="px-4 py-3">{row.avgComplexityScore}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {row.lastSubmission ? new Date(row.lastSubmission).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-slate-400">
                    No leaderboard data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
