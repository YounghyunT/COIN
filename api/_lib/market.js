const MARKET_SOURCES = [
  {
    name: "Binance Global",
    restBase: "https://api.binance.com/api/v3/klines",
  },
  {
    name: "Binance US",
    restBase: "https://api.binance.us/api/v3/klines",
  },
];

const FEAR_GREED_ENDPOINT = "https://api.alternative.me/fng/?limit=1";

export function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return [];
  const output = Array(period).fill(null);
  let gains = 0;
  let losses = 0;

  for (let index = 1; index <= period; index += 1) {
    const diff = values[index] - values[index - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  output.push(100 - 100 / (1 + avgGain / (avgLoss || 1)));

  for (let index = period + 1; index < values.length; index += 1) {
    const diff = values[index] - values[index - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    output.push(100 - 100 / (1 + avgGain / (avgLoss || 1)));
  }

  return output;
}

function buildKlinesUrl(source, interval, limit) {
  const url = new URL(source.restBase);
  url.searchParams.set("symbol", "BTCUSDT");
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

function parseKlines(rows) {
  const now = Date.now();
  return rows
    .filter((row) => Number(row[6]) < now)
    .map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      closeTime: Number(row[6]),
    }));
}

export async function fetchCandles(interval, limit = 200) {
  const failures = [];

  for (const source of MARKET_SOURCES) {
    try {
      const response = await fetch(buildKlinesUrl(source, interval, limit));
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const rows = await response.json();
      const candles = parseKlines(rows);
      if (!candles.length) throw new Error("No closed candles returned");
      return { source: source.name, candles };
    } catch (error) {
      failures.push(`${source.name}: ${error.message}`);
    }
  }

  throw new Error(`Market data failed: ${failures.join("; ")}`);
}

export async function fetchFearGreedIndex() {
  const response = await fetch(FEAR_GREED_ENDPOINT);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const payload = await response.json();
  const item = payload?.data?.[0];
  const value = Number(item?.value);
  if (!Number.isFinite(value)) throw new Error("Fear and Greed payload is invalid");

  return {
    value,
    label: item?.value_classification ?? "Unknown",
    updatedAt: item?.timestamp ? new Date(Number(item.timestamp) * 1000).toISOString() : null,
  };
}

