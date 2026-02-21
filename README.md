# Omnichannel Inbox (Telegram + Instagram starter)

Микросервис на **Node.js + TypeScript + Fastify + Prisma + Postgres**:
- принимает сообщения из Telegram и Instagram (webhooks)
- нормализует в общий формат
- сохраняет: текст/контент, ник, канал, время, тип (inbound/outbound), телефон (если есть)
- предоставляет API для списка диалогов/сообщений и отправки исходящих (Telegram реализован, Instagram — заготовка)

## Быстрый старт (Docker)

1) Скопируйте переменные окружения:
```bash
cp .env.example .env
```

2) Запустите:
```bash
docker compose up --build
```

3) Проверка:
- Health: `GET http://localhost:8080/health`
- Conversations: `GET http://localhost:8080/conversations`

> При старте контейнер выполнит `prisma migrate deploy`.  
> Для локальной разработки можно использовать `npm run prisma:migrate:dev`.


## Локальный старт без Docker (Postgres)

1) Скопируйте переменные окружения и укажите строку подключения к вашей локальной БД Postgres:
```bash
cp .env.example .env
```

2) Установите зависимости и примените миграции:
```bash
npm install
npm run prisma:generate
npm run prisma:migrate:dev
```

3) Запустите сервис:
```bash
npm run dev
```

UI:
- `http://localhost:8080/`

API:
- Health: `GET http://localhost:8080/health`
- Conversations: `GET http://localhost:8080/conversations`

## Prod (Postgres)

Перед стартом приложения примените миграции:
```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```


## Локальная разработка (без Docker)

По умолчанию проект запускается **без Postgres** — на **SQLite** (файл `./dev.db`).
Это самый простой старт «скачал → запустил».

```bash
cp .env.example .env
npm i
npm run dev:local
```

Что делает `dev:local`:
- генерирует Prisma client
- создаёт/обновляет схему в `dev.db` через `prisma db push`
- запускает сервер в watch режиме

### Если нужен Postgres локально

1) В `prisma/schema.prisma` верни `provider = "postgresql"`
2) В `.env` задай `DATABASE_URL=postgresql://...`
3) Прогони миграции:

```bash
npm run prisma:generate
npm run prisma:migrate:dev
npm run dev
```

## Webhooks

### Telegram
Endpoint: `POST /webhooks/telegram`

**Рекомендуется** включить проверку секретом:
- задайте `TELEGRAM_WEBHOOK_SECRET=...` в `.env`
- Telegram будет присылать заголовок `x-telegram-bot-api-secret-token`

Установка вебхука (пример):
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<YOUR_DOMAIN>/webhooks/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Исходящие сообщения:
- `POST /messages/send` (для telegram отправит сообщение и сохранит outbound)

### Instagram / Meta
Endpoints:
- `GET /webhooks/instagram` — verification (hub.challenge)
- `POST /webhooks/instagram` — события сообщений (заготовка)

В `.env` нужно задать:
- `INSTAGRAM_VERIFY_TOKEN`

> Валидация подписи `X-Hub-Signature-256` не включена в этот starter, но место под это есть (см. `src/adapters/instagram.ts`).

## API

- `GET /conversations?channel=telegram|instagram&q=<search>&limit=50&cursor=<iso>`
- `GET /conversations/:id/messages?limit=50&cursor=<iso>`
- `POST /messages/send` `{ conversationId, text, messageType? }`

## Расширение каналов

Добавляйте адаптер в `src/adapters/*` который преобразует входящие события в `NormalizedMessage`,
а дальше сохранение делается общими функциями `upsertConversation` и `insertMessage`.

## Запуск без Docker (самый простой)

```bash
cp .env.example .env
npm install
npm run dev:local
```


Примечание: в проекте есть .npmrc с `omit=false`, чтобы npm не пропускал dev-зависимости.

### Важно (macOS / npm конфиги)
Проект запускается без зависимости от `node_modules/.bin` (bin-links), поэтому команды работают даже если `npx prisma`/`tsx` не находятся.
Используй:
- `npm run prisma:generate`
- `npm run prisma:migrate:deploy`
- `npm run dev`


### Instagram DM sending
Set `INSTAGRAM_PAGE_ACCESS_TOKEN` (and optionally `META_GRAPH_VERSION`) to enable sending DM via `/messages/send` for instagram conversations.
