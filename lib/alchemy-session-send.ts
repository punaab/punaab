/**
 * Send arbitrary EVM calls via the local Alchemy CLI session (Agent Wallet).
 * Uses the same remote signing challenge flow as `alchemy evm approve`.
 */
import { sign as cryptoSign } from "crypto";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  createSmartWalletClient,
  alchemyWalletTransport,
} from "@alchemy/wallet-apis";
import { toAccount, type LocalAccount } from "viem/accounts";
import { arbitrum, type Chain } from "viem/chains";
import type { Address, Hex } from "viem";
import { getAlchemyApiKey, getAlchemyGasPolicyId } from "./config";

interface StoredSession {
  sessionId: string;
  status?: string;
  privateKeyPem: string;
  evmAddress?: string;
  walletId?: string;
  evmWalletId?: string;
  privyKeyQuorumId?: string;
  providerKeyQuorumId?: string;
  privySignerId?: string;
  providerSignerId?: string;
  envelopeVersion?: string;
  capabilities?: Record<string, boolean>;
  sessionsByChain?: {
    evm?: {
      sessionId?: string;
      walletId?: string;
      walletAddress?: string;
      providerKeyQuorumId?: string;
      providerSignerId?: string;
      status?: string;
    };
  };
}

interface AlchemyConfig {
  auth_token?: string;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sessionPaths() {
  const base = join(homedir(), ".config", "alchemy");
  return {
    session: join(base, "wallet-session.json"),
    config: join(base, "config.json"),
  };
}

function signChallengePayload(challengePayload: string, privateKeyPem: string): string {
  const signature = cryptoSign(
    "sha256",
    Buffer.from(challengePayload, "utf8"),
    {
      key: privateKeyPem,
      dsaEncoding: "der",
    },
  );
  return signature.toString("base64url");
}

async function adminRequest(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `https://admin-api.alchemy.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`admin_api_${res.status}:${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : undefined;
}

function unwrapData(resp: unknown): unknown {
  if (resp && typeof resp === "object" && "data" in resp) {
    return (resp as { data: unknown }).data;
  }
  return resp;
}

function resolveEvmSession(raw: StoredSession) {
  const chain = raw.sessionsByChain?.evm;
  const evmAddress = (raw.evmAddress ?? chain?.walletAddress ?? "").trim();
  const sessionId = (chain?.sessionId ?? raw.sessionId).trim();
  const walletId = (chain?.walletId ?? raw.evmWalletId ?? raw.walletId ?? "").trim();
  const providerKeyQuorumId = (
    chain?.providerKeyQuorumId ??
    raw.providerKeyQuorumId ??
    raw.privyKeyQuorumId ??
    ""
  ).trim();
  const providerSignerId = (
    chain?.providerSignerId ??
    raw.providerSignerId ??
    raw.privySignerId ??
    ""
  ).trim();
  if (!evmAddress || !sessionId || !walletId || !raw.privateKeyPem) {
    throw new Error("alchemy_session_incomplete — run alchemy wallet connect");
  }
  if (!providerKeyQuorumId && !providerSignerId) {
    throw new Error("alchemy_session_missing_signer_binding");
  }
  return {
    evmAddress: evmAddress as Address,
    sessionId,
    walletId,
    providerKeyQuorumId: providerKeyQuorumId || undefined,
    providerSignerId: providerSignerId || undefined,
    privateKeyPem: raw.privateKeyPem,
  };
}

function createDelegatedSigner(
  authToken: string,
  session: ReturnType<typeof resolveEvmSession>,
): LocalAccount {
  const binding = {
    sessionId: session.sessionId,
    walletId: session.walletId,
    walletAddress: session.evmAddress,
    ...(session.providerKeyQuorumId
      ? { providerKeyQuorumId: session.providerKeyQuorumId }
      : {}),
    ...(session.providerSignerId
      ? { providerSignerId: session.providerSignerId }
      : {}),
  };

  return toAccount({
    address: session.evmAddress,
    async signMessage({ message }) {
      const msg =
        typeof message === "string"
          ? { message, encoding: "utf8" as const }
          : {
              message:
                typeof message === "object" && message && "raw" in message
                  ? String(message.raw)
                  : String(message),
              encoding: "hex" as const,
            };
      const challengeResp = unwrapData(
        await adminRequest(authToken, "POST", "/wallet/evm/sign-message/challenge", {
          ...binding,
          message: msg.message,
          encoding: msg.encoding,
        }),
      ) as { challengeId: string; challenge: string };
      const signature = signChallengePayload(
        challengeResp.challenge,
        session.privateKeyPem,
      );
      const complete = unwrapData(
        await adminRequest(authToken, "POST", "/wallet/evm/sign-message/complete", {
          challengeId: challengeResp.challengeId,
          signature,
        }),
      ) as { signature: Hex };
      return complete.signature;
    },
    async signTypedData(typedData) {
      const challengeResp = unwrapData(
        await adminRequest(
          authToken,
          "POST",
          "/wallet/evm/sign-typed-data/challenge",
          {
            ...binding,
            typedData,
          },
        ),
      ) as { challengeId: string; challenge: string };
      const signature = signChallengePayload(
        challengeResp.challenge,
        session.privateKeyPem,
      );
      const complete = unwrapData(
        await adminRequest(
          authToken,
          "POST",
          "/wallet/evm/sign-typed-data/complete",
          {
            challengeId: challengeResp.challengeId,
            signature,
          },
        ),
      ) as { signature: Hex };
      return complete.signature;
    },
    async signTransaction() {
      throw new Error("signTransaction_not_used_for_smart_wallet_sendCalls");
    },
  });
}

export async function sendCallsViaAlchemySession(params: {
  to: Address;
  data: Hex;
  valueWei: bigint;
  chain?: Chain;
}): Promise<{ ok: boolean; callId?: string; txHash?: string; error?: string }> {
  const paths = sessionPaths();
  if (!existsSync(paths.session) || !existsSync(paths.config)) {
    return { ok: false, error: "alchemy_session_files_missing" };
  }
  const apiKey = getAlchemyApiKey();
  if (!apiKey) return { ok: false, error: "missing_alchemy_api_key" };

  const rawSession = loadJson<StoredSession>(paths.session);
  const cfg = loadJson<AlchemyConfig>(paths.config);
  const authToken = cfg.auth_token?.trim();
  if (!authToken) return { ok: false, error: "missing_alchemy_auth_token" };

  try {
    const session = resolveEvmSession(rawSession);
    const signer = createDelegatedSigner(authToken, session);
    const chain = params.chain ?? arbitrum;
    const policyId = getAlchemyGasPolicyId();
    const client = createSmartWalletClient({
      transport: alchemyWalletTransport({ apiKey }),
      chain,
      signer,
      ...(policyId ? { paymaster: { policyId } } : {}),
    });

    const { id } = await client.sendCalls({
      calls: [
        {
          to: params.to,
          data: params.data,
          value: params.valueWei,
        },
      ],
    });
    const status = await client.waitForCallsStatus({ id });
    const txHash =
      status.status === "success" && status.receipts?.[0]?.transactionHash
        ? status.receipts[0].transactionHash
        : undefined;
    return {
      ok: status.status === "success",
      callId: id,
      txHash,
      error:
        status.status === "success"
          ? undefined
          : `sendCalls_status_${status.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
