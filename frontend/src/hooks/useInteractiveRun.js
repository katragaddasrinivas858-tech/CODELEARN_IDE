import { useCallback, useEffect, useRef, useState } from "react";
import {
  API_BASE,
  apiRequest,
  clearAuthSession,
  getAuthHeaders,
  redirectToLogin,
  SESSION_EXPIRED_MESSAGE,
} from "../lib/api";

const SESSION_LOOKUP_ERROR_RE = /run session not found|expired or unavailable/i;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseSseBlock = (block) => {
  const normalized = block.replace(/\r/g, "");
  const lines = normalized.split("\n");
  let event = "message";
  const dataLines = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (!dataLines.length) return null;
  const rawData = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
};

export default function useInteractiveRun() {
  const [output, setOutput] = useState("");
  const [runState, setRunState] = useState("idle");
  const [runMessage, setRunMessage] = useState("");
  const [sessionId, setSessionId] = useState(null);

  const sessionRef = useRef(null);
  const streamAbortRef = useRef(null);

  const appendOutput = useCallback((chunk) => {
    if (!chunk) return;
    setOutput((prev) => prev + chunk);
  }, []);

  const stopRun = useCallback(async () => {
    const activeSessionId = sessionRef.current;
    if (!activeSessionId) return;

    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }

    try {
      await apiRequest(`/api/run/session/${activeSessionId}`, { method: "DELETE" });
    } catch {
      // Best-effort cleanup.
    }

    sessionRef.current = null;
    setSessionId(null);
    setRunState((prev) => (prev === "running" || prev === "starting" ? "stopped" : prev));
  }, []);

  const attachStreamWithRetry = useCallback(async (sessionId, signal) => {
    const maxAttempts = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const streamRes = await fetch(`${API_BASE}/api/run/session/${sessionId}/stream`, {
        method: "GET",
        headers: {
          ...getAuthHeaders(),
        },
        signal,
      });

      if (streamRes.ok) {
        if (!streamRes.body) {
          throw new Error("Streaming is not supported in this browser.");
        }
        return streamRes;
      }

      const rawMessage = await streamRes.text().catch(() => "");
      let message = rawMessage;
      try {
        const parsed = JSON.parse(rawMessage);
        message = parsed?.error || parsed?.message || rawMessage;
      } catch {
        // Keep plain text message.
      }

      if (streamRes.status === 401) {
        clearAuthSession();
        redirectToLogin();
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }

      const retriable = streamRes.status === 404 && SESSION_LOOKUP_ERROR_RE.test(message);
      const canRetry = retriable && attempt < maxAttempts && !signal.aborted;
      if (canRetry) {
        await wait(200 * attempt);
        continue;
      }
      throw new Error(message || "Unable to start stream");
    }

    throw new Error("Unable to start stream");
  }, []);

  const startRun = useCallback(
    async ({ code, projectId, fileId, files, entryFile, language, initialInput = "" }) => {
      await stopRun();
      setOutput("");
      setRunMessage("");
      setRunState("starting");

      let nextSessionId = null;
      let streamController = null;
      let receivedEnd = false;
      let sessionCreated = false;
      let streamEstablished = false;

      try {
        const start = await apiRequest("/api/run/session", {
          method: "POST",
          body: JSON.stringify({
            code,
            projectId,
            fileId,
            files,
            entryFile,
            language,
            input: initialInput,
          }),
        });

        nextSessionId = start.sessionId;
        sessionRef.current = nextSessionId;
        setSessionId(nextSessionId);
        setRunState("running");
        sessionCreated = true;

        streamController = new AbortController();
        streamAbortRef.current = streamController;

        const streamRes = await attachStreamWithRetry(nextSessionId, streamController.signal);
        streamEstablished = true;

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseSseBlock(block);

            if (parsed?.event === "output") {
              appendOutput(parsed.data?.chunk || "");
            }

            if (parsed?.event === "end") {
              receivedEnd = true;
              const status = parsed.data?.status;
              if (status === "ok") {
                setRunState("done");
              } else if (status === "killed") {
                setRunState("stopped");
              } else {
                setRunState("error");
              }
              setRunMessage(parsed.data?.message || "");
              sessionRef.current = null;
              setSessionId(null);
            }

            boundary = buffer.indexOf("\n\n");
          }
        }

        if (!receivedEnd && sessionRef.current === nextSessionId) {
          setRunState("running");
          setRunMessage(
            "Connection dropped before completion. You can still try Send, or click Run again."
          );
        }
      } catch (err) {
        if (streamController?.signal.aborted) return;

        if (sessionCreated && sessionRef.current === nextSessionId) {
          setRunState("running");
          setRunMessage(
            streamEstablished
              ? "Connection dropped before completion. You can still try Send, or click Run again."
              : "Could not attach live console stream. You can still try Send, or click Run again."
          );
          return;
        }

        if (nextSessionId) {
          try {
            await apiRequest(`/api/run/session/${nextSessionId}`, { method: "DELETE" });
          } catch {
            // Best-effort cleanup.
          }
        }

        sessionRef.current = null;
        setSessionId(null);
        setRunState("error");
        setRunMessage(err.message || "Run failed");
        throw err;
      } finally {
        streamAbortRef.current = null;
      }
    },
    [appendOutput, attachStreamWithRetry, stopRun]
  );

  const sendInput = useCallback(async (inputText) => {
    const activeSessionId = sessionRef.current;
    if (!activeSessionId) {
      throw new Error("No running session");
    }

    const payload =
      inputText.endsWith("\n") || inputText.endsWith("\r\n")
        ? inputText
        : `${inputText}\n`;
    const echoedInput = payload.replace(/\r\n/g, "\n");
    appendOutput(echoedInput);

    let lastError = null;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await apiRequest(`/api/run/session/${activeSessionId}/input`, {
          method: "POST",
          body: JSON.stringify({ input: payload }),
        });
        return;
      } catch (err) {
        lastError = err;
        const retriable = SESSION_LOOKUP_ERROR_RE.test(err.message || "");
        if (retriable && attempt < 4) {
          await wait(150 * attempt);
          continue;
        }
        break;
      }
    }

    if (SESSION_LOOKUP_ERROR_RE.test(lastError?.message || "")) {
      sessionRef.current = null;
      setSessionId(null);
      setRunState("error");
      setRunMessage(lastError.message);
    }
    throw lastError;
  }, [appendOutput]);

  const clearOutput = useCallback(() => {
    setOutput("");
    setRunMessage("");
  }, []);

  useEffect(() => {
    return () => {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
      }

      const activeSessionId = sessionRef.current;
      if (!activeSessionId) return;

      fetch(`${API_BASE}/api/run/session/${activeSessionId}`, {
        method: "DELETE",
        headers: {
          ...getAuthHeaders(),
        },
      }).catch(() => {});
    };
  }, []);

  return {
    output,
    runState,
    runMessage,
    sessionId,
    isRunning: runState === "starting" || runState === "running",
    startRun,
    sendInput,
    stopRun,
    clearOutput,
  };
}
