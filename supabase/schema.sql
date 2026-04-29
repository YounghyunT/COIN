create table if not exists public.bot_state (
  id text primary key default 'default',
  cash numeric not null default 50000,
  btc numeric not null default 0,
  avg_entry numeric,
  equity numeric,
  last_candle_time bigint,
  last_run_at timestamptz,
  last_signal jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_trades (
  id bigserial primary key,
  bot_id text not null default 'default',
  side text not null check (side in ('BUY', 'SELL')),
  price numeric not null,
  amount numeric not null,
  cash_delta numeric not null,
  position_pct numeric,
  equity_before numeric,
  equity_after numeric,
  avg_entry_before numeric,
  realized_pnl numeric,
  realized_pnl_pct numeric,
  reason text,
  candle_time bigint not null,
  created_at timestamptz not null default now()
);

alter table public.bot_trades add column if not exists position_pct numeric;
alter table public.bot_trades add column if not exists equity_before numeric;
alter table public.bot_trades add column if not exists equity_after numeric;
alter table public.bot_trades add column if not exists avg_entry_before numeric;
alter table public.bot_trades add column if not exists realized_pnl numeric;
alter table public.bot_trades add column if not exists realized_pnl_pct numeric;

insert into public.bot_state (id, cash, btc)
values ('default', 50000, 0)
on conflict (id) do nothing;
