# Telegram Bot + Mini App

The existing 14-site Telegram bot and its matching white/black Mini App, packaged for persistent Linux VPS hosting with Cloudflare HTTPS and explicit direct or proxy connections to site APIs.

**Deployment status (30 September 2026):** bot and Mini App deployed on a Linux VPS with a dedicated Cloudflare Tunnel at [miniapp.app-showpay.in](https://miniapp.app-showpay.in/). Outgoing site requests use direct IPv4 with `SITE_NETWORK_MODE=direct`. Open the Mini App through the Telegram bot's menu using an authorized Telegram account. GitHub stores the code; the VPS runs the services.

An initial direct test with one saved account per site passed all 14 logins and balance reads. Bulk checks also received temporary application errors despite HTTP 200 responses; no Cloudflare challenges were detected in those tests. Direct connectivity does not guarantee that a site will accept every account or request.

`/balance` now shows its first full result before retrying temporary failures such as “Please try again later”. Successful accounts and credential/account-lockout errors are excluded. The single deferred pass waits at least eight seconds, spaces retries for each site by eight seconds, respects `Retry-After`, and permits at most three simultaneous retry requests in the bot/command-bridge process. It then sends the combined final count and updated results for the retried accounts. Persistent failures remain visible; they do not loop indefinitely. The same handler runs in Telegram and the Mini App commands view. The dashboard keeps its existing job scheduler.

A live VPS sample on 30 September used three saved accounts each on OlaPay, ATG Game and OPay. The first report contained 3 successful checks and 6 “Please try again later” responses. Only those 6 entries were retried, beginning eight seconds after the first report; the final result was 9/9 successful. No account warnings or Cloudflare challenges occurred in that sample. The diagnostic used the deployed handler and real site APIs with replies and session updates held in memory; it did not send Telegram messages or modify stored account files. All 34 automated checks also passed inside the deployment image.

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

The package passed 34 tests covering existing commands, MPIN/OCR flow, session recovery, authorization, private bridge, shared writes, reports, deferred retry ordering and pacing, cancellation, concurrent command limits, credential edits during retries, large Telegram reports, explicit direct routing, proxy routing, refusal of automatic direct fallback, and production configuration.

## Deploy

Follow [the VPS and Cloudflare setup](deploy/DEPLOYMENT.md). Real bot/proxy credentials belong only in `private/config.env` on the VPS. Existing wallet and authorization files must be transferred directly to private server storage, never through GitHub. No live credentials or user account files are included in this repository.

A running VPS, Cloudflare HTTPS configuration, private data migration, and a successful remote smoke test are required before the PC can be switched off. Set `SITE_NETWORK_MODE=direct` to use the VPS IPv4 without a site proxy. To use a proxy, set `SITE_NETWORK_MODE=proxy` and supply `SITE_PROXY_URL`. An omitted mode keeps the older proxy-required behavior. Target sites can still reject credentials, rate-limit, or challenge requests in either mode.

## Current limits

Third-party home-page and token-history screenshots and transaction-history APIs are not connected. Exported summaries show this dashboard's recorded balance observations. Reports require actual checks; automatic daily checks have not been scheduled. Running jobs and interactive session state are held in memory and do not resume after a process restart. Persistent account files and recorded balance observations survive service restarts.
