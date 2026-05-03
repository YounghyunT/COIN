import crypto from "node:crypto";

const DEFAULT_TESTNET_BASE_URL = "https://testnet.binancefuture.com";
const DEFAULT_SYMBOLS = ["BTCUSDT", "BTCUSDC"];

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

async function binanceRequest(path, { signed = false, params = {}, apiKey, secretKey, baseUrl } = {}) {
  const requestParams = {
    ...params,
    ...(signed ? { timestamp: Date.now(), recvWindow: 10_000 } : {}),
  };
  let query = buildQuery(requestParams);
  if (signed) {
    query = `${query}&signature=${signQuery(query, secretKey)}`;
  }

  const response = await fetch(`${baseUrl}${path}${query ? `?${query}` : ""}`, {
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
  return {
    totalWalletBalance: Number(account?.totalWalletBalance ?? 0),
    totalUnrealizedProfit: Number(account?.totalUnrealizedProfit ?? 0),
    availableBalance: Number(account?.availableBalance ?? 0),
    assets: assets
      .filter((asset) => ["USDT", "USDC", "BNB"].includes(asset.asset))
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

export async function getBinanceTestnetStatus(symbols = DEFAULT_SYMBOLS) {
  const config = getBinanceConfig();
  const [time, account, positionResults, commissionResults] = await Promise.all([
    binanceRequest("/fapi/v1/time", config),
    binanceRequest("/fapi/v2/account", { ...config, signed: true }),
    Promise.all(symbols.map((symbol) => optionalSignedRequest("/fapi/v2/positionRisk", { ...config, params: { symbol } }))),
    Promise.all(symbols.map((symbol) => optionalSignedRequest("/fapi/v1/commissionRate", { ...config, params: { symbol } }))),
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
    checkedAt: new Date().toISOString(),
  };
}
