const BOT_ID = "default";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${response.status}: ${text}`);
  }

  return response;
}

async function supabaseFetch(path, options = {}) {
  const response = await supabaseRequest(path, options);
  if (response.status === 204) return null;
  return response.json();
}

export async function getBotState() {
  const rows = await supabaseFetch(`/bot_state?id=eq.${BOT_ID}&select=*&limit=1`);
  return rows?.[0] ?? null;
}

export async function upsertBotState(state) {
  const rows = await supabaseFetch("/bot_state?on_conflict=id", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([{ ...state, id: BOT_ID }]),
  });
  return rows?.[0] ?? null;
}

export async function insertTrade(trade) {
  if (!trade) return null;
  const rows = await supabaseFetch("/bot_trades", {
    method: "POST",
    headers: {
      Prefer: "return=representation",
    },
    body: JSON.stringify([{ ...trade, bot_id: BOT_ID }]),
  });
  return rows?.[0] ?? null;
}

export async function getRecentTrades(limit = 20) {
  return supabaseFetch(`/bot_trades?bot_id=eq.${BOT_ID}&select=*&order=created_at.desc&limit=${limit}`);
}

export async function getTradeCount() {
  const response = await supabaseRequest(`/bot_trades?bot_id=eq.${BOT_ID}&select=id&limit=1`, {
    headers: {
      Prefer: "count=exact",
    },
  });
  const contentRange = response.headers.get("content-range");
  const count = Number(contentRange?.split("/")?.[1]);
  return Number.isFinite(count) ? count : 0;
}
