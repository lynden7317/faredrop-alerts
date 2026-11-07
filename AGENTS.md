## Project rules
- Backend is used for authentication only (built-in auth users); do not add app data tables — later milestones store data elsewhere.
- The app is a static Vite + React SPA (no SSR, no server functions). Routes are declared in src/routes.tsx with React Router; pages live in src/pages/.
- Signed-in pages are children of the `authenticated` route in src/routes.tsx (its loader redirects to /auth when signed out).
- Only `VITE_*` env vars reach the app (inlined at build time); never put secrets in them.
- Course skills live in .claude/skills/ (m0-*, m1-flight-price-checker*, aws/resend/supabase/lovable-best-practice); follow them for milestone work. Supabase is auth-only; app data (subscriptions) goes to DynamoDB on AWS from M1.1.
