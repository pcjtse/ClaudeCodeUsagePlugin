import streamDeck, {
  action,
  SingletonAction,
  WillAppearEvent,
  KeyDownEvent,
  KeyAction,
  type JsonObject,
} from "@elgato/streamdeck";
import { fetchUsage, UsageDisplay } from "../services/claude-api.js";

type Mode = "session" | "weekly";

interface ResetSettings extends JsonObject {
  mode?: "session" | "weekly";
}

function timeComponents(resetsAt: Date): { days: number; hours: number; minutes: number; totalSeconds: number } {
  const diffMs = Math.max(0, resetsAt.getTime() - Date.now());
  const totalSeconds = Math.floor(diffMs / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    totalSeconds,
  };
}

function buildSvg(title: string, primary: string, secondary: string, fraction: number, color: string): string {
  const barW = Math.round(Math.min(1, fraction) * 120);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="14" fill="#0D1117"/>
  <text x="72" y="22" font-family="Arial,sans-serif" font-size="15" font-weight="600" fill="#8E8E93" text-anchor="middle">${title}</text>
  <text x="72" y="76" font-family="Arial,sans-serif" font-size="52" font-weight="700" fill="${color}" text-anchor="middle">${primary}</text>
  <text x="72" y="102" font-family="Arial,sans-serif" font-size="24" font-weight="600" fill="${color}" opacity="0.8" text-anchor="middle">${secondary}</text>
  <rect x="12" y="118" width="120" height="6" rx="3" fill="#2C2C2E"/>
  <rect x="12" y="118" width="${barW}" height="6" rx="3" fill="${color}"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function buildResetImage(mode: Mode, cached: UsageDisplay | null, error: string | null): string {
  if (error) {
    return buildSvg(mode === "session" ? "5h Reset" : "7d Reset", "ERR", "check creds", 0, "#FF3B30");
  }
  if (!cached) {
    return buildSvg(mode === "session" ? "5h Reset" : "7d Reset", "...", "loading", 0, "#48484A");
  }

  if (mode === "session") {
    const sess = cached.session;
    if (!sess) return buildSvg("5h Reset", "—", "no data", 0, "#48484A");
    const { hours, minutes, totalSeconds } = timeComponents(sess.resetsAt);
    const fraction = totalSeconds / (5 * 3600);
    const color = totalSeconds < 3600 ? "#FF3B30" : totalSeconds < 7200 ? "#FF9500" : "#30D158";
    return buildSvg("5h Reset", `${hours}h`, `${minutes}m`, fraction, color);
  } else {
    const week = cached.weekly;
    if (!week) return buildSvg("7d Reset", "—", "no data", 0, "#48484A");
    const { days, hours, totalSeconds } = timeComponents(week.resetsAt);
    const fraction = totalSeconds / (7 * 24 * 3600);
    const color = totalSeconds < 86400 ? "#FF3B30" : totalSeconds < 172800 ? "#FF9500" : "#0A84FF";
    return buildSvg("7d Reset", `${days}d`, `${hours}h`, fraction, color);
  }
}

@action({ UUID: "com.pcjtse.claudeusage.reset" })
export class ResetKey extends SingletonAction<ResetSettings> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cached: UsageDisplay | null = null;
  private lastError: string | null = null;

  override async onWillAppear(ev: WillAppearEvent<ResetSettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    if (!ev.payload.settings.mode) {
      await ev.action.setSettings({ mode: "session" });
    }
    if (!this.pollTimer) {
      await this.refresh();
      this.pollTimer = setInterval(() => void this.refresh(), 30_000);
    } else {
      await this.renderKey(ev.action, ev.payload.settings.mode ?? "session");
    }
  }

  override async onKeyDown(ev: KeyDownEvent<ResetSettings>): Promise<void> {
    const current = ev.payload.settings.mode ?? "session";
    const next: Mode = current === "session" ? "weekly" : "session";
    await ev.action.setSettings({ mode: next });
    await this.renderKey(ev.action, next);
  }

  private async refresh(): Promise<void> {
    try {
      this.cached = await fetchUsage();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`[ClaudeUsage Reset] ${this.lastError}`);
    }
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (act.isKey()) {
        const settings = await act.getSettings<ResetSettings>();
        await this.renderKey(act, settings.mode ?? "session");
      }
    }
  }

  private async renderKey(act: KeyAction<ResetSettings>, mode: Mode): Promise<void> {
    try {
      await act.setImage(buildResetImage(mode, this.cached, this.lastError));
    } catch (err) {
      streamDeck.logger.error(`[ClaudeUsage Reset] setImage error: ${err}`);
    }
  }
}
