delete from public.bot_trades
where bot_id in ('poongdeok-xi-v1', 'gagok-daegwang-v1');

insert into public.bot_state (
  id,
  cash,
  btc,
  avg_entry,
  equity,
  last_candle_time,
  last_run_at,
  last_signal,
  updated_at
)
values (
  'poongdeok-xi-v1',
  50000,
  0,
  null,
  50000,
  null,
  null,
  null,
  now()
),
(
  'gagok-daegwang-v1',
  50000,
  0,
  null,
  50000,
  null,
  null,
  null,
  now()
)
on conflict (id) do update set
  cash = excluded.cash,
  btc = excluded.btc,
  avg_entry = excluded.avg_entry,
  equity = excluded.equity,
  last_candle_time = excluded.last_candle_time,
  last_run_at = excluded.last_run_at,
  last_signal = excluded.last_signal,
  updated_at = excluded.updated_at;
