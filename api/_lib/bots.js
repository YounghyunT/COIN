export const BOTS = [
  {
    id: "poongdeok-xi-v1",
    name: "풍덕자이v1.0",
    interval: "15m",
    candleLimit: 240,
    initialCash: 50000,
    strategy: "trend-pullback",
  },
  {
    id: "gagok-daegwang-v1",
    name: "가곡대광v1.0",
    interval: "15m",
    candleLimit: 240,
    initialCash: 50000,
    strategy: "balanced-mean-reversion",
  },
];

export const DEFAULT_BOT_ID = BOTS[0].id;

export function getBotConfig(botId = DEFAULT_BOT_ID) {
  return BOTS.find((bot) => bot.id === botId) ?? BOTS[0];
}
