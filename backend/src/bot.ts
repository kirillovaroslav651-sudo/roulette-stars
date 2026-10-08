import { Telegraf } from "telegraf";
import { handlePaymentUpdate } from "./routes";

/**
 * Бот обрабатывает успешные платежи (successful_payment) и команды.
 * В webhook-режиме апдейты приходят на /webhook/telegram,
 * в polling-режиме бот сам их качает.
 */

/** Полный URL приложения, без хвостовых слэшей. */
function webAppUrl(): string {
  const raw = process.env.WEBAPP_URL ?? process.env.BASE_URL ?? "";
  return raw.replace(/\/+$/, "");
}

export async function createBot(): Promise<Telegraf> {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN not set");
  const bot = new Telegraf(token);
  const appUrl = webAppUrl();
  // Telegram принимает web_app-кнопки только по HTTPS
  const httpsOk = appUrl.startsWith("https://");

  // Веб-кнопка под полем ввода (setChatMenuButton) — только если HTTPS.
  if (httpsOk) {
    await bot.telegram
      .setChatMenuButton({
        menuButton: {
          type: "web_app",
          text: "🎰 Играть",
          web_app: { url: appUrl },
        },
      })
      .catch((err) => console.warn("Не удалось установить кнопку меню:", err.message));
  }

  // Команда /start — приветствие + кнопка запуска (если HTTPS) или текст.
  bot.start((ctx) => {
    const startPayload = ctx.startPayload;
    const url = startPayload ? `${appUrl}?start_param=ref_${startPayload}` : appUrl;

    if (!httpsOk) {
      return ctx.reply(
        "👋 Добро пожаловать в «Рулетку Звёзд»! 🎰\n\n⚠️ Mini App ещё не подключён по HTTPS. " +
          "Установи туннель (cloudflared) и пропиши WEBAPP_URL с https://, чтобы открыть игру."
      );
    }

    ctx.reply("👋 Добро пожаловать в «Рулетку Звёзд»! 🎰\nКупи звёзды, крути рулетку и умножай их. Удачи!", {
      reply_markup: {
        inline_keyboard: [[{ text: "🎰 Открыть игру", web_app: { url } }]],
      },
    });
  });

  // Обработчик успешной оплаты.
  bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));
  bot.on("message", async (ctx) => {
    if (ctx.message && "successful_payment" in ctx.message) {
      await handlePaymentUpdate(ctx.message as any);
    }
  });

  return bot;
}