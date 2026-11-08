# AWS backend (M1 + M2)

Lambdas use handler `index.handler`, python3.12, role `flight-lambda-role`, region us-east-1. Each is a
CloudFormation stack named after the function. The deployed code is the source of truth; these copies
are kept in sync for review and redeploys.

**Deploying (M2+).** Inline `ZipFile` caps code at 4096 chars, so stacks now deploy from S3:
invoke `flight-deploy-bundler` with `{"key": "deploy/<fn>/<sha>.zip", "files": {"index.py": "<source>"},
"s3_files": {"ecpay_common.py": "deploy/src/ecpay_common-<sha>.py"}}` (it zips into
`s3://flight-config-<ACCOUNT_ID>/deploy/…` and returns per-file sha256 prefixes to compare with the local
files), then create/update the stack with `Code: {S3Bucket, S3Key}`. A new S3 key per change is what makes
CloudFormation pick up new code. `ecpay_common.py` is shared by the ECPay Lambdas and is uploaded once
to `deploy/src/` with `s3:PutObject`. Stacks for new HTTP routes also own their API Gateway
integration, route, and invoke permission. Legacy M1 stacks with inline code still work the same way.

| File | Function | Trigger |
|---|---|---|
| flight-save-subscription.py | `flight-save-subscription` | `POST /subscribe` (HTTP API `flight-api`) |
| flight-list-subscriptions.py | `flight-list-subscriptions` | `GET /subscriptions?email=` |
| flight-list-routes.py | `flight-list-routes` | `GET /routes` (plan cards shown on the dashboard) |
| flight-list-fares.py | `flight-list-fares` | `GET /fares` (latest cheapest fare per route, shown on the plan cards) |
| flight-parser-wrapper.py | `flight-parser-wrapper` | EventBridge `flight-price-check`, rate(30 minutes) |
| flight-parser.py | `flight-parser` | async invoke from the wrapper, one route per call |
| flight-fare-notification.py | `flight-fare-notification` | SQS `flight-fare-queue` (batch size 1) |
| flight-ecpay-return.py (+ ecpay_common.py) | `flight-ecpay-return` | `POST /ecpay-return` — ECPay ReturnURL, first charge → `active` |
| flight-ecpay-period.py (+ ecpay_common.py) | `flight-ecpay-period` | `POST /ecpay-period` — ECPay PeriodReturnURL, renewals |
| flight-ecpay-result.py | `flight-ecpay-result` | `ANY /ecpay-result` — OrderResultURL browser POST → 302 `/app?purchase=…` |
| flight-cancel-subscription.py (+ ecpay_common.py) | `flight-cancel-subscription` | `POST /cancel` — CreditCardPeriodAction Cancel → `cancelled` |
| flight-status-notification.py | `flight-status-notification` | SQS `flight-status-queue` — welcome / cancel emails by `event_type` |
| flight-deploy-bundler.py | `flight-deploy-bundler` | invoked by hand to build deploy zips (see above) |

Data: DynamoDB `subscriptions` (email, route), `notification_history` (pk = email#route, sent_at) and
`latest_fares` (route; overwritten by `flight-parser` on every run).
M2 adds to `subscriptions`: `subscription_status` (`pending_payment` → `active` → `cancelled` → `expired`),
`merchant_trade_no`, `period_type`, `current_period_end` (UTC `YYYY-MM-DDTHH:MM:SSZ`, string-compared),
`current_period_end_date` (Taiwan date for display), `success_times`, `consecutive_failures`.
The parser alerts only `active` rows and `cancelled` rows whose `current_period_end` hasn't passed, and flips
lapsed `cancelled` rows to `expired`. Status emails are deduped in `notification_history` under
`pk = status#<email>#<route>#<event_type>#<merchant_trade_no>`.

Config: `s3://flight-config-<ACCOUNT_ID>/flight-routes.json` is the **single source of truth for routes**
(copy in `aws/flight-routes.json`; see "Adding a route" below). Secrets: `flight/travelpayouts`, `flight/resend`, `flight/ecpay` (merchant_id, hash_key, hash_iv, env, amount).
Price change = edit `amount` in `flight/ecpay` (no redeploy; Lambdas cache it per container, so allow a few
minutes). Renewal testing: set `PERIOD_TYPE=D`, `EXEC_TIMES=2` on `flight-save-subscription`, then set it back to `M` / `999`.
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
