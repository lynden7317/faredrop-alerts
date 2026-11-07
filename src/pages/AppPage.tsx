import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plane } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PlanCard } from "@/components/PlanCard";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuthUser } from "@/components/RequireAuth";
import { usePageMeta } from "@/hooks/use-page-meta";
import {
  PLANS,
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

  const subsQuery = useQuery({
    queryKey: subsKey,
    queryFn: () => listSubscriptions(email),
    enabled: Boolean(email),
  });

  const save = useMutation({
    mutationFn: saveSubscription,
    onSuccess: (saved) => {
      // Flip the card to "subscribed" immediately, then refetch the source of truth.
      queryClient.setQueryData<Subscription[]>(subsKey, (prev = []) => [
        ...prev.filter((s) => s.route !== saved.route),
        saved,
      ]);
      void queryClient.invalidateQueries({ queryKey: subsKey });
    },
  });

  const byRoute = new Map((subsQuery.data ?? []).map((s) => [s.route, s]));

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

        {subsQuery.isError && (
          <p className="mt-6 text-sm text-destructive">
            無法載入你的訂閱：{(subsQuery.error as Error).message}
          </p>
        )}

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              subscription={byRoute.get(plan.route)}
              fare={fareByRoute.get(plan.route)}
              fareLoading={faresQuery.isPending}
              saving={save.isPending && save.variables?.plan_name === plan.name}
              onSave={async (target_price) => {
                await save.mutateAsync({ email, plan_name: plan.name, target_price });
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
