import { fetchCandles, fetchFearGreedIndex, rsi, sma } from "./market.js";

const INITIAL_CASH = 10000;
const POSITION_SIZE = 0.5;

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

function buildStrategySignal({ alertCandles, dailyCandles, fearGreed, entryPrice }) {
  const last = alertCandles.at(-1);
  const previous = alertCandles.at(-4) ?? alertCandles.at(-2);
  if (!last) return { side: "WAIT", label: "대기", score: 0, reason: "1분봉 데이터 수집 중" };

  const alertCloses = alertCandles.map((candle) => candle.close);
  const dailyCloses = dailyCandles.map((candle) => candle.close);
  const ma20 = sma(dailyCloses, 20).at(-1);
  const rsi14 = rsi(alertCloses).at(-1);
  const emaFast = ema(alertCloses, 5).at(-1);
  const emaSlow = ema(alertCloses, 20).at(-1);
  const fearGreedValue = fearGreed?.value;
  const price = last.close;
  const ma20Gap = ma20 ? ((price - ma20) / ma20) * 100 : null;
  const pnl = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
  const momentum = previous ? ((price - previous.close) / previous.close) * 100 : 0;
  const buyReasons = [];
  const sellReasons = [];
  let buyScore = 0;
  let sellScore = 0;

  if (fearGreedValue !== null && fearGreedValue !== undefined) {
    if (fearGreedValue <= 60) {
      buyScore += 2;
      buyReasons.push(`공포·탐욕 지수 ${fearGreedValue}: 매수 허용 구간`);
    }
    if (fearGreedValue >= 55) {
      sellScore += 2;
      sellReasons.push(`공포·탐욕 지수 ${fearGreedValue}: 매도 경계 구간`);
    }
  }

  if (ma20Gap !== null) {
    if (ma20Gap <= 1) {
      buyScore += 2;
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 저평가 테스트 조건`);
    } else {
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%`);
    }
  }

  if (rsi14) {
    if (rsi14 <= 55) {
      buyScore += 2;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 공격적 매수 허용`);
    } else if (rsi14 <= 62) {
      buyScore += 1;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 중립 매수 후보`);
    } else {
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}`);
    }

    if (rsi14 >= 58) {
      sellScore += 2;
      sellReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 공격적 과열 기준`);
    }
  }

  if (emaFast && emaSlow) {
    if (emaFast >= emaSlow) {
      buyScore += 1;
      buyReasons.push("EMA 5가 EMA 20 위");
    } else {
      sellScore += 1;
      sellReasons.push("EMA 5가 EMA 20 아래");
    }
  }

  if (momentum >= 0.05) {
    buyScore += 1;
    buyReasons.push(`최근 단기 모멘텀 +${momentum.toFixed(2)}%`);
  } else if (momentum <= -0.05) {
    sellScore += 1;
    sellReasons.push(`최근 단기 모멘텀 ${momentum.toFixed(2)}%`);
  }

  if (pnl !== null) {
    if (pnl >= 0.3) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 +${pnl.toFixed(2)}%: 테스트 익절`);
    } else if (pnl <= -0.3) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 ${pnl.toFixed(2)}%: 테스트 손절`);
    } else {
      sellReasons.push(`매수가 대비 ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
    }
  } else {
    sellReasons.push("보유 포지션 없음");
  }

  if (entryPrice && sellScore >= 2) {
    return { side: "SELL", label: "공격 매도", score: sellScore, reason: sellReasons.join(", ") };
  }

  if (!entryPrice && buyScore >= 3) {
    return { side: "BUY", label: "공격 매수", score: buyScore, reason: buyReasons.join(", ") };
  }

  if (entryPrice) {
    return { side: "WAIT", label: "보유 대기", score: Math.max(buyScore, sellScore), reason: sellReasons.join(", ") };
  }

  return { side: "WAIT", label: buyScore >= 2 ? "매수 관찰" : "중립 대기", score: buyScore, reason: buyReasons.join(", ") };
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
    fetchCandles("1m", 240),
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
