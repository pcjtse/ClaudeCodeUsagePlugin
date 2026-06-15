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

type View = "session" | "weekly";

interface Settings extends JsonObject {
  view?: "session" | "weekly";
}

function barColor(pct: number): string {
  if (pct >= 90) return "#FF3B30";
  if (pct >= 70) return "#FF9500";
  return "#30D158";
}

@action({ UUID: "com.pcjtse.claudeusage.usage" })
export class UsageDial extends SingletonAction<Settings> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cached: UsageDisplay | null = null;
  private lastError: string | null = null;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;

    // Default to session view
    if (!ev.payload.settings.view) {
      await ev.action.setSettings({ view: "session" });
    }

    if (!this.pollTimer) {
      await this.refresh();
      this.pollTimer = setInterval(() => void this.refresh(), 30_000);
    } else {
      await this.renderDial(ev.action, ev.payload.settings.view ?? "session");
    }
  }

  // Rotate → toggle session ↔ weekly
  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const current = ev.payload.settings.view ?? "session";
    const next: View = current === "session" ? "weekly" : "session";
    await ev.action.setSettings({ view: next });
    await this.renderDial(ev.action, next);
  }

  // Press dial → force refresh
  override async onDialDown(_ev: DialDownEvent<Settings>): Promise<void> {
    await this.refresh();
  }

  // Tap touchscreen → toggle view
  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const current = ev.payload.settings.view ?? "session";
    const next: View = current === "session" ? "weekly" : "session";
    await ev.action.setSettings({ view: next });
    await this.renderDial(ev.action, next);
  }

  private async refresh(): Promise<void> {
    try {
      this.cached = await fetchUsage();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`[ClaudeUsage] ${this.lastError}`);
    }
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (act.isDial()) {
        const settings = await act.getSettings<Settings>();
        await this.renderDial(act, settings.view ?? "session");
      }
    }
  }

  private async renderDial(act: DialAction<Settings>, view: View): Promise<void> {
    if (this.lastError) {
      await act.setFeedback({
        title: view === "session" ? "5h Session" : "7d Weekly",
        value: "—",
        bar: { value: 0, bar_fill_c: "#FF3B30", bar_bg_c: "#2C2C2E" },
        subtitle: "Error: check credentials",
      });
      return;
    }

    if (!this.cached) {
      await act.setFeedback({
        title: view === "session" ? "5h Session" : "7d Weekly",
        value: "...",
        bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
        subtitle: "Loading...",
      });
      return;
    }

    const sess = this.cached.session;
    const week = this.cached.weekly;

    if (view === "session") {
      // Primary: session %. Secondary: weekly % in subtitle
      const weekLabel = week ? `  7d: ${week.pct}%` : "";
      await act.setFeedback(
        sess
          ? {
              title: "5h Session",
              value: `${sess.pct}%`,
              bar: { value: sess.pct, bar_fill_c: barColor(sess.pct), bar_bg_c: "#2C2C2E" },
              subtitle: `Resets ${sess.resetsIn}${weekLabel}`,
            }
          : {
              title: "5h Session",
              value: "—",
              bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
              subtitle: week ? `7d: ${week.pct}%` : "No data",
            }
      );
    } else {
      // Primary: weekly %. Secondary: session % in subtitle
      const sessLabel = sess ? `  5h: ${sess.pct}%` : "";
      const son = this.cached.weeklySonnet;
      const subtitle = week
        ? son
          ? `Son:${son.pct}% · Resets ${week.resetsIn}`
          : `Resets ${week.resetsIn}${sessLabel}`
        : sess
          ? `5h: ${sess.pct}%`
          : "No data";

      await act.setFeedback(
        week
          ? {
              title: "7d Weekly",
              value: `${week.pct}%`,
              bar: { value: week.pct, bar_fill_c: barColor(week.pct), bar_bg_c: "#2C2C2E" },
              subtitle,
            }
          : {
              title: "7d Weekly",
              value: "—",
              bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
              subtitle,
            }
      );
    }
  }
}
