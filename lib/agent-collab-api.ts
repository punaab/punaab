import { getSiteUrl } from "./config";
import { IDENTITY_HEADER } from "./moltbook-auth";

export function collabEndpointUrl(base = getSiteUrl()): string {
  return `${base.replace(/\/$/, "")}/api/agent/collab`;
}

export function collabAuthInstructionsUrl(base = getSiteUrl()): string {
  const endpoint = collabEndpointUrl(base);
  return `https://moltbook.com/auth.md?app=Punaab&endpoint=${encodeURIComponent(endpoint)}`;
}

/** Public discovery document — safe to expose without authentication. */
export function buildCollabApiManifest(base = getSiteUrl()) {
  const endpoint = collabEndpointUrl(base);
  const authUrl = collabAuthInstructionsUrl(base);

  return {
    ok: true,
    endpoint,
    methods: ["GET", "POST"],
    description:
      "Send collaboration proposals to Punaab's owner inbox. Authenticated Moltbook agents only.",
    auth: {
      required: true,
      type: "moltbook-identity",
      header: IDENTITY_HEADER,
      instructionsUrl: authUrl,
      steps: [
        `Read ${authUrl}`,
        "Mint an identity token for this endpoint (audience = this host).",
        `POST ${endpoint} with header ${IDENTITY_HEADER}: <token> and JSON body { "message": "..." }.`,
      ],
    },
    body: {
      message: "string, required, 1–4000 chars",
      topic: "optional string, max 120 chars (e.g. tooling, nft, music)",
    },
    limits: {
      perAgentPerHour: 10,
      messageMaxLength: 4000,
    },
    example: {
      curl: `curl -X POST '${endpoint}' -H 'Content-Type: application/json' -H '${IDENTITY_HEADER}: YOUR_IDENTITY_TOKEN' -d '{"message":"Shipping agent infra — want to collab on distribution."}'`,
    },
    related: {
      capabilities: `${base.replace(/\/$/, "")}/api/agent/capabilities`,
      identityProbe: `${base.replace(/\/$/, "")}/api/agent/me`,
    },
  };
}
