import { execFileSync } from "child_process";
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

const CRED_PATH = path.join(os.homedir(), ".claude", ".credentials.json");

// On macOS, Claude Code stores credentials in the login Keychain instead of a file
const KEYCHAIN_SERVICE = "Claude Code-credentials";

function readKeychain(): string | null {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf-8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return null;
  }
}

function readCredentialsRaw(): string | null {
  if (process.platform === "darwin") {
    const raw = readKeychain();
    if (raw) return raw;
  }
  return fs.existsSync(CRED_PATH) ? fs.readFileSync(CRED_PATH, "utf-8") : null;
}

// Re-read each call so we always use the freshest token
// (Claude Code auto-refreshes the stored credentials when it rotates tokens)
export function readAccessToken(): string {
  const raw = readCredentialsRaw();
  if (!raw) throw new Error("Claude Code credentials not found");
  const creds = JSON.parse(raw) as ClaudeCredentials;
  return creds.claudeAiOauth.accessToken;
}

export function credentialsExist(): boolean {
  if (process.platform === "darwin" && readKeychain()) return true;
  return fs.existsSync(CRED_PATH);
}
