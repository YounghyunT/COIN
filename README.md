# BTC Signal Lab

React + Tailwind 기반의 비트코인 신호 대시보드입니다. Binance BTCUSDT 1분봉을 실시간으로 받아 차트, EMA, RSI, MACD, Bollinger Band를 보여주고, 규칙 기반 매수/매도 관심 신호와 모의투자 섹션을 제공합니다.

## 실행

```bash
npm install
npm run dev
```

## 텔레그램 알림

Vercel 프로젝트 환경변수에 아래 값을 등록하면 `/api/telegram-signal` 서버리스 함수가 현재 신호를 텔레그램으로 전송합니다.

```bash
TELEGRAM_BOT_TOKEN=123456:replace_me
TELEGRAM_CHAT_ID=123456789
```

## Vercel 배포

- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

이 앱은 주문을 실행하지 않는 분석/모의투자 도구입니다. 실제 투자 판단 전에는 전략 검증과 리스크 관리를 별도로 진행해야 합니다.
