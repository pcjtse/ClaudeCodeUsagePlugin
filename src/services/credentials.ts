import fs from "fs";
import os from "os";
import path from "path";

interface ClaudeCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

// Re-read from disk each call so we always use the freshest token
// (Claude Code auto-refreshes the file when it rotates tokens)
export function readAccessToken(): string {
  const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
  const raw = fs.readFileSync(credPath, "utf-8");
  const creds = JSON.parse(raw) as ClaudeCredentials;
  return creds.claudeAiOauth.accessToken;
}

export function credentialsExist(): boolean {
  const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
  return fs.existsSync(credPath);
}
