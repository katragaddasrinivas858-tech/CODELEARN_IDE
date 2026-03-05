import { useCallback, useEffect, useState } from "react";
import { getLearningLanguage, setLearningLanguage } from "../lib/auth";
import { normalizeLanguage } from "../lib/languages";

export default function useLearningLanguage() {
  const [language, setLanguage] = useState(() => getLearningLanguage());

  useEffect(() => {
    const onLanguageChange = (event) => {
      setLanguage(normalizeLanguage(event?.detail?.language || getLearningLanguage()));
    };

    window.addEventListener("codelearn:language-changed", onLanguageChange);
    return () => window.removeEventListener("codelearn:language-changed", onLanguageChange);
  }, []);

  const updateLanguage = useCallback((nextLanguage) => {
    const persisted = setLearningLanguage(nextLanguage);
    setLanguage(normalizeLanguage(persisted));
    return persisted;
  }, []);

  return [language, updateLanguage];
}
