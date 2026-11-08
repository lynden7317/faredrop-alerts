// Client for the Flight Price Notifier API (AWS API Gateway → Lambda → DynamoDB).
// The browser holds no AWS credentials: it only calls these public HTTP routes.

const DEFAULT_API_URL = "https://c27hhnw2jl.execute-api.us-east-1.amazonaws.com";

export const FLIGHT_API_URL: string = (
  (import.meta.env["VITE_FLIGHT_API_URL"] as string | undefined) || DEFAULT_API_URL
).replace(/\/+$/, "");

/** Plan id from flight-routes.json in S3 (e.g. "tokyo"). Routes are config, not code. */
export type PlanName = string;

export type Plan = {
  name: PlanName;
  label: string;
  route: string;
};

/** Fallback shown only if GET /routes is unreachable; the S3 config is the source of truth. */
export const FALLBACK_PLANS: Plan[] = [
  { name: "tokyo", label: "台北 ✈ 東京", route: "TPE-TYO" },
  { name: "seoul", label: "台北 ✈ 首爾", route: "TPE-SEL" },
  { name: "macau", label: "台北 ✈ 澳門", route: "TPE-MFM" },
];

export async function listRoutes(): Promise<Plan[]> {
  const res = await fetch(`${FLIGHT_API_URL}/routes`);
  const body = await parse<{ routes: Plan[] }>(res);
  return body.routes ?? [];
}

/** Latest cheapest fare per route, written by the flight-parser Lambda every 30 minutes. */
export type LatestFare = {
  route: string;
  price_twd: number;
  price_usd?: number;
  airline?: string;
  depart_date?: string;
  month?: string;
  checked_at: string;
};

export async function listFares(): Promise<LatestFare[]> {
  const res = await fetch(`${FLIGHT_API_URL}/fares`);
  const body = await parse<{ fares: LatestFare[] }>(res);
  return body.fares ?? [];
}

/**
 * M2 lifecycle: pending_payment → active ⇄ (target updates) → cancelled (grace) → expired.
 * Only the ECPay callbacks write `active`; rows from M1 have no status and count as unpaid.
 */
export type SubscriptionStatus = "pending_payment" | "active" | "cancelled" | "expired";

export type Subscription = {
  email: string;
  route: string;
  plan_name: PlanName;
  target_price: number;
  currency: "TWD";
  created_at?: string;
  updated_at?: string;
  subscription_status?: SubscriptionStatus;
  /** UTC "YYYY-MM-DDTHH:MM:SSZ" — alerts continue until this instant (also for cancelled rows). */
  current_period_end?: string;
  /** Taiwan-local "YYYY-MM-DD", for display. */
  current_period_end_date?: string;
  cancelled_at?: string;
};

/** Display only — the charged amount comes from the `amount` field of the flight/ecpay secret. */
export const MONTHLY_PRICE_TWD = 300;

/** Paid-through (active, or cancelled but still inside the paid period): alerts are being sent. */
export function isPaid(s: Subscription | undefined): boolean {
  if (!s) return false;
  if (s.subscription_status === "active") return true;
  return (
    s.subscription_status === "cancelled" &&
    !!s.current_period_end &&
    new Date(s.current_period_end).getTime() >= Date.now()
  );
}

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export async function listSubscriptions(email: string): Promise<Subscription[]> {
  const res = await fetch(`${FLIGHT_API_URL}/subscriptions?email=${encodeURIComponent(email)}`);
  const body = await parse<{ subscriptions: Subscription[] }>(res);
  return body.subscriptions ?? [];
}

/**
 * POST /subscribe answers in one of two shapes (branch on Content-Type, never blindly res.json()):
 * - text/html → an auto-submitting ECPay checkout form: hand the whole page to ECPay's cashier.
 * - application/json → an in-place target-price update for an already-paid subscription.
 */
export type SaveResult =
  { kind: "checkout"; html: string } | { kind: "updated"; subscription: Subscription };

export async function saveSubscription(input: {
  email: string;
  plan_name: PlanName;
  target_price: number;
}): Promise<SaveResult> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.includes("text/html")) return { kind: "checkout", html: await res.text() };
  return { kind: "updated", subscription: await parse<Subscription>(res) };
}

/** Replace the current page with ECPay's cashier (the form's inline script submits it). */
export function goToCheckout(html: string) {
  document.open();
  document.write(html);
  document.close();
}

/** Stops renewals at ECPay; alerts continue until current_period_end. */
export async function cancelSubscription(input: { email: string; route: string }): Promise<{
  subscription_status: SubscriptionStatus;
  current_period_end?: string;
  current_period_end_date?: string;
}> {
  const res = await fetch(`${FLIGHT_API_URL}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parse(res);
}
