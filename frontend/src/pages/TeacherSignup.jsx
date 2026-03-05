import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import {
  getStoredLearningLanguage,
  normalizeLanguage,
  persistLearningLanguage,
  SUPPORTED_LANGUAGES,
} from "../lib/languages";

export default function TeacherSignup() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [teacherCode, setTeacherCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [learningLanguage, setLearningLanguage] = useState(() =>
    normalizeLanguage(searchParams.get("language") || getStoredLearningLanguage())
  );
  const [message, setMessage] = useState("");

  const submit = async () => {
    setMessage("");
    try {
      const data = await apiRequest("/api/auth/signup-teacher", {
        method: "POST",
        body: JSON.stringify({ email, password, teacherCode, displayName, learningLanguage }),
      });
      persistLearningLanguage(learningLanguage);
      setMessage(data.message || "Account created. You can log in now.");
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="mb-6">
          <div className="text-2xl font-semibold text-white">Teacher Signup</div>
          <div className="text-sm text-slate-400">
            Use the admin code and choose a default language to manage cohorts.
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-emerald-400"
            placeholder="Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
          <input
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-emerald-400"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-emerald-400"
            placeholder="Teacher code"
            value={teacherCode}
            onChange={(e) => setTeacherCode(e.target.value)}
          />
          <select
            value={learningLanguage}
            onChange={(event) => setLearningLanguage(event.target.value)}
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition hover:border-slate-600 focus:border-emerald-400"
          >
            {SUPPORTED_LANGUAGES.map((language) => (
              <option key={language.id} value={language.id}>
                {language.label}
              </option>
            ))}
          </select>
          <input
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-emerald-400"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            type="submit"
            className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
          >
            Create teacher account
          </button>

          <Link to="/login" className="text-sm text-slate-400 transition hover:text-white">
            Already have an account? Login
          </Link>
          {message && <div className="text-sm text-emerald-300">{message}</div>}
        </form>
      </div>
    </div>
  );
}
