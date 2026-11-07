import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Plane } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Plan, Subscription } from "@/lib/flightApi";

const twd = (n: number) => `NT$${n.toLocaleString("en-US")}`;

type Props = {
  plan: Plan;
  subscription: Subscription | undefined;
  saving: boolean;
  onSave: (targetPrice: number) => Promise<void>;
};

export function PlanCard({ plan, subscription, saving, onSave }: Props) {
  const subscribed = Boolean(subscription);
  const [editing, setEditing] = useState(!subscribed);
  const [value, setValue] = useState(String(subscription?.target_price ?? plan.hintTwd + 700));
  const [error, setError] = useState<string | null>(null);

  // Keep the form in sync when the saved subscription loads or changes.
  useEffect(() => {
    if (subscription) {
      setValue(String(subscription.target_price));
      setEditing(false);
    }
  }, [subscription]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("請輸入大於 0 的台幣金額");
      return;
    }
    setError(null);
    try {
      await onSave(Math.round(n));
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗，請稍後再試");
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Plane className="h-5 w-5 text-primary" />
            {plan.label}
          </CardTitle>
          {subscribed && (
            <Badge className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              已訂閱
            </Badge>
          )}
        </div>
        <CardDescription>
          {plan.route} · 近期最低價約 {twd(plan.hintTwd)}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        {subscribed && !editing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              目標價{" "}
              <span className="text-lg font-semibold text-foreground">
                {twd(subscription!.target_price)}
              </span>
              <br />
              票價低於或等於目標價時，我們會寄 email 通知你。
            </p>
            <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
              更新目標價
            </Button>
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={saving}>
                {saving ? "儲存中…" : subscribed ? "儲存目標價" : "開始追蹤"}
              </Button>
              {subscribed && (
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
