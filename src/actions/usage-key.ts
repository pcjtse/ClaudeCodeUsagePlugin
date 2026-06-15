import streamDeck, {
  action,
  SingletonAction,
  WillAppearEvent,
  KeyDownEvent,
  KeyAction,
  type JsonObject,
} from "@elgato/streamdeck";
import { fetchUsage, UsageDisplay } from "../services/claude-api.js";

type View = "session" | "weekly";

interface KeySettings extends JsonObject {
  view?: "session" | "weekly";
}

function barColor(pct: number): string {
  if (pct >= 90) return "#FF3B30";
  if (pct >= 70) return "#FF9500";
  return "#30D158";
}

function buildKeyImage(view: View, cached: UsageDisplay | null, error: string | null): string {
  const title = view === "session" ? "5h Session" : "7d Weekly";
  let pct = 0;
  let pctText = "—"; // em dash
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
      subtitle = week
        ? `↺${sess.resetsIn} · 7d:${week.pct}%`
        : `↺${sess.resetsIn}`;
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
      subtitle = sess
        ? `↺${week.resetsIn} · 5h:${sess.pct}%`
        : `↺${week.resetsIn}`;
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
  private cached: UsageDisplay | null = null;
  private lastError: string | null = null;

  override async onWillAppear(ev: WillAppearEvent<KeySettings>): Promise<void> {
    streamDeck.logger.info(`[ClaudeUsage Key] onWillAppear isKey=${ev.action.isKey()}`);
    if (!ev.action.isKey()) return;
    if (!ev.payload.settings.view) {
      await ev.action.setSettings({ view: "session" });
    }
    if (!this.pollTimer) {
      await this.refresh();
      this.pollTimer = setInterval(() => void this.refresh(), 30_000);
    } else {
      await this.renderKey(ev.action, ev.payload.settings.view ?? "session");
    }
  }

  override async onKeyDown(ev: KeyDownEvent<KeySettings>): Promise<void> {
    const current = ev.payload.settings.view ?? "session";
    const next: View = current === "session" ? "weekly" : "session";
    await ev.action.setSettings({ view: next });
    await this.renderKey(ev.action, next);
  }

  private async refresh(): Promise<void> {
    streamDeck.logger.info("[ClaudeUsage Key] refresh start");
    try {
      this.cached = await fetchUsage();
      this.lastError = null;
      streamDeck.logger.info(`[ClaudeUsage Key] fetch ok sess=${this.cached.session?.pct} week=${this.cached.weekly?.pct}`);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      streamDeck.logger.error(`[ClaudeUsage Key] fetch error: ${this.lastError}`);
    }
    await this.renderAll();
  }

  private async renderAll(): Promise<void> {
    for (const act of this.actions) {
      if (act.isKey()) {
        const settings = await act.getSettings<KeySettings>();
        await this.renderKey(act, settings.view ?? "session");
      }
    }
  }

  private async renderKey(act: KeyAction<KeySettings>, view: View): Promise<void> {
    try {
      const img = buildKeyImage(view, this.cached, this.lastError);
      await act.setImage(img);
      streamDeck.logger.info(`[ClaudeUsage Key] setImage ok view=${view}`);
    } catch (err) {
      streamDeck.logger.error(`[ClaudeUsage Key] setImage error: ${err}`);
    }
  }
}
