# Telegram Bot + Mini App

The existing 14-site Telegram bot and its matching white/black Mini App, packaged for persistent Linux VPS hosting with Cloudflare HTTPS and explicit direct or proxy connections to site APIs.

**Deployment status (29 September 2026):** bot and Mini App deployed on a Linux VPS with a dedicated Cloudflare Tunnel at [miniapp.app-showpay.in](https://miniapp.app-showpay.in/). Outgoing site requests use direct IPv4 with `SITE_NETWORK_MODE=direct`. Open the Mini App through the Telegram bot's menu using an authorized Telegram account. GitHub stores the code; the VPS runs the services.

An initial direct test with one saved account per site passed all 14 logins and balance reads. After deployment, the original `/balance` handler completed a 70-account sample with 40 successful checks and 30 failures. A separate one-attempt diagnostic with three accounts in flight received 9 successful balances, 60 temporary application errors and one account-attempt warning. Neither test detected a Cloudflare challenge. This verifies direct connectivity, not error-free bulk checking; further account retries were stopped after the warning. The routing change passes 25 automated checks. Existing bot handlers, saved data, other VPS applications, and the main domain's DNS configuration are preserved.

## Included

- Original `/start`, `/add`, `/scan`, `/ocr`, `/check`, `/edit`, `/balance`, `/password`, `/list`, and `/restart` flows, keyboards, numbered lists, and replies.
- The same command flow in the Mini App, using the original bot handlers through a private loopback bridge.
- Photo/PDF credential extraction and six-digit MPIN preservation, including leading zeros.
- Dashboard with Check All, Top 10/50/100 rechecks, number/ID search, recorded balance changes, and summary exports.
- Telegram-signed authentication, an authorized-user list, session renewal, CSRF/origin checks, and explicitly requested password/MPIN reveal.
- Independent Mini App commands, duplicate-command coalescing, bounded temporary-error retries, and persistent balance observations.
- Explicit direct IPv4 or proxy routing for all 14 configured site APIs. Telegram traffic and local bridge downloads use their normal connections. Proxy mode still requires a valid endpoint and has no automatic direct fallback.
- Docker Compose services with restart policies, health checks, private persistent data, and an optional Cloudflare Tunnel service.

## Repository layout

| Directory | Purpose |
|---|---|
| `bot/` | Existing bot handlers and MPIN/PDF support |
| `miniapp/` | Interface, authenticated API, command bridge, reports and tests |
| `runtime/` | Environment configuration, direct/proxy routing, service startup and health checks |
| `deploy/` | Deployment instructions and tunnel configuration template |
| `test/` | Production configuration and routing tests using synthetic data |

The deployment copy replaces inline secrets and PC-specific storage locations with environment configuration, and removes message/credential logging. The source PC project and its account files are not modified by this package.

## Check locally

Use Node.js 22 or newer. Run `npm ci --ignore-scripts`, then `npm test`. The test runner supplies synthetic credentials and mocked site responses; it does not poll Telegram or log into real wallet accounts.

The package passed 25 tests covering existing commands, MPIN/OCR flow, session recovery, authorization, private bridge, shared writes, reports, retries, explicit direct routing, proxy routing, refusal of automatic direct fallback, and production configuration.

## Deploy

Follow [the VPS and Cloudflare setup](deploy/DEPLOYMENT.md). Real bot/proxy credentials belong only in `private/config.env` on the VPS. Existing wallet and authorization files must be transferred directly to private server storage, never through GitHub. No live credentials or user account files are included in this repository.

A running VPS, Cloudflare HTTPS configuration, private data migration, and a successful remote smoke test are required before the PC can be switched off. Set `SITE_NETWORK_MODE=direct` to use the VPS IPv4 without a site proxy. To use a proxy, set `SITE_NETWORK_MODE=proxy` and supply `SITE_PROXY_URL`. An omitted mode keeps the older proxy-required behavior. Target sites can still reject credentials, rate-limit, or challenge requests in either mode.

## Current limits

Third-party home-page and token-history screenshots and transaction-history APIs are not connected. Exported summaries show this dashboard's recorded balance observations. Reports require actual checks; automatic daily checks have not been scheduled. Running jobs and interactive session state are held in memory and do not resume after a process restart. Persistent account files and recorded balance observations survive service restarts.
