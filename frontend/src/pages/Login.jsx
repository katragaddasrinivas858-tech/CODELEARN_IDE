import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import {
  getStoredLearningLanguage,
  persistLearningLanguage,
  SUPPORTED_LANGUAGES,
} from "../lib/languages";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [learningLanguage, setLearningLanguage] = useState(getStoredLearningLanguage());
  const [message, setMessage] = useState("");

  const submit = async () => {
    setMessage("");
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, learningLanguage }),
      });

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      persistLearningLanguage(data.user?.learningLanguage || learningLanguage);
      navigate("/topics", { replace: true });
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 shadow-2xl">
        <div className="mb-6">
          <div className="text-2xl font-semibold text-white">Welcome to CodeLearn</div>
          <div className="text-sm text-slate-400">
            Login to your coding studio and continue in your chosen language.
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
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <input
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 outline-none transition focus:border-emerald-400"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <div>
            <label className="mb-1 block text-xs uppercase tracking-widest text-slate-500">
              Learning Language
            </label>
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
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 hover:shadow-[0_0_0_2px_rgba(16,185,129,0.35)]"
          >
            Login
          </button>

          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
            <div className="font-semibold text-slate-200">New here?</div>
            <div className="mt-1">
              Choose your target language and create an account to get language-specific topics and questions.
            </div>
            <div className="mt-2 flex flex-col gap-1 text-sm">
              <Link
                to={`/signup/student?language=${encodeURIComponent(learningLanguage)}`}
                className="transition hover:text-white"
              >
                Create student account
              </Link>
              <Link
                to={`/signup/teacher?language=${encodeURIComponent(learningLanguage)}`}
                className="transition hover:text-white"
              >
                Create teacher account
              </Link>
            </div>
          </div>

          {message && <div className="text-sm text-rose-400">{message}</div>}
        </form>
      </div>
    </div>
  );
}
