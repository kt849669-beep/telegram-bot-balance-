# Matching Mini App

The `/` page displays the original bot commands and numbered lists through the loopback command bridge. The `/dashboard` page provides account search, Check All, Top rechecks and recorded balance-change reports.

Use the [repository deployment guide](../deploy/DEPLOYMENT.md) for production. Start through `runtime/start.cjs` with `MINIAPP_MODE=telegram`; never expose local trust mode to the Internet. Production account files live in `BOT_DATA_DIR`, separate from the source directory.

The Mini App requires signed Telegram launch data and a positive user ID already present in the bot authorization list. Active sessions renew, and expired sessions require valid authentication. A group authorization does not authorize every group member to use the Mini App.

The bot and Mini App share the same account data. The command mirror isolates command state, reuses identical running commands, and preserves the original replies. File uploads retain MPIN extraction and the original Scan/Cancel confirmation.

Daily balance reports contain observations from user-requested checks; they are not third-party transaction/token history. Site history and authenticated screenshots are not connected. In-memory jobs do not survive process restarts.
