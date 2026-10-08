import crypto from "crypto";
import fs from "fs";
import path from "path";

// Диагностический лог (АБСОЛЮТНЫЙ путь, чтобы не зависеть от %TEMP% процесса)
const AUTH_LOG = path.join("C:/Users/kiril/AppData/Local/Temp", "roulette_auth.log");
function diag(...args: any[]) {
  try {
    fs.appendFileSync(AUTH_LOG, `[${new Date().toISOString()}] ${args.join(" ")}\n`);
  } catch {}
}

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface AuthPayload {
  user: TgUser | null;
  refCode?: string | null; // из поля start_param: ref_<ref_code>
}

/** HTTP-контекст запроса Express. */
declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN as string;
const MAX_AGE = parseInt(process.env.INITDATA_MAX_AGE ?? "86400", 10);

/** Канонизирует строку initData для проверки подписи.
 *  Telegram: data_check_string = пары key=value (ЗНАЧЕНИЯ ДЕКОДИРУЮТСЯ),
 *  отсортированные лексикографически по ключу, разделённые \n.
 *  Исключаем только поле `hash`. Поле `signature` включаем (современный формат). */
function sortInitData(initData: string): string {
  return initData
    .split("&")
    .filter((p) => {
      if (!p) return false;
      const key = p.split("=")[0];
      return key !== "hash"; // hash исключаем; signature — включаем
    })
    .map((p) => {
      const eq = p.indexOf("=");
      const key = p.slice(0, eq);
      const value = decodeURIComponent(p.slice(eq + 1));
      return `${key}=${value}`;
    })
    .sort((a, b) => a.localeCompare(b))
    .join("\n");
}

/**
 * Валидирует Telegram WebApp initData (подпись HMAC-SHA256, поля внутри).
 * Возвращает распарсенный payload или null, если вредно/просрочено.
 */
export function validateInitData(
  initData: string,
  botToken: string = BOT_TOKEN
): AuthPayload | null {
  try {
    // 1. Вытащить hash и остальные поля
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;

    // 2. secret_key = HMAC_SHA256("WebAppData", bot_token)
    const secret = crypto
      .createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // 3. data_check_string для подписи
    const dataCheckString = sortInitData(initData);

    // 4. computed_hash = HMAC_SHA256(data_check_string, secret)
    const computed = crypto
      .createHmac("sha256", secret)
      .update(dataCheckString)
      .digest("hex");

    if (computed !== hash) {
      diag("  computedHash=", computed, "telegramHash=", hash);
      return null; // подпись не сошлась
    }

    // 5. Проверка давности auth_date (защита от replay)
    const authDate = params.get("auth_date");
    if (authDate) {
      const ageSec = Math.floor(Date.now() / 1000) - parseInt(authDate, 10);
      if (ageSec < 0 || ageSec > MAX_AGE) return null;
    }

    // 6. Распарсить user и start_param
    let user: TgUser | null = null;
    const userRaw = params.get("user");
    if (userRaw) user = JSON.parse(decodeURIComponent(userRaw));

    let refCode: string | null = null;
    const startParam = params.get("start_param");
    if (startParam) {
      // start_param = "ref_<ref_code>" — код пригласившего
      const m = startParam.match(/^ref_(.+)$/);
      if (m) refCode = m[1];
    }

    return { user, refCode };
  } catch {
    return null;
  }
}

/**
 * Express middleware: парсит initData из заголовка x-init-data,
 * валидирует, подсовывает req.auth.
 */
export function authGuard(req: any, _res: any, next: any) {
  const header = req.headers["x-init-data"] as string | undefined;
  diag("serverBotToken=", (BOT_TOKEN || "EMPTY").slice(0, 6), "len=", (BOT_TOKEN || "").length);
  if (!header) {
    req.auth = undefined;
    diag("НЕТ заголовка x-init-data; path:", req.path, "ua:", req.headers["user-agent"]);
    return next();
  }
  const payload = validateInitData(header);
  if (payload) {
    req.auth = payload;
    diag("OK user:", payload.user?.id, "username:", payload.user?.username, "path:", req.path);
  } else {
    req.auth = undefined;
    // Полный дамп initData для диагностики
    const full = header.length > 2000 ? header.slice(0, 2000) : header;
    diag("НЕ прошёл: len=", header.length, "FULL=", JSON.stringify(full));
    diag("  hex=", Buffer.from(header.slice(0, 120)).toString("hex"));
  }
  next();
}

/** Проверка, что юзер авторизован через initData (иначе 401). */
export function requireAuth(req: any, res: any, next: any) {
  if (!req.auth?.user) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}