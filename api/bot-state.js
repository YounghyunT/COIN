import { getBotState, getRecentTrades, getTradeCount, getTradeStats } from "./_lib/supabase-rest.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const [state, trades, tradeCount, tradeStats] = await Promise.all([
      getBotState(),
      getRecentTrades(200),
      getTradeCount(),
      getTradeStats(),
    ]);
    response.status(200).json({ ok: true, state, trades, tradeCount, tradeStats });
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
