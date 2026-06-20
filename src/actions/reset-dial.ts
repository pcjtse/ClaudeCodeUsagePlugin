import streamDeck, {
  action,
  SingletonAction,
  WillAppearEvent,
  DialRotateEvent,
  DialDownEvent,
  TouchTapEvent,
  DialAction,
  type JsonObject,
} from "@elgato/streamdeck";
import { fetchUsage, UsageDisplay } from "../services/claude-api.js";

type Mode = "session" | "weekly";

interface ResetDialSettings extends JsonObject {
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

function timeBarColor(totalSeconds: number, isSession: boolean): string {
  if (isSession) {
    if (totalSeconds < 3600) return "#FF3B30";
    if (totalSeconds < 7200) return "#FF9500";
    return "#30D158";
  } else {
    if (totalSeconds < 86400) return "#FF3B30";
    if (totalSeconds < 172800) return "#FF9500";
    return "#0A84FF";
  }
}

@action({ UUID: "com.pcjtse.claudeusage.resetdial" })
export class ResetDial extends SingletonAction<ResetDialSettings> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cached: UsageDisplay | null = null;
  private lastError: string | null = null;

  override async onWillAppear(ev: WillAppearEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    if (!ev.payload.settings.mode) {
      await ev.action.setSettings({ mode: "session" });
    }
    if (!this.pollTimer) {
      await this.refresh();
      this.pollTimer = setInterval(() => void this.refresh(), 30_000);
    } else {
      await this.renderDial(ev.action, ev.payload.settings.mode ?? "session");
    }
  }

  override async onDialRotate(ev: DialRotateEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const current = ev.payload.settings.mode ?? "session";
    const next: Mode = current === "session" ? "weekly" : "session";
    await ev.action.setSettings({ mode: next });
    await this.renderDial(ev.action, next);
  }

  override async onDialDown(_ev: DialDownEvent<ResetDialSettings>): Promise<void> {
    await this.refresh();
  }

  override async onTouchTap(ev: TouchTapEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const current = ev.payload.settings.mode ?? "session";
    const next: Mode = current === "session" ? "weekly" : "session";
    await ev.action.setSettings({ mode: next });
    await this.renderDial(ev.action, next);
  }

  private async refresh(): Promise<void> {
    try {
      this.cached = await fetchUsage();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`[ClaudeUsage ResetDial] ${this.lastError}`);
    }
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (act.isDial()) {
        const settings = await act.getSettings<ResetDialSettings>();
        await this.renderDial(act, settings.mode ?? "session");
      }
    }
  }

  private async renderDial(act: DialAction<ResetDialSettings>, mode: Mode): Promise<void> {
    if (this.lastError) {
      await act.setFeedback({
        title: mode === "session" ? "5h Reset" : "7d Reset",
        value: "—",
        bar: { value: 0, bar_fill_c: "#FF3B30", bar_bg_c: "#2C2C2E" },
        subtitle: "Error: check credentials",
      });
      return;
    }

    if (!this.cached) {
      await act.setFeedback({
        title: mode === "session" ? "5h Reset" : "7d Reset",
        value: "...",
        bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
        subtitle: "Loading...",
      });
      return;
    }

    if (mode === "session") {
      const sess = this.cached.session;
      const week = this.cached.weekly;
      if (!sess) {
        await act.setFeedback({
          title: "5h Reset",
          value: "—",
          bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
          subtitle: week ? `7d resets ${week.resetsIn}` : "No data",
        });
        return;
      }
      const { hours, minutes, totalSeconds } = timeComponents(sess.resetsAt);
      const barValue = Math.round(Math.min(1, totalSeconds / (5 * 3600)) * 100);
      const color = timeBarColor(totalSeconds, true);
      const weekSuffix = week ? `  7d: ${week.resetsIn}` : "";
      await act.setFeedback({
        title: "5h Reset",
        value: `${hours}h ${minutes}m`,
        bar: { value: barValue, bar_fill_c: color, bar_bg_c: "#2C2C2E" },
        subtitle: `Time left${weekSuffix}`,
      });
    } else {
      const week = this.cached.weekly;
      const sess = this.cached.session;
      if (!week) {
        await act.setFeedback({
          title: "7d Reset",
          value: "—",
          bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
          subtitle: sess ? `5h resets ${sess.resetsIn}` : "No data",
        });
        return;
      }
      const { days, hours, totalSeconds } = timeComponents(week.resetsAt);
      const barValue = Math.round(Math.min(1, totalSeconds / (7 * 24 * 3600)) * 100);
      const color = timeBarColor(totalSeconds, false);
      const sessSuffix = sess ? `  5h: ${sess.resetsIn}` : "";
      await act.setFeedback({
        title: "7d Reset",
        value: `${days}d ${hours}h`,
        bar: { value: barValue, bar_fill_c: color, bar_bg_c: "#2C2C2E" },
        subtitle: `Time left${sessSuffix}`,
      });
    }
  }
}
