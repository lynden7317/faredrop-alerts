# AWS backend (M1)

Single-file Lambdas (handler `index.handler`, python3.12, role `flight-lambda-role`, region us-east-1).
Each is deployed as an inline CloudFormation stack named after the function. The deployed code is
the source of truth; these copies are kept in sync for review and redeploys.

| File | Function | Trigger |
|---|---|---|
| flight-save-subscription.py | `flight-save-subscription` | `POST /subscribe` (HTTP API `flight-api`) |
| flight-list-subscriptions.py | `flight-list-subscriptions` | `GET /subscriptions?email=` |
| flight-parser-wrapper.py | `flight-parser-wrapper` | EventBridge `flight-price-check`, rate(30 minutes) |
| flight-parser.py | `flight-parser` | async invoke from the wrapper, one route per call |
| flight-fare-notification.py | `flight-fare-notification` | SQS `flight-fare-queue` (batch size 1) |

Data: DynamoDB `subscriptions` (email, route) and `notification_history` (pk = email#route, sent_at).
Config: `s3://flight-config-<ACCOUNT_ID>/flight-routes.json`. Secrets: `flight/travelpayouts`, `flight/resend`.
Dedup knobs (env on the notification Lambda): NOTIFY_FLOOR_HOURS=24, REALERT_PCT=20, REALERT_ABS_TWD=2000.
