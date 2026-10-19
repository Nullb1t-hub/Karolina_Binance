# Karolina Binance AI Agent

A Telegram-controlled assistant for Binance Square market-analysis posts.

## Current modules
- Binance public Spot and USD-M Futures market snapshots (no trading API key).
- Gemini-generated posts in a language selected in Telegram.
- Spot/Futures adaptive mode and manual ratio mode.
- Automatically generated market-card images and Binance Square image upload flow.
- Telegram controls, schedule, recent-post journal and status reports.
- Local JSON state and a health endpoint.
- GitHub Actions syntax checks.

## Safety defaults
- DRY_RUN=true sends generated drafts to Telegram but does not publish.
- No order placement, wallet access or trade permissions.
- Conservative internal daily cap and minimum interval.
- Never commit .env or share API keys.
- Market analysis is not financial advice; income is not guaranteed.

## Start
See docs/SETUP.md. This initial scaffold has not yet been run against the user's live Telegram or Binance credentials. Creator Center analytics such as views and ticker click-throughs are not integrated until a supported data source is verified.

## Hosting note
This worker needs to stay alive and keep persistent state. Many free web hosts sleep or erase local files; choose a host that supports an always-on worker and persistent storage before enabling automatic publishing.
