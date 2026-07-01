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

type Mode = "session" | "weekly";
type Provider = "claudecode" | "minimax";

interface ResetDialSettings extends JsonObject {
  mode?: Mode;
  provider?: Provider;
  minimaxApiKey?: string;
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
  private cachedClaude: UsageDisplay | null = null;
  private cachedMinimax: UsageDisplay | null = null;
  private claudeError: string | null = null;
  private minimaxError: string | null = null;
  private settingsCache = new Map<string, ResetDialSettings>();

  override async onWillAppear(ev: WillAppearEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;

    const s = ev.payload.settings.mode
      ? ev.payload.settings
      : { ...ev.payload.settings, mode: "session" as Mode };

    if (!ev.payload.settings.mode) {
      await ev.action.setSettings(s);
    }
    this.settingsCache.set(ev.action.id, s);

    if (!this.pollTimer) {
      await this.refresh();
      this.pollTimer = setInterval(() => void this.refresh(), 30_000);
    } else {
      const { cached, error } = this.providerData(s.provider);
      await this.renderDial(ev.action, s.mode ?? "session", cached, error);
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const s = ev.payload.settings;
    this.settingsCache.set(ev.action.id, s);
    const { cached, error } = this.providerData(s.provider);
    await this.renderDial(ev.action, s.mode ?? "session", cached, error);
    void this.refresh();
  }

  override async onDialRotate(ev: DialRotateEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const s = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
    const next: Mode = (s.mode ?? "session") === "session" ? "weekly" : "session";
    const updated = { ...s, mode: next };
    this.settingsCache.set(ev.action.id, updated);
    await ev.action.setSettings(updated);
    const { cached, error } = this.providerData(s.provider);
    await this.renderDial(ev.action, next, cached, error);
  }

  override async onDialDown(_ev: DialDownEvent<ResetDialSettings>): Promise<void> {
    await this.refresh();
  }

  override async onTouchTap(ev: TouchTapEvent<ResetDialSettings>): Promise<void> {
    if (!ev.action.isDial()) return;
    const s = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
    const next: Mode = (s.mode ?? "session") === "session" ? "weekly" : "session";
    const updated = { ...s, mode: next };
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
    if (this.settingsCache.size === 0) needsClaude = true;

    if (needsClaude) {
      try { this.cachedClaude = await fetchUsage(); this.claudeError = null; }
      catch (err) { this.claudeError = err instanceof Error ? err.message : String(err); streamDeck.logger.error(`[ResetDial] claude: ${this.claudeError}`); }
    }
    if (minimaxKey) {
      try { this.cachedMinimax = await fetchMinimaxUsage(minimaxKey); this.minimaxError = null; }
      catch (err) { this.minimaxError = err instanceof Error ? err.message : String(err); streamDeck.logger.error(`[ResetDial] minimax: ${this.minimaxError}`); }
    }

    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (!act.isDial()) continue;
      const s = this.settingsCache.get(act.id) ?? {};
      const { cached, error } = this.providerData((s as ResetDialSettings).provider);
      await this.renderDial(act, (s as ResetDialSettings).mode ?? "session", cached, error);
    }
  }

  private async renderDial(act: DialAction<ResetDialSettings>, mode: Mode, cached: UsageDisplay | null, error: string | null): Promise<void> {
    if (error) {
      await act.setFeedback({
        title: mode === "session" ? "5h Reset" : "7d Reset",
        value: "—",
        bar: { value: 0, bar_fill_c: "#FF3B30", bar_bg_c: "#2C2C2E" },
        subtitle: "Error: check credentials",
      });
      return;
    }

    if (!cached) {
      await act.setFeedback({
        title: mode === "session" ? "5h Reset" : "7d Reset",
        value: "...",
        bar: { value: 0, bar_fill_c: "#48484A", bar_bg_c: "#2C2C2E" },
        subtitle: "Loading...",
      });
      return;
    }

    if (mode === "session") {
      const sess = cached.session;
      const week = cached.weekly;
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
      const week = cached.weekly;
      const sess = cached.session;
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
