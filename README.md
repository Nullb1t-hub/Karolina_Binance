# Karolina Binance AI Agent

Telegram-controlled Binance Square publishing assistant. This repository is the initial project scaffold; it does not publish anything until credentials are configured and you press Start in Telegram.

## Safety

- Never add API keys to source code or commit `.env`.
- Binance market data is read-only; no trading endpoints or trade permissions are required.
- Start in preview/dry-run mode and publish a single test post before enabling a schedule.
- Generated trading analysis is informational, not financial advice.

## Status

Initial repository setup. See `.env.example` and `docs/SETUP.md` for configuration. Free hosting must support a continuously running worker and persistent state; sleeping serverless/free instances can miss scheduled posts.