/**
 * POST /api/recommend
 *
 * Standalone endpoint for running Gemini recommendation (Call #2).
 * Expects pre-computed intent, package info, and compat matrix in the body.
 */

import { NextRequest, NextResponse } from "next/server";
import { generateRecommendation } from "@/lib/gemini";
import type { IntentResult } from "@/lib/gemini";
import type { PackageInfo } from "@/lib/registry";
import type { CompatibilityResult } from "@/lib/compat";

interface RecommendRequestBody {
  intent: IntentResult;
  packages: PackageInfo[];
  compatibility: CompatibilityResult;
}

export async function POST(request: NextRequest) {
  try {
    const body: RecommendRequestBody = await request.json();

    if (!body.intent || !body.packages || !body.compatibility) {
      return NextResponse.json(
        { error: "Missing required fields: intent, packages, compatibility" },
        { status: 400 }
      );
    }

    const result = await generateRecommendation(
      body.intent,
      body.packages,
      body.compatibility
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Recommendation failed: ${message}` },
      { status: 500 }
    );
  }
}
