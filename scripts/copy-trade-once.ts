import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { runCopyTradeTick } from "../lib/copy-trade/engine";

function loadEnv(name: string) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    process.env[t.slice(0, eq).trim()] = t
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

loadEnv(".env");

runCopyTradeTick()
  .then((s) => {
    console.log(JSON.stringify(s, null, 2));
    process.exit(s.ok || s.skipped ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
