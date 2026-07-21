import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface AlchemyCliResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Run an Alchemy CLI command with JSON output (local machine with session only). */
export async function runAlchemyCli(
  args: string[],
  options?: { timeoutMs?: number },
): Promise<AlchemyCliResult> {
  const cmd =
    process.env.ALCHEMY_CLI_PATH ??
    (process.platform === "win32" ? "alchemy.cmd" : "alchemy");
  const fullArgs = ["--json", "--no-interactive", ...args];

  try {
    const { stdout, stderr } = await execFileAsync(cmd, fullArgs, {
      timeout: options?.timeoutMs ?? 120_000,
      maxBuffer: 4 * 1024 * 1024,
      shell: process.platform === "win32",
      env: {
        ...process.env,
        ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
      },
    });

    // Prefer stdout JSON; stderr is often warnings that must not kill a valid session
    const raw = stdout?.trim() || stderr?.trim() || "";
    if (!raw) {
      return { ok: false, error: "alchemy_cli_empty_output" };
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      // stdout may include banner lines — extract last JSON object
      const start = raw.lastIndexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        data = JSON.parse(raw.slice(start, end + 1));
      } else {
        return { ok: false, error: `alchemy_cli_non_json:${raw.slice(0, 200)}` };
      }
    }

    const cliError = parseCliJsonError(data);
    if (cliError) {
      return { ok: false, error: cliError, data };
    }
    return { ok: true, data };
  } catch (error) {
    const exec = error as { stdout?: string; stderr?: string; message?: string };
    const blob = exec.stdout?.trim() || exec.stderr?.trim() || "";
    if (blob) {
      try {
        const start = blob.indexOf("{");
        const end = blob.lastIndexOf("}");
        const json =
          start >= 0 && end > start ? blob.slice(start, end + 1) : blob;
        const data = JSON.parse(json) as unknown;
        const cliError = parseCliJsonError(data);
        if (cliError) {
          return { ok: false, error: cliError, data };
        }
        return { ok: true, data };
      } catch {
        // fall through
      }
    }
    const message = exec.message ?? "alchemy_cli_failed";
    return { ok: false, error: message };
  }
}

function parseCliJsonError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const err = record.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  return undefined;
}

export async function getAlchemyWalletStatus(): Promise<AlchemyCliResult> {
  return runAlchemyCli(["wallet", "status", "--verify"]);
}

export async function getAlchemyWalletAddresses(): Promise<{
  evm?: string;
  solana?: string;
} | null> {
  const result = await runAlchemyCli(["wallet", "address"]);
  if (!result.ok || !result.data) return null;

  const data = result.data as Record<string, unknown>;
  return {
    evm: typeof data.evm === "string" ? data.evm : undefined,
    solana: typeof data.solana === "string" ? data.solana : undefined,
  };
}
