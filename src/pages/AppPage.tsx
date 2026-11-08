import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PlanCard } from "@/components/PlanCard";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuthUser } from "@/components/RequireAuth";
import { usePageMeta } from "@/hooks/use-page-meta";
import {
  FALLBACK_PLANS,
  cancelSubscription,
  goToCheckout,
  listRoutes,
  listFares,
  listSubscriptions,
  saveSubscription,
  type Subscription,
} from "@/lib/flightApi";

export default function AppPage() {
  usePageMeta({
    title: "Dashboard — Flight Price Notifier",
    description: "Your Flight Price Notifier dashboard.",
    ogTitle: "Dashboard — Flight Price Notifier",
    ogDescription: "Your fare-tracking dashboard.",
  });
  const user = useAuthUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const email = (user.email ?? "").toLowerCase();
  const subsKey = ["subscriptions", email] as const;

  // Back from ECPay: OrderResultURL → flight-ecpay-result → /app?purchase=success|failed.
  const [searchParams, setSearchParams] = useSearchParams();
  const purchase = searchParams.get("purchase");

  const subsQuery = useQuery({
    queryKey: subsKey,
    queryFn: () => listSubscriptions(email),
    enabled: Boolean(email),
    // The ReturnURL callback may land a few seconds after the browser does — poll briefly.
    refetchInterval: (q) =>
      purchase === "success" &&
      !(q.state.data ?? []).some((s) => s.subscription_status === "active") &&
      q.state.dataUpdateCount < 10
        ? 3000
        : false,
  });

  useEffect(() => {
    if (!purchase) return;
    const t = setTimeout(() => setSearchParams({}, { replace: true }), 30000);
    return () => clearTimeout(t);
  }, [purchase, setSearchParams]);

  const upsert = (saved: Partial<Subscription> & { route: string }) =>
    queryClient.setQueryData<Subscription[]>(subsKey, (prev = []) =>
      prev.map((s) => (s.route === saved.route ? { ...s, ...saved } : s)),
    );

  const save = useMutation({
    mutationFn: saveSubscription,
    onSuccess: (result) => {
      if (result.kind === "checkout") {
        goToCheckout(result.html); // leaves the SPA for ECPay's cashier
        return;
      }
      upsert(result.subscription);
      void queryClient.invalidateQueries({ queryKey: subsKey });
    },
  });

  const cancel = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: (res, vars) => {
      upsert({ route: vars.route, ...res });
      void queryClient.invalidateQueries({ queryKey: subsKey });
    },
  });

  const byRoute = new Map((subsQuery.data ?? []).map((s) => [s.route, s]));

  // Routes come from the backend config (S3 flight-routes.json) — add a route there, not here.
  const routesQuery = useQuery({
    queryKey: ["routes"],
    queryFn: listRoutes,
    staleTime: 5 * 60 * 1000,
  });
  const plans = routesQuery.data?.length ? routesQuery.data : FALLBACK_PLANS;

  // Latest cheapest fares (refreshed by the backend every 30 min; re-poll every 5 min).
  const faresQuery = useQuery({
    queryKey: ["fares"],
    queryFn: listFares,
    refetchInterval: 5 * 60 * 1000,
  });
  const fareByRoute = new Map((faresQuery.data ?? []).map((f) => [f.route, f]));

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate("/auth", { replace: true });
  }

  return (
    <div className="min-h-screen">
      <SiteHeader
        right={
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out / 登出
          </Button>
        }
      />
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Hi <span className="text-gradient break-all">{user.email}</span>
        </h1>
        <p className="mt-3 text-muted-foreground">
          選一條航線、設定目標價（台幣），票價降到目標價以下就寄 email 通知你。
        </p>

        {purchase === "success" && (
          <p className="mt-6 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
            付款完成，謝謝！訂閱狀態會在幾秒內更新為「已訂閱（有效）」，並寄一封確認信給你。
          </p>
        )}
        {purchase === "failed" && (
          <p className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            付款沒有完成，這次沒有扣款。可以在下方按「完成付款」再試一次。
          </p>
        )}

        {subsQuery.isError && (
          <p className="mt-6 text-sm text-destructive">
            無法載入你的訂閱：{(subsQuery.error as Error).message}
          </p>
        )}

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {plans.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              subscription={byRoute.get(plan.route)}
              fare={fareByRoute.get(plan.route)}
              fareLoading={faresQuery.isPending}
              saving={save.isPending && save.variables?.plan_name === plan.name}
              cancelling={cancel.isPending && cancel.variables?.route === plan.route}
              onSave={async (target_price) => {
                await save.mutateAsync({ email, plan_name: plan.name, target_price });
              }}
              onCancel={async () => {
                await cancel.mutateAsync({ email, route: plan.route });
              }}
            />
          ))}
        </div>

        {subsQuery.isPending && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Plane className="h-4 w-4 animate-pulse" /> 載入訂閱中…
          </p>
        )}
      </main>
    </div>
  );
}
