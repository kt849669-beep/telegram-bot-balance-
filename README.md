# Telegram Bot + Mini App

The existing 14-site Telegram bot and its matching white/black Mini App, packaged for persistent Linux VPS hosting with Cloudflare HTTPS and a separately configured mobile proxy.

**Deployment status:** source and deployment configuration prepared; no VPS has been provisioned and no production URL is live from this repository yet. GitHub stores the code; it does not run the bot. Cloudflare Workers & Pages alone does not run this existing polling/filesystem/OCR workflow.

## Included

- Original `/start`, `/add`, `/scan`, `/ocr`, `/check`, `/edit`, `/balance`, `/password`, `/list`, and `/restart` flows, keyboards, numbered lists, and replies.
- The same command flow in the Mini App, using the original bot handlers through a private loopback bridge.
- Photo/PDF credential extraction and six-digit MPIN preservation, including leading zeros.
- Dashboard with Check All, Top 10/50/100 rechecks, number/ID search, recorded balance changes, and summary exports.
- Telegram-signed authentication, an authorized-user list, session renewal, CSRF/origin checks, and explicitly requested password/MPIN reveal.
- Independent Mini App commands, duplicate-command coalescing, bounded temporary-error retries, and persistent balance observations.
- Proxy routing for all 14 configured site APIs. Telegram traffic and local bridge downloads use their normal connections. There is no fallback from a failed site proxy to the VPS public IP.
- Docker Compose services with restart policies, health checks, private persistent data, and an optional Cloudflare Tunnel service.

## Repository layout

| Directory | Purpose |
|---|---|
| `bot/` | Existing bot handlers and MPIN/PDF support |
| `miniapp/` | Interface, authenticated API, command bridge, reports and tests |
| `runtime/` | Environment configuration, proxy routing, service startup and health checks |
| `deploy/` | Deployment instructions and tunnel configuration template |
| `test/` | Production configuration and routing tests using synthetic data |

The deployment copy replaces inline secrets and PC-specific storage locations with environment configuration, and removes message/credential logging. The source PC project and its account files are not modified by this package.

## Check locally

Use Node.js 22 or newer. Run `npm ci --ignore-scripts`, then `npm test`. The test runner supplies synthetic credentials and mocked site responses; it does not poll Telegram or log into real wallet accounts.

The package passed 23 tests covering existing commands, MPIN/OCR flow, session recovery, authorization, private bridge, shared writes, reports, retries, proxy routing, refusal of direct API fallback, and production configuration.

## Deploy

Follow [the VPS and Cloudflare setup](deploy/DEPLOYMENT.md). Real bot/proxy credentials belong only in `private/config.env` on the VPS. Existing wallet and authorization files must be transferred directly to private server storage, never through GitHub. No live credentials or user account files are included in this repository.

A running VPS, active proxy traffic allowance, Cloudflare HTTPS configuration, private data migration, and a successful remote smoke test are required before the PC can be switched off. A mobile proxy can rotate or fail; a successful connection is not a guarantee that third-party sites will always accept it.

## Current limits

Third-party home-page and token-history screenshots and transaction-history APIs are not connected. Exported summaries show this dashboard's recorded balance observations. Reports require actual checks; automatic daily checks have not been scheduled. Running jobs and interactive session state are held in memory and do not resume after a process restart. Persistent account files and recorded balance observations survive service restarts.
