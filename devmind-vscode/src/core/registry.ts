/**
 * npm Registry Client
 *
 * Fetches package metadata and download stats from the npm registry.
 * All fetches run in parallel via Promise.all().
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  peerDependencies: Record<string, string>;
  dependencies: Record<string, string>;
  weeklyDownloads: number;
  error?: string;
}

interface NpmRegistryResponse {
  name: string;
  version: string;
  description?: string;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

interface NpmDownloadsResponse {
  downloads: number;
  package: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const REGISTRY_BASE = "https://registry.npmjs.org";
const DOWNLOADS_BASE = "https://api.npmjs.org/downloads/point/last-week";
const FETCH_TIMEOUT_MS = 8000;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch metadata for a single package from the npm registry.
 * Returns null-safe PackageInfo with error field on failure.
 */
export async function fetchPackageInfo(
  packageName: string
): Promise<PackageInfo> {
  try {
    // Fetch metadata and downloads in parallel
    const [metaRes, dlRes] = await Promise.all([
      fetchWithTimeout(`${REGISTRY_BASE}/${encodeURIComponent(packageName)}/latest`),
      fetchWithTimeout(`${DOWNLOADS_BASE}/${encodeURIComponent(packageName)}`),
    ]);

    if (!metaRes.ok) {
      return {
        name: packageName,
        version: "unknown",
        description: "",
        peerDependencies: {},
        dependencies: {},
        weeklyDownloads: 0,
        error: `Registry returned ${metaRes.status} for ${packageName}`,
      };
    }

    const meta: NpmRegistryResponse = await metaRes.json();
    let weeklyDownloads = 0;

    if (dlRes.ok) {
      const dlData: NpmDownloadsResponse = await dlRes.json();
      weeklyDownloads = dlData.downloads ?? 0;
    }

    return {
      name: meta.name ?? packageName,
      version: meta.version ?? "unknown",
      description: meta.description ?? "",
      peerDependencies: meta.peerDependencies ?? {},
      dependencies: meta.dependencies ?? {},
      weeklyDownloads,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: packageName,
      version: "unknown",
      description: "",
      peerDependencies: {},
      dependencies: {},
      weeklyDownloads: 0,
      error: `Failed to fetch ${packageName}: ${message}`,
    };
  }
}

/**
 * Fetch metadata for multiple packages in parallel.
 * Never throws — individual failures are captured in each PackageInfo.error field.
 */
export async function fetchAllPackages(
  packageNames: string[]
): Promise<PackageInfo[]> {
  const unique = [...new Set(packageNames)];
  return Promise.all(unique.map(fetchPackageInfo));
}
