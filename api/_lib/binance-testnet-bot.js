import { getBotConfig } from "./bots.js";
import {
  getBinanceAccount,
  getBinanceExchangeSymbol,
  getBinanceOrder,
  getBinancePosition,
  getBinanceTickerPrice,
  placeBinanceMarketOrder,
  setBinanceLeverage,
  setBinanceMarginType,
} from "./binance-futures.js";
import { evaluateBot } from "./strategy.js";

export const BINANCE_TESTNET_BOT_ID = "binance-testnet-gagok-v1";
const EXECUTION_SYMBOL = "BTCUSDT";
const SIGNAL_BOT_ID = "poongdeok-xi-v1";
const LEVERAGE = 25;
const MARGIN_USAGE = 0.9;
const BTC_DUST = 0.00000001;

function getAssetBalance(account, assetName) {
  const asset = account.assets?.find((item) => item.asset === assetName);
  return {
    walletBalance: Number(asset?.walletBalance ?? 0),
    availableBalance: Number(asset?.availableBalance ?? 0),
  };
}

function stepDecimals(stepSize) {
  const [, decimals = ""] = String(stepSize).split(".");
  return decimals.replace(/0+$/, "").length;
}

function floorToStep(value, stepSize) {
  const step = Number(stepSize);
  const decimals = stepDecimals(stepSize);
  return Number((Math.floor(value / step) * step).toFixed(decimals));
}

function getLotFilter(symbolInfo) {
  return symbolInfo.filters?.find((filter) => filter.filterType === "LOT_SIZE") ?? {};
}

function getMinNotionalFilter(symbolInfo) {
  return symbolInfo.filters?.find((filter) => filter.filterType === "MIN_NOTIONAL" || filter.filterType === "NOTIONAL") ?? {};
}

function buildSyntheticState({ previousState, account, position }) {
  const usdt = getAssetBalance(account, "USDT");
  const positionAmt = Number(position.positionAmt ?? 0);
  return {
    ...previousState,
    cash: usdt.availableBalance,
    btc: Math.abs(positionAmt),
    avg_entry: Math.abs(positionAmt) > BTC_DUST ? Number(position.entryPrice) : null,
    equity: usdt.walletBalance + Number(position.unRealizedProfit ?? 0),
  };
}

async function ensureTradingSettings() {
  await setBinanceMarginType(EXECUTION_SYMBOL, "ISOLATED");
  await setBinanceLeverage(EXECUTION_SYMBOL, LEVERAGE);
}

async function buildBuyQuantity({ account, price, symbolInfo }) {
  const usdt = getAssetBalance(account, "USDT");
  const lot = getLotFilter(symbolInfo);
  const minNotional = getMinNotionalFilter(symbolInfo);
  const notional = usdt.availableBalance * MARGIN_USAGE * LEVERAGE;
  const rawQuantity = notional / price;
  const quantity = floorToStep(rawQuantity, lot.stepSize ?? "0.001");
  const minQty = Number(lot.minQty ?? 0);
  const minNotionalValue = Number(minNotional.notional ?? minNotional.minNotional ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0 || quantity < minQty) {
    throw new Error(`${EXECUTION_SYMBOL} quantity is too small: ${quantity}`);
  }
  if (minNotionalValue && quantity * price < minNotionalValue) {
    throw new Error(`${EXECUTION_SYMBOL} notional is below minimum: ${(quantity * price).toFixed(2)}`);
  }

  return quantity;
}

async function getFilledOrder(order) {
  if (!order?.orderId) return order;
  try {
    return await getBinanceOrder({ symbol: order.symbol ?? EXECUTION_SYMBOL, orderId: order.orderId });
  } catch {
    return order;
  }
}

function buildTradeFromOrder({ side, order, price, reason, positionPct, avgEntryBefore = null }) {
  const executedQty = Number(order.executedQty ?? order.origQty ?? 0);
  const averagePrice = Number(order.avgPrice ?? 0) || price;
  const cashDelta = side === "BUY" ? -(executedQty * averagePrice) : executedQty * averagePrice;
  const realizedPnl =
    side === "SELL" && avgEntryBefore ? executedQty * (averagePrice - Number(avgEntryBefore)) : null;
  const realizedPnlPct =
    side === "SELL" && avgEntryBefore ? ((averagePrice - Number(avgEntryBefore)) / Number(avgEntryBefore)) * 100 : null;

  return {
    side,
    price: averagePrice,
    amount: executedQty,
    cash_delta: cashDelta,
    position_pct: positionPct,
    equity_before: null,
    equity_after: null,
    avg_entry_before: avgEntryBefore,
    realized_pnl: realizedPnl,
    realized_pnl_pct: realizedPnlPct,
    reason,
    candle_time: Math.floor(Date.now() / 1000),
  };
}

export async function runBinanceTestnetPoongdeokTick(previousState) {
  const signalBot = getBotConfig(SIGNAL_BOT_ID);
  const [account, position, symbolInfo, executionPrice] = await Promise.all([
    getBinanceAccount(),
    getBinancePosition(EXECUTION_SYMBOL),
    getBinanceExchangeSymbol(EXECUTION_SYMBOL),
    getBinanceTickerPrice(EXECUTION_SYMBOL),
  ]);
  const hasPosition = Math.abs(Number(position.positionAmt ?? 0)) > BTC_DUST;
  const syntheticState = buildSyntheticState({ previousState, account, position });
  const result = await evaluateBot(syntheticState, signalBot);
  let order = null;
  let trade = null;
  let accountAfter = account;
  let positionAfter = position;

  if (!result.alreadyProcessed) {
    if (!hasPosition && result.signal.side === "BUY") {
      await ensureTradingSettings();
      const quantity = await buildBuyQuantity({ account, price: executionPrice, symbolInfo });
      order = await placeBinanceMarketOrder({
        symbol: EXECUTION_SYMBOL,
        side: "BUY",
        quantity,
      });
      order = await getFilledOrder(order);
      trade = buildTradeFromOrder({
        side: "BUY",
        order,
        price: executionPrice,
        reason: `${result.signal.reason}, Binance Testnet ${EXECUTION_SYMBOL} 25x 진입`,
        positionPct: MARGIN_USAGE,
      });
      [accountAfter, positionAfter] = await Promise.all([getBinanceAccount(), getBinancePosition(EXECUTION_SYMBOL)]);
    } else if (hasPosition && result.signal.side === "SELL") {
      const lot = getLotFilter(symbolInfo);
      const quantity = floorToStep(Math.abs(Number(position.positionAmt)), lot.stepSize ?? "0.001");
      order = await placeBinanceMarketOrder({
        symbol: EXECUTION_SYMBOL,
        side: "SELL",
        quantity,
        reduceOnly: true,
      });
      order = await getFilledOrder(order);
      trade = buildTradeFromOrder({
        side: "SELL",
        order,
        price: executionPrice,
        reason: `${result.signal.reason}, Binance Testnet ${EXECUTION_SYMBOL} 전량 청산`,
        positionPct: 1,
        avgEntryBefore: Number(position.entryPrice),
      });
      [accountAfter, positionAfter] = await Promise.all([getBinanceAccount(), getBinancePosition(EXECUTION_SYMBOL)]);
    }
  }

  const finalHasPosition = Math.abs(Number(positionAfter.positionAmt ?? 0)) > BTC_DUST;
  const finalUsdt = getAssetBalance(accountAfter, "USDT");

  return {
    state: {
      ...result.state,
      id: BINANCE_TESTNET_BOT_ID,
      cash: finalUsdt.availableBalance,
      btc: Math.abs(Number(positionAfter.positionAmt ?? 0)),
      avg_entry: finalHasPosition ? Number(positionAfter.entryPrice) : null,
      equity: finalUsdt.walletBalance + Number(positionAfter.unRealizedProfit ?? 0),
      last_signal: {
        ...result.signal,
        botId: BINANCE_TESTNET_BOT_ID,
        botName: "Binance Testnet 풍덕자이v1.0",
        signalBotId: SIGNAL_BOT_ID,
        signalSymbol: "BTCUSDT",
        executionSymbol: EXECUTION_SYMBOL,
        leverage: LEVERAGE,
        executionPrice,
        orderId: order?.orderId ?? null,
        orderStatus: order?.status ?? null,
        orderAvgPrice: order?.avgPrice ?? null,
        orderExecutedQty: order?.executedQty ?? null,
        positionAmt: Number(positionAfter.positionAmt ?? 0),
        alreadyProcessed: result.alreadyProcessed,
      },
      updated_at: new Date().toISOString(),
    },
    trade,
    signal: result.signal,
    order,
    price: executionPrice,
    alreadyProcessed: result.alreadyProcessed,
  };
}
