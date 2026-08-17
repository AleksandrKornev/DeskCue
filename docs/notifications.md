# Notifications

DeskCue can send session and agent events through browser Web Push, ntfy,
Gotify, Telegram, or a webhook. Providers, event routes, test delivery, and
recent delivery diagnostics are configured from the Notifications settings tab.
DeskCue does not run a hosted notification relay.

## Events and routes

The current events are:

- `approval.required`
- `session.finished`
- `session.failed`
- `agent.turn.finished`

Each event has its own provider list. A provider must be enabled and included in
that event's route before DeskCue sends a real notification to it. Test delivery
is provider-specific and does not change a session.

## Providers

### Browser Web Push

Web Push belongs to a browser profile, not a DeskCue account. Enabling it creates
a subscription for the current browser. The settings UI can list registered
push sessions and stop DeskCue delivery to the current browser or another one.
Removing a subscription from DeskCue does not change that browser's OS-level
notification permission.

The browser must run in a secure context: HTTPS, or localhost on the same
device. A plain LAN `http://` address cannot create a Push API subscription.
DeskCue waits for an active service worker before subscribing and removes stale
subscriptions after 180 days without a successful delivery.

### ntfy

Configure a complete topic URL. DeskCue sends the notification body directly to
that URL. Use a private topic or authenticated endpoint for sensitive work.

### Gotify

Configure the server URL and application token. The token is local secret
configuration and is not included in diagnostics responses.

### Telegram

Configure a bot token and chat id, or use the short-lived pairing flow in the
settings UI. Pairing sessions expire after two minutes. Telegram delivery uses
the normal network path first and can retry over IPv4 after network failures.

### Webhook

Configure an HTTP(S) URL and optional request headers in the settings UI. Only
send webhooks to a receiver you trust, because notification metadata leaves the
DeskCue host.

`DESKCUE_SESSION_WEBHOOK_URL` remains as a source-checkout compatibility/default
setting for session webhooks. Prefer the dashboard settings for new setups.
`DESKCUE_NOTIFICATION_PROVIDER_TIMEOUT_MS` sets the deadline for each external
provider attempt and defaults to 10 seconds. The older
`DESKCUE_SESSION_WEBHOOK_TIMEOUT_MS` name is only a fallback when the canonical
variable is unset.

## Delivery and persistence

Retryable failures from external providers go into the SQLite notification
outbox. The attempt limit is fixed when the record is created. The outbox keeps
at most 1,000 records and expires them after seven days; when it is full, the
oldest records are removed. Pending retries survive a normal daemon restart.

Web Push fan-out is handled per subscription. Permanently expired browser
endpoints are removed instead of being retried forever.

The Notifications tab shows the last attempt, last success, last failure, and
pending retry count. A timeout or `uncertain` result means the daemon could not
prove whether the remote provider accepted the request. It does not mean the
DeskCue session itself failed.

## API Summary

- `GET /api/notifications/settings`
- `PATCH /api/notifications/settings`
- `POST /api/notifications/test`
- `POST /api/notifications/telegram/pairing/start`
- `POST /api/notifications/telegram/pairing/resolve`
- `GET /api/push/status`
- `GET /api/push/vapid-public-key`
- `GET|POST|DELETE /api/push/subscriptions...`
- `POST /api/push/test`

Provider credentials, raw push keys, access tokens, and prompt bodies must not
be written to operational logs or returned in delivery diagnostics.
