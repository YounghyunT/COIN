import { getBotConfig } from "./bots.js";
import { fetchCandles, fetchFearGreedIndex, rsi, sma } from "./market.js";

const INITIAL_CASH = 50000;
const SELL_SPLIT_PARTS = 3;
const BTC_DUST = 0.00000001;

function positionPctFromSignal(score, side, bot) {
  if (side === "BUY") {
    if (
      bot?.strategy === "balanced-mean-reversion" ||
      bot?.strategy === "trend-pullback" ||
      bot?.strategy === "aggressive-scalp"
    ) {
      return 0.98;
    }

    if (score >= 7) return 0.7;
    if (score >= 5) return 0.55;
    return 0.35;
  }

  return 1 / SELL_SPLIT_PARTS;
}

function getActiveExitPlan(state, currentBtc) {
  const previousPlan = state?.last_signal?.exitPlan;
  if (
    previousPlan &&
    Number(previousPlan.baseBtc) > 0 &&
    Number(previousPlan.remainingParts) > 0 &&
    Number(currentBtc) > BTC_DUST
  ) {
    return {
      baseBtc: Number(previousPlan.baseBtc),
      remainingParts: Number(previousPlan.remainingParts),
    };
  }

  return {
    baseBtc: Number(currentBtc),
    remainingParts: SELL_SPLIT_PARTS,
  };
}

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

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function bollinger(values, period = 20, multiplier = 2) {
  return values.map((_, index) => {
    if (index + 1 < period) return null;
    const slice = values.slice(index + 1 - period, index + 1);
    const middle = slice.reduce((sum, value) => sum + value, 0) / period;
    const deviation = standardDeviation(slice);
    return {
      middle,
      upper: middle + deviation * multiplier,
      lower: middle - deviation * multiplier,
    };
  });
}

function buildPoongdeokSignal({ alertCandles, dailyCandles, fearGreed, entryPrice, intervalLabel }) {
  const last = alertCandles.at(-1);
  const previous = alertCandles.at(-5) ?? alertCandles.at(-2);
  if (!last) return { side: "WAIT", label: "대기", score: 0, reason: `${intervalLabel} 데이터 수집 중` };

  const alertCloses = alertCandles.map((candle) => candle.close);
  const dailyCloses = dailyCandles.map((candle) => candle.close);
  const ma20 = sma(dailyCloses, 20).at(-1);
  const rsi14 = rsi(alertCloses).at(-1);
  const emaFast = ema(alertCloses, 9).at(-1);
  const emaMid = ema(alertCloses, 21).at(-1);
  const emaSlow = ema(alertCloses, 55).at(-1);
  const fearGreedValue = fearGreed?.value;
  const price = last.close;
  const ma20Gap = ma20 ? ((price - ma20) / ma20) * 100 : null;
  const pnl = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
  const momentum = previous ? ((price - previous.close) / previous.close) * 100 : 0;
  const recentHigh = Math.max(...alertCandles.slice(-24, -1).map((candle) => candle.high ?? candle.close));
  const pullbackToEma = emaMid ? price >= emaMid * 0.995 && price <= emaMid * 1.012 : false;
  const breakout = Number.isFinite(recentHigh) && price >= recentHigh * 0.998;
  const buyReasons = [];
  const sellReasons = [];
  let buyScore = 0;
  let sellScore = 0;

  if (fearGreedValue !== null && fearGreedValue !== undefined) {
    if (fearGreedValue <= 72) {
      buyScore += 1;
      buyReasons.push(`공포·탐욕 지수 ${fearGreedValue}: 추세 매수 허용`);
    }
    if (fearGreedValue >= 78) {
      sellScore += 1;
      sellReasons.push(`공포·탐욕 지수 ${fearGreedValue}: 과열 경계`);
    }
  }

  if (ma20Gap !== null) {
    if (ma20Gap >= -8 && ma20Gap <= 8) {
      buyScore += 1;
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 추세 추격 허용 범위`);
    } else if (ma20Gap > 12) {
      sellScore += 1;
      sellReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 단기 과열`);
    } else {
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%`);
    }
  }

  if (rsi14) {
    if (rsi14 >= 48 && rsi14 <= 64) {
      buyScore += 2;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 추세 지속 구간`);
    } else if (rsi14 >= 42 && rsi14 < 48) {
      buyScore += 1;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 눌림 반등 후보`);
    } else {
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}`);
    }

    if (rsi14 >= 72) {
      sellScore += 1;
      sellReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 과열권`);
    } else if (rsi14 <= 38) {
      sellScore += 2;
      sellReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 추세 이탈 위험`);
    }
  }

  if (emaFast && emaMid && emaSlow) {
    if (emaFast >= emaMid && emaMid >= emaSlow && price >= emaMid) {
      buyScore += 3;
      buyReasons.push("EMA 9/21/55 정배열");
    } else if (emaFast >= emaMid && price >= emaSlow) {
      buyScore += 1;
      buyReasons.push("EMA 9/21 단기 우위");
    } else {
      sellScore += 2;
      sellReasons.push("EMA 추세 약화");
    }
  }

  if (pullbackToEma) {
    buyScore += 1;
    buyReasons.push("EMA 21 눌림 구간");
  }

  if (breakout) {
    buyScore += 1;
    buyReasons.push("최근 24개 15분봉 고점 돌파 시도");
  }

  if (momentum >= 0.12) {
    buyScore += 1;
    buyReasons.push(`최근 75분 모멘텀 +${momentum.toFixed(2)}%`);
  } else if (momentum <= -0.35) {
    sellScore += 1;
    sellReasons.push(`최근 75분 모멘텀 ${momentum.toFixed(2)}%`);
  }

  if (pnl !== null) {
    if (pnl >= 0.9) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 +${pnl.toFixed(2)}%: 추세형 익절`);
    } else if (pnl <= -0.55) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 ${pnl.toFixed(2)}%: 추세형 손절`);
    } else {
      sellReasons.push(`매수가 대비 ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
    }
  } else {
    sellReasons.push("보유 포지션 없음");
  }

  if (entryPrice && sellScore >= 3) {
    return { side: "SELL", label: "15분 추세 매도", score: sellScore, reason: sellReasons.join(", ") };
  }

  if (!entryPrice && buyScore >= 6) {
    return { side: "BUY", label: "15분 추세 매수", score: buyScore, reason: buyReasons.join(", ") };
  }

  if (entryPrice) {
    return { side: "WAIT", label: "15분 추세 보유", score: Math.max(buyScore, sellScore), reason: sellReasons.join(", ") };
  }

  return { side: "WAIT", label: buyScore >= 4 ? "15분 추세 관찰" : "15분 중립 대기", score: buyScore, reason: buyReasons.join(", ") };
}

function buildGagokSignal({ alertCandles, dailyCandles, fearGreed, entryPrice, intervalLabel }) {
  const last = alertCandles.at(-1);
  const previous = alertCandles.at(-2);
  if (!last) return { side: "WAIT", label: "대기", score: 0, reason: `${intervalLabel} 완성봉 데이터 수집 중` };

  const closes = alertCandles.map((candle) => candle.close);
  const dailyCloses = dailyCandles.map((candle) => candle.close);
  const price = last.close;
  const rsi14 = rsi(closes).at(-1);
  const ema20 = ema(closes, 20).at(-1);
  const ema60 = ema(closes, 60).at(-1);
  const band = bollinger(closes, 20, 2).at(-1);
  const dailyMa20 = sma(dailyCloses, 20).at(-1);
  const fearGreedValue = fearGreed?.value;
  const pnl = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
  const prevClose = previous?.close ?? price;
  const rebound = band ? prevClose < band.lower && price >= band.lower : false;
  const ma20Gap = dailyMa20 ? ((price - dailyMa20) / dailyMa20) * 100 : null;
  const buyReasons = [];
  const sellReasons = [];
  let buyScore = 0;
  let sellScore = 0;

  if (rsi14) {
    if (rsi14 <= 38) {
      buyScore += 3;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 과매도 구간`);
    } else if (rsi14 <= 52) {
      buyScore += 2;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 반등 후보`);
    } else if (rsi14 <= 58) {
      buyScore += 1;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 공격 매수 허용`);
    } else {
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}`);
    }

    if (rsi14 >= 68) {
      sellScore += 2;
      sellReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 과열권`);
    }
  }

  if (band) {
    if (price <= band.lower * 1.01) {
      buyScore += 2;
      buyReasons.push("볼린저 하단 근접");
    } else if (price <= band.middle) {
      buyScore += 1;
      buyReasons.push("볼린저 중심선 이하");
    }
    if (rebound) {
      buyScore += 1;
      buyReasons.push("볼린저 하단 이탈 후 회복");
    }
    if (price >= band.upper * 0.996) {
      sellScore += 2;
      sellReasons.push("볼린저 상단 근접");
    }
    if (price >= band.middle && pnl !== null && pnl > 0) {
      sellScore += 1;
      sellReasons.push("볼린저 중심선 위 수익권");
    }
  }

  if (ema20 && ema60) {
    if (price >= ema60 * 0.985 && ema20 >= ema60 * 0.99) {
      buyScore += 1;
      buyReasons.push("15분봉 추세 허용 범위");
    } else {
      sellScore += 1;
      sellReasons.push("15분봉 추세 약화");
    }
  }

  if (fearGreedValue !== null && fearGreedValue !== undefined) {
    if (fearGreedValue <= 60) {
      buyScore += 1;
      buyReasons.push(`공포·탐욕 ${fearGreedValue}: 매수 허용`);
    }
    if (fearGreedValue >= 70) {
      sellScore += 1;
      sellReasons.push(`공포·탐욕 ${fearGreedValue}: 탐욕 구간`);
    }
  }

  if (ma20Gap !== null) {
    if (ma20Gap <= 10) {
      buyScore += 1;
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 추격매수 억제 통과`);
    } else {
      sellReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 과열 주의`);
    }
  }

  if (pnl !== null) {
    if (pnl >= 1) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 +${pnl.toFixed(2)}%: 15분봉 익절`);
    } else if (pnl <= -0.7) {
      sellScore += 4;
      sellReasons.push(`매수가 대비 ${pnl.toFixed(2)}%: 15분봉 손절`);
    } else {
      sellReasons.push(`매수가 대비 ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
    }
  } else {
    sellReasons.push("보유 포지션 없음");
  }

  if (entryPrice && sellScore >= 4) {
    return { side: "SELL", label: "15분 안정 매도", score: sellScore, reason: sellReasons.join(", ") };
  }

  if (!entryPrice && buyScore >= 4) {
    return { side: "BUY", label: "15분 공격 매수", score: buyScore, reason: buyReasons.join(", ") };
  }

  if (entryPrice) {
    return { side: "WAIT", label: "15분 보유 대기", score: Math.max(buyScore, sellScore), reason: sellReasons.join(", ") };
  }

  return { side: "WAIT", label: buyScore >= 3 ? "15분 매수 관찰" : "15분 중립 대기", score: buyScore, reason: buyReasons.join(", ") };
}

function buildPoongdeokAggressiveSignal({ alertCandles, dailyCandles, fearGreed, entryPrice, intervalLabel }) {
  const last = alertCandles.at(-1);
  const previous = alertCandles.at(-2);
  const momentumBase = alertCandles.at(-4) ?? previous;
  if (!last) return { side: "WAIT", label: "대기", score: 0, reason: `${intervalLabel} 데이터 수집 중` };

  const closes = alertCandles.map((candle) => candle.close);
  const dailyCloses = dailyCandles.map((candle) => candle.close);
  const price = last.close;
  const rsi14 = rsi(closes).at(-1);
  const emaFast = ema(closes, 9).at(-1);
  const emaMid = ema(closes, 21).at(-1);
  const band = bollinger(closes, 20, 2).at(-1);
  const dailyMa20 = sma(dailyCloses, 20).at(-1);
  const fearGreedValue = fearGreed?.value;
  const pnl = entryPrice ? ((price - entryPrice) / entryPrice) * 100 : null;
  const ma20Gap = dailyMa20 ? ((price - dailyMa20) / dailyMa20) * 100 : null;
  const prevClose = previous?.close ?? price;
  const oneCandleMomentum = previous ? ((price - previous.close) / previous.close) * 100 : 0;
  const shortMomentum = momentumBase ? ((price - momentumBase.close) / momentumBase.close) * 100 : 0;
  const lowerBandRebound = band ? prevClose <= band.lower * 1.001 && price > band.lower : false;
  const nearLowerBand = band ? price <= band.lower * 1.006 : false;
  const emaReclaim = emaFast && emaMid ? prevClose < emaFast && price >= emaFast && price >= emaMid * 0.998 : false;
  const recentHigh = Math.max(...alertCandles.slice(-10, -1).map((candle) => candle.high ?? candle.close));
  const microBreakout = Number.isFinite(recentHigh) && price >= recentHigh * 0.9995;
  const buyReasons = [];
  const sellReasons = [];
  let buyScore = 0;
  let sellScore = 0;

  if (fearGreedValue !== null && fearGreedValue !== undefined) {
    if (fearGreedValue <= 80) {
      buyScore += 1;
      buyReasons.push(`공포·탐욕 ${fearGreedValue}: 공격 테스트 매수 허용`);
    }
    if (fearGreedValue >= 88) {
      sellScore += 1;
      sellReasons.push(`공포·탐욕 ${fearGreedValue}: 극단 과열`);
    }
  }

  if (ma20Gap !== null) {
    if (ma20Gap >= -12 && ma20Gap <= 12) {
      buyScore += 1;
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 테스트 허용 범위`);
    } else if (ma20Gap > 16) {
      sellScore += 1;
      sellReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%: 과열 주의`);
    } else {
      buyReasons.push(`20일선 대비 ${ma20Gap.toFixed(1)}%`);
    }
  }

  if (rsi14) {
    if (rsi14 <= 38) {
      buyScore += 3;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 1분봉 과매도 반등`);
    } else if (rsi14 <= 55) {
      buyScore += 2;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 공격 진입 가능`);
    } else if (rsi14 <= 64) {
      buyScore += 1;
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 단기 추세 추격`);
    } else {
      buyReasons.push(`RSI(14) ${rsi14.toFixed(1)}`);
    }

    if (rsi14 >= 70) {
      sellScore += 2;
      sellReasons.push(`RSI(14) ${rsi14.toFixed(1)}: 단기 과열`);
    }
  }

  if (emaFast && emaMid) {
    if (price >= emaFast && emaFast >= emaMid * 0.999) {
      buyScore += 2;
      buyReasons.push("EMA 9/21 단기 우위");
    } else if (emaReclaim) {
      buyScore += 2;
      buyReasons.push("EMA 9 재돌파");
    } else if (price < emaMid * 0.996) {
      sellScore += 1;
      sellReasons.push("EMA 21 하단 이탈");
    }
  }

  if (lowerBandRebound) {
    buyScore += 2;
    buyReasons.push("볼린저 하단 반등");
  } else if (nearLowerBand) {
    buyScore += 1;
    buyReasons.push("볼린저 하단 근접");
  }

  if (microBreakout) {
    buyScore += 2;
    buyReasons.push("최근 10개 1분봉 고점 돌파");
  }

  if (oneCandleMomentum >= 0.04 || shortMomentum >= 0.08) {
    buyScore += 1;
    buyReasons.push(`단기 모멘텀 ${shortMomentum >= 0 ? "+" : ""}${shortMomentum.toFixed(2)}%`);
  } else if (oneCandleMomentum <= -0.08 || shortMomentum <= -0.16) {
    sellScore += 2;
    sellReasons.push(`단기 모멘텀 ${shortMomentum.toFixed(2)}%`);
  }

  if (pnl !== null) {
    if (pnl >= 0.4) {
      sellScore += 5;
      sellReasons.push(`매수가 대비 +${pnl.toFixed(2)}%: 공격 익절`);
    } else if (pnl <= -0.2) {
      sellScore += 5;
      sellReasons.push(`매수가 대비 ${pnl.toFixed(2)}%: 공격 손절`);
    } else {
      sellReasons.push(`매수가 대비 ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
    }
  } else {
    sellReasons.push("보유 포지션 없음");
  }

  if (entryPrice && sellScore >= 3) {
    return { side: "SELL", label: "1분 공격 매도", score: sellScore, reason: sellReasons.join(", ") };
  }

  if (!entryPrice && buyScore >= 4) {
    return { side: "BUY", label: "1분 공격 매수", score: buyScore, reason: buyReasons.join(", ") };
  }

  if (entryPrice) {
    return { side: "WAIT", label: "1분 공격 보유", score: Math.max(buyScore, sellScore), reason: sellReasons.join(", ") };
  }

  return { side: "WAIT", label: buyScore >= 3 ? "1분 공격 관찰" : "1분 공격 대기", score: buyScore, reason: buyReasons.join(", ") };
}

function buildStrategySignal(args) {
  if (args.bot?.strategy === "aggressive-scalp") {
    return buildPoongdeokAggressiveSignal(args);
  }

  if (args.bot?.strategy === "balanced-mean-reversion") {
    return buildGagokSignal(args);
  }

  return buildPoongdeokSignal(args);
}

function defaultState(bot) {
  return {
    id: bot.id,
    cash: bot.initialCash ?? INITIAL_CASH,
    btc: 0,
    avg_entry: null,
    last_candle_time: null,
    last_run_at: null,
    last_signal: null,
  };
}

export async function evaluateBot(previousState, botConfig) {
  const bot = getBotConfig(botConfig?.id);
  const state = previousState ?? defaultState(bot);
  const [{ candles: alertCandles, source }, { candles: dailyCandles }, fearGreed] = await Promise.all([
    fetchCandles(bot.interval, bot.candleLimit ?? 240),
    fetchCandles("1d", 80),
    fetchFearGreedIndex(),
  ]);

  const last = alertCandles.at(-1);
  const price = last.close;
  const hasPosition = Number(state.btc) > 0 && Number(state.avg_entry) > 0;
  const signal = buildStrategySignal({
    bot,
    alertCandles,
    dailyCandles,
    fearGreed,
    entryPrice: hasPosition ? Number(state.avg_entry) : null,
    intervalLabel: bot.interval,
  });
  const alreadyProcessed = Number(state.last_candle_time) === Number(last.time);
  const nextState = {
    ...defaultState(bot),
    ...state,
    cash: Number(state.cash ?? bot.initialCash ?? INITIAL_CASH),
    btc: Number(state.btc ?? 0),
    avg_entry: state.avg_entry === null || state.avg_entry === undefined ? null : Number(state.avg_entry),
    last_candle_time: last.time,
    last_run_at: new Date().toISOString(),
    last_signal: {
      ...signal,
      botId: bot.id,
      botName: bot.name,
      interval: bot.interval,
      price,
      fearGreed,
      source,
      candleTime: last.time,
      alreadyProcessed,
    },
  };
  let trade = null;

  if (!alreadyProcessed && signal.side === "BUY" && nextState.cash > 0) {
    const equityBefore = nextState.cash + nextState.btc * price;
    const positionPct = positionPctFromSignal(signal.score, "BUY", bot);
    const spend = Math.min(nextState.cash, equityBefore * positionPct);
    const amount = spend / price;
    const nextBtc = nextState.btc + amount;
    const avgEntryBefore = nextState.avg_entry;
    nextState.avg_entry = ((nextState.avg_entry || 0) * nextState.btc + spend) / nextBtc;
    nextState.cash -= spend;
    nextState.btc = nextBtc;
    trade = {
      side: "BUY",
      price,
      amount,
      cash_delta: -spend,
      position_pct: positionPct,
      equity_before: equityBefore,
      equity_after: nextState.cash + nextState.btc * price,
      avg_entry_before: avgEntryBefore,
      realized_pnl: null,
      realized_pnl_pct: null,
      reason: signal.reason,
      candle_time: last.time,
    };
    delete nextState.last_signal.exitPlan;
  }

  if (!alreadyProcessed && signal.side === "SELL" && nextState.btc > 0) {
    const equityBefore = nextState.cash + nextState.btc * price;
    const fullExit =
      bot.strategy === "balanced-mean-reversion" ||
      bot.strategy === "trend-pullback" ||
      bot.strategy === "aggressive-scalp";
    const exitPlan = fullExit ? { baseBtc: nextState.btc, remainingParts: 1 } : getActiveExitPlan(state, nextState.btc);
    const trancheAmount = fullExit ? nextState.btc : exitPlan.baseBtc / SELL_SPLIT_PARTS;
    const avgEntryBefore = nextState.avg_entry;
    const amount = exitPlan.remainingParts <= 1 ? nextState.btc : Math.min(nextState.btc, trancheAmount);
    const positionPct = amount / Math.max(exitPlan.baseBtc, BTC_DUST);
    const proceeds = amount * price;
    const costBasis = amount * (avgEntryBefore || price);
    const realizedPnl = proceeds - costBasis;
    const realizedPnlPct = avgEntryBefore ? ((price - avgEntryBefore) / avgEntryBefore) * 100 : null;
    nextState.cash += proceeds;
    nextState.btc = Math.max(0, nextState.btc - amount);
    const remainingParts = Math.max(0, exitPlan.remainingParts - 1);
    if (nextState.btc <= BTC_DUST || remainingParts === 0) {
      nextState.btc = 0;
      nextState.avg_entry = null;
      delete nextState.last_signal.exitPlan;
    } else {
      nextState.last_signal.exitPlan = {
        baseBtc: exitPlan.baseBtc,
        remainingParts,
      };
    }
    trade = {
      side: "SELL",
      price,
      amount,
      cash_delta: proceeds,
      position_pct: positionPct,
      equity_before: equityBefore,
      equity_after: nextState.cash + nextState.btc * price,
      avg_entry_before: avgEntryBefore,
      realized_pnl: realizedPnl,
      realized_pnl_pct: realizedPnlPct,
      reason: fullExit
        ? `${signal.reason}, 전량 청산`
        : `${signal.reason}, 3분할 매도 ${SELL_SPLIT_PARTS - exitPlan.remainingParts + 1}/${SELL_SPLIT_PARTS}`,
      candle_time: last.time,
    };
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
