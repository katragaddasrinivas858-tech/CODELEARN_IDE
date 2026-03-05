import {
  getStoredLearningLanguage,
  normalizeLanguage,
  persistLearningLanguage,
} from "./languages";

export const getUser = () => {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const isTeacher = () => {
  const user = getUser();
  return user?.role === "teacher";
};

export const getLearningLanguage = () => {
  const user = getUser();
  return normalizeLanguage(user?.learningLanguage || getStoredLearningLanguage());
};

export const setLearningLanguage = (language) => persistLearningLanguage(language);
