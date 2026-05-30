/**
 * POST /api/init
 *
 * The main Feature 0 pipeline — orchestrates the full flow:
 * 1. Intent extraction (Gemini Call #1)
 * 2. Registry scan (parallel npm lookups)
 * 3. Compatibility check (peer dep cross-check)
 * 4. Recommendation (Gemini Call #2)
 * 5. Save to Supabase
 *
 * Returns a streaming JSON response with progress updates.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractIntent, generateRecommendation } from "@/lib/gemini";
import { fetchAllPackages } from "@/lib/registry";
import { checkCompatibility } from "@/lib/compat";
import { saveRecommendation } from "@/lib/supabase";

interface InitRequestBody {
  prompt: string;
  deviceId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: InitRequestBody = await request.json();

    if (!body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty 'prompt' field" },
        { status: 400 }
      );
    }

    const prompt = body.prompt.trim();

    // ── Step 1: Intent Extraction (Gemini Call #1) ───────────────────────
    const intent = await extractIntent(prompt);

    // ── Step 2: Registry Scan (parallel) ─────────────────────────────────
    const candidates = intent.all_candidates ?? [];
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error: "No package candidates could be inferred from the description.",
          intent,
        },
        { status: 422 }
      );
    }

    const packages = await fetchAllPackages(candidates);

    // Filter out packages that completely failed (keep partials for context)
    const validPackages = packages.filter((p) => p.version !== "unknown");

    // ── Step 3: Compatibility Check ──────────────────────────────────────
    const compatibility = checkCompatibility(validPackages);

    // ── Step 4: Recommendation (Gemini Call #2) ──────────────────────────
    const recommendation = await generateRecommendation(
      intent,
      validPackages,
      compatibility
    );

    // ── Step 5: Persist to Supabase ──────────────────────────────────────
    const savedRecord = await saveRecommendation({
      raw_prompt: prompt,
      intent_json: intent as unknown as Record<string, unknown>,
      result_json: recommendation as unknown as Record<string, unknown>,
    });

    // ── Response ─────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      prompt,
      intent,
      registry: {
        total: packages.length,
        resolved: validPackages.length,
        failed: packages.filter((p) => p.error).map((p) => ({
          name: p.name,
          error: p.error,
        })),
      },
      compatibility,
      recommendation,
      saved: savedRecord !== null,
      savedId: savedRecord?.id ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[DevMind /api/init] Pipeline error:", message);

    return NextResponse.json(
      { error: `Pipeline failed: ${message}` },
      { status: 500 }
    );
  }
}
