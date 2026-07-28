/**
 * Packs plugins/godot/addons/punaab into public/downloads/punaab-godot-0.1.0.zip
 * Zip root contains addons/punaab so users unzip into their Godot project root.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ADDON = path.join(ROOT, "plugins", "godot", "addons", "punaab");
const OUT_DIR = path.join(ROOT, "public", "downloads");
const VERSION = "0.1.0";
const ZIP_NAME = `punaab-godot-${VERSION}.zip`;
const OUT_ZIP = path.join(OUT_DIR, ZIP_NAME);
const STAGING = path.join(ROOT, ".tmp-plugin-pack");

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(ADDON)) {
  console.error("Missing addon at", ADDON);
  process.exit(1);
}

rimraf(STAGING);
const stagedAddon = path.join(STAGING, "addons", "punaab");
copyDir(ADDON, stagedAddon);
fs.copyFileSync(
  path.join(ROOT, "plugins", "godot", "README.md"),
  path.join(STAGING, "README.md")
);

fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);

const isWin = process.platform === "win32";
if (isWin) {
  // Compress-Archive paths must use backslashes; create zip of staging contents
  const ps = [
    "Compress-Archive",
    "-Path",
    path.join(STAGING, "*"),
    "-DestinationPath",
    OUT_ZIP,
    "-Force",
  ];
  execFileSync("powershell.exe", ["-NoProfile", "-Command", ps.join(" ")], {
    stdio: "inherit",
  });
} else {
  execFileSync("zip", ["-r", OUT_ZIP, "."], { cwd: STAGING, stdio: "inherit" });
}

rimraf(STAGING);
console.log("Wrote", OUT_ZIP);
