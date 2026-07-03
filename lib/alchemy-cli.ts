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
  const cmd = process.env.ALCHEMY_CLI_PATH ?? "alchemy";
  const fullArgs = ["--json", "--no-interactive", ...args];

  try {
    const { stdout, stderr } = await execFileAsync(cmd, fullArgs, {
      timeout: options?.timeoutMs ?? 120_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
      },
    });

    if (stderr?.trim()) {
      try {
        const errJson = JSON.parse(stderr) as { error?: string; message?: string };
        return {
          ok: false,
          error: errJson.error ?? errJson.message ?? stderr.slice(0, 300),
        };
      } catch {
        // stderr may be warnings
      }
    }

    const data = JSON.parse(stdout) as unknown;
    return { ok: true, data };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "alchemy_cli_failed";
    return { ok: false, error: message };
  }
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
