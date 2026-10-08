# 🎰 Рулетка Звёзд — Telegram Mini App

Полноценное мини-приложение для Telegram: покупай Telegram Stars (XTR), играй в казино-мини игры и выигрывай/проигрывай звёзды.

Стек: **React 18 + Vite + TypeScript + @twa-dev/sdk** (frontend) · **Node.js + Express + Telegraf + SQLite** (backend, на встроенном `node:sqlite` — без компиляции).

---

## ✨ Возможности

- **Авторизация** через Telegram WebApp `initData` с крипто-валидацией подписи HMAC-SHA256 на сервере (защита от подделки и replay).
- **Покупка звёзд (XTR)** — создание `createInvoiceLink`, открытие платежа через `WebApp.openInvoice`, пополнение через вебхук `successful_payment`.
- **5 игр** (выбор вкладкой):
  - 🎰 **Рулетка** — 50/50, ×2
  - 🪙 **Монетка** — орёл/решка, ×2
  - 🎲 **Кубик** — чёт / 4+, ×2
  - 🃏 **Карты** — выше/ниже, ×1.8
  - 🍀 **Лотерея** — джекпот 1/25, ×3
- **Ежедневный бонус** — бесплатные звёзды раз в сутки.
- **Реферальная система** — 10% от пополнения приглашённых тебе на баланс.
- **Админ-кнопка «🪄 +100»** — магическая накрутка звёзд (по whitelist `ADMIN_IDS`).
- **Идемпотентность** всех кошельковых операций (уникальные `bet_id` и `payload`).
- **Московская дата** для дневных бонусов.
- **Тёмная фиолетовая тема**, адаптация под Telegram theme.
- **История транзакций** на главном экране.

---

## 📁 Структура

```
roulette-stars/
├── backend/                  # Node + Express + Telegraf + node:sqlite
│   ├── src/
│   │   ├── server.ts         # точка входа, webhook/polling
│   │   ├── bot.ts            # Telegraf: /start, successful_payment
│   │   ├── auth.ts           # валидация initData + middleware
│   │   ├── db.ts             # схема БД, транзакции, игры, бонусы
│   │   ├── routes.ts         # /api/* + обработка оплаты
│   │   └── helpers.ts        # isAdmin, toInt
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
└── frontend/                 # React 18 + Vite + TS + TWA SDK
    ├── src/
    │   ├── App.tsx           # layout, состояние юзера
    │   ├── components/       # GamePicker, Roulette(игровое поле),
    │   │                     # BuyModal, History, InviteCard
    │   ├── lib/api.ts        # API-клиент + типы
    │   ├── styles.css        # фиолетовая тема
    │   ├── main.tsx
    │   └── vite.config.ts    # proxy /api → localhost:3000
    ├── package.json
    └── tsconfig.json
```

---

## 🚀 Запуск локально

### 1. Требования
- Node.js **>= 22** (нужен встроенный `node:sqlite`)
- Бот из [@BotFather](https://t.me/BotFather)

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env      # отредактируй
```

В `.env` пропиши:
```env
BOT_TOKEN=123456:AAA...
BOT_MODE=polling          # локально: без HTTPS, без вебхука
PORT=3000
ADMIN_IDS=123456789       # твой Telegram ID (накрутка звёзд)
WEBAPP_URL=http://localhost:5173
```

Запуск:
```bash
npm run dev               # tsx watch (или npm run build && npm start)
```

> **Важно про покупку звёзд локально:** `createInvoiceLink` и открытие платежа работают только когда бот инициирован из Telegram и URL открывается внутри WebApp. В чистом браузере платёж не откроется — это нормально. Для реального теста нужен HTTPS-домен (раздел «Деплой»).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Во время разработки Vite проксирует `/api` на `http://localhost:3000` (см. `vite.config.ts`).

### 4. Сборка продакшена

```bash
cd frontend && npm run build   # → frontend/dist
cd backend  && npm run build   # → backend/dist
```

---

## 🧩 Как подключить бота к Mini App

1. В @BotFather: **/newapp** (или /mybots → редактировать → Mini App) → укажи `WEBAPP_URL` твоего фронтенда.
2. Дай боту право **показывать invoices** (BotFather → оплата или api):
   ```
   POST /setpaymentsprovider?provider_token=XTR
   ```
   (для звёзд provider_token пустой, просто активируй Stars-платежи).

---

## ☁️ Деплой (HTTPS)

Платежи и `openInvoice` требуют HTTPS-домена с **валидным сертификатом** (не локального).

### Вариант А — Render / Railway / Fly.io (просто)
1. Задеплой монорепо; в начале сборки запускай `npm install` в `backend`, в конце — `node dist/server.js`.
2. Проксируй `/api` и `/webhook/telegram` на тот же Express-сервер, а статику `frontend/dist` — через отдельный хостинг (Netlify/Vercel) или Express `express.static`.
3. В `.env`: `BOT_MODE=webhook`, `BASE_URL=https://твой-домен`, `WEBAPP_URL=https://фронт`.

### Вариант Б — один Node-сервер (всё на одном домене)
В `server.ts` подключи статику фронтенда (добавь в `server.ts`):

```ts
app.use(express.static(path.join(__dirname, "../../frontend/dist")));
```

Тогда `BASE_URL` и `WEBAPP_URL` — один домен.

### Туннель для локального HTTPS-теста
```
npx cloudflared tunnel --url http://localhost:3000
```
Вставь выданный `https://...trycloudflare.com` в `BASE_URL`, `BOT_MODE=webhook`. Учти: бесплатные туннели нестабильны для продакшена.

---

## 🔒 Безопасность

- **initData** — проверяется подпись `hash` через `HMAC_SHA256("WebAppData", bot_token)` и свежесть `auth_date` (анти-replay, окно задаётся `INITDATA_MAX_AGE`).
- **Все операции с балансом** — только на сервере, в SQLite-транзакциях.
- **Идемпотентность** — `bet_id` у ставок и `payload` у инвойсов уникальны; повторный обработчик не зачислит дважды.
- **Админка** — `ADMIN_IDS` whitelist на сервере; фронт просто скрывает кнопку, реальная проверка на бэке.
- **Платежи** — пополнение только после вебхука `successful_payment`, сумма сверяется с заказом.

---

## 🎲 Как устроены игры (fairness)

Исход каждой ставки вычисляется **на сервере** внутри SQLite-транзакции (`Math.random()`), выбор игрока передаётся как `choice`. Ставка списывается/зачисляется атомарно — нельзя «передёрнуть» броском. В рублях/ставках нет корысти: математическое ожидание всех игр отрицательное/честное (×2 на 50%, ×1.8 на ~50%, ×3 на ~4%), как в настоящем казино.

---

## 🕹 Стикеры / эмодзи

Интерфейс использует системные эмодзи (`⭐🎰🪙🎲🃏🍀💎🪄`). Если хочешь подключить набор стикеров (например, UtyaDuck), открой его в Telegram → скачай стикеры как PNG/WebP → положи в `frontend/public/stickers/` и замени эмодзи на `<img src="/stickers/xxx.png">` в компонентах (`GamePicker`, `Roulette`, `BuyModal`, `History`).

---

## 🧼 Проверка

```bash
cd backend  && npm run typecheck
cd frontend && npm run build
```
Оба проходят без ошибок на этой версии.