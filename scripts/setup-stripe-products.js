/**
 * Creates Stripe Products + Prices for Creator / Studio and prints env lines.
 * Usage: node scripts/setup-stripe-products.js
 * Requires STRIPE_SECRET_KEY in env or .env
 */
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY required");
    process.exit(1);
  }

  const Stripe = require("stripe");
  const stripe = new Stripe(key);

  const creator = await stripe.products.create({
    name: "Punaab Creator",
    description: "10 projects, 25k credits / month",
  });
  const creatorPrice = await stripe.prices.create({
    product: creator.id,
    unit_amount: 1900,
    currency: "usd",
    recurring: { interval: "month" },
  });

  const studio = await stripe.products.create({
    name: "Punaab Studio",
    description: "Unlimited projects, 250k credits / month",
  });
  const studioPrice = await stripe.prices.create({
    product: studio.id,
    unit_amount: 9900,
    currency: "usd",
    recurring: { interval: "month" },
  });

  console.log("\nAdd to .env:\n");
  console.log(`STRIPE_PRICE_CREATOR=${creatorPrice.id}`);
  console.log(`STRIPE_PRICE_STUDIO=${studioPrice.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
