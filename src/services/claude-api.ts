import { execFile } from "child_process";
import { promisify } from "util";
import { readAccessToken, credentialsExist } from "./credentials.js";

const execFileAsync = promisify(execFile);

interface RawLimit {
  utilization: number; // 0–100 percentage
  resets_at: string;   // ISO date string
}

interface RawUsageResponse {
  five_hour?: RawLimit;
  seven_day?: RawLimit;
  seven_day_sonnet?: RawLimit;
  seven_day_opus?: RawLimit;
}

export interface LimitDisplay {
  pct: number;
  resetsIn: string;
  resetsAt: Date;
}

export interface UsageDisplay {
  session: LimitDisplay | null;
  weekly: LimitDisplay | null;
  weeklySonnet: LimitDisplay | null;
}

export function formatTimeLeft(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const s = Math.floor(diffMs / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function toDisplay(raw: RawLimit | undefined): LimitDisplay | null {
  if (!raw) return null;
  const pct = Math.round(raw.utilization);
  const resetsAt = new Date(raw.resets_at);
  return { pct, resetsIn: formatTimeLeft(resetsAt), resetsAt };
}

// Use system curl instead of Node's https/fetch so we:
//  1. Get the system DNS resolver (no c-ares ENOTFOUND issues)
//  2. Match the TLS fingerprint that Cloudflare accepts
//  3. Use Claude Code's own headers to pass authentication checks
async function curlGet(url: string, token: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s",            // silent
      "-m", "15",      // max 15s
      "--compressed",  // accept gzip
      "-H", `Authorization: Bearer ${token}`,
      "-H", "Content-Type: application/json",
      "-H", "User-Agent: claude-cli/2.1.165",
      "-H", "x-app: cli",
      "-H", "anthropic-client-platform: cli",
      "-H", "anthropic-beta: oauth-2025-04-20",
      url,
    ],
    { timeout: 20_000 }
  );
  return stdout;
}

// The usage endpoint rate-limits aggressively, so every action shares one cached
// result and we hit the API at most once per FETCH_INTERVAL_MS.
const FETCH_INTERVAL_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

let lastRaw: RawUsageResponse | null = null;
let nextFetchAt = 0;
let backoffMs = FETCH_INTERVAL_MS;
let inFlight: Promise<RawUsageResponse> | null = null;

function toUsageDisplay(raw: RawUsageResponse): UsageDisplay {
  return {
    session: toDisplay(raw.five_hour),
    weekly: toDisplay(raw.seven_day),
    weeklySonnet: toDisplay(raw.seven_day_sonnet),
  };
}

async function requestUsage(): Promise<RawUsageResponse> {
  const token = readAccessToken();
  const body = await curlGet("https://api.anthropic.com/api/oauth/usage", token);

  if (!body.trim()) throw new Error("Empty response from usage API");

  let raw: RawUsageResponse;
  try {
    raw = JSON.parse(body) as RawUsageResponse;
  } catch {
    throw new Error(`Unexpected response: ${body.slice(0, 80)}`);
  }

  const maybeErr = raw as { error?: { type?: string; message?: string }; type?: string };
  if (maybeErr.error || maybeErr.type === "error") {
    const type = maybeErr.error?.type ?? "";
    if (type === "rate_limit_error") throw new RateLimitError();
    if (type === "authentication_error" || type === "permission_error") {
      throw new Error("Token expired — open Claude Code to refresh");
    }
    throw new Error(maybeErr.error?.message ?? `API error: ${type || "unknown"}`);
  }
  return raw;
}

class RateLimitError extends Error {
  constructor() {
    super("Rate limited — retrying later");
  }
}

export async function fetchUsage(): Promise<UsageDisplay> {
  const empty: UsageDisplay = { session: null, weekly: null, weeklySonnet: null };
  if (!credentialsExist()) return empty;

  if (Date.now() < nextFetchAt) {
    if (lastRaw) return toUsageDisplay(lastRaw);
    throw new Error("Rate limited — retrying later");
  }

  // Several actions refresh on the same tick; share one request between them
  if (!inFlight) {
    inFlight = requestUsage().finally(() => { inFlight = null; });
    inFlight.then(
      () => { backoffMs = FETCH_INTERVAL_MS; nextFetchAt = Date.now() + FETCH_INTERVAL_MS; },
      (err) => {
        if (err instanceof RateLimitError) {
          nextFetchAt = Date.now() + backoffMs;
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        }
      }
    );
  }

  try {
    lastRaw = await inFlight;
  } catch (err) {
    // Keep showing the last good numbers through a rate limit
    if (err instanceof RateLimitError && lastRaw) return toUsageDisplay(lastRaw);
    throw err;
  }
  return toUsageDisplay(lastRaw);
}
