import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/SiteHeader";

export function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const res = isSignup
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/app" } })
      : await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (res.error) return setError(res.error.message);
    if (!res.data.session) return setInfo("請到信箱確認帳號 / Check your email to confirm.");
    navigate({ to: "/app" });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-hero px-4">
      <div className="mb-8"><Logo /></div>
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-8 shadow-glow">
        <div>
          <h1 className="text-2xl font-semibold">{isSignup ? "建立帳號 Sign up" : "登入 Sign in"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignup ? "用 email 註冊開始追蹤票價" : "歡迎回來"}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {info && <p className="text-sm text-primary">{info}</p>}
        <Button type="submit" variant="hero" className="w-full" disabled={loading}>
          {loading ? "…" : isSignup ? "Sign up / 註冊" : "Sign in / 登入"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          {isSignup ? (
            <>已有帳號？<Link to="/auth" className="text-primary hover:underline">Sign in</Link></>
          ) : (
            <>還沒有帳號？<Link to="/signup" className="text-primary hover:underline">Sign up</Link></>
          )}
        </p>
      </form>
    </div>
  );
}
