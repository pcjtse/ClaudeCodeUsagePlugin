import { execFile } from "child_process";
import { promisify } from "util";
import { LimitDisplay, UsageDisplay, formatTimeLeft } from "./claude-api.js";

const execFileAsync = promisify(execFile);

const MINIMAX_URL = "https://api.minimax.io/v1/api/openplatform/coding_plan/remains";

interface MinimaxModelEntry {
  model_name: string;
  end_time: number;                          // 5h interval end, Unix ms
  weekly_end_time: number;                   // weekly end, Unix ms
  current_interval_remaining_percent: number; // 0–100 remaining → usage = 100 - this
  current_weekly_remaining_percent: number;   // 0–100 remaining → usage = 100 - this
}

interface MinimaxRawResponse {
  base_resp?: { status_code: number; status_msg: string };
  model_remains?: MinimaxModelEntry[];
}

function toDisplay(remainingPct: number, resetMs: number): LimitDisplay {
  const pct = Math.round(100 - remainingPct);
  const resetsAt = new Date(resetMs);
  return { pct, resetsIn: formatTimeLeft(resetsAt), resetsAt };
}

export async function fetchMinimaxUsage(apiKey: string): Promise<UsageDisplay> {
  const empty: UsageDisplay = { session: null, weekly: null, weeklySonnet: null };
  if (!apiKey) return empty;

  const { stdout } = await execFileAsync(
    "curl",
    ["-s", "-m", "15", "--compressed",
      "-H", `Authorization: Bearer ${apiKey}`,
      "-H", "Content-Type: application/json",
      MINIMAX_URL],
    { timeout: 20_000 }
  );

  if (!stdout.trim()) throw new Error("Empty response from Minimax API");

  let raw: MinimaxRawResponse;
  try {
    raw = JSON.parse(stdout) as MinimaxRawResponse;
  } catch {
    throw new Error(`Unexpected Minimax response: ${stdout.slice(0, 80)}`);
  }

  if (raw.base_resp && raw.base_resp.status_code !== 0) {
    throw new Error(`Minimax API error: ${raw.base_resp.status_msg}`);
  }

  const entry = raw.model_remains?.find(m => m.model_name === "general");
  if (!entry) return empty;

  return {
    session: toDisplay(entry.current_interval_remaining_percent, entry.end_time),
    weekly: toDisplay(entry.current_weekly_remaining_percent, entry.weekly_end_time),
    weeklySonnet: null,
  };
}
