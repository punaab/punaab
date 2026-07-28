import Stripe from "stripe";
import { getAppUrl as resolveAppUrl } from "@/lib/app-url";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

export function getAppUrl() {
  return resolveAppUrl();
}
