const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Problem = require("../models/Problem");
const Challenge = require("../models/Challenge");
const Submission = require("../models/Submission");
const User = require("../models/User");
const {
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  buildLanguageFilter,
  isSupportedLanguage,
} = require("../constants/languages");
const {
  complexityToScore,
  estimateComplexityFromCode,
  normalizeComplexity,
  percentileLowerBetter,
} = require("../utils/performance");

const invalidInputError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const buildPythonHarness = (problem, code) => {
  const tests = JSON.stringify(problem.testCases || []);
  const entryType = problem.entryType || "function";
  const entryName = problem.entryName;

  return `
import json, time, inspect

${code}

def __is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)

def __values_match(actual, expected):
    if __is_number(actual) and __is_number(expected):
        return abs(float(actual) - float(expected)) <= 1e-6

    if isinstance(actual, (list, tuple)) and isinstance(expected, (list, tuple)):
        if len(actual) != len(expected):
            return False
        return all(__values_match(a, b) for a, b in zip(actual, expected))

    if isinstance(actual, dict) and isinstance(expected, dict):
        if set(actual.keys()) != set(expected.keys()):
            return False
        return all(__values_match(actual[k], expected[k]) for k in actual.keys())

    return actual == expected

def __call_args(func, inp):
    if not isinstance(inp, list):
        return [inp]

    # LeetCode-style: if input list matches callable arity, spread args; otherwise pass as one arg.
    try:
        sig = inspect.signature(func)
        params = list(sig.parameters.values())
        positional = [
            p for p in params
            if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
        ]
        has_varargs = any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params)
        required = len([p for p in positional if p.default is inspect._empty])
        max_args = 10**9 if has_varargs else len(positional)
        if required <= len(inp) <= max_args:
            return inp
    except Exception:
        pass

    return [inp]

def __resolve_function(entry_name):
    direct = globals().get(entry_name)
    if callable(direct):
        return direct, entry_name

    solution_cls = globals().get("Solution")
    if inspect.isclass(solution_cls):
        try:
            inst = solution_cls()
            method = getattr(inst, entry_name, None)
            if callable(method):
                return method, "Solution." + entry_name

            public_methods = [
                n for n, m in inspect.getmembers(inst, predicate=callable)
                if not n.startswith("_")
            ]
            if len(public_methods) == 1:
                chosen = public_methods[0]
                return getattr(inst, chosen), "Solution." + chosen
        except Exception:
            pass

    user_functions = []
    for name, obj in globals().items():
        if name.startswith("_"):
            continue
        if name in {"json", "time", "inspect"}:
            continue
        if inspect.isfunction(obj):
            user_functions.append((name, obj))

    if len(user_functions) == 1:
        return user_functions[0][1], user_functions[0][0]

    return None, entry_name

def __resolve_class(entry_name):
    direct = globals().get(entry_name)
    if inspect.isclass(direct):
        return direct, entry_name

    solution_cls = globals().get("Solution")
    if inspect.isclass(solution_cls):
        return solution_cls, "Solution"

    user_classes = []
    for name, obj in globals().items():
        if name.startswith("_"):
            continue
        if name in {"json", "time", "inspect"}:
            continue
        if inspect.isclass(obj):
            user_classes.append((name, obj))

    if len(user_classes) == 1:
        return user_classes[0][1], user_classes[0][0]

    return None, entry_name

def __run():
    tests = json.loads(${JSON.stringify(tests)})
    passed = 0
    total = len(tests)
    details = []
    had_runtime_error = False
    resolver_used = ""
    start = time.perf_counter()
    for t in tests:
        inp = t.get("input")
        expected = t.get("output")
        try:
            if "${entryType}" == "function":
                func, resolved_name = __resolve_function("${entryName}")
                if func is None:
                    raise Exception("Function ${entryName} not found")
                resolver_used = resolved_name
                args = __call_args(func, inp)
                output = func(*args)
            else:
                cls, resolved_name = __resolve_class("${entryName}")
                if cls is None:
                    raise Exception("Class ${entryName} not found")
                resolver_used = resolved_name
                init_args = inp.get("init", [])
                calls = inp.get("calls", [])
                obj = cls(*init_args)
                outputs = []
                for call in calls:
                    method = getattr(obj, call[0])
                    args = call[1] if len(call) > 1 else []
                    outputs.append(method(*args))
                output = outputs
            if __values_match(output, expected):
                passed += 1
            else:
                details.append({"input": inp, "expected": expected, "output": output})
        except Exception as e:
            had_runtime_error = True
            details.append({"input": inp, "expected": expected, "error": str(e)})
    runtime_ms = int((time.perf_counter() - start) * 1000)
    result = {
        "passed": passed,
        "total": total,
        "runtimeMs": runtime_ms,
        "details": details,
        "hadRuntimeError": had_runtime_error,
        "resolverUsed": resolver_used,
    }
    print("__RESULT__" + json.dumps(result, default=str))

__run()
`;
};

const buildJavascriptHarness = (problem, code) => {
  const tests = problem.testCases || [];
  const entryType = problem.entryType || "function";
  const entryName = problem.entryName;

  return `
"use strict";
const vm = require("vm");

const __tests = ${JSON.stringify(tests)};
const __entryType = ${JSON.stringify(entryType)};
const __entryName = ${JSON.stringify(entryName)};
const __source = ${JSON.stringify(code)};

const __sandbox = {
  module: { exports: {} },
  exports: {},
  require,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
__sandbox.global = __sandbox;
__sandbox.globalThis = __sandbox;
vm.createContext(__sandbox);

let __loadError = null;
try {
  new vm.Script(__source, { filename: "solution.js" }).runInContext(__sandbox, { timeout: 4000 });
} catch (err) {
  __loadError = err;
}

function __isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function __valuesMatch(actual, expected) {
  if ((actual === null || actual === undefined) && (expected === null || expected === undefined)) {
    return true;
  }

  if (__isNumber(actual) && __isNumber(expected)) {
    return Math.abs(actual - expected) <= 1e-6;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i += 1) {
      if (!__valuesMatch(actual[i], expected[i])) return false;
    }
    return true;
  }

  if (
    actual &&
    expected &&
    typeof actual === "object" &&
    typeof expected === "object" &&
    !Array.isArray(actual) &&
    !Array.isArray(expected)
  ) {
    const aKeys = Object.keys(actual).sort();
    const eKeys = Object.keys(expected).sort();
    if (!__valuesMatch(aKeys, eKeys)) return false;
    for (const key of aKeys) {
      if (!__valuesMatch(actual[key], expected[key])) return false;
    }
    return true;
  }

  return actual === expected;
}

function __callArgs(inputValue) {
  if (Array.isArray(inputValue)) return inputValue;
  return [inputValue];
}

function __resolveFunction(entryName) {
  const direct = __sandbox[entryName];
  if (typeof direct === "function") return [direct, entryName];

  const moduleExports = __sandbox.module?.exports;
  if (typeof moduleExports === "function") return [moduleExports, "module.exports"];
  if (moduleExports && typeof moduleExports[entryName] === "function") {
    return [moduleExports[entryName], "module.exports." + entryName];
  }
  if (moduleExports && typeof moduleExports.default === "function") {
    return [moduleExports.default, "module.exports.default"];
  }

  const solutionClass = __sandbox.Solution || moduleExports?.Solution;
  if (typeof solutionClass === "function") {
    try {
      const instance = new solutionClass();
      const method = instance?.[entryName];
      if (typeof method === "function") {
        return [method.bind(instance), "Solution." + entryName];
      }
      const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(instance || {})).filter(
        (name) => name !== "constructor" && typeof instance[name] === "function"
      );
      if (methodNames.length === 1) {
        const picked = methodNames[0];
        return [instance[picked].bind(instance), "Solution." + picked];
      }
    } catch (_) {
      // ignore and continue with fallback detection
    }
  }

  const userFunctions = Object.entries(__sandbox).filter(([name, value]) => {
    if (name.startsWith("__")) return false;
    if (["module", "exports", "require", "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "global", "globalThis"].includes(name)) {
      return false;
    }
    return typeof value === "function";
  });

  if (userFunctions.length === 1) {
    return [userFunctions[0][1], userFunctions[0][0]];
  }

  return [null, entryName];
}

function __resolveClass(entryName) {
  const direct = __sandbox[entryName];
  if (typeof direct === "function") return [direct, entryName];

  const moduleExports = __sandbox.module?.exports;
  if (moduleExports && typeof moduleExports[entryName] === "function") {
    return [moduleExports[entryName], "module.exports." + entryName];
  }

  const solutionClass = __sandbox.Solution || moduleExports?.Solution;
  if (typeof solutionClass === "function") return [solutionClass, "Solution"];

  const userClasses = Object.entries(__sandbox).filter(([name, value]) => {
    if (name.startsWith("__")) return false;
    if (["module", "exports", "require", "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "global", "globalThis"].includes(name)) {
      return false;
    }
    return typeof value === "function";
  });

  if (userClasses.length === 1) {
    return [userClasses[0][1], userClasses[0][0]];
  }

  return [null, entryName];
}

function __finishWithLoadError() {
  const result = {
    passed: 0,
    total: Array.isArray(__tests) ? __tests.length : 0,
    runtimeMs: 0,
    details: [{ error: __loadError?.message || "Unable to evaluate submission." }],
    hadRuntimeError: true,
    resolverUsed: "",
  };
  console.log("__RESULT__" + JSON.stringify(result));
}

function __run() {
  if (__loadError) {
    __finishWithLoadError();
    return;
  }

  const tests = Array.isArray(__tests) ? __tests : [];
  let passed = 0;
  const total = tests.length;
  const details = [];
  let hadRuntimeError = false;
  let resolverUsed = "";
  const start = Date.now();

  for (const testCase of tests) {
    const inputValue = testCase?.input;
    const expected = testCase?.output;

    try {
      let output;
      if (__entryType === "function") {
        const [fn, resolvedName] = __resolveFunction(__entryName);
        if (typeof fn !== "function") {
          throw new Error("Function " + __entryName + " not found");
        }
        resolverUsed = resolvedName;
        output = fn(...__callArgs(inputValue));
      } else {
        const [Clazz, resolvedName] = __resolveClass(__entryName);
        if (typeof Clazz !== "function") {
          throw new Error("Class " + __entryName + " not found");
        }
        resolverUsed = resolvedName;
        const initArgs = Array.isArray(inputValue?.init) ? inputValue.init : [];
        const calls = Array.isArray(inputValue?.calls) ? inputValue.calls : [];
        const instance = new Clazz(...initArgs);
        const outputs = [];
        for (const call of calls) {
          const methodName = call?.[0];
          const methodArgs = Array.isArray(call?.[1]) ? call[1] : [];
          const method = instance?.[methodName];
          if (typeof method !== "function") {
            throw new Error("Method " + methodName + " not found");
          }
          outputs.push(method.apply(instance, methodArgs));
        }
        output = outputs;
      }

      if (__valuesMatch(output, expected)) {
        passed += 1;
      } else {
        details.push({ input: inputValue, expected, output });
      }
    } catch (err) {
      hadRuntimeError = true;
      details.push({ input: inputValue, expected, error: err?.message || String(err) });
    }
  }

  const runtimeMs = Date.now() - start;
  const result = { passed, total, runtimeMs, details, hadRuntimeError, resolverUsed };
  console.log("__RESULT__" + JSON.stringify(result));
}

__run();
`;
};

const C_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const escapeCString = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");

const toCNumberLiteral = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw invalidInputError("C judge supports only finite numeric outputs.");
  }
  const raw = number.toString();
  if (/e/i.test(raw)) return raw;
  if (raw.includes(".")) return raw;
  return `${raw}.0`;
};

const toCScalarLiteral = (value) => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw invalidInputError("C judge supports only finite numeric inputs.");
    }
    return Number.isInteger(value) ? String(value) : value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "string") {
    return `"${escapeCString(value)}"`;
  }
  throw invalidInputError(
    "C judge supports only scalar number, boolean, and string arguments in test cases."
  );
};

const buildCHarness = (problem, code) => {
  const tests = Array.isArray(problem.testCases) ? problem.testCases : [];
  const entryName = String(problem.entryName || "").trim();
  const entryType = problem.entryType || "function";

  if (entryType !== "function") {
    throw invalidInputError("C judge currently supports function-style problems only.");
  }
  if (!C_IDENTIFIER_RE.test(entryName)) {
    throw invalidInputError("Invalid C entry function name.");
  }

  const invocations = tests
    .map((testCase) => {
      const args = Array.isArray(testCase?.input) ? testCase.input : [testCase?.input];
      const argList = args.map((arg) => toCScalarLiteral(arg)).join(", ");
      const outputValue = testCase?.output;
      if (typeof outputValue !== "number" && typeof outputValue !== "boolean") {
        throw invalidInputError("C judge expects numeric outputs for seeded test cases.");
      }
      const expectedLiteral = toCNumberLiteral(
        typeof outputValue === "boolean" ? (outputValue ? 1 : 0) : outputValue
      );
      return `
  {
    const double __expected = ${expectedLiteral};
    const double __actual = (double)(${entryName}(${argList}));
    if (fabs(__actual - __expected) <= 1e-6) {
      passed += 1;
    }
  }`;
    })
    .join("\n");

  return `
#include <math.h>
#include <stdio.h>
#include <time.h>

${code}

int main(void) {
  int passed = 0;
  const int total = ${tests.length};
  const clock_t startClock = clock();
${invocations}
  const double elapsedMs = ((double)(clock() - startClock) * 1000.0) / (double)CLOCKS_PER_SEC;
  printf("__RESULT__{\\"passed\\":%d,\\"total\\":%d,\\"runtimeMs\\":%d,\\"details\\":[],\\"hadRuntimeError\\":false,\\"resolverUsed\\":\\"${entryName}\\"}\\n", passed, total, (int)elapsedMs);
  return 0;
}
`;
};

const judgeProblem = async (req, res) => {
  const { problemId, code, challengeId, language: requestedLanguage } = req.body;
  if (!problemId || !code) {
    return res.status(400).json({ error: "problemId and code required" });
  }

  const problem = await Problem.findById(problemId);
  if (!problem) return res.status(404).json({ error: "Problem not found" });
  const problemLanguage = normalizeLanguage(problem.language);
  if (requestedLanguage && !isSupportedLanguage(requestedLanguage)) {
    return res.status(400).json({ error: "Unsupported submission language" });
  }
  if (requestedLanguage && normalizeLanguage(requestedLanguage) !== problemLanguage) {
    return res.status(400).json({
      error: `Problem belongs to ${problemLanguage}. Submit with the same language.`,
    });
  }

  const user = await User.findById(req.user.id);
  const teacherId = user?.role === "student" ? user.teacherId : user?._id;
  let challenge = null;
  if (challengeId) {
    challenge = await Challenge.findById(challengeId);
    if (!challenge || !challenge.active) {
      return res.status(404).json({ error: "Challenge not found or inactive" });
    }
    const challengeLanguage = normalizeLanguage(challenge.language);
    if (challengeLanguage !== problemLanguage) {
      return res.status(400).json({ error: "Challenge language does not match problem language" });
    }
    const problemIncluded = (challenge.problemIds || []).some(
      (id) => id.toString() === problem._id.toString()
    );
    if (!problemIncluded) {
      return res.status(400).json({ error: "Problem is not part of this challenge" });
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codelearn-judge-"));
  const extension =
    problemLanguage === SUPPORTED_LANGUAGES.JAVASCRIPT
      ? "js"
      : problemLanguage === SUPPORTED_LANGUAGES.C
        ? "c"
        : "py";
  const tempFile = path.join(tempDir, `judge.${extension}`);

  let script = "";
  try {
    script =
      problemLanguage === SUPPORTED_LANGUAGES.JAVASCRIPT
        ? buildJavascriptHarness(problem, code)
        : problemLanguage === SUPPORTED_LANGUAGES.C
          ? buildCHarness(problem, code)
          : buildPythonHarness(problem, code);
  } catch (err) {
    fs.rm(tempDir, { recursive: true, force: true }, () => {});
    return res.status(err.status || 400).json({ error: err.message || "Unable to prepare judge script" });
  }

  fs.writeFileSync(tempFile, script, "utf8");

  const cleanup = () => {
    fs.rm(tempDir, { recursive: true, force: true }, () => {});
  };

  const handleExecutionResult = async (error, stdout, stderr) => {
    cleanup();

    try {
      if (error && !stdout) {
        return res.json({ status: "Runtime Error", output: stderr || error.message });
      }

      const lines = String(stdout || "")
        .trim()
        .split("\n");
      const resultLine = lines.reverse().find((line) => line.startsWith("__RESULT__"));
      if (!resultLine) {
        return res.json({ status: "Runtime Error", output: stderr || "No result" });
      }

      const payload = JSON.parse(resultLine.replace("__RESULT__", ""));
      let status = "Wrong Answer";
      if (payload.passed === payload.total) {
        status = "Accepted";
      } else if (payload.hadRuntimeError && payload.passed === 0) {
        status = "Runtime Error";
      }
      const runtimeMs = payload.runtimeMs || 0;
      const estimated = estimateComplexityFromCode(code, problem.entryName);
      const expectedComplexity = normalizeComplexity(problem.complexity);
      const expectedComplexityScore = complexityToScore(expectedComplexity);

      const submission = await Submission.create({
        language: problemLanguage,
        userId: req.user.id,
        teacherId,
        problemId: problem._id,
        challengeId: challengeId || null,
        status,
        runtimeMs,
        passedCount: payload.passed,
        totalCount: payload.total,
        estimatedComplexity: estimated.label,
        complexityScore: estimated.score,
        expectedComplexity,
        expectedComplexityScore,
        sourceLength: code.length,
      });

      let runtimePercentile = 0;
      let complexityPercentile = 0;
      if (status === "Accepted") {
        const peerFilter = {
          problemId: problem._id,
          status: "Accepted",
          ...buildLanguageFilter(problemLanguage),
        };

        if (teacherId) peerFilter.teacherId = teacherId;
        if (challengeId) peerFilter.challengeId = challengeId;

        const peers = await Submission.find(peerFilter).select("runtimeMs complexityScore");
        runtimePercentile = percentileLowerBetter(
          peers.map((s) => s.runtimeMs),
          runtimeMs
        );
        complexityPercentile = percentileLowerBetter(
          peers.map((s) => s.complexityScore),
          estimated.score
        );
      }

      const challengeAccepted = !challengeId || status === "Accepted";

      return res.json({
        language: problemLanguage,
        status,
        runtimeMs,
        passed: payload.passed,
        total: payload.total,
        complexity: {
          expected: expectedComplexity,
          estimated: estimated.label,
          score: estimated.score,
          percentile: complexityPercentile,
        },
        runtimePercentile,
        submissionId: submission._id,
        details: (payload.details || []).slice(0, 3),
        resolverUsed: payload.resolverUsed || problem.entryName,
        challengeAccepted,
        challengeMessage:
          challengeId && !challengeAccepted
            ? "Challenge submission is counted only when all test cases pass."
            : "",
      });
    } catch (err) {
      return res.status(err.status || 500).json({ error: err.message || "Judge failed" });
    }
  };

  if (problemLanguage === SUPPORTED_LANGUAGES.C) {
    const binaryFile = path.join(tempDir, process.platform === "win32" ? "judge.exe" : "judge.out");
    execFile(
      "gcc",
      [tempFile, "-O2", "-std=c11", "-lm", "-o", binaryFile],
      { timeout: 8000, maxBuffer: 1024 * 1024 },
      (compileError, compileStdout, compileStderr) => {
        if (compileError) {
          cleanup();
          return res.json({
            status: "Runtime Error",
            output: compileStderr || compileStdout || compileError.message,
          });
        }

        execFile(
          binaryFile,
          [],
          { timeout: 8000, maxBuffer: 1024 * 1024 },
          (error, stdout, stderr) => {
            void handleExecutionResult(error, stdout, stderr);
          }
        );
      }
    );
    return;
  }

  const command = problemLanguage === SUPPORTED_LANGUAGES.JAVASCRIPT ? "node" : "python";
  execFile(
    command,
    [tempFile],
    { timeout: 8000, maxBuffer: 1024 * 1024 },
    (error, stdout, stderr) => {
      void handleExecutionResult(error, stdout, stderr);
    }
  );
};

module.exports = { judgeProblem };
