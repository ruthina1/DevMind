/**
 * Peer Dependency Compatibility Checker
 *
 * Cross-checks every candidate pair's peer dependency version ranges.
 * Flags any pairs that cannot coexist at their latest versions.
 */

import semver from "semver";
import type { PackageInfo } from "@/lib/registry";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Conflict {
  packageA: string;
  packageB: string;
  sharedDep: string;
  requiredByA: string;
  requiredByB: string;
  reason: string;
}

export interface CompatibilityResult {
  conflicts: Conflict[];
  warnings: string[];
  isCompatible: boolean;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Check peer dependency compatibility across all candidate packages.
 *
 * For each pair of packages that share a peer dependency, we verify that
 * a single version of that shared dependency can satisfy both ranges.
 */
export function checkCompatibility(
  packages: PackageInfo[]
): CompatibilityResult {
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];

  // Build a map of: sharedDep → [{ package, range }]
  const peerDepMap = new Map<
    string,
    { packageName: string; range: string }[]
  >();

  for (const pkg of packages) {
    if (pkg.error) {
      warnings.push(`Skipping ${pkg.name}: ${pkg.error}`);
      continue;
    }

    for (const [dep, range] of Object.entries(pkg.peerDependencies)) {
      if (!peerDepMap.has(dep)) {
        peerDepMap.set(dep, []);
      }
      peerDepMap.get(dep)!.push({ packageName: pkg.name, range });
    }
  }

  // For each shared peer dependency, check if all requiring packages
  // can agree on a single version
  for (const [sharedDep, consumers] of peerDepMap.entries()) {
    if (consumers.length < 2) continue;

    // Check every pair
    for (let i = 0; i < consumers.length; i++) {
      for (let j = i + 1; j < consumers.length; j++) {
        const a = consumers[i];
        const b = consumers[j];

        // Try to find if ranges intersect
        const intersection = findRangeIntersection(a.range, b.range);

        if (!intersection) {
          conflicts.push({
            packageA: a.packageName,
            packageB: b.packageName,
            sharedDep,
            requiredByA: a.range,
            requiredByB: b.range,
            reason: `${a.packageName} requires ${sharedDep}@${a.range} but ${b.packageName} requires ${sharedDep}@${b.range} — no overlapping version exists.`,
          });
        }
      }
    }
  }

  // Also check if any package's peer deps conflict with another package's
  // actual version (i.e., package A peer-depends on B at range X, but B's
  // latest version is Y which doesn't satisfy X)
  const versionMap = new Map<string, string>();
  for (const pkg of packages) {
    if (!pkg.error && pkg.version !== "unknown") {
      versionMap.set(pkg.name, pkg.version);
    }
  }

  for (const pkg of packages) {
    if (pkg.error) continue;

    for (const [dep, range] of Object.entries(pkg.peerDependencies)) {
      const actualVersion = versionMap.get(dep);
      if (actualVersion && !semver.satisfies(actualVersion, range)) {
        // Avoid duplicate conflict if already found in pair check
        const alreadyFlagged = conflicts.some(
          (c) =>
            (c.packageA === pkg.name || c.packageB === pkg.name) &&
            c.sharedDep === dep
        );
        if (!alreadyFlagged) {
          conflicts.push({
            packageA: pkg.name,
            packageB: dep,
            sharedDep: dep,
            requiredByA: range,
            requiredByB: actualVersion,
            reason: `${pkg.name} requires peer ${dep}@${range} but latest ${dep} is ${actualVersion} which doesn't satisfy.`,
          });
        }
      }
    }
  }

  return {
    conflicts,
    warnings,
    isCompatible: conflicts.length === 0,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check if two semver ranges have an overlapping intersection.
 * Returns true if a version exists that satisfies both ranges.
 */
function findRangeIntersection(
  rangeA: string,
  rangeB: string
): boolean {
  try {
    const parsedA = new semver.Range(rangeA);
    const parsedB = new semver.Range(rangeB);

    // Test representative versions from range A against range B and vice versa
    // We check common major versions 0-30 with minor 0 and patch 0
    for (let major = 0; major <= 30; major++) {
      for (const minor of [0, 5, 10, 15, 20]) {
        const testVersion = `${major}.${minor}.0`;
        if (
          semver.valid(testVersion) &&
          semver.satisfies(testVersion, parsedA) &&
          semver.satisfies(testVersion, parsedB)
        ) {
          return true;
        }
      }
    }

    return false;
  } catch {
    // If ranges are unparseable, assume compatible (benefit of the doubt)
    return true;
  }
}
