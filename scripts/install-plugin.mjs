import fs from "fs";
import os from "os";
import path from "path";

const PLUGIN_DIR = "com.pcjtse.claudeusage.sdPlugin";

function getStreamDeckPluginsDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA, "Elgato", "StreamDeck", "Plugins");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "com.elgato.StreamDeck", "Plugins");
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const pluginsDir = getStreamDeckPluginsDir();
const dest = path.join(pluginsDir, PLUGIN_DIR);

console.log(`Installing to: ${dest}`);
copyDir(PLUGIN_DIR, dest);
console.log("Done. Restart the Stream Deck app if it was already running.");
