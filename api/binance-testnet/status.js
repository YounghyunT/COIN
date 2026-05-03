import { getBinanceTestnetStatus } from "../_lib/binance-futures.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const symbols = String(request.query?.symbols || "BTCUSDC")
      .split(",")
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 4);
    const status = await getBinanceTestnetStatus(symbols);
    response.status(200).json({ ok: true, status });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}
