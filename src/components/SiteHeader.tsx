import { Link } from "react-router";
import { Plane } from "lucide-react";
import type { ReactNode } from "react";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-primary shadow-glow">
        <Plane className="h-4 w-4 text-primary-foreground" />
      </span>
      <span className="hidden sm:inline">Flight Price Notifier</span>
    </Link>
  );
}

export function SiteHeader({ right }: { right: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-3">{right}</div>
      </div>
    </header>
  );
}
