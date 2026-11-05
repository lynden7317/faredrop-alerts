import { QueryClient } from "@tanstack/react-query";
import { createBrowserRouter } from "react-router";

import { routes } from "./routes";

export const queryClient = new QueryClient();

export const router = createBrowserRouter(routes);
