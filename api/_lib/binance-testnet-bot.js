import { getBotConfig } from "./bots.js";
import {
  getBinanceAccount,
  getBinanceExchangeSymbol,
  getBinancePosition,
  getBinanceTickerPrice,
  placeBinanceMarketOrder,
  setBinanceLeverage,
  setBinanceMarginType,
} from "./binance-futures.js";
import { evaluateBot } from "./strategy.js";

export const BINANCE_TESTNET_BOT_ID = "binance-testnet-gagok-v1";
const EXECUTION_SYMBOL = "BTCUSDC";
const SIGNAL_BOT_ID = "poongdeok-xi-v1";
const LEVERAGE = 25;
const MARGIN_USAGE = 0.98;
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
  const usdc = getAssetBalance(account, "USDC");
  const positionAmt = Number(position.positionAmt ?? 0);
  return {
    ...previousState,
    cash: usdc.availableBalance,
    btc: Math.abs(positionAmt),
    avg_entry: Math.abs(positionAmt) > BTC_DUST ? Number(position.entryPrice) : null,
    equity: usdc.walletBalance + Number(position.unRealizedProfit ?? 0),
  };
}

async function ensureTradingSettings() {
  await setBinanceMarginType(EXECUTION_SYMBOL, "ISOLATED");
  await setBinanceLeverage(EXECUTION_SYMBOL, LEVERAGE);
}

async function buildBuyQuantity({ account, price, symbolInfo }) {
  const usdc = getAssetBalance(account, "USDC");
  const lot = getLotFilter(symbolInfo);
  const minNotional = getMinNotionalFilter(symbolInfo);
  const notional = usdc.availableBalance * MARGIN_USAGE * LEVERAGE;
  const rawQuantity = notional / price;
  const quantity = floorToStep(rawQuantity, lot.stepSize ?? "0.001");
  const minQty = Number(lot.minQty ?? 0);
  const minNotionalValue = Number(minNotional.notional ?? minNotional.minNotional ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0 || quantity < minQty) {
    throw new Error(`BTCUSDC quantity is too small: ${quantity}`);
  }
  if (minNotionalValue && quantity * price < minNotionalValue) {
    throw new Error(`BTCUSDC notional is below minimum: ${(quantity * price).toFixed(2)}`);
  }

  return quantity;
}

function buildTradeFromOrder({ side, order, price, reason, positionPct }) {
  const executedQty = Number(order.executedQty ?? order.origQty ?? 0);
  const averagePrice = Number(order.avgPrice ?? 0) || price;
  const cashDelta = side === "BUY" ? -(executedQty * averagePrice) : executedQty * averagePrice;

  return {
    side,
    price: averagePrice,
    amount: executedQty,
    cash_delta: cashDelta,
    position_pct: positionPct,
    equity_before: null,
    equity_after: null,
    avg_entry_before: null,
    realized_pnl: null,
    realized_pnl_pct: null,
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

  if (!result.alreadyProcessed) {
    if (!hasPosition && result.signal.side === "BUY") {
      await ensureTradingSettings();
      const quantity = await buildBuyQuantity({ account, price: executionPrice, symbolInfo });
      order = await placeBinanceMarketOrder({
        symbol: EXECUTION_SYMBOL,
        side: "BUY",
        quantity,
      });
      trade = buildTradeFromOrder({
        side: "BUY",
        order,
        price: executionPrice,
        reason: `${result.signal.reason}, Binance Testnet ${EXECUTION_SYMBOL} 25x 진입`,
        positionPct: MARGIN_USAGE,
      });
    } else if (hasPosition && result.signal.side === "SELL") {
      const lot = getLotFilter(symbolInfo);
      const quantity = floorToStep(Math.abs(Number(position.positionAmt)), lot.stepSize ?? "0.001");
      order = await placeBinanceMarketOrder({
        symbol: EXECUTION_SYMBOL,
        side: "SELL",
        quantity,
        reduceOnly: true,
      });
      trade = buildTradeFromOrder({
        side: "SELL",
        order,
        price: executionPrice,
        reason: `${result.signal.reason}, Binance Testnet ${EXECUTION_SYMBOL} 전량 청산`,
        positionPct: 1,
      });
    }
  }

  return {
    state: {
      ...result.state,
      id: BINANCE_TESTNET_BOT_ID,
      cash: getAssetBalance(account, "USDC").availableBalance,
      btc: Math.abs(Number(position.positionAmt ?? 0)),
      avg_entry: hasPosition ? Number(position.entryPrice) : null,
      equity: getAssetBalance(account, "USDC").walletBalance + Number(position.unRealizedProfit ?? 0),
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
