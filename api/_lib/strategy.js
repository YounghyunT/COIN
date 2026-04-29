import { fetchCandles, fetchFearGreedIndex, rsi, sma } from "./market.js";

const INITIAL_CASH = 10000;
const POSITION_SIZE = 0.25;

function buildStrategySignal({ alertCandles, dailyCandles, fearGreed, entryPrice }) {
  const last = alertCandles.at(-1);
  if (!last) return { side: "WAIT", label: "대기", score: 0, reason: "15분봉 데이터 수집 중" };

  const alertCloses = alertCandles.map((candle) => candle.close);
  const dailyCloses = dailyCandles.map((candle) => candle.close);
  const ma20 = sma(dailyCloses, 20).at(-1);
  const rsi14 = rsi(alertCloses).at(-1);
  const fearGreedValue = fearGreed?.value;
  const price = last.close;
  const ma20Gap = ma20 ? ((price - ma20) / ma20) * 100 : null;
  const pnl = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
  const buyReasons = [];
  const sellReasons = [];
  let buyScore = 0;
  let sellScore = 0;

  if (fearGreedValue !== null && fearGreedValue !== undefined) {
    if (fearGreedValue <= 30) {
      buyScore += 2;
      buyReasons.push(`공포·탐욕 지수 ${fearGreedValue}: 공포 구간`);
    }
    if (fearGreedValue >= 70) {
      sellScore += 2;
      sellReasons.push(`공포·탐욕 지수 ${fearGreedValue}: 탐욕 구간`);
    }
  }

  if (ma20Gap !== null) {
    if (ma20Gap <= -3) {
      buyScore += 2;
      buyReasons.push(`현재가가 20일선 대비 ${Math.abs(ma20Gap).toFixed(1)}% 낮음`);
    } else {
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%`);
    }
  }

  if (rsi14) {
    if (rsi14 <= 30) {
      buyScore += 2;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 과매도`);
    } else if (rsi14 <= 35) {
      buyScore += 1;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 과매도 근접`);
    } else {
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}`);
    }

    if (rsi14 >= 70) {
      sellScore += 2;
      sellReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 과매수`);
    }
  }

  if (pnl !== null) {
    if (pnl >= 10) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 +${pnl.toFixed(1)}%: 익절 조건`);
    } else if (pnl <= -5) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 ${pnl.toFixed(1)}%: 손절 조건`);
    } else {
      sellReasons.push(`매수가 대비 ${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}%`);
    }
  } else {
    sellReasons.push("보유 포지션 없음");
  }

  if (entryPrice && sellScore >= 3) {
    return { side: "SELL", label: "매도 신호", score: sellScore, reason: sellReasons.join(", ") };
  }

  if (!entryPrice && buyScore >= 4) {
    return { side: "BUY", label: "매수 신호", score: buyScore, reason: buyReasons.join(", ") };
  }

  if (entryPrice) {
    return { side: "WAIT", label: "보유 대기", score: Math.max(buyScore, sellScore), reason: sellReasons.join(", ") };
  }

  return { side: "WAIT", label: buyScore >= 3 ? "매수 관찰" : "중립 대기", score: buyScore, reason: buyReasons.join(", ") };
}

function defaultState() {
  return {
    id: "default",
    cash: INITIAL_CASH,
    btc: 0,
    avg_entry: null,
    last_candle_time: null,
    last_run_at: null,
    last_signal: null,
  };
}

export async function evaluateBot(previousState) {
  const state = previousState ?? defaultState();
  const [{ candles: alertCandles, source }, { candles: dailyCandles }, fearGreed] = await Promise.all([
    fetchCandles("15m", 240),
    fetchCandles("1d", 80),
    fetchFearGreedIndex(),
  ]);

  const last = alertCandles.at(-1);
  const price = last.close;
  const hasPosition = Number(state.btc) > 0 && Number(state.avg_entry) > 0;
  const signal = buildStrategySignal({
    alertCandles,
    dailyCandles,
    fearGreed,
    entryPrice: hasPosition ? Number(state.avg_entry) : null,
  });
  const alreadyProcessed = Number(state.last_candle_time) === Number(last.time);
  const nextState = {
    ...defaultState(),
    ...state,
    cash: Number(state.cash ?? INITIAL_CASH),
    btc: Number(state.btc ?? 0),
    avg_entry: state.avg_entry === null || state.avg_entry === undefined ? null : Number(state.avg_entry),
    last_candle_time: last.time,
    last_run_at: new Date().toISOString(),
    last_signal: {
      ...signal,
      price,
      fearGreed,
      source,
      candleTime: last.time,
      alreadyProcessed,
    },
  };
  let trade = null;

  if (!alreadyProcessed && signal.side === "BUY" && nextState.cash > 0) {
    const equity = nextState.cash + nextState.btc * price;
    const spend = Math.min(nextState.cash, equity * POSITION_SIZE);
    const amount = spend / price;
    const nextBtc = nextState.btc + amount;
    nextState.avg_entry = ((nextState.avg_entry || 0) * nextState.btc + spend) / nextBtc;
    nextState.cash -= spend;
    nextState.btc = nextBtc;
    trade = { side: "BUY", price, amount, cash_delta: -spend, reason: signal.reason, candle_time: last.time };
  }

  if (!alreadyProcessed && signal.side === "SELL" && nextState.btc > 0) {
    const amount = nextState.btc;
    const proceeds = amount * price;
    nextState.cash += proceeds;
    nextState.btc = 0;
    nextState.avg_entry = null;
    trade = { side: "SELL", price, amount, cash_delta: proceeds, reason: signal.reason, candle_time: last.time };
  }

  const equity = nextState.cash + nextState.btc * price;
  return {
    state: {
      ...nextState,
      equity,
      updated_at: new Date().toISOString(),
    },
    trade,
    signal,
    price,
    alreadyProcessed,
  };
}

