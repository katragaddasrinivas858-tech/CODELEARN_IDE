import { useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import RichLessonEditor from "../components/RichLessonEditor";
import { apiRequest } from "../lib/api";
import {
  blocksFromPlainText,
  lessonBlocksToPlainText,
  normalizeLessonBlocks,
} from "../lib/lessonBlocks";

export default function TeacherAdmin() {
  const [students, setStudents] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [selectedLessonId, setSelectedLessonId] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonBlocks, setLessonBlocks] = useState([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [error, setError] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [importingContent, setImportingContent] = useState(false);
  const [savingTopic, setSavingTopic] = useState(false);
  const [savingLesson, setSavingLesson] = useState(false);
  const [resettingCurriculum, setResettingCurriculum] = useState(false);

  const orderedTopics = useMemo(
    () => [...topics].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [topics]
  );
  const selectedTopic = useMemo(
    () => orderedTopics.find((topic) => topic._id === selectedTopicId) || null,
    [orderedTopics, selectedTopicId]
  );
  const orderedLessons = useMemo(
    () => [...(selectedTopic?.lessons || [])].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [selectedTopic]
  );
  const selectedLesson = useMemo(
    () => orderedLessons.find((lesson) => lesson.id === selectedLessonId) || null,
    [orderedLessons, selectedLessonId]
  );

  const syncTopicSelection = (topicList, preferredTopicId = "", preferredLessonId = "") => {
    if (!topicList.length) {
      setSelectedTopicId("");
      setSelectedLessonId("");
      return;
    }

    const topicId = topicList.some((topic) => topic._id === preferredTopicId)
      ? preferredTopicId
      : topicList[0]._id;
    setSelectedTopicId(topicId);

    const topic = topicList.find((item) => item._id === topicId);
    const lessons = [...(topic?.lessons || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!lessons.length) {
      setSelectedLessonId("");
      return;
    }
    const lessonId = lessons.some((lesson) => lesson.id === preferredLessonId)
      ? preferredLessonId
      : lessons[0].id;
    setSelectedLessonId(lessonId);
  };

  const refreshTopics = async (preferredTopicId = selectedTopicId, preferredLessonId = selectedLessonId) => {
    const data = await apiRequest("/api/topics?full=true");
    const sorted = [...(data || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    setTopics(sorted);
    syncTopicSelection(sorted, preferredTopicId, preferredLessonId);
  };

  useEffect(() => {
    const load = async () => {
      setTopicsLoading(true);
      try {
        const [studentsData, topicsData] = await Promise.all([
          apiRequest("/api/teacher/students"),
          apiRequest("/api/topics?full=true"),
        ]);
        setStudents(studentsData.students || []);
        const sorted = [...(topicsData || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
        setTopics(sorted);
        syncTopicSelection(sorted);
      } catch (err) {
        setError(err.message);
      } finally {
        setTopicsLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedTopic) {
      setTopicTitle("");
      setTopicDescription("");
      return;
    }
    setTopicTitle(selectedTopic.title || "");
    setTopicDescription(selectedTopic.description || "");
  }, [selectedTopic]);

  useEffect(() => {
    if (!selectedTopic) {
      if (selectedLessonId) setSelectedLessonId("");
      return;
    }
    if (!orderedLessons.length) {
      if (selectedLessonId) setSelectedLessonId("");
      return;
    }
    if (!orderedLessons.some((lesson) => lesson.id === selectedLessonId)) {
      setSelectedLessonId(orderedLessons[0].id);
    }
  }, [selectedTopic, orderedLessons, selectedLessonId]);

  useEffect(() => {
    if (!selectedLesson) {
      setLessonTitle("");
      setLessonBlocks([]);
      return;
    }

    setLessonTitle(selectedLesson.title || "");
    const normalized = normalizeLessonBlocks(selectedLesson.blocks);
    if (normalized.length) {
      setLessonBlocks(normalized);
      return;
    }
    setLessonBlocks(blocksFromPlainText(selectedLesson.content || ""));
  }, [selectedLesson]);

  const seedCurriculum = async () => {
    setError("");
    setAdminMessage("");
    try {
      const res = await apiRequest("/api/seed/python", { method: "POST" });
      setAdminMessage(res.message || "Curriculum seeded.");
      await refreshTopics();
    } catch (err) {
      setError(err.message);
    }
  };

  const seedChallenges = async () => {
    setError("");
    setAdminMessage("");
    try {
      const res = await apiRequest("/api/seed/challenges", { method: "POST" });
      setAdminMessage(
        res.count
          ? `Created ${res.count} challenges.`
          : res.message || "Challenges seeded."
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const importTopicContent = async () => {
    const confirmed = confirm(
      "Import curated lesson content from web sources and replace existing lesson text?"
    );
    if (!confirmed) return;

    setError("");
    setAdminMessage("");
    setImportingContent(true);

    try {
      const res = await apiRequest("/api/seed/topic-content", {
        method: "POST",
        body: JSON.stringify({ replaceExisting: true }),
      });
      setAdminMessage(
        `Imported web content into ${res.updatedLessons || 0} lessons across ${
          res.updatedTopics || 0
        } topics.`
      );
      await refreshTopics();
    } catch (err) {
      setError(err.message);
    } finally {
      setImportingContent(false);
    }
  };

  const saveTopicHeader = async () => {
    if (!selectedTopicId) return;
    setError("");
    setAdminMessage("");
    setSavingTopic(true);
    try {
      await apiRequest(`/api/topics/${selectedTopicId}/content`, {
        method: "PUT",
        body: JSON.stringify({
          title: topicTitle,
          description: topicDescription,
        }),
      });
      setAdminMessage("Topic title and description updated.");
      await refreshTopics(selectedTopicId, selectedLessonId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTopic(false);
    }
  };

  const saveLessonDraft = async () => {
    if (!selectedTopicId || !selectedLessonId) return;
    setError("");
    setAdminMessage("");
    setSavingLesson(true);
    try {
      const normalizedBlocks = normalizeLessonBlocks(lessonBlocks);
      await apiRequest(`/api/topics/${selectedTopicId}/content`, {
        method: "PUT",
        body: JSON.stringify({
          lessons: [
            {
              id: selectedLessonId,
              title: lessonTitle,
              content: lessonBlocksToPlainText(normalizedBlocks),
              blocks: normalizedBlocks,
            },
          ],
        }),
      });
      setAdminMessage("Lesson content updated.");
      await refreshTopics(selectedTopicId, selectedLessonId);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingLesson(false);
    }
  };

  const resetCurriculum = async () => {
    const confirmed = confirm(
      "Delete all topics, problems, challenges, and linked submissions from seeded curriculum?"
    );
    if (!confirmed) return;

    setError("");
    setAdminMessage("");
    setResettingCurriculum(true);
    try {
      const res = await apiRequest("/api/seed/python", {
        method: "DELETE",
        body: JSON.stringify({ confirm: "RESET_CURRICULUM" }),
      });
      setAdminMessage(
        `Removed ${res.deleted?.topics || 0} topics, ${res.deleted?.problems || 0} problems, ${
          res.deleted?.challenges || 0
        } challenges.`
      );
      await refreshTopics();
    } catch (err) {
      setError(err.message);
    } finally {
      setResettingCurriculum(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-2xl font-semibold">Teacher Admin</div>
            <div className="text-sm text-slate-400">
              Track student progress, seed rich lesson content, and launch ranked challenges.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={seedCurriculum}
              className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
            >
              Seed Topics & Problems
            </button>
            <button
              onClick={importTopicContent}
              disabled={importingContent}
              className="rounded-md border border-emerald-500/50 px-3 py-2 text-xs text-emerald-200 hover:border-emerald-400 disabled:opacity-50"
            >
              {importingContent ? "Importing..." : "Import Web Lesson Content"}
            </button>
            <button
              onClick={seedChallenges}
              className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Create 20 Challenges
            </button>
            <button
              onClick={resetCurriculum}
              disabled={resettingCurriculum}
              className="rounded-md border border-rose-500/50 px-3 py-2 text-xs text-rose-200 hover:border-rose-400 disabled:opacity-50"
            >
              {resettingCurriculum ? "Removing..." : "Remove Seeded Curriculum"}
            </button>
          </div>
        </div>
        {adminMessage && <div className="mt-3 text-sm text-emerald-300">{adminMessage}</div>}
        {error && <div className="mt-4 text-sm text-rose-400">{error}</div>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-4 py-3">Student</th>
                  <th className="px-4 py-3">Solved</th>
                  <th className="px-4 py-3">Submissions</th>
                  <th className="px-4 py-3">Last Submission</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id} className="border-t border-slate-800">
                    <td className="px-4 py-3">
                      <div className="text-white">{student.name}</div>
                      <div className="text-xs text-slate-500">{student.email}</div>
                    </td>
                    <td className="px-4 py-3">{student.solvedCount}</td>
                    <td className="px-4 py-3">{student.submissions}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {student.lastSubmission
                        ? new Date(student.lastSubmission).toLocaleString()
                        : "-"}
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-4 py-6 text-center text-slate-400">
                      No students yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="text-sm font-semibold text-emerald-200">Rich Topic Content Editor</div>
            <div className="mt-1 text-xs text-slate-400">
              Build lesson pages with headings, images, and runnable Python code snippets.
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Topic</label>
                <select
                  value={selectedTopicId}
                  onChange={(e) => setSelectedTopicId(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                >
                  {!orderedTopics.length && <option value="">No topics found</option>}
                  {orderedTopics.map((topic) => (
                    <option key={topic._id} value={topic._id}>
                      {`Topic ${topic.order}: ${topic.title}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Lesson</label>
                <select
                  value={selectedLessonId}
                  onChange={(e) => setSelectedLessonId(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                >
                  {!orderedLessons.length && <option value="">No lessons in this topic</option>}
                  {orderedLessons.map((lesson) => (
                    <option key={lesson.id} value={lesson.id}>
                      {`Lesson ${lesson.order}: ${lesson.title}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-400">Topic Title</label>
                <input
                  type="text"
                  value={topicTitle}
                  onChange={(e) => setTopicTitle(e.target.value)}
                  placeholder="Enter topic title"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-400">Lesson Title</label>
                <input
                  type="text"
                  value={lessonTitle}
                  onChange={(e) => setLessonTitle(e.target.value)}
                  placeholder="Enter lesson title"
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs text-slate-400">Topic Description</label>
              <textarea
                rows={3}
                value={topicDescription}
                onChange={(e) => setTopicDescription(e.target.value)}
                placeholder="Enter topic description visible on the Topics page"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400"
              />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={saveTopicHeader}
                disabled={!selectedTopicId || savingTopic || topicsLoading}
                className="rounded-md border border-emerald-500/40 px-3 py-2 text-xs font-semibold text-emerald-200 hover:border-emerald-400 disabled:opacity-50"
              >
                {savingTopic ? "Saving Topic..." : "Save Topic Header"}
              </button>
              <button
                onClick={saveLessonDraft}
                disabled={!selectedTopicId || !selectedLesson || savingLesson || topicsLoading}
                className="rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                {savingLesson ? "Saving Lesson..." : "Save Lesson Page"}
              </button>
            </div>

            <div className="mt-4">
              <RichLessonEditor
                blocks={lessonBlocks}
                onChange={setLessonBlocks}
                disabled={!selectedTopicId || !selectedLesson || topicsLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
