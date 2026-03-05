import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest } from "../lib/api";
import Navbar from "../components/Navbar";
import useLearningLanguage from "../hooks/useLearningLanguage";
import { getLanguageConfig } from "../lib/languages";

export default function Dashboard() {
  const navigate = useNavigate();
  const [learningLanguage] = useLearningLanguage();
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const languageConfig = getLanguageConfig(learningLanguage);

  const loadProjects = async () => {
    try {
      const data = await apiRequest("/api/projects");
      setProjects(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const createProject = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const project = await apiRequest("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, language: learningLanguage }),
      });
      setName("");
      navigate(`/projects/${project._id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteProject = async (id) => {
    setError("");
    try {
      await apiRequest(`/api/projects/${id}`, { method: "DELETE" });
      loadProjects();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Navbar onToggleTutorial={() => {}} />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-semibold text-white">Your Projects</div>
            <div className="text-sm text-slate-400">
              Create, manage, and launch your {languageConfig.label} coding workspaces.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New project name"
              className="rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createProject();
                }
              }}
            />
            <button
              onClick={createProject}
              disabled={loading}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>

        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <div
              key={project._id}
              className="rounded-xl border border-slate-800 bg-slate-900/70 p-5"
            >
              <div className="text-lg font-semibold text-white">{project.projectName}</div>
              <div className="mt-1 text-xs text-slate-500">
                Updated {new Date(project.updatedAt).toLocaleString()}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => navigate(`/projects/${project._id}`)}
                  className="rounded-md bg-slate-800 px-3 py-2 text-xs text-white hover:bg-slate-700"
                >
                  Open
                </button>
                <button
                  onClick={() => deleteProject(project._id)}
                  className="rounded-md px-3 py-2 text-xs text-rose-400 hover:text-rose-300"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {projects.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-500">
              No projects yet. Create one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
