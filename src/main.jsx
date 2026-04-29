import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bell,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  History,
  Pause,
  Play,
  Radio,
  Send,
  Settings2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import "./styles.css";

const MARKET_SOURCES = [
  {
    name: "Binance Global",
    restBase: "https://api.binance.com/api/v3/klines",
    wsBase: "wss://stream.binance.com:9443/ws",
  },
  {
    name: "Binance US",
    restBase: "https://api.binance.us/api/v3/klines",
    wsBase: "wss://stream.binance.us:9443/ws",
  },
];

const TIMEFRAMES = [
  { label: "1분", value: "1m", caption: "최근 약 8일", stepMs: 60_000, maxRequests: 12 },
  { label: "15분", value: "15m", caption: "최근 약 4개월", stepMs: 15 * 60_000, maxRequests: 12 },
  { label: "1시간", value: "1h", caption: "최근 약 16개월", stepMs: 60 * 60_000, maxRequests: 12 },
  { label: "4시간", value: "4h", caption: "2023년부터", stepMs: 4 * 60 * 60_000, maxRequests: 12 },
  { label: "1일", value: "1d", caption: "2023년부터", stepMs: 24 * 60 * 60_000, maxRequests: 4 },
];

const LONG_HISTORY_START = Date.UTC(2023, 0, 1);
const BINANCE_LIMIT = 1000;

const formatUsd = (value, digits = 2) =>
  Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const roundTime = (ms) => Math.floor(ms / 1000);

function ema(values, period) {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  const output = [];
  let previous = values[0];
  values.forEach((value, index) => {
    previous = index === 0 ? value : value * multiplier + previous * (1 - multiplier);
    output.push(previous);
  });
  return output;
}

function sma(values, period) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / period;
  });
}

function rsi(values, period = 14) {
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

function bollinger(values, period = 20, deviation = 2) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    const middle = slice.reduce((sum, value) => sum + value, 0) / period;
    const variance = slice.reduce((sum, value) => sum + (value - middle) ** 2, 0) / period;
    const band = Math.sqrt(variance) * deviation;
    return { upper: middle + band, middle, lower: middle - band };
  });
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, index) => fast[index] - slow[index]);
  const signal = ema(line, 9);
  return line.map((value, index) => ({
    macd: value,
    signal: signal[index],
    histogram: value - signal[index],
  }));
}

function buildSignal(candles, indicators) {
  const last = candles.at(-1);
  const previous = candles.at(-2);
  if (!last || !previous) return { side: "WAIT", label: "대기", score: 0, reason: "데이터 수집 중" };

  const lastRsi = indicators.rsi.at(-1);
  const lastMacd = indicators.macd.at(-1);
  const prevMacd = indicators.macd.at(-2);
  const emaFast = indicators.emaFast.at(-1);
  const emaSlow = indicators.emaSlow.at(-1);
  const band = indicators.bollinger.at(-1);

  let score = 0;
  const reasons = [];

  if (emaFast > emaSlow) {
    score += 1;
    reasons.push("EMA 9가 EMA 21 위");
  } else {
    score -= 1;
    reasons.push("EMA 9가 EMA 21 아래");
  }

  if (lastMacd && prevMacd && prevMacd.histogram <= 0 && lastMacd.histogram > 0) {
    score += 2;
    reasons.push("MACD 히스토그램 양전환");
  } else if (lastMacd && prevMacd && prevMacd.histogram >= 0 && lastMacd.histogram < 0) {
    score -= 2;
    reasons.push("MACD 히스토그램 음전환");
  }

  if (lastRsi && lastRsi < 32) {
    score += 1;
    reasons.push("RSI 과매도 근접");
  } else if (lastRsi && lastRsi > 68) {
    score -= 1;
    reasons.push("RSI 과매수 근접");
  }

  if (band && last.close < band.lower) {
    score += 1;
    reasons.push("볼린저 하단 이탈");
  } else if (band && last.close > band.upper) {
    score -= 1;
    reasons.push("볼린저 상단 돌파");
  }

  if (last.close > previous.close) score += 0.5;
  else score -= 0.5;

  if (score >= 2) return { side: "BUY", label: "매수 관심", score, reason: reasons.join(", ") };
  if (score <= -2) return { side: "SELL", label: "매도/관망", score, reason: reasons.join(", ") };
  return { side: "WAIT", label: "중립 대기", score, reason: reasons.join(", ") };
}

function buildRestUrl(source, interval, startTime) {
  const url = new URL(source.restBase);
  url.searchParams.set("symbol", "BTCUSDT");
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(BINANCE_LIMIT));
  if (startTime) url.searchParams.set("startTime", String(startTime));
  return url.toString();
}

async function fetchHistoricalCandles(source, timeframe) {
  const rows = [];
  let startTime = LONG_HISTORY_START;

  for (let requestIndex = 0; requestIndex < timeframe.maxRequests; requestIndex += 1) {
    const response = await fetch(buildRestUrl(source, timeframe.value, startTime));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    rows.push(...batch);
    const lastOpenTime = batch.at(-1)?.[0];
    if (!lastOpenTime || batch.length < BINANCE_LIMIT) break;

    startTime = lastOpenTime + timeframe.stepMs;
    if (startTime > Date.now()) break;
  }

  return rows;
}

function useMarketData(interval) {
  const timeframe = useMemo(() => TIMEFRAMES.find((item) => item.value === interval) ?? TIMEFRAMES.at(-1), [interval]);
  const [candles, setCandles] = useState([]);
  const [status, setStatus] = useState({
    mode: "connecting",
    source: "시장 데이터",
    message: "데이터 소스 연결 중",
  });

  useEffect(() => {
    let socket;
    let demoTimer;
    let cancelled = false;
    const stepSeconds = timeframe.stepMs / 1000;

    function parseKlines(rows) {
      return rows.map((row) => ({
        time: roundTime(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
      }));
    }

    function pushCandle(candle) {
      setCandles((current) => {
        const next = current.slice(-11999);
        const last = next.at(-1);
        if (last?.time === candle.time) {
          next[next.length - 1] = candle;
          return [...next];
        }
        return [...next, candle];
      });
    }

    function startDemoMode() {
      const now = Math.floor(Date.now() / timeframe.stepMs) * stepSeconds;
      let price = 95000;
      const seed = Array.from({ length: 180 }, (_, index) => {
        const open = price;
        const drift = (Math.sin(index / 8) + Math.random() - 0.45) * 140;
        price = Math.max(1000, price + drift);
        return {
          time: now - (180 - index) * stepSeconds,
          open,
          high: Math.max(open, price) + Math.random() * 90,
          low: Math.min(open, price) - Math.random() * 90,
          close: price,
          volume: 1 + Math.random() * 8,
        };
      });
      setCandles(seed);
      setStatus({
        mode: "demo",
        source: "Demo feed",
        message: "외부 시세 API 연결 실패. 데모 데이터로 표시 중",
      });

      demoTimer = window.setInterval(() => {
        const last = seed.at(-1);
        const open = last.close;
        price = Math.max(1000, open + (Math.random() - 0.48) * 220);
        const candle = {
          time: Math.floor(Date.now() / timeframe.stepMs) * stepSeconds,
          open,
          high: Math.max(open, price) + Math.random() * 80,
          low: Math.min(open, price) - Math.random() * 80,
          close: price,
          volume: 1 + Math.random() * 8,
        };
        seed.push(candle);
        seed.splice(0, Math.max(0, seed.length - 240));
        pushCandle(candle);
      }, 2500);
    }

    function connectSocket(source) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`${source.wsBase}/btcusdt@kline_${timeframe.value}`);
        const timeout = window.setTimeout(() => {
          ws.close();
          reject(new Error(`${source.name} WebSocket timeout`));
        }, 6000);

        ws.addEventListener("open", () => {
          window.clearTimeout(timeout);
          socket = ws;
          setStatus({
            mode: "live",
            source: source.name,
            message: `${timeframe.label}봉 실시간 WebSocket 연결`,
          });
          resolve(ws);
        });

        ws.addEventListener("close", () => {
          if (!cancelled) {
            setStatus((current) =>
              current.mode === "live"
                ? { ...current, mode: "offline", message: "WebSocket 연결이 종료됨" }
                : current,
            );
          }
        });

        ws.addEventListener("error", () => {
          window.clearTimeout(timeout);
          reject(new Error(`${source.name} WebSocket error`));
        });

        ws.addEventListener("message", (event) => {
          const payload = JSON.parse(event.data);
          const kline = payload.k;
          pushCandle({
            time: roundTime(kline.t),
            open: Number(kline.o),
            high: Number(kline.h),
            low: Number(kline.l),
            close: Number(kline.c),
            volume: Number(kline.v),
          });
        });
      });
    }

    async function boot() {
      const failures = [];

      for (const source of MARKET_SOURCES) {
        try {
          setStatus({
            mode: "connecting",
            source: source.name,
            message: `${timeframe.caption} 캔들 데이터 요청 중`,
          });
          const rows = await fetchHistoricalCandles(source, timeframe);
          if (cancelled) return;
          setCandles(parseKlines(rows));
          await connectSocket(source);
          return;
        } catch (error) {
          failures.push(`${source.name}: ${error.message}`);
        }
      }

      if (!cancelled) {
        console.warn("Market data sources failed", failures);
        startDemoMode();
      }
    }

    boot().catch(() => startDemoMode());

    return () => {
      cancelled = true;
      socket?.close();
      window.clearInterval(demoTimer);
    };
  }, [timeframe]);

  return { candles, status };
}

function BinanceChart({ candles, indicators, interval, onIntervalChange, status }) {
  const [view, setView] = useState({ end: 1, count: 220 });
  const [drag, setDrag] = useState(null);
  const width = 1000;
  const height = 560;
  const chartTop = 28;
  const chartHeight = 400;
  const volumeTop = 452;
  const volumeHeight = 64;
  const pricePad = 58;
  const timePad = 26;
  const chartWidth = width - pricePad - timePad;
  const minViewCount = 35;
  const maxViewCount = candles.length || 220;
  const currentCount = Math.min(Math.max(view.count, minViewCount), maxViewCount);
  const currentEnd = Math.min(Math.max(view.end, currentCount / Math.max(candles.length, 1)), 1);
  const endIndex = Math.min(candles.length, Math.max(currentCount, Math.round(currentEnd * candles.length)));
  const startIndex = Math.max(0, endIndex - currentCount);
  const visibleCandles = candles.slice(startIndex, endIndex);
  const visibleStart = startIndex;
  const visibleHigh = Math.max(...visibleCandles.map((item) => item.high), 1);
  const visibleLow = Math.min(...visibleCandles.map((item) => item.low), visibleHigh * 0.98);
  const priceRange = visibleHigh - visibleLow || 1;
  const maxVolume = Math.max(...visibleCandles.map((item) => item.volume), 1);
  const candleGap = chartWidth / Math.max(visibleCandles.length, 1);
  const candleBody = Math.max(1, Math.min(9, candleGap * 0.58));

  const xAt = (index) => timePad + index * candleGap + candleGap / 2;
  const yAt = (price) => chartTop + ((visibleHigh - price) / priceRange) * chartHeight;
  const volumeY = (volume) => volumeTop + volumeHeight - (volume / maxVolume) * volumeHeight;

  const linePath = (values) => {
    let hasStarted = false;
    return visibleCandles
      .map((_, index) => {
        const value = values[visibleStart + index];
        if (!value) return null;
        const command = hasStarted ? "L" : "M";
        hasStarted = true;
        return `${command} ${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`;
      })
      .filter(Boolean)
      .join(" ");
  };

  const bollingerUpper = linePath(indicators.bollinger.map((item) => item?.upper));
  const bollingerLower = linePath(indicators.bollinger.map((item) => item?.lower));
  const priceTicks = Array.from({ length: 5 }, (_, index) => visibleLow + (priceRange / 4) * index).reverse();
  const timeTicks = visibleCandles.filter((_, index) => index % Math.max(1, Math.floor(visibleCandles.length / 5)) === 0);

  useEffect(() => {
    if (!candles.length) return;
    setView((current) => ({
      end: current.end === 1 ? 1 : Math.min(1, current.end),
      count: Math.min(Math.max(current.count, minViewCount), candles.length),
    }));
  }, [candles.length]);

  useEffect(() => {
    setView({ end: 1, count: interval === "1d" ? 260 : 220 });
  }, [interval]);

  function handleWheel(event) {
    event.preventDefault();
    if (!candles.length) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const zoomFactor = event.deltaY > 0 ? 1.18 : 0.82;

    setView((current) => {
      const oldCount = Math.min(Math.max(current.count, minViewCount), candles.length);
      const oldEnd = Math.min(candles.length, Math.max(oldCount, Math.round(current.end * candles.length)));
      const oldStart = Math.max(0, oldEnd - oldCount);
      const anchor = oldStart + pointerRatio * oldCount;
      const nextCount = Math.round(Math.min(candles.length, Math.max(minViewCount, oldCount * zoomFactor)));
      const nextStart = Math.min(candles.length - nextCount, Math.max(0, Math.round(anchor - pointerRatio * nextCount)));
      const nextEnd = nextStart + nextCount;
      return { count: nextCount, end: nextEnd / candles.length };
    });
  }

  function handlePointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX, end: currentEnd });
  }

  function handlePointerMove(event) {
    if (!drag || !candles.length) return;
    const deltaCandles = ((event.clientX - drag.x) / chartWidth) * currentCount;
    const nextEndIndex = Math.round(drag.end * candles.length - deltaCandles);
    const clampedEnd = Math.min(candles.length, Math.max(currentCount, nextEndIndex));
    setView((current) => ({ ...current, end: clampedEnd / candles.length }));
  }

  function handlePointerUp(event) {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  }

  if (candles.length === 0) {
    return (
      <div className="binance-chart-shell">
        <div className="chart-loading">Binance 캔들 데이터를 불러오는 중</div>
      </div>
    );
  }

  return (
    <div className="binance-chart-shell">
      <div className="chart-toolbar">
        <div>
          <div className="text-xs font-medium text-cyan-300">Binance BTCUSDT</div>
          <div className="mt-1 text-sm text-slate-400">
            {status.message} · {candles.length.toLocaleString("ko-KR")}개 캔들
          </div>
        </div>
        <div className="timeframe-tabs" aria-label="차트 시간봉">
          {TIMEFRAMES.map((item) => (
            <button
              className={item.value === interval ? "active" : ""}
              key={item.value}
              onClick={() => onIntervalChange(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        className={`binance-chart ${drag ? "dragging" : ""}`}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Binance BTCUSDT candlestick chart"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        <rect x="0" y="0" width={width} height={height} fill="#101418" />
        {priceTicks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line x1={timePad} x2={width - pricePad} y1={y} y2={y} stroke="rgba(148, 163, 184, 0.10)" />
              <text x={width - pricePad + 10} y={y + 4} fill="#94a3b8" fontSize="12">
                {formatUsd(tick, 0)}
              </text>
            </g>
          );
        })}
        {bollingerUpper ? <path d={bollingerUpper} fill="none" stroke="rgba(168, 85, 247, 0.65)" strokeWidth="1.4" /> : null}
        {bollingerLower ? <path d={bollingerLower} fill="none" stroke="rgba(168, 85, 247, 0.65)" strokeWidth="1.4" /> : null}
        <path d={linePath(indicators.emaFast)} fill="none" stroke="#f59e0b" strokeWidth="2" />
        <path d={linePath(indicators.emaSlow)} fill="none" stroke="#38bdf8" strokeWidth="2" />
        {visibleCandles.map((candle, index) => {
          const x = xAt(index);
          const up = candle.close >= candle.open;
          const color = up ? "#22c55e" : "#f43f5e";
          const openY = yAt(candle.open);
          const closeY = yAt(candle.close);
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(closeY - openY));
          const vY = volumeY(candle.volume);
          return (
            <g key={`${candle.time}-${index}`}>
              <line x1={x} x2={x} y1={yAt(candle.high)} y2={yAt(candle.low)} stroke={color} strokeWidth="1.4" />
              <rect x={x - candleBody / 2} y={bodyY} width={candleBody} height={bodyHeight} rx="1.5" fill={color} />
              <rect x={x - candleBody / 2} y={vY} width={candleBody} height={volumeTop + volumeHeight - vY} fill={color} opacity="0.25" />
            </g>
          );
        })}
        <line x1={timePad} x2={width - pricePad} y1={volumeTop} y2={volumeTop} stroke="rgba(148, 163, 184, 0.12)" />
        {timeTicks.map((tick) => (
          <text key={tick.time} x={xAt(visibleCandles.indexOf(tick))} y={height - 16} fill="#64748b" fontSize="12" textAnchor="middle">
            {new Date(tick.time * 1000).toLocaleDateString("ko-KR", {
              year: interval === "1d" || interval === "4h" ? "2-digit" : undefined,
              month: "2-digit",
              day: "2-digit",
            })}
          </text>
        ))}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-ema-fast" /> EMA 9</span>
        <span><i className="legend-ema-slow" /> EMA 21</span>
        <span><i className="legend-bollinger" /> Bollinger</span>
        <button type="button" onClick={() => setView({ end: 1, count: interval === "1d" ? 260 : 220 })}>
          최근 구간
        </button>
      </div>
    </div>
  );
}

function IndicatorCard({ title, value, caption, tone }) {
  return (
    <div className="metric-card">
      <div className="text-xs font-medium text-slate-400">{title}</div>
      <div className={`mt-2 text-2xl font-semibold ${tone || "text-slate-50"}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-500">{caption}</div>
    </div>
  );
}

function PaperTrading({ lastPrice, signal }) {
  const [cash, setCash] = useState(10000);
  const [btc, setBtc] = useState(0);
  const [logs, setLogs] = useState([]);
  const equity = cash + btc * lastPrice;

  function trade(side) {
    if (!lastPrice) return;
    if (side === "buy") {
      const spend = Math.min(cash, equity * 0.25);
      if (spend <= 0) return;
      const amount = spend / lastPrice;
      setCash((value) => value - spend);
      setBtc((value) => value + amount);
      setLogs((items) => [{ side: "BUY", price: lastPrice, amount, time: new Date().toLocaleTimeString() }, ...items]);
    } else {
      const amount = Math.min(btc, btc * 0.5 || 0);
      if (amount <= 0) return;
      setCash((value) => value + amount * lastPrice);
      setBtc((value) => value - amount);
      setLogs((items) => [{ side: "SELL", price: lastPrice, amount, time: new Date().toLocaleTimeString() }, ...items]);
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <Wallet size={18} />
        <span>모의투자</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <IndicatorCard title="총 평가금" value={`$${formatUsd(equity)}`} caption="현금 + BTC 평가액" />
        <IndicatorCard title="보유 현금" value={`$${formatUsd(cash)}`} caption="가상 USDT" />
        <IndicatorCard title="보유 BTC" value={btc.toFixed(6)} caption="모의 수량" />
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="action-button buy" onClick={() => trade("buy")}>
          <TrendingUp size={18} />
          매수 체결
        </button>
        <button className="action-button sell" onClick={() => trade("sell")}>
          <TrendingDown size={18} />
          매도 체결
        </button>
        <div className="signal-chip">
          현재 신호 <strong>{signal.label}</strong>
        </div>
      </div>
      <div className="mt-5 max-h-48 overflow-auto rounded-md border border-white/10">
        {logs.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">아직 체결 기록이 없습니다.</div>
        ) : (
          logs.map((log, index) => (
            <div className="trade-row" key={`${log.time}-${index}`}>
              <span className={log.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>{log.side}</span>
              <span>{log.amount.toFixed(6)} BTC</span>
              <span>${formatUsd(log.price)}</span>
              <span className="text-slate-500">{log.time}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function TelegramPanel({ signal, lastPrice }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("Vercel 환경변수 설정 후 전송 가능");

  async function sendSignal() {
    setStatus("전송 중...");
    try {
      const response = await fetch("/api/telegram-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signal: signal.label,
          price: lastPrice,
          reason: signal.reason,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!response.ok) throw new Error("텔레그램 API 응답 실패");
      setStatus("텔레그램으로 신호를 보냈습니다.");
    } catch (error) {
      setStatus("전송 실패: 환경변수 또는 배포 API를 확인하세요.");
    }
  }

  return (
    <section className="panel">
      <div className="section-title">
        <Bot size={18} />
        <span>텔레그램 신호</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] p-3">
        <div>
          <div className="text-sm font-medium text-slate-200">신호 알림 준비</div>
          <div className="text-xs text-slate-500">{status}</div>
        </div>
        <button className={`toggle ${enabled ? "on" : ""}`} onClick={() => setEnabled((value) => !value)}>
          {enabled ? <Play size={15} /> : <Pause size={15} />}
        </button>
      </div>
      <button className="mt-4 w-full justify-center action-button neutral" onClick={sendSignal}>
        <Send size={17} />
        현재 신호 테스트 전송
      </button>
      <div className="mt-4 rounded-md bg-slate-950/60 p-4 text-sm leading-6 text-slate-400">
        Vercel 프로젝트에 <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_CHAT_ID</code>를 등록하면 이 버튼이 실제
        봇 메시지를 보냅니다.
      </div>
    </section>
  );
}

function App() {
  const [interval, setInterval] = useState("1d");
  const selectedTimeframe = TIMEFRAMES.find((item) => item.value === interval) ?? TIMEFRAMES.at(-1);
  const { candles, status } = useMarketData(interval);
  const closes = useMemo(() => candles.map((candle) => candle.close), [candles]);
  const indicators = useMemo(
    () => ({
      emaFast: ema(closes, 9),
      emaSlow: ema(closes, 21),
      rsi: rsi(closes),
      bollinger: bollinger(closes),
      macd: macd(closes),
    }),
    [closes],
  );
  const signal = useMemo(() => buildSignal(candles, indicators), [candles, indicators]);
  const last = candles.at(-1);
  const lastRsi = indicators.rsi.at(-1);
  const lastMacd = indicators.macd.at(-1);
  const lastBand = indicators.bollinger.at(-1);

  return (
    <main className="min-h-screen bg-[#0b0f12] text-slate-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="topbar">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-300">
              <Radio size={16} />
              {status.source} BTCUSDT {selectedTimeframe.label}
            </div>
            <div className="site-name">수학머리와 정보몸통</div>
            <h1>수학정보융합 비트코인 자동매매</h1>
            <div className="taglines">
              <span>규칙은 단 하나, 욕심 부리지말고 프로그램을 믿을 것.</span>
              <span>데이터는 거짓말을 하지 않는다.</span>
            </div>
            <div className="lab-name">[Y & K] BTC Signal Lab</div>
          </div>
          <div className={`connection ${status.mode}`}>
            <span />
            {status.mode === "live" ? "실시간 연결" : status.mode === "demo" ? "데모 모드" : status.mode === "offline" ? "연결 종료" : "연결 중"}
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="panel overflow-hidden p-0">
            <div className="chart-head">
              <div>
                <div className="text-xs text-slate-500">BTCUSDT</div>
                <div className="text-3xl font-semibold">${formatUsd(last?.close)}</div>
              </div>
              <div className={`decision ${signal.side.toLowerCase()}`}>
                {signal.side === "BUY" ? <TrendingUp size={18} /> : signal.side === "SELL" ? <TrendingDown size={18} /> : <Activity size={18} />}
                {signal.label}
              </div>
            </div>
            <BinanceChart
              candles={candles}
              indicators={indicators}
              interval={interval}
              onIntervalChange={setInterval}
              status={status}
            />
          </div>

          <aside className="flex flex-col gap-4">
            <section className="panel">
              <div className="section-title">
                <Bell size={18} />
                <span>매수/매도 판단</span>
              </div>
              <div className={`signal-box ${signal.side.toLowerCase()}`}>
                <div className="text-sm text-slate-400">현재 판단</div>
                <div className="mt-1 text-3xl font-semibold">{signal.label}</div>
                <div className="mt-3 text-sm leading-6 text-slate-300">{signal.reason}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <IndicatorCard title="신뢰 점수" value={signal.score.toFixed(1)} caption="규칙 기반 합산" />
                <IndicatorCard title="업데이트" value={last ? new Date(last.time * 1000).toLocaleTimeString() : "--"} caption={status.message} />
              </div>
            </section>
            <TelegramPanel signal={signal} lastPrice={last?.close} />
          </aside>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          <IndicatorCard
            title="RSI 14"
            value={lastRsi ? lastRsi.toFixed(1) : "--"}
            caption={lastRsi > 70 ? "과매수 구간" : lastRsi < 30 ? "과매도 구간" : "중립 구간"}
            tone={lastRsi > 70 ? "text-rose-400" : lastRsi < 30 ? "text-emerald-400" : "text-slate-50"}
          />
          <IndicatorCard
            title="MACD"
            value={lastMacd ? lastMacd.histogram.toFixed(2) : "--"}
            caption="히스토그램"
            tone={lastMacd?.histogram > 0 ? "text-emerald-400" : "text-rose-400"}
          />
          <IndicatorCard title="EMA 9 / 21" value={`${formatUsd(indicators.emaFast.at(-1), 0)} / ${formatUsd(indicators.emaSlow.at(-1), 0)}`} caption="단기 추세" />
          <IndicatorCard title="Bollinger" value={lastBand ? `${formatUsd(lastBand.lower, 0)} - ${formatUsd(lastBand.upper, 0)}` : "--"} caption="20, 2σ 밴드" />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <PaperTrading lastPrice={last?.close || 0} signal={signal} />
          <section className="panel">
            <div className="section-title">
              <Settings2 size={18} />
              <span>배포 체크</span>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-400">
              <div className="check-row">
                <CheckCircle2 size={16} />
                GitHub 저장소 연결 후 Vercel Import
              </div>
              <div className="check-row">
                <CheckCircle2 size={16} />
                Build Command: <code>npm run build</code>
              </div>
              <div className="check-row">
                <CheckCircle2 size={16} />
                Output Directory: <code>dist</code>
              </div>
              <div className="check-row">
                <CheckCircle2 size={16} />
                텔레그램 환경변수 2개 등록
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
