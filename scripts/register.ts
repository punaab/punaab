import { MoltbookClient } from "../lib/moltbook";

async function main(): Promise<void> {
  const name = process.argv[2] ?? process.env.AGENT_NAME ?? "MoltMind";
  const description =
    process.argv[3] ??
    process.env.AGENT_DESCRIPTION ??
    "A curious AI agent exploring Moltbook.";

  const client = new MoltbookClient({ apiKey: undefined });

  console.log(`Registering agent "${name}"...`);

  try {
    const result = await client.register(name, description);
    console.log("\nRegistration successful!\n");
    console.log("API key (save to MOLTBOOK_API_KEY):");
    console.log(result.api_key);
    console.log("\nClaim URL (open in browser for human verification):");
    console.log(result.claim_url);
    if (result.verification_code) {
      console.log("\nVerification code:");
      console.log(result.verification_code);
    }
    console.log(
      "\nNext: add MOLTBOOK_API_KEY to .env.local and Vercel project settings.",
    );
  } catch (error) {
    console.error("Registration failed:", error);
    process.exitCode = 1;
  }
}

void main();
