# Setup

1. Create a Binance Square publishing key at https://www.binance.com/square/creator-center/home
2. Create a Gemini key at https://aistudio.google.com/apikey
3. Use the existing Telegram bot token from BotFather. On first start, send /myid to @carolinainfo_bot to get your numeric Telegram user ID, then configure TELEGRAM_OWNER_ID and restart.
4. Copy .env.example to .env and fill the secrets. Never commit .env.
5. Node.js 20+: run npm install, npm run check, npm start.
6. In Telegram, send /start then /settings. DRY_RUN=true means drafts only; no Binance post is sent.
7. After validating drafts and the key, change DRY_RUN=false and start with a low cadence.

Public Binance Spot/Futures market data is read-only and does not need trading credentials. This project never places trades.

Known limitations in this initial scaffold:
- The code now generates a market-card image and calls Binance Square's image-upload flow. This still must be validated with a real account/API key in dry-run first, then a single real test post.
- Views, ticker clicks and reward payments are not assumed to be available via a public API. Reports mark these as unavailable until a reliable data source is implemented.
- The adaptive Spot/Futures choice is a transparent heuristic based on 24h volatility and funding snapshots, not a predictive trading model.
- scheduleMode=active is saved but full market-hour optimization is not yet implemented.
- State is a local JSON file; production hosting must provide persistent storage.
- Free hosts may sleep or restart. A host must support an always-running worker and persistent storage to avoid missed jobs. No free plan is guaranteed to do this.
- No earnings are guaranteed; trading analysis is informational, not financial advice.
