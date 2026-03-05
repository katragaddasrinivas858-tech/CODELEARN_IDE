import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { apiRequest } from "../lib/api";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { normalizeLanguage, withLanguageQuery } from "../lib/languages";

export default function ChallengeDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [learningLanguage] = useLearningLanguage();
  const activeLanguage = normalizeLanguage(searchParams.get("language") || learningLanguage);

  const [challenge, setChallenge] = useState(null);
  const [problems, setProblems] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [rankingRule, setRankingRule] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiRequest(withLanguageQuery(`/api/challenges/${id}`, activeLanguage));
        setChallenge(data);

        const problemList = await Promise.all(
          (data.problemIds || []).map((problemId) =>
            apiRequest(withLanguageQuery(`/api/problems/${problemId}`, activeLanguage))
          )
        );
        setProblems(problemList);

        const board = await apiRequest(
          withLanguageQuery(`/api/challenges/${id}/leaderboard`, activeLanguage)
        );
        setLeaderboard(board.leaderboard || []);
        setRankingRule(board.rankingRule || "");
      } catch (err) {
        setError(err.message);
      }
    };
    load();
  }, [id, activeLanguage]);

  if (!challenge) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="mx-auto max-w-5xl px-6 py-10 text-sm text-slate-400">Loading challenge...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-xs uppercase tracking-widest text-emerald-300">Challenge</div>
        <div className="mt-2 text-3xl font-semibold">{challenge.title}</div>
        <div className="mt-2 text-sm text-slate-300">{challenge.description}</div>
        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {problems.map((problem, index) => (
            <div key={problem._id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs text-slate-400">Problem {index + 1}</div>
              <div className="mt-1 text-sm font-semibold text-white">{problem.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {problem.difficulty} | {problem.complexity}
              </div>
              <Link
                to={`/practice/${problem.topicId}/${problem._id}?challengeId=${challenge._id}&language=${encodeURIComponent(
                  activeLanguage
                )}`}
                className="mt-3 inline-flex rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
              >
                Solve
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="text-lg font-semibold">Challenge Leaderboard</div>
          {rankingRule && <div className="mt-1 text-xs text-slate-400">{rankingRule}</div>}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-2">Rank</th>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Solved</th>
                  <th className="px-3 py-2">Penalty</th>
                  <th className="px-3 py-2">Runtime</th>
                  <th className="px-3 py-2">Complexity</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.userId} className="border-b border-slate-800/60">
                    <td className="px-3 py-2">{row.rank}</td>
                    <td className="px-3 py-2">
                      <div className="text-white">{row.name}</div>
                      <div className="text-xs text-slate-500">{row.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      {row.solvedCount}/{row.totalProblems}
                    </td>
                    <td className="px-3 py-2">{row.penaltyMinutes} min</td>
                    <td className="px-3 py-2">
                      {row.avgRuntimeMs} ms ({row.runtimePercentile}th %ile)
                    </td>
                    <td className="px-3 py-2">
                      {row.avgComplexityScore} ({row.complexityPercentile}th %ile)
                    </td>
                  </tr>
                ))}
                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-3 py-4 text-center text-slate-500">
                      No accepted submissions yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
