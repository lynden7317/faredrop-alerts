import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { routes } from "@/routes";

// Match routes without running loaders or rendering: the auth loader needs the
// network the test run lacks.
const leafPath = (url: string) => {
  const matches = matchRoutes(routes, url) ?? [];
  return matches.at(-1)?.route.path ?? (matches.at(-1)?.route.index ? "(index)" : undefined);
};

describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    expect(leafPath("/")).toBe("(index)");
  });

  it.each([
    ["/app", "app"],
    ["/auth", "auth"],
    ["/signup", "signup"],
    ["/sign-in", "sign-in"],
    ["/sign-up", "sign-up"],
  ])("matches %s", (url, path) => {
    expect(leafPath(url)).toBe(path);
  });

  it("puts /app behind the authenticated loader", () => {
    const ids = (matchRoutes(routes, "/app") ?? []).map((m) => m.route.id);
    expect(ids).toContain("authenticated");
  });

  it("falls back to the not-found page for unknown paths", () => {
    expect(leafPath("/nope")).toBe("*");
  });
});
