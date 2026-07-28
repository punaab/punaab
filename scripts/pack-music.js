/**
 * Packs public/music/*.mp3 into public/downloads/punaab-music.zip
 * so the Music page can offer a one-click “Download all”.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MUSIC_DIR = path.join(ROOT, "public", "music");
const OUT_DIR = path.join(ROOT, "public", "downloads");
const ZIP_NAME = "punaab-music.zip";
const OUT_ZIP = path.join(OUT_DIR, ZIP_NAME);
const STAGING = path.join(ROOT, ".tmp-music-pack");

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

const tracks = fs
  .readdirSync(MUSIC_DIR)
  .filter((name) => name.toLowerCase().endsWith(".mp3"));

if (!tracks.length) {
  console.error("No .mp3 files found in", MUSIC_DIR);
  process.exit(1);
}

rimraf(STAGING);
fs.mkdirSync(STAGING, { recursive: true });

for (const file of tracks) {
  fs.copyFileSync(path.join(MUSIC_DIR, file), path.join(STAGING, file));
}

fs.writeFileSync(
  path.join(STAGING, "LICENSE.txt"),
  [
    "Punaab music — Creative Commons Attribution 4.0 (CC BY)",
    "",
    "Use, arrange, and perform with credit in the form:",
    "  SongTitle - Punaab",
    "",
    "https://creativecommons.org/licenses/by/4.0/",
    "",
  ].join("\n")
);

fs.mkdirSync(OUT_DIR, { recursive: true });
if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);

const isWin = process.platform === "win32";
if (isWin) {
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
console.log("Wrote", OUT_ZIP, `(${tracks.length} tracks)`);
