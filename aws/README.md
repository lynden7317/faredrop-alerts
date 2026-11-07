# AWS backend (M1)

Single-file Lambdas (handler `index.handler`, python3.12, role `flight-lambda-role`, region us-east-1).
Each is deployed as an inline CloudFormation stack named after the function. The deployed code is
the source of truth; these copies are kept in sync for review and redeploys.

| File | Function | Trigger |
|---|---|---|
| flight-save-subscription.py | `flight-save-subscription` | `POST /subscribe` (HTTP API `flight-api`) |
| flight-list-subscriptions.py | `flight-list-subscriptions` | `GET /subscriptions?email=` |
| flight-list-routes.py | `flight-list-routes` | `GET /routes` (plan cards shown on the dashboard) |
| flight-list-fares.py | `flight-list-fares` | `GET /fares` (latest cheapest fare per route, shown on the plan cards) |
| flight-parser-wrapper.py | `flight-parser-wrapper` | EventBridge `flight-price-check`, rate(30 minutes) |
| flight-parser.py | `flight-parser` | async invoke from the wrapper, one route per call |
| flight-fare-notification.py | `flight-fare-notification` | SQS `flight-fare-queue` (batch size 1) |

Data: DynamoDB `subscriptions` (email, route), `notification_history` (pk = email#route, sent_at) and
`latest_fares` (route; overwritten by `flight-parser` on every run).
Config: `s3://flight-config-<ACCOUNT_ID>/flight-routes.json` is the **single source of truth for routes**
(copy in `aws/flight-routes.json`; see "Adding a route" below). Secrets: `flight/travelpayouts`, `flight/resend`.
Dedup knobs (env on the notification Lambda): NOTIFY_FLOOR_HOURS=24, REALERT_PCT=20, REALERT_ABS_TWD=2000.

## Adding a route (config only — no code change, no redeploy)

1. Check Travelpayouts has fares for it: invoke `flight-parser` with
   `{"origin":"TPE","destination":"OKA","route":"TPE-OKA"}` and confirm `cheapest_twd` comes back.
2. Add one entry to `flight-routes.json` and upload it to the config bucket:
   `{"plan": "okinawa", "origin": "TPE", "destination": "OKA", "label": "台北 ✈ 沖繩", "origin_city": "台北", "city": "沖繩"}`
   (`plan` = id stored on subscriptions; `label` = card title; `origin_city`/`city` = email subject.)
3. Done. Within ~1 minute `POST /subscribe` accepts it (save Lambda caches the file 60s), the dashboard
   shows the card (`GET /routes`, browser cache ≤5 min), and the next 30-min run fetches its fare and alerts.

To remove a route, delete its entry; existing subscriptions to it simply stop matching.
