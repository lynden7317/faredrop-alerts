import type { User } from "@supabase/supabase-js";
import { Outlet, redirect, useRouteLoaderData } from "react-router";

import { supabase } from "@/integrations/supabase/client";

export type AuthenticatedData = { user: User };

/** Loader for the signed-in area: redirect to /auth when there is no user. */
export async function requireAuthLoader(): Promise<AuthenticatedData> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw redirect("/auth");
  return { user: data.user };
}

export function AuthenticatedLayout() {
  return <Outlet />;
}

/** The signed-in user, for components rendered under the authenticated route. */
export function useAuthUser(): User {
  const data = useRouteLoaderData("authenticated") as AuthenticatedData | undefined;
  if (!data) throw new Error("useAuthUser must be used under the authenticated route");
  return data.user;
}
