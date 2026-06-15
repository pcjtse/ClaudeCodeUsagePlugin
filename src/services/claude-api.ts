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

function formatTimeLeft(date: Date): string {
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
      url,
    ],
    { timeout: 20_000 }
  );
  return stdout;
}

export async function fetchUsage(): Promise<UsageDisplay> {
  const empty: UsageDisplay = { session: null, weekly: null, weeklySonnet: null };
  if (!credentialsExist()) return empty;

  const token = readAccessToken();
  const body = await curlGet("https://claude.ai/api/oauth/usage", token);

  if (!body.trim()) throw new Error("Empty response from usage API");

  let raw: RawUsageResponse;
  try {
    raw = JSON.parse(body) as RawUsageResponse;
  } catch {
    throw new Error(`Unexpected response: ${body.slice(0, 80)}`);
  }

  const maybeErr = raw as Record<string, unknown>;
  if (maybeErr.error || maybeErr.type === "error") {
    throw new Error("Token expired — open Claude Code to refresh");
  }

  return {
    session: toDisplay(raw.five_hour),
    weekly: toDisplay(raw.seven_day),
    weeklySonnet: toDisplay(raw.seven_day_sonnet),
  };
}
