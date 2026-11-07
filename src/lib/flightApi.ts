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

export type Subscription = {
  email: string;
  route: string;
  plan_name: PlanName;
  target_price: number;
  currency: "TWD";
  created_at?: string;
  updated_at?: string;
};

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

export async function saveSubscription(input: {
  email: string;
  plan_name: PlanName;
  target_price: number;
}): Promise<Subscription> {
  const res = await fetch(`${FLIGHT_API_URL}/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parse<Subscription>(res);
}
