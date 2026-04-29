# Supabase AI Bot Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run `supabase/schema.sql`.
3. Add these environment variables in Vercel:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
CRON_SECRET=long-random-string
```

4. Deploy to Vercel.
5. Vercel Cron will call `/api/bot-tick` every 15 minutes.
6. The dashboard reads persisted bot state from `/api/bot-state`.

The bot stores:

- cash
- BTC balance
- average entry price
- equity
- last processed 15-minute candle
- last signal
- trade history

The current strategy uses:

- Bitcoin Fear and Greed Index <= 30 for buy pressure
- current BTC price at least 3% below the 20-day moving average for buy pressure
- RSI(14) <= 30 on the 15-minute chart for buy pressure
- profit >= 10% from average entry for take-profit sell
- loss <= -5% from average entry for stop-loss sell
- Bitcoin Fear and Greed Index >= 70 for sell pressure
- RSI(14) >= 70 on the 15-minute chart for sell pressure

