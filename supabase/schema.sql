create table if not exists public.bot_state (
  id text primary key default 'default',
  cash numeric not null default 10000,
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
  reason text,
  candle_time bigint not null,
  created_at timestamptz not null default now()
);

insert into public.bot_state (id, cash, btc)
values ('default', 10000, 0)
on conflict (id) do nothing;

