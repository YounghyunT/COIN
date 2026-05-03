import crypto from "node:crypto";

const DEFAULT_TESTNET_BASE_URL = "https://testnet.binancefuture.com";
const DEFAULT_SYMBOLS = ["BTCUSDT"];

function getBinanceConfig() {
  const apiKey = process.env.BINANCE_TESTNET_API_KEY;
  const secretKey = process.env.BINANCE_TESTNET_SECRET_KEY;
  const baseUrl = process.env.BINANCE_FUTURES_BASE_URL || DEFAULT_TESTNET_BASE_URL;
  const testnet = process.env.BINANCE_FUTURES_TESTNET !== "false";

  if (!apiKey || !secretKey) {
    throw new Error("BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_SECRET_KEY are required");
  }

  return {
    apiKey,
    secretKey,
    baseUrl: baseUrl.replace(/\/$/, ""),
    testnet,
  };
}

function signQuery(query, secretKey) {
  return crypto.createHmac("sha256", secretKey).update(query).digest("hex");
}

function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) search.set(key, String(value));
  });
  return search.toString();
}

export function assertTestnetConfig() {
  const config = getBinanceConfig();
  if (!config.testnet) throw new Error("Binance testnet trading is disabled");
  if (!config.baseUrl.includes("testnet") && !config.baseUrl.includes("demo-fapi")) {
    throw new Error("Refusing to trade because Binance base URL is not a testnet endpoint");
  }
  return config;
}

async function binanceRequest(path, { method = "GET", signed = false, params = {}, apiKey, secretKey, baseUrl } = {}) {
  const requestParams = {
    ...params,
    ...(signed ? { timestamp: Date.now(), recvWindow: 10_000 } : {}),
  };
  let query = buildQuery(requestParams);
  if (signed) {
    query = `${query}&signature=${signQuery(query, secretKey)}`;
  }

  const response = await fetch(`${baseUrl}${path}${query ? `?${query}` : ""}`, {
    method,
    headers: apiKey ? { "X-MBX-APIKEY": apiKey } : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload?.msg || text || "Binance request failed";
    throw new Error(`Binance ${response.status}: ${message}`);
  }

  return payload;
}

async function optionalSignedRequest(path, options) {
  try {
    return {
      ok: true,
      data: await binanceRequest(path, { ...options, signed: true }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
}

function compactAccount(account) {
  const assets = account?.assets ?? [];
  const usdt = assets.find((asset) => asset.asset === "USDT");
  return {
    totalWalletBalance: Number(account?.totalWalletBalance ?? 0),
    totalUnrealizedProfit: Number(account?.totalUnrealizedProfit ?? 0),
    availableBalance: Number(usdt?.availableBalance ?? 0),
    assets: assets
      .filter((asset) => ["USDT"].includes(asset.asset))
      .map((asset) => ({
        asset: asset.asset,
        walletBalance: Number(asset.walletBalance ?? 0),
        availableBalance: Number(asset.availableBalance ?? 0),
        unrealizedProfit: Number(asset.unrealizedProfit ?? 0),
      })),
  };
}

function compactPosition(position) {
  return {
    symbol: position.symbol,
    positionAmt: Number(position.positionAmt ?? 0),
    entryPrice: Number(position.entryPrice ?? 0),
    markPrice: Number(position.markPrice ?? 0),
    unRealizedProfit: Number(position.unRealizedProfit ?? 0),
    liquidationPrice: Number(position.liquidationPrice ?? 0),
    leverage: Number(position.leverage ?? 0),
    marginType: position.marginType,
    positionSide: position.positionSide,
  };
}

function compactCommission(symbol, result) {
  if (!result.ok) {
    return {
      symbol,
      ok: false,
      error: result.error,
    };
  }

  return {
    symbol,
    ok: true,
    makerCommissionRate: Number(result.data.makerCommissionRate ?? 0),
    takerCommissionRate: Number(result.data.takerCommissionRate ?? 0),
  };
}

function getKstTodayRange(now = new Date()) {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const shifted = new Date(now.getTime() + KST_OFFSET_MS);
  const startUtcMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - KST_OFFSET_MS;

  return {
    startTime: startUtcMs,
    endTime: now.getTime(),
    timezone: "Asia/Seoul",
  };
}

function sumIncomeRows(rows) {
  return Array.isArray(rows)
    ? rows.reduce((sum, row) => sum + Number(row.income ?? 0), 0)
    : 0;
}

function compactIncomeSummary(results, range) {
  const [realizedResult, commissionResult, fundingResult] = results;
  const realizedPnl = realizedResult.ok ? sumIncomeRows(realizedResult.data) : 0;
  const commission = commissionResult.ok ? sumIncomeRows(commissionResult.data) : 0;
  const fundingFee = fundingResult.ok ? sumIncomeRows(fundingResult.data) : 0;

  return {
    ...range,
    realizedPnl,
    commission,
    fundingFee,
    netPnl: realizedPnl + commission + fundingFee,
    errors: [
      realizedResult.ok ? null : `REALIZED_PNL: ${realizedResult.error}`,
      commissionResult.ok ? null : `COMMISSION: ${commissionResult.error}`,
      fundingResult.ok ? null : `FUNDING_FEE: ${fundingResult.error}`,
    ].filter(Boolean),
  };
}

export async function getBinanceTestnetStatus(symbols = DEFAULT_SYMBOLS) {
  const config = getBinanceConfig();
  const incomeRange = getKstTodayRange();
  const primarySymbol = symbols[0] || DEFAULT_SYMBOLS[0];
  const incomeParams = {
    symbol: primarySymbol,
    startTime: incomeRange.startTime,
    endTime: incomeRange.endTime,
    limit: 1000,
  };
  const [time, account, positionResults, commissionResults, incomeResults] = await Promise.all([
    binanceRequest("/fapi/v1/time", config),
    binanceRequest("/fapi/v2/account", { ...config, signed: true }),
    Promise.all(symbols.map((symbol) => optionalSignedRequest("/fapi/v2/positionRisk", { ...config, params: { symbol } }))),
    Promise.all(symbols.map((symbol) => optionalSignedRequest("/fapi/v1/commissionRate", { ...config, params: { symbol } }))),
    Promise.all([
      optionalSignedRequest("/fapi/v1/income", { ...config, params: { ...incomeParams, incomeType: "REALIZED_PNL" } }),
      optionalSignedRequest("/fapi/v1/income", { ...config, params: { ...incomeParams, incomeType: "COMMISSION" } }),
      optionalSignedRequest("/fapi/v1/income", { ...config, params: { ...incomeParams, incomeType: "FUNDING_FEE" } }),
    ]),
  ]);

  return {
    mode: config.testnet ? "testnet" : "mainnet",
    baseUrl: config.baseUrl,
    serverTime: time.serverTime,
    account: compactAccount(account),
    positions: positionResults.flatMap((result) => {
      if (!result.ok) return [];
      const rows = Array.isArray(result.data) ? result.data : [result.data];
      return rows.map(compactPosition);
    }),
    commissions: symbols.map((symbol, index) => compactCommission(symbol, commissionResults[index])),
    todayIncome: compactIncomeSummary(incomeResults, incomeRange),
    checkedAt: new Date().toISOString(),
  };
}

export async function getBinanceAccount() {
  const config = assertTestnetConfig();
  return binanceRequest("/fapi/v2/account", { ...config, signed: true });
}

export async function getBinancePosition(symbol) {
  const config = assertTestnetConfig();
  const rows = await binanceRequest("/fapi/v2/positionRisk", { ...config, signed: true, params: { symbol } });
  const positions = Array.isArray(rows) ? rows : [rows];
  return compactPosition(positions.find((position) => position.symbol === symbol) ?? positions[0] ?? {});
}

export async function getBinanceTickerPrice(symbol) {
  const config = assertTestnetConfig();
  const payload = await binanceRequest("/fapi/v1/ticker/price", { ...config, params: { symbol } });
  return Number(payload.price);
}

export async function getBinanceExchangeSymbol(symbol) {
  const config = assertTestnetConfig();
  const payload = await binanceRequest("/fapi/v1/exchangeInfo", { ...config });
  const info = payload.symbols?.find((item) => item.symbol === symbol);
  if (!info) throw new Error(`${symbol} exchange info not found`);
  return info;
}

export async function setBinanceLeverage(symbol, leverage) {
  const config = assertTestnetConfig();
  return binanceRequest("/fapi/v1/leverage", {
    ...config,
    method: "POST",
    signed: true,
    params: { symbol, leverage },
  });
}

export async function setBinanceMarginType(symbol, marginType = "ISOLATED") {
  const config = assertTestnetConfig();
  try {
    return await binanceRequest("/fapi/v1/marginType", {
      ...config,
      method: "POST",
      signed: true,
      params: { symbol, marginType },
    });
  } catch (error) {
    if (error.message.includes("No need to change margin type")) return { ok: true, skipped: true };
    throw error;
  }
}

export async function placeBinanceMarketOrder({ symbol, side, quantity, reduceOnly = false }) {
  const config = assertTestnetConfig();
  return binanceRequest("/fapi/v1/order", {
    ...config,
    method: "POST",
    signed: true,
    params: {
      symbol,
      side,
      type: "MARKET",
      quantity,
      reduceOnly: reduceOnly ? "true" : undefined,
      newOrderRespType: "RESULT",
      newClientOrderId: `yk_${Date.now()}`,
    },
  });
}

export async function getBinanceOrder({ symbol, orderId }) {
  const config = assertTestnetConfig();
  return binanceRequest("/fapi/v1/order", {
    ...config,
    signed: true,
    params: {
      symbol,
      orderId,
    },
  });
}
