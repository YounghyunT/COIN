import { getBotState, getRecentTrades, getTradeCount, getTradeStats } from "./_lib/supabase-rest.js";
import { getBotConfig } from "./_lib/bots.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const bot = getBotConfig(request.query?.bot);
    const [state, trades, tradeCount, tradeStats] = await Promise.all([
      getBotState(bot.id),
      getRecentTrades(200, bot.id),
      getTradeCount(bot.id),
      getTradeStats(bot.id),
    ]);
    response.status(200).json({ ok: true, bot, state, trades, tradeCount, tradeStats });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
