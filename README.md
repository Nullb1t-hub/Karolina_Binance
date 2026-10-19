# Karolina Binance — Telegram Control Panel

GitHub Actions-powered Telegram controller for preparing and scheduling crypto-event posts for Binance Square.

## Flow
1. Send /start or /panel to the Telegram bot.
2. Choose duration (3/6/12 hours), post count (3/5/8), and language.
3. Press “Find events and prepare”. The controller reads public crypto-news RSS feeds and uses Gemini to draft source-linked posts.
4. Review the drafts. Preparation does not publish.
5. Choose test/live mode, then press Start. Posts are processed gradually during the selected period; Pause stops the campaign.
6. Receive Telegram status and completion messages.

Focus: new token launches/listings, testnets, airdrops, ecosystem launches, security events, partnerships, funding, token unlocks and governance. Routine BTC/ETH price commentary is not the default.

## Required GitHub Actions secrets
- TELEGRAM_BOT_TOKEN
- TELEGRAM_OWNER_ID (numeric Telegram user ID)
- GEMINI_API_KEY
- BINANCE_SQUARE_OPENAPI_KEY (live publishing only)

The .karolina/state.json file stores the Telegram update offset, settings, and public drafts. Never put keys or private messages into it. The repository is public.

## Free operation and limitations
- The controller runs every five minutes. Telegram commands can take several minutes; scheduled runs can be delayed. It is not a real-time server.
- Public GitHub repositories can use standard Actions runners within GitHub policies and limits; Gemini API quotas are separate.
- The workflow requires contents: write to persist campaign state. Do not run the older npm start worker at the same time with this bot token.
- RSS feeds can be unavailable or stale. Posts should be checked before starting a campaign.
- Default mode is dry-run. Binance Square publishing API credentials/endpoints must be validated before relying on live posts. Live mode publishes publicly.
- No trading, wallet access, earnings guarantees, or verified views/click analytics.
