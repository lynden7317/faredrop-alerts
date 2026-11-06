import { Navigate, type RouteObject } from "react-router";

import { RootLayout, RootErrorBoundary, NotFound } from "@/components/RootLayout";
import { requireAuthLoader, AuthenticatedLayout } from "@/components/RequireAuth";
import Index from "@/pages/Index";
import SignIn from "@/pages/SignIn";
import SignUp from "@/pages/SignUp";
import AppPage from "@/pages/AppPage";

// Route table shared by the browser router (src/router.ts) and tests.
export const routes: RouteObject[] = [
  {
    id: "root",
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    hydrateFallbackElement: <div className="min-h-screen bg-background" />,
    children: [
      { index: true, element: <Index /> },
      { path: "auth", element: <SignIn /> },
      { path: "signup", element: <SignUp /> },
      // Friendly aliases for the auth pages.
      { path: "sign-in", element: <Navigate to="/auth" replace /> },
      { path: "sign-up", element: <Navigate to="/signup" replace /> },
      {
        // Client-only gate: redirects to /auth when there is no signed-in user.
        id: "authenticated",
        loader: requireAuthLoader,
        element: <AuthenticatedLayout />,
        children: [{ path: "app", element: <AppPage /> }],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
];
