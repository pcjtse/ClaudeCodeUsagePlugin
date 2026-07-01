import streamDeck, {
  action,
  SingletonAction,
  WillAppearEvent,
  DialRotateEvent,
  DialDownEvent,
  TouchTapEvent,
  DialAction,
  DidReceiveSettingsEvent,
  type JsonObject,
} from "@elgato/streamdeck";
import { fetchUsage, UsageDisplay } from "../services/claude-api.js";
import { fetchMinimaxUsage } from "../services/minimax-api.js";

type View = "session" | "weekly";
type Provider = "claudecode" | "minimax";

interface Settings extends JsonObject {
  view?: View;
  provider?: Provider;
  minimaxApiKey?: string;
}

function barColor(pct: number): string {
  if (pct >= 90) return "#FF3B30";
  if (pct >= 70) return "#FF9500";
  return "#30D158";
}

@action({ UUID: "com.pcjtse.claudeusage.usage" })
export class UsageDial extends SingletonAction<Settings> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cachedClaude: UsageDisplay | null = null;
  private cachedMinimax: UsageDisplay | null = null;
  private claudeError: string | null = null;
  private minimaxError: string | null = null;
  // Local settings cache — avoids calling getSettings() which fires didReceiveSettings
  // and creates an infinite loop when onDidReceiveSettings also triggers refresh().
  private settingsCache = new Map<string, Settings>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;

    const s = ev.payload.settings.view
      ? ev.payload.settings
      : { ...ev.payload.settings, view: "session" as View };

    if (!ev.payload.settings.view) {
      await ev.action.setSettings(s);
    }
    this.settingsCache.set(ev.action.id, s);

    if (!this.pollTimer) {
      await this.refresh();
      this.pollTimer = setInterval(() => void this.refresh(), 30_000);
    } else {
      const { cached, error } = this.providerData(s.provider);
      await this.renderDial(ev.action, s.view ?? "session", cached, error);
    }
  }

  // Re-render immediately when PI changes settings, then refresh so a newly
  // configured provider fetches data right away instead of waiting up to 30s.
  // Safe to call refresh() here because refresh() no longer calls getSettings(),
  // so there is no didReceiveSettings → refresh() → getSettings() → didReceiveSettings loop.
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const s = ev.payload.settings;
    this.settingsCache.set(ev.action.id, s);
    const { cached, error } = this.providerData(s.provider);
    await this.renderDial(ev.action, s.view ?? "session", cached, error);
    void this.refresh();
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const s = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
    const next: View = (s.view ?? "session") === "session" ? "weekly" : "session";
    const updated = { ...s, view: next };
    this.settingsCache.set(ev.action.id, updated);
    await ev.action.setSettings(updated);
    const { cached, error } = this.providerData(s.provider);
    await this.renderDial(ev.action, next, cached, error);
  }

  override async onDialDown(_ev: DialDownEvent<Settings>): Promise<void> {
    await this.refresh();
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const s = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
    const next: View = (s.view ?? "session") === "session" ? "weekly" : "session";
    const updated = { ...s, view: next };
    this.settingsCache.set(ev.action.id, updated);
    await ev.action.setSettings(updated);
    const { cached, error } = this.providerData(s.provider);
    await this.renderDial(ev.action, next, cached, error);
  }

  private providerData(provider: Provider | undefined): { cached: UsageDisplay | null; error: string | null } {
    if (provider === "minimax") return { cached: this.cachedMinimax, error: this.minimaxError };
    return { cached: this.cachedClaude, error: this.claudeError };
  }

  private async refresh(): Promise<void> {
    let needsClaude = false;
    let minimaxKey: string | undefined;

    for (const s of this.settingsCache.values()) {
      if (s.provider === "minimax") {
        minimaxKey = s.minimaxApiKey;
      } else {
        needsClaude = true;
      }
    }
    // Default to Claude when no buttons have appeared yet
    if (this.settingsCache.size === 0) needsClaude = true;

    if (needsClaude) {
      try { this.cachedClaude = await fetchUsage(); this.claudeError = null; }
      catch (err) { this.claudeError = err instanceof Error ? err.message : String(err); streamDeck.logger.error(`[UsageDial] claude: ${this.claudeError}`); }
    }
    if (minimaxKey) {
      try { this.cachedMinimax = await fetchMinimaxUsage(minimaxKey); this.minimaxError = null; }
      catch (err) { this.minimaxError = err instanceof Error ? err.message : String(err); streamDeck.logger.error(`[UsageDial] minimax: ${this.minimaxError}`); }
    }

    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (!act.isDial()) continue;
      const s = this.settingsCache.get(act.id) ?? {};
      const { cached, error } = this.providerData((s as Settings).provider);
      await this.renderDial(act, (s as Settings).view ?? "session", cached, error);
    }
  }

  private async renderDial(act: DialAction<Settings>, view: View, cached: UsageDisplay | null, error: string | null): Promise<void> {
    if (error) {
      await act.setFeedback({
        title: view === "session" ? "5h Session" : "7d Weekly",
        value: "—",
        bar: { value: 0, bar_fill_c: "#FF3B30", bar_bg_c: "#2C2C2E" },
        subtitle: "Error: check credentials",
      });
      return;
    }

    if (!cached) {
      await act.setFeedback({
        title: view === "session" ? "5h Session" : "7d Weekly",
        value: "...",
        bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
        subtitle: "Loading...",
      });
      return;
    }

    const sess = cached.session;
    const week = cached.weekly;

    if (view === "session") {
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
      const sessLabel = sess ? `  5h: ${sess.pct}%` : "";
      const son = cached.weeklySonnet;
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
