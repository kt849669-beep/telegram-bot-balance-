# VPS deployment with Cloudflare HTTPS

This is a deployment package, not evidence of a running service. Provisioning a VPS, Cloudflare login, a public hostname, transferring private data, and a remote smoke test are required before announcing the bot live.

Use a Linux VPS with Docker Engine and the Compose plugin. A VPS with 2 GB RAM is a starting point; OCR and concurrent work may require more. Keep exactly one Telegram polling instance active. Stop the PC instance before starting the server instance.

1. Clone this repository on the VPS. Create `private/data/bot`, `private/data/reports`, `private/data/bridge` and `private/data/cache`. Restrict `private` to the deploying administrator and set data ownership to UID/GID 1000 for the app containers.
2. Transfer the existing `wallets.json`, `wallets_backup.json`, `wallets_backup2.json`, and `auth.json` into `private/data/bot` over an authenticated SSH connection. Preserve the PC originals. Transfer existing Mini App balance observations into `private/data/reports` to retain report history. Do not commit any of these files.
3. Put the existing bot token, administrator password, the chosen HTTPS `PUBLIC_ORIGIN`, and explicit `SITE_NETWORK_MODE=direct` into `private/config.env`, using `.env.example` as the template. Direct mode requires no proxy credentials. To deliberately use a proxy instead, set `SITE_NETWORK_MODE=proxy` and configure `SITE_PROXY_URL`. Keep the file mode `0600`. Do not paste credentials into shell command arguments, build logs, or screenshots. The existing positive Telegram user IDs in `auth.json` control Mini App access.
4. In Cloudflare, create a named Cloudflare Tunnel and a public hostname under a domain you control. Route that hostname to `http://127.0.0.1:8787`. Keep the HTTP Host header equal to the public hostname. Put the tunnel token into `private/tunnel.env` as `TUNNEL_TOKEN=...`. A temporary Quick Tunnel is not the permanent deployment plan.
5. Run `docker compose build`, then `docker compose run --rm bot node /app/runtime/check-config.cjs`. Resolve failures without printing the environment. Run `docker compose --profile cloudflare up -d` once the configuration and data are verified.
6. Verify both service health checks, the public HTTPS page, an unauthenticated API rejection, authorized Telegram Mini App launch, original command lists, authorized login/balance requests through the selected network mode, and restart persistence. Only then set the Telegram menu button to the HTTPS Mini App URL.

The Node services bind to loopback. Cloudflare Tunnel runs on the VPS, so the PC is not required. The VPS must stay active; direct mode does not consume proxy traffic. Incoming Mini App traffic continues to use Cloudflare HTTPS. Outgoing wallet API requests use the explicitly selected direct or proxy mode. Telegram downloads and the private Mini App bridge do not use the site proxy.

If no network mode is specified, the older proxy-required behavior remains in place. In proxy mode, an outage produces a visible check failure and never silently sends requests directly. Both modes retain the fourteen-site HTTPS destination checks and disable redirects for site API calls. Successful tests do not guarantee future acceptance by every site.

Check application responses as well as HTTP status: a site can return HTTP 200 with application code 500 and a temporary-error message. The 29 September direct deployment passed service/authentication checks, but bulk account tests still received these application errors and an account-attempt warning. Do not treat healthy containers or the absence of Cloudflare challenges as proof that every saved account can be checked successfully. Stop further diagnostic retries when an account reports a lockout or attempt warning.

For an existing deployment, privately back up `private/config.env` and the current runtime files before changing mode. Build and validate the replacement image before recreating only `bot` and `miniapp` with `docker compose up -d --no-deps bot miniapp`. Do not restart unrelated services or the Cloudflare connector for an outbound-mode change. Confirm service health, mode, account checks and data preservation afterwards.

Wallet files and balance observations persist under `private/data`. In-memory jobs and interactive sessions do not survive a process restart. Docker restarts a stopped/crashed process and starts it after VPS reboot; a health failure is diagnostic and does not by itself restart a running container.

Back up private data securely outside the VPS. Keep backups out of Git, container images, public web directories, and support screenshots. Do not switch off the PC until the remote checks and private data transfer are complete.

## Cloudflare Workers & Pages

This exact bot uses a continuous Telegram polling process, filesystem-backed state, and OCR workers. Workers & Pages is not a VPS. Deploying only the HTML to Pages does not run the bot or its API. The recommended configuration above uses Cloudflare for HTTPS and a VPS for the original Node workflow. Cloudflare Containers is a separate paid hosting option and would require its own persistent-storage design and validation before use.
