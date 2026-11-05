<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Backend is used for authentication only (built-in auth users); do not add app data tables — later milestones store data elsewhere.
- The app is a static Vite + React SPA (no SSR, no server functions). Routes are declared in src/routes.tsx with React Router; pages live in src/pages/.
- Signed-in pages are children of the `authenticated` route in src/routes.tsx (its loader redirects to /auth when signed out).
- Only `VITE_*` env vars reach the app (inlined at build time); never put secrets in them.
