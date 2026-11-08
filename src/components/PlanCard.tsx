import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Clock, Plane, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MONTHLY_PRICE_TWD,
  isPaid,
  type LatestFare,
  type Plan,
  type Subscription,
} from "@/lib/flightApi";

const twd = (n: number) => `NT$${n.toLocaleString("en-US")}`;

const time = (iso: string) =>
  new Date(iso).toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const date = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}/${d.getDate()}`;
};

/** What the card shows, derived from subscription_status (+ the paid-through date). */
type View = "new" | "unpaid" | "active" | "grace" | "ended";

function viewOf(s: Subscription | undefined): View {
  if (!s) return "new";
  switch (s.subscription_status) {
    case "active":
      return "active";
    case "cancelled":
      return isPaid(s) ? "grace" : "ended";
    case "expired":
      return "ended";
    default:
      return "unpaid"; // pending_payment, or an M1 row created before payments existed
  }
}

function StatusBadge({ view, until }: { view: View; until?: string | undefined }) {
  switch (view) {
    case "active":
      return (
        <Badge className="gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />
          已訂閱（有效）
        </Badge>
      );
    case "grace":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3.5 w-3.5" />
          已取消{until ? ` · 有效至 ${until}` : ""}
        </Badge>
      );
    case "unpaid":
      return (
        <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-500">
          <AlertCircle className="h-3.5 w-3.5" />
          未完成付款
        </Badge>
      );
    case "ended":
      return (
        <Badge variant="outline" className="gap-1">
          <XCircle className="h-3.5 w-3.5" />
          已結束
        </Badge>
      );
    default:
      return null;
  }
}

type Props = {
  plan: Plan;
  subscription: Subscription | undefined;
  fare: LatestFare | undefined;
  fareLoading: boolean;
  saving: boolean;
  cancelling: boolean;
  /** Paid rows update in place; anything else is sent to the ECPay cashier. */
  onSave: (targetPrice: number) => Promise<void>;
  onCancel: () => Promise<void>;
};

export function PlanCard({
  plan,
  subscription,
  fare,
  fareLoading,
  saving,
  cancelling,
  onSave,
  onCancel,
}: Props) {
  const view = viewOf(subscription);
  const paid = view === "active" || view === "grace";
  const [editing, setEditing] = useState(view === "new");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [value, setValue] = useState(subscription ? String(subscription.target_price) : "");
  const [error, setError] = useState<string | null>(null);

  // Keep the form in sync when the saved subscription loads or changes.
  useEffect(() => {
    if (subscription) {
      setValue(String(subscription.target_price));
      setEditing(false);
      setConfirmCancel(false);
    }
  }, [subscription]);

  // For a new subscription, start from the current cheapest fare once it arrives.
  useEffect(() => {
    if (!subscription && fare) setValue((v) => (v === "" ? String(fare.price_twd) : v));
  }, [subscription, fare]);

  const belowTarget = Boolean(fare && subscription && fare.price_twd <= subscription.target_price);
  const until = subscription?.current_period_end_date;

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗，請稍後再試");
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("請輸入大於 0 的台幣金額");
      return;
    }
    void run(() => onSave(Math.round(n)));
  }

  const submitLabel = saving
    ? paid
      ? "儲存中…"
      : "前往付款…"
    : paid
      ? "儲存目標價"
      : `訂閱並付款（${twd(MONTHLY_PRICE_TWD)}/月）`;

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Plane className="h-5 w-5 text-primary" />
            {plan.label}
          </CardTitle>
          <StatusBadge view={view} until={until} />
        </div>
        <CardDescription>{plan.route}</CardDescription>
        <div className="mt-2 rounded-lg bg-muted/50 px-3 py-2">
          {fare ? (
            <>
              <p className="text-sm text-muted-foreground">
                目前最低價
                {fare.depart_date && date(fare.depart_date)
                  ? `（${date(fare.depart_date)} 出發）`
                  : ""}
              </p>
              <p className="text-2xl font-semibold">
                {twd(fare.price_twd)}
                {fare.price_usd !== undefined && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    約 US${fare.price_usd}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                更新於 {time(fare.checked_at)} · 每 30 分鐘更新
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {fareLoading ? "載入最新票價中…" : "最新票價更新中"}
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent className="mt-auto">
        {subscription && !editing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              目標價{" "}
              <span className="text-lg font-semibold text-foreground">
                {twd(subscription.target_price)}
              </span>
              <br />
              {view === "active" && "票價低於或等於目標價時，我們會寄 email 通知你。"}
              {view === "grace" && `已取消，不會再扣款；${until ?? "本期結束"}前仍會通知你。`}
              {view === "unpaid" && "付款完成後才會開始通知。"}
              {view === "ended" && "訂閱已結束，不會再通知。"}
            </p>
            {paid && belowTarget && (
              <p className="text-sm font-medium text-primary">
                ✓ 目前票價已達你的目標價（24 小時內同一航線最多通知一次）
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {view === "unpaid" && (
              <Button
                className="w-full"
                disabled={saving}
                onClick={() => void run(() => onSave(subscription.target_price))}
              >
                {saving ? "前往付款…" : `完成付款（${twd(MONTHLY_PRICE_TWD)}/月）`}
              </Button>
            )}
            {view === "ended" && (
              <Button className="w-full" onClick={() => setEditing(true)}>
                重新訂閱
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
              更新目標價
            </Button>

            {view === "active" &&
              (confirmCancel ? (
                <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
                  <p className="text-sm">
                    確定取消？之後不會再扣款，
                    {until ? `${until} 前` : "本期結束前"}仍會繼續通知。
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={cancelling}
                      onClick={() => void run(onCancel)}
                    >
                      {cancelling ? "取消中…" : "確定取消訂閱"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={cancelling}
                      onClick={() => setConfirmCancel(false)}
                    >
                      返回
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => setConfirmCancel(true)}
                >
                  取消訂閱
                </Button>
              ))}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`target-${plan.name}`}>目標價（TWD）</Label>
              <Input
                id={`target-${plan.name}`}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={saving}
              />
            </div>
            {!paid && (
              <p className="text-xs text-muted-foreground">
                月費 {twd(MONTHLY_PRICE_TWD)}，透過綠界信用卡定期定額每月扣款，可隨時取消。
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saving}>
                {submitLabel}
              </Button>
              {subscription && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  取消
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
