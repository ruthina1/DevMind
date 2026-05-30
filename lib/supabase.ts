/**
 * Supabase Client
 *
 * Configures the Supabase client for persisting recommendation history
 * and developer style profiles.
 *
 * Falls back gracefully when credentials are not provided —
 * the app works fully without a database connection.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RecommendationRecord {
  id?: string;
  created_at?: string;
  raw_prompt: string;
  intent_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
}

export interface StyleProfile {
  id?: string;
  created_at?: string;
  updated_at?: string;
  device_id: string;
  profile_json: Record<string, unknown> | null;
}

// ── Client ───────────────────────────────────────────────────────────────────

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || url.includes("your-project")) {
    // Supabase not configured — return null to trigger fallback
    return null;
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Save a recommendation record. Returns the saved record or null if DB is unavailable.
 */
export async function saveRecommendation(
  record: RecommendationRecord
): Promise<RecommendationRecord | null> {
  const db = getSupabase();
  if (!db) {
    console.log("[DevMind] Supabase not configured — skipping save.");
    return null;
  }

  const { data, error } = await db
    .from("recommendations")
    .insert({
      raw_prompt: record.raw_prompt,
      intent_json: record.intent_json,
      result_json: record.result_json,
    })
    .select()
    .single();

  if (error) {
    console.error("[DevMind] Failed to save recommendation:", error.message);
    return null;
  }

  return data as RecommendationRecord;
}

/**
 * Fetch recent recommendations, newest first. Returns empty array if DB is unavailable.
 */
export async function getRecentRecommendations(
  limit: number = 20
): Promise<RecommendationRecord[]> {
  const db = getSupabase();
  if (!db) return [];

  const { data, error } = await db
    .from("recommendations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[DevMind] Failed to fetch recommendations:", error.message);
    return [];
  }

  return (data ?? []) as RecommendationRecord[];
}

/**
 * Upsert a developer style profile. Returns the saved profile or null.
 */
export async function upsertStyleProfile(
  deviceId: string,
  profileJson: Record<string, unknown>
): Promise<StyleProfile | null> {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from("style_profiles")
    .upsert(
      {
        device_id: deviceId,
        profile_json: profileJson,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("[DevMind] Failed to upsert style profile:", error.message);
    return null;
  }

  return data as StyleProfile;
}

/**
 * Get a developer style profile by device ID. Returns null if not found or DB unavailable.
 */
export async function getStyleProfile(
  deviceId: string
): Promise<StyleProfile | null> {
  const db = getSupabase();
  if (!db) return null;

  const { data, error } = await db
    .from("style_profiles")
    .select("*")
    .eq("device_id", deviceId)
    .single();

  if (error) {
    return null;
  }

  return data as StyleProfile;
}

/**
 * Check if Supabase is configured and reachable.
 */
export function isSupabaseConfigured(): boolean {
  return getSupabase() !== null;
}
