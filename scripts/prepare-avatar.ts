/**
 * Crop astronaut cat to square JPEG under 500KB for Moltbook avatar.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";

const src = resolve("public/punaab-avatar.png");
const out = resolve("public/punaab-avatar.jpg");

// Prefer magick/ffmpeg if available; else keep original and rename content-type
const magick = spawnSync(
  "magick",
  [
    src,
    "-gravity",
    "center",
    "-extent",
    "512x512",
    "-quality",
    "85",
    out,
  ],
  { encoding: "utf8" },
);

if (magick.status === 0 && existsSync(out)) {
  console.log("Wrote", out, "bytes", readFileSync(out).length);
  process.exit(0);
}

const ffmpeg = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-i",
    src,
    "-vf",
    "crop=min(iw\\,ih):min(iw\\,ih),scale=512:512",
    "-q:v",
    "3",
    out,
  ],
  { encoding: "utf8" },
);

if (ffmpeg.status === 0 && existsSync(out)) {
  console.log("Wrote", out, "bytes", readFileSync(out).length);
  process.exit(0);
}

// Fallback: copy bytes as .jpg (file is already JPEG payload)
writeFileSync(out, readFileSync(src));
console.log(
  "Copied as JPEG bytes to",
  out,
  "bytes",
  readFileSync(out).length,
  "(install ImageMagick for square crop)",
);
