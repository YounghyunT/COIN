import { BOTS } from "./_lib/bots.js";
import { evaluateBot } from "./_lib/strategy.js";
import { getBotState, insertTrade, upsertBotState } from "./_lib/supabase-rest.js";

async function sendTelegram({ bot, signal, price, trade }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || !trade) return null;

  const text = [
    `[Y & K] ${bot.name}: ${signal.label}`,
    `Action: ${trade.side}`,
    `Price: ${Number(price).toLocaleString("en-US")} USDT`,
    `Amount: ${trade.amount.toFixed(6)} BTC`,
    `Reason: ${signal.reason}`,
    `Candle: ${new Date(trade.candle_time * 1000).toISOString()}`,
  ].join("\n");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  return response.json();
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = request.headers.authorization;
  const cronHeader = request.headers["x-vercel-cron"];
  const querySecret = request.query?.secret;

  return auth === `Bearer ${secret}` || querySecret === secret || cronHeader === "1";
}

async function runBot(bot) {
  const previousState = await getBotState(bot.id);
  const result = await evaluateBot(previousState, bot);
  const state = await upsertBotState(result.state, bot.id);
  const trade = await insertTrade(result.trade, bot.id);
  const telegram = await sendTelegram({ bot, signal: result.signal, price: result.price, trade });

  return {
    bot,
    alreadyProcessed: result.alreadyProcessed,
    signal: result.signal,
    state,
    trade,
    telegram,
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  if (!isAuthorized(request)) {
    response.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const results = [];
    for (const bot of BOTS) {
      results.push(await runBot(bot));
    }

    response.status(200).json({ ok: true, results });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
