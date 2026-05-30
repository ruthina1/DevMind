/**
 * Gemini API Wrapper
 *
 * All Gemini interactions go through this module.
 * Uses response_mime_type: "application/json" to enforce structured output.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  INTENT_SYSTEM_PROMPT,
  buildIntentPrompt,
} from "@/lib/prompts/intent";
import {
  RECOMMEND_SYSTEM_PROMPT,
  buildRecommendPrompt,
} from "@/lib/prompts/recommend";
import type { PackageInfo } from "@/lib/registry";
import type { CompatibilityResult } from "@/lib/compat";

// ── Types ────────────────────────────────────────────────────────────────────

export interface IntentResult {
  project_type: string;
  frontend_framework: string | null;
  backend_framework: string | null;
  database: string | null;
  key_features: string[];
  implicit_needs: {
    need: string;
    reason: string;
    candidates: string[];
  }[];
  scale: "prototype" | "production";
  all_candidates: string[];
}

export interface RecommendedPackage {
  name: string;
  version: string;
  reason: string;
  weekly_downloads: number;
}

export interface StackCategory {
  name: string;
  packages: RecommendedPackage[];
}

export interface Landmine {
  trigger: string;
  warning: string;
}

export interface Alternative {
  package: string;
  rejected_reason: string;
  suggested_instead: string;
}

export interface RecommendationResult {
  stack_status: "conflict_free" | "has_warnings";
  categories: StackCategory[];
  landmines: Landmine[];
  alternatives: Alternative[];
  install_command: string;
}

// ── Gemini Client ────────────────────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to your .env.local file."
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Call #1 — Intent Extraction
 *
 * Parses a plain-English project description into structured JSON
 * identifying frameworks, features, and candidate packages.
 */
export async function extractIntent(
  description: string
): Promise<IntentResult> {
  const client = getClient();
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: INTENT_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const result = await model.generateContent(buildIntentPrompt(description));
  const text = result.response.text();

  try {
    return JSON.parse(text) as IntentResult;
  } catch {
    throw new Error(`Failed to parse Gemini intent response: ${text}`);
  }
}

/**
 * Call #2 — Stack Recommendation
 *
 * Given intent + registry data + compat matrix, produces the final
 * curated, conflict-free stack.
 */
export async function generateRecommendation(
  intent: IntentResult,
  packages: PackageInfo[],
  compatibility: CompatibilityResult
): Promise<RecommendationResult> {
  const client = getClient();
  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: RECOMMEND_SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
    },
  });

  const prompt = buildRecommendPrompt(intent, packages, compatibility);
  const result = await model.generateContent(prompt);
  const text = result.response.text();

  try {
    return JSON.parse(text) as RecommendationResult;
  } catch {
    throw new Error(`Failed to parse Gemini recommendation response: ${text}`);
  }
}
