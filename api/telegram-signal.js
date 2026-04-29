export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    response.status(500).json({ ok: false, error: "Telegram env vars are missing" });
    return;
  }

  try {
    const { signal, price, reason, timeframe, trend, timestamp } = request.body ?? {};
    const text = [
      `[Y & K] BTC Signal Lab: ${signal ?? "NEUTRAL"}`,
      timeframe ? `Timeframe: ${timeframe}` : null,
      price ? `Price: ${Number(price).toLocaleString("en-US")} USDT` : null,
      reason ? `Reason: ${reason}` : null,
      trend ? `Trend filter: ${trend}` : null,
      timestamp ? `Time: ${timestamp}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    const payload = await telegramResponse.json();
    response.status(telegramResponse.ok ? 200 : 502).json(payload);
  } catch (error) {
    response.status(500).json({ ok: false, error: error.message });
  }
}
