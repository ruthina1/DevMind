/**
 * GET /api/registry?package={name}
 *
 * Fetch npm registry metadata for a single package.
 * Used for direct lookups and debugging.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchPackageInfo } from "@/lib/registry";

export async function GET(request: NextRequest) {
  const packageName = request.nextUrl.searchParams.get("package");

  if (!packageName) {
    return NextResponse.json(
      { error: "Missing 'package' query parameter" },
      { status: 400 }
    );
  }

  try {
    const info = await fetchPackageInfo(packageName);

    if (info.error) {
      return NextResponse.json(
        { error: info.error, partial: info },
        { status: 404 }
      );
    }

    return NextResponse.json(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Registry lookup failed: ${message}` },
      { status: 500 }
    );
  }
}
