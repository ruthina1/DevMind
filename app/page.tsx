"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Brain,
  Zap,
  Search,
  Shield,
  Sparkles,
  Check,
  Copy,
  AlertTriangle,
  XCircle,
  Clock,
  ArrowRight,
  History,
  Package,
  ChevronRight,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════════ */

interface RecommendedPackage {
  name: string;
  version: string;
  reason: string;
  weekly_downloads: number;
}

interface StackCategory {
  name: string;
  packages: RecommendedPackage[];
}

interface Landmine {
  trigger: string;
  warning: string;
}

interface Alternative {
  package: string;
  rejected_reason: string;
  suggested_instead: string;
}

interface RecommendationResult {
  stack_status: "conflict_free" | "has_warnings";
  categories: StackCategory[];
  landmines: Landmine[];
  alternatives: Alternative[];
  install_command: string;
}

interface FailedPackage {
  name: string;
  error: string;
}

interface ApiResponse {
  success: boolean;
  prompt: string;
  intent: Record<string, unknown>;
  registry: {
    total: number;
    resolved: number;
    failed: FailedPackage[];
  };
  compatibility: {
    conflicts: unknown[];
    warnings: string[];
    isCompatible: boolean;
  };
  recommendation: RecommendationResult;
  saved: boolean;
  savedId: string | null;
  error?: string;
}

interface HistoryItem {
  prompt: string;
  timestamp: string;
  result: ApiResponse;
}

type PipelineStep = "idle" | "intent" | "registry" | "compat" | "recommend" | "done" | "error";

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */

const EXAMPLE_PROMPTS = [
  "realtime collaborative notes app with auth and postgres",
  "e-commerce store with Stripe payments and image uploads",
  "todo app with user login and a REST API",
  "chat app with WebSocket and Redis",
  "blog platform with markdown and SEO",
];

const PIPELINE_LABELS: Record<string, string> = {
  intent: "Extracting project intent…",
  registry: "Scanning npm registry…",
  compat: "Checking peer dependencies…",
  recommend: "Generating curated stack…",
};

/* ═══════════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/wk`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K/wk`;
  return `${n}/wk`;
}

function getStepStatus(
  step: string,
  currentStep: PipelineStep
): "pending" | "active" | "done" | "error" {
  const order = ["intent", "registry", "compat", "recommend"];
  const currentIdx = order.indexOf(currentStep);
  const stepIdx = order.indexOf(step);

  if (currentStep === "error") return stepIdx <= currentIdx ? "error" : "pending";
  if (currentStep === "done") return "done";
  if (stepIdx < currentIdx) return "done";
  if (stepIdx === currentIdx) return "active";
  return "pending";
}

/* ═══════════════════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════════════════ */

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [currentStep, setCurrentStep] = useState<PipelineStep>("idle");
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("devmind_history");
      if (stored) setHistory(JSON.parse(stored));
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [prompt]);

  const saveToHistory = useCallback(
    (promptText: string, res: ApiResponse) => {
      const item: HistoryItem = {
        prompt: promptText,
        timestamp: new Date().toISOString(),
        result: res,
      };
      const updated = [item, ...history].slice(0, 20);
      setHistory(updated);
      try {
        localStorage.setItem("devmind_history", JSON.stringify(updated));
      } catch {
        // Storage might be full
      }
    },
    [history]
  );

  /* ── Submit Handler ─────────────────────────────────────────────────── */
  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || currentStep !== "idle") return;

    setResult(null);
    setError(null);

    // Simulate the pipeline steps with timing
    const steps: PipelineStep[] = ["intent", "registry", "compat", "recommend"];
    let stepIndex = 0;

    setCurrentStep(steps[stepIndex]);

    // Start the actual API call
    const apiPromise = fetch("/api/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.trim() }),
    });

    // Progress simulation — advance steps while waiting
    const stepInterval = setInterval(() => {
      stepIndex++;
      if (stepIndex < steps.length) {
        setCurrentStep(steps[stepIndex]);
      }
    }, 2500);

    try {
      const res = await apiPromise;
      clearInterval(stepInterval);

      const data: ApiResponse = await res.json();

      if (!res.ok || data.error) {
        setCurrentStep("error");
        setError(data.error || `Server returned ${res.status}`);
        return;
      }

      setCurrentStep("done");
      setResult(data);
      saveToHistory(prompt.trim(), data);

      // Scroll to results
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    } catch (err) {
      clearInterval(stepInterval);
      setCurrentStep("error");
      setError(err instanceof Error ? err.message : "Network error");
    }
  }, [prompt, currentStep, saveToHistory]);

  /* ── Copy Install Command ───────────────────────────────────────────── */
  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  /* ── Load History Item ──────────────────────────────────────────────── */
  const loadHistoryItem = useCallback((item: HistoryItem) => {
    setPrompt(item.prompt);
    setResult(item.result);
    setCurrentStep("done");
    setError(null);
  }, []);

  /* ── Reset ──────────────────────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    setCurrentStep("idle");
    setResult(null);
    setError(null);
  }, []);

  const isRunning = !["idle", "done", "error"].includes(currentStep);

  /* ═══════════════════════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════════════════════ */

  return (
    <div className="app-container">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo">
            <Brain size={20} />
          </div>
          <div>
            <div className="header-title">DevMind</div>
            <div className="header-subtitle">AI Dependency Intelligence</div>
          </div>
        </div>
        <span className="header-badge">⚡ Powered by Gemini</span>
      </header>

      {/* ── Main Layout ───────────────────────────────────────────────── */}
      <div className="main-layout">
        <main className="main-content">
          {/* ── Hero ────────────────────────────────────────────────── */}
          {currentStep === "idle" && !result && (
            <section className="hero-section">
              <div className="hero-icon">
                <Package size={32} color="var(--accent-indigo)" />
              </div>
              <h1 className="hero-title">
                Describe your project.
                <br />
                Get a perfect stack.
              </h1>
              <p className="hero-description">
                DevMind analyzes your idea, scans the npm registry, checks peer
                dependency compatibility, and returns a conflict-free pinned
                stack — before you write a single line of code.
              </p>
            </section>
          )}

          {/* ── Input Section ──────────────────────────────────────── */}
          <section className="input-section">
            <div className="input-wrapper">
              <textarea
                ref={textareaRef}
                className="input-field"
                placeholder="Describe your project idea… e.g. &quot;realtime collaborative notes app with auth and postgres&quot;"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                disabled={isRunning}
                rows={1}
                id="project-input"
              />
              <div className="input-actions">
                <div className="input-hints">
                  {EXAMPLE_PROMPTS.slice(0, 3).map((ex) => (
                    <button
                      key={ex}
                      className="input-hint"
                      onClick={() => setPrompt(ex)}
                      disabled={isRunning}
                    >
                      {ex.length > 35 ? ex.slice(0, 35) + "…" : ex}
                    </button>
                  ))}
                </div>
                <button
                  className="submit-btn"
                  onClick={handleSubmit}
                  disabled={!prompt.trim() || isRunning}
                  id="submit-btn"
                >
                  {isRunning ? (
                    <>
                      <div className="step-spinner" /> Analyzing…
                    </>
                  ) : (
                    <>
                      <Zap size={14} /> Analyze
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* ── Pipeline Progress ──────────────────────────────────── */}
          {currentStep !== "idle" && (
            <section className="pipeline-section">
              <div className="pipeline-steps">
                {(["intent", "registry", "compat", "recommend"] as const).map(
                  (step) => {
                    const status = getStepStatus(step, currentStep);
                    return (
                      <div
                        key={step}
                        className={`pipeline-step ${status}`}
                      >
                        <span className="step-icon">
                          {status === "done" && <Check size={18} />}
                          {status === "active" && <div className="step-spinner" />}
                          {status === "pending" && <ChevronRight size={18} />}
                          {status === "error" && <XCircle size={18} />}
                        </span>
                        <span>
                          {step === "intent" && (
                            <>
                              <Brain size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                              {status === "active" ? PIPELINE_LABELS[step] : "Intent extraction"}
                            </>
                          )}
                          {step === "registry" && (
                            <>
                              <Search size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                              {status === "active" ? PIPELINE_LABELS[step] : "Registry scan"}
                            </>
                          )}
                          {step === "compat" && (
                            <>
                              <Shield size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                              {status === "active" ? PIPELINE_LABELS[step] : "Compatibility check"}
                            </>
                          )}
                          {step === "recommend" && (
                            <>
                              <Sparkles size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                              {status === "active" ? PIPELINE_LABELS[step] : "Stack recommendation"}
                            </>
                          )}
                        </span>
                      </div>
                    );
                  }
                )}
              </div>
            </section>
          )}

          {/* ── Error State ────────────────────────────────────────── */}
          {error && (
            <div className="error-card">
              <div className="error-title">
                <XCircle size={18} />
                Pipeline Error
              </div>
              <div className="error-message">{error}</div>
              <button
                className="submit-btn"
                style={{ marginTop: 16 }}
                onClick={handleReset}
              >
                <ArrowRight size={14} /> Try Again
              </button>
            </div>
          )}

          {/* ── Results ────────────────────────────────────────────── */}
          {result?.recommendation && (
            <div className="result-section" ref={resultRef}>
              {/* Status header */}
              <div
                className={`result-header ${
                  result.recommendation.stack_status === "has_warnings"
                    ? "has-warnings"
                    : ""
                }`}
              >
                {result.recommendation.stack_status === "conflict_free" ? (
                  <Shield size={24} color="var(--accent-emerald)" />
                ) : (
                  <AlertTriangle size={24} color="var(--accent-amber)" />
                )}
                <div>
                  <div className="result-header-text">
                    {result.recommendation.stack_status === "conflict_free"
                      ? "RECOMMENDED STACK — conflict free ✓"
                      : "RECOMMENDED STACK — has warnings ⚠"}
                  </div>
                  <div className="result-header-sub">
                    {result.registry.resolved} packages resolved
                    {result.registry.failed.length > 0 &&
                      ` · ${result.registry.failed.length} failed lookups`}
                    {result.compatibility.isCompatible
                      ? " · all peer deps compatible"
                      : ` · ${result.compatibility.conflicts.length} conflict(s) found`}
                  </div>
                </div>
              </div>

              {/* Category cards */}
              {result.recommendation.categories.map((cat, ci) => (
                <div key={ci} className="category-card">
                  <div className="category-header">
                    <span className="category-dot" />
                    <span className="category-name">{cat.name}</span>
                    <span className="category-count">
                      {cat.packages.length} package
                      {cat.packages.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="category-packages">
                    {cat.packages.map((pkg, pi) => (
                      <div key={pi} className="package-row">
                        <span className="package-name">{pkg.name}</span>
                        <span className="package-version">@{pkg.version}</span>
                        <span className="package-reason">{pkg.reason}</span>
                        {pkg.weekly_downloads > 0 && (
                          <span className="package-downloads">
                            {formatDownloads(pkg.weekly_downloads)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Landmines */}
              {result.recommendation.landmines.length > 0 && (
                <div className="landmines-section">
                  <div className="landmines-title">
                    <AlertTriangle size={16} />
                    Landmine Warnings
                  </div>
                  {result.recommendation.landmines.map((mine, i) => (
                    <div key={i} className="landmine-card">
                      <div className="landmine-trigger">⚠ {mine.trigger}</div>
                      <div className="landmine-warning">{mine.warning}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Alternatives */}
              {result.recommendation.alternatives.length > 0 && (
                <div className="alternatives-section">
                  <div className="alternatives-title">
                    <Package size={16} />
                    Alternatives Considered
                  </div>
                  {result.recommendation.alternatives.map((alt, i) => (
                    <div key={i} className="alternative-card">
                      <span className="alternative-pkg">{alt.package}</span>
                      <span className="alternative-reason">
                        {alt.rejected_reason}
                      </span>
                      <span className="alternative-instead">
                        → {alt.suggested_instead}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Install command */}
              {result.recommendation.install_command && (
                <div className="install-section">
                  <div className="install-card">
                    <div className="install-header">
                      <span className="install-label">Install Command</span>
                      <button
                        className={`copy-btn ${copied ? "copied" : ""}`}
                        onClick={() =>
                          handleCopy(result.recommendation.install_command)
                        }
                      >
                        {copied ? (
                          <>
                            <Check size={12} /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Copy
                          </>
                        )}
                      </button>
                    </div>
                    <div className="install-command">
                      {result.recommendation.install_command}
                    </div>
                  </div>
                </div>
              )}

              {/* New analysis button */}
              <div style={{ textAlign: "center", marginTop: 32 }}>
                <button className="submit-btn" onClick={handleReset}>
                  <Sparkles size={14} /> Analyze Another Project
                </button>
              </div>
            </div>
          )}
        </main>

        {/* ── Sidebar ─────────────────────────────────────────────────── */}
        <aside className="sidebar">
          <div className="sidebar-title">
            <History size={14} />
            Recent Analyses
          </div>
          {history.length === 0 ? (
            <div className="sidebar-empty">
              Your analysis history will appear here.
              <br />
              <br />
              Try describing a project idea to get started!
            </div>
          ) : (
            history.map((item, i) => (
              <div
                key={i}
                className="history-item"
                onClick={() => loadHistoryItem(item)}
              >
                <div className="history-item-prompt">{item.prompt}</div>
                <div className="history-item-meta">
                  <Clock size={10} />
                  {new Date(item.timestamp).toLocaleDateString()}{" "}
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))
          )}
        </aside>
      </div>
    </div>
  );
}
