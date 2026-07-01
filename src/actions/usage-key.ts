import streamDeck, {
  action,
  SingletonAction,
  WillAppearEvent,
  KeyDownEvent,
  KeyAction,
  DidReceiveSettingsEvent,
  type JsonObject,
} from "@elgato/streamdeck";
import { fetchUsage, UsageDisplay } from "../services/claude-api.js";
import { fetchMinimaxUsage } from "../services/minimax-api.js";

type View = "session" | "weekly";
type Provider = "claudecode" | "minimax";

interface KeySettings extends JsonObject {
  view?: View;
  provider?: Provider;
  minimaxApiKey?: string;
}

function barColor(pct: number): string {
  if (pct >= 90) return "#FF3B30";
  if (pct >= 70) return "#FF9500";
  return "#30D158";
}

function buildKeyImage(view: View, cached: UsageDisplay | null, error: string | null): string {
  const title = view === "session" ? "5h Session" : "7d Weekly";
  let pct = 0;
  let pctText = "—";
  let subtitle = "";
  let color = "#48484A";

  if (error) {
    pctText = "ERR";
    subtitle = "check creds";
    color = "#FF3B30";
  } else if (!cached) {
    pctText = "...";
    subtitle = "loading";
  } else if (view === "session") {
    const sess = cached.session;
    const week = cached.weekly;
    if (sess) {
      pct = sess.pct;
      pctText = `${pct}%`;
      color = barColor(pct);
      subtitle = week ? `↺${sess.resetsIn} · 7d:${week.pct}%` : `↺${sess.resetsIn}`;
    } else {
      subtitle = week ? `7d: ${week.pct}%` : "no data";
    }
  } else {
    const week = cached.weekly;
    const sess = cached.session;
    if (week) {
      pct = week.pct;
      pctText = `${pct}%`;
      color = barColor(pct);
      subtitle = sess ? `↺${week.resetsIn} · 5h:${sess.pct}%` : `↺${week.resetsIn}`;
    } else {
      subtitle = sess ? `5h: ${sess.pct}%` : "no data";
    }
  }

  const barW = Math.round((pct / 100) * 120);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="14" fill="#0D1117"/>
  <text x="72" y="24" font-family="Arial,sans-serif" font-size="16" font-weight="600" fill="#8E8E93" text-anchor="middle">${title}</text>
  <text x="72" y="80" font-family="Arial,sans-serif" font-size="50" font-weight="700" fill="${color}" text-anchor="middle">${pctText}</text>
  <rect x="12" y="95" width="120" height="7" rx="3.5" fill="#2C2C2E"/>
  <rect x="12" y="95" width="${barW}" height="7" rx="3.5" fill="${color}"/>
  <text x="72" y="126" font-family="Arial,sans-serif" font-size="13" fill="#8E8E93" text-anchor="middle">${subtitle}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

@action({ UUID: "com.pcjtse.claudeusage.key" })
export class UsageKey extends SingletonAction<KeySettings> {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private cachedClaude: UsageDisplay | null = null;
  private cachedMinimax: UsageDisplay | null = null;
  private claudeError: string | null = null;
  private minimaxError: string | null = null;
  private settingsCache = new Map<string, KeySettings>();

  override async onWillAppear(ev: WillAppearEvent<KeySettings>): Promise<void> {
    streamDeck.logger.info(`[ClaudeUsage Key] onWillAppear isKey=${ev.action.isKey()}`);
    if (!ev.action.isKey()) return;

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
      await this.renderKey(ev.action, s.view ?? "session", cached, error);
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<KeySettings>): Promise<void> {
    if (!ev.action.isKey()) return;
    const s = ev.payload.settings;
    this.settingsCache.set(ev.action.id, s);
    const { cached, error } = this.providerData(s.provider);
    await this.renderKey(ev.action, s.view ?? "session", cached, error);
    void this.refresh();
  }

  override async onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
    const s = this.settingsCache.get(ev.action.id) ?? ev.payload.settings;
    const next: View = (s.view ?? "session") === "session" ? "weekly" : "session";
    const updated = { ...s, view: next };
    this.settingsCache.set(ev.action.id, updated);
    await ev.action.setSettings(updated);
    const { cached, error } = this.providerData(s.provider);
    await this.renderKey(ev.action, next, cached, error);
  }

  private providerData(provider: Provider | undefined): { cached: UsageDisplay | null; error: string | null } {
    if (provider === "minimax") return { cached: this.cachedMinimax, error: this.minimaxError };
    return { cached: this.cachedClaude, error: this.claudeError };
  }

  private async refresh(): Promise<void> {
    streamDeck.logger.info("[ClaudeUsage Key] refresh start");
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
      catch (err) { this.claudeError = err instanceof Error ? err.message : String(err); streamDeck.logger.error(`[UsageKey] claude: ${this.claudeError}`); }
    }
    if (minimaxKey) {
      try { this.cachedMinimax = await fetchMinimaxUsage(minimaxKey); this.minimaxError = null; }
      catch (err) { this.minimaxError = err instanceof Error ? err.message : String(err); streamDeck.logger.error(`[UsageKey] minimax: ${this.minimaxError}`); }
    }

    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (!act.isKey()) continue;
      const s = this.settingsCache.get(act.id) ?? {};
      const { cached, error } = this.providerData((s as KeySettings).provider);
      await this.renderKey(act, (s as KeySettings).view ?? "session", cached, error);
    }
  }

  private async renderKey(act: KeyAction<KeySettings>, view: View, cached: UsageDisplay | null, error: string | null): Promise<void> {
    try {
      await act.setImage(buildKeyImage(view, cached, error));
    } catch (err) {
      streamDeck.logger.error(`[ClaudeUsage Key] setImage error: ${err}`);
    }
  }
}
