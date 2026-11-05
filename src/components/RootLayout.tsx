import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  ScrollRestoration,
  isRouteErrorResponse,
  useRevalidator,
  useRouteError,
} from "react-router";

import { supabase } from "@/integrations/supabase/client";
import { reportLovableError } from "@/lib/lovable-error-reporting";

export function RootLayout() {
  const queryClient = useQueryClient();
  const { revalidate } = useRevalidator();

  // Re-run the auth gate (and refresh queries) whenever the session changes.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void revalidate();
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [revalidate, queryClient]);

  return (
    <>
      <Outlet />
      <ScrollRestoration />
    </>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export function RootErrorBoundary() {
  const error = useRouteError();
  const { revalidate } = useRevalidator();

  useEffect(() => {
    console.error(error);
    reportLovableError(error, { boundary: "react_router_root_error_boundary" });
  }, [error]);

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => void revalidate()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
