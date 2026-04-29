# Supabase AI Bot Setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run `supabase/schema.sql`.
   - If the tables already exist, run it again after updates. The `alter table ... add column if not exists` lines safely add new performance columns without deleting existing bot data.
3. Add these environment variables in Vercel:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=your-telegram-chat-id
CRON_SECRET=long-random-string
```

4. Deploy to Vercel.
5. Add these GitHub repository secrets:

```text
BOT_TICK_URL=https://your-vercel-domain.vercel.app/api/bot-tick
CRON_SECRET=the-same-long-random-string-used-in-vercel
```

6. GitHub Actions will call `/api/bot-tick` every 5 minutes.
7. The dashboard reads persisted bot state from `/api/bot-state`.

Vercel Hobby accounts only allow daily Vercel Cron jobs. This project uses GitHub Actions for the 5-minute bot schedule so the Vercel Hobby deployment can still succeed.

The bot stores:

- cash
- BTC balance
- average entry price
- equity
- last processed 1-minute candle
- last signal
- trade history

The current strategy uses:

- Bitcoin Fear and Greed Index <= 60 for aggressive buy permission
- current BTC price no more than 1% above the 20-day moving average for buy pressure
- RSI(14) <= 55 on the 1-minute chart for aggressive buy pressure
- EMA 5/20 and short momentum for extra aggressive entries/exits
- profit >= 0.3% from average entry for test take-profit sell
- loss <= -0.3% from average entry for test stop-loss sell
- Bitcoin Fear and Greed Index >= 55 for sell pressure
- RSI(14) >= 58 on the 1-minute chart for sell pressure
