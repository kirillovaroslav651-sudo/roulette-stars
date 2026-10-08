import { DatabaseSync } from "node:sqlite";
import path from "path";
import crypto from "crypto";

// Единый экземпляр БД на процесс. Файл лежит рядом с бэкендом — data/roulette.db
// Используем встроенный node:sqlite (Node >= 22) — не требует компиляции.
const dataDir = path.join(__dirname, "..", "data");
const fs = require("fs");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "roulette.db"));
db.exec("PRAGMA journal_mode = WAL");

/** Обёртка над транзакцией для node:sqlite (аналог better-sqlite3 .transaction). */
function transaction<T extends (...args: any[]) => any>(fn: T): T {
  return ((...args: Parameters<T>) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }) as T;
}

/** Пакет покупки: стоимость в XTR = количество звёзд. */
type Package = {
  id: string;
  amount: number;
  title: string;
};

export const PACKAGES: Package[] = [
  { id: "pkg-50", amount: 50, title: "50 звёзд" },
  { id: "pkg-100", amount: 100, title: "100 звёзд" },
  { id: "pkg-250", amount: 250, title: "250 звёзд" },
  { id: "pkg-500", amount: 500, title: "500 звёзд" },
];

// Комиссия рефеферала, % от пополнения приглашённым
export const REFERRAL_PERCENT = 10;

export type BetResult = "win" | "lose";
export type TxType =
  | "purchase"
  | "bet_win"
  | "bet_lose"
  | "referral_bonus"
  | "admin_credit"
  | "daily_bonus";

/** Инициализация схемы (idempotent). */
export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id   INTEGER PRIMARY KEY,
      username      TEXT,
      balance       INTEGER NOT NULL DEFAULT 0,
      ref_code      TEXT UNIQUE,
      referred_by   INTEGER REFERENCES users(telegram_id),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
      type        TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      game        TEXT,
      choice      TEXT,
      ref         TEXT,
      bet_id      TEXT,
      spin_result TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_bet ON transactions(bet_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_purchase_ref ON transactions(ref);

    -- Незавершённые покупки: payload → юзер и пакет
    CREATE TABLE IF NOT EXISTS orders (
      payload      TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL,
      package_id   TEXT NOT NULL,
      amount       INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

    -- Ежедневный бонус: один акт в сутки
    CREATE TABLE IF NOT EXISTS daily_bonus (
      user_id     INTEGER PRIMARY KEY,
      last_day    TEXT NOT NULL
    );
  `);

  // ref_code для всех, у кого его нет (переносимость появившихся миграций)
  const missing = db
    .prepare(`SELECT telegram_id FROM users WHERE ref_code IS NULL`)
    .all();
  const upd = db.prepare(`UPDATE users SET ref_code = ? WHERE telegram_id = ?`);
  for (const u of missing as any[]) upd.run(makeRefCode(), u.telegram_id);
}

/** Случайный короткий реферальный код. */
export function makeRefCode(): string {
  return crypto.randomBytes(4).toString("hex");
}

/** Возвращает запись юзера или undefined. */
export function getRawUser(telegramId: number): any {
  return db.prepare(`SELECT * FROM users WHERE telegram_id = ?`).get(telegramId);
}

export function getUser(telegramId: number): any {
  return getRawUser(telegramId);
}

/** Создать юзера при первом входе (upsert по telegram_id). */
export function ensureUser(
  telegramId: number,
  username: string | undefined,
  referredBy: number | null = null
): any {
  const existing = getRawUser(telegramId);
  if (existing) return existing;

  db.prepare(
    `INSERT OR IGNORE INTO users (telegram_id, username, ref_code, referred_by)
     VALUES (?, ?, ?, ?)`
  ).run(telegramId, username ?? null, makeRefCode(), referredBy);
  return getRawUser(telegramId);
}

/**
 * Начислить/списать с созданием транзакции, с идемпотентностью.
 */
export function applyTx(
  telegramId: number,
  type: TxType,
  amount: number,
  opts: {
    ref?: string;
    betId?: string;
    spinResult?: BetResult;
    game?: string;
    choice?: string;
  } = {}
): void {
  if (opts.betId) {
    const exists = db.prepare(`SELECT id FROM transactions WHERE bet_id = ?`).get(opts.betId);
    if (exists) return;
  }
  if (opts.ref) {
    const exists = db.prepare(`SELECT id FROM transactions WHERE ref = ?`).get(opts.ref);
    if (exists) return;
  }

  if (amount < 0) {
    const u = getRawUser(telegramId);
    if (!u || u.balance + amount < 0) throw new Error("insufficient_balance");
  }

  transaction(() => {
    db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(amount, telegramId);
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, ref, bet_id, spin_result, game, choice)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      telegramId,
      type,
      amount,
      opts.ref ?? null,
      opts.betId ?? null,
      opts.spinResult ?? null,
      opts.game ?? null,
      opts.choice ?? null
    );
  })();
}

/** История транзакций юзера. */
export function getTransactions(telegramId: number, limit = 20): any[] {
  return db
    .prepare(
      `SELECT id, type, amount, spin_result, game, choice, created_at
       FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(telegramId, limit);
}

/** Резолвер исхода игры. */
function resolveGame(
  game: string,
  choice?: string
): { won: boolean; multiplier: number; label: string } {
  switch (game) {
    case "coin": {
      const result = Math.random() < 0.5 ? "heads" : "tails";
      return { won: choice === result, multiplier: 2, label: result };
    }
    case "dice": {
      const roll = 1 + Math.floor(Math.random() * 6);
      if (choice === "even") return { won: roll % 2 === 0, multiplier: 2, label: `🎲 ${roll}` };
      if (choice === "over") return { won: roll >= 4, multiplier: 2, label: `🎲 ${roll}` };
      return { won: false, multiplier: 0, label: `🎲 ${roll}` };
    }
    case "highlow": {
      const bot = 2 + Math.floor(Math.random() * 10);
      const player = 2 + Math.floor(Math.random() * 10);
      const won =
        choice === "higher" ? player > bot : choice === "lower" ? player < bot : false;
      return { won, multiplier: 1.8, label: `${player} vs ${bot}` };
    }
    case "lucky": {
      const n = 1 + Math.floor(Math.random() * 25);
      return { won: n === 1, multiplier: 3, label: `#${n}` };
    }
    default:
      return { won: Math.random() < 0.5, multiplier: 2, label: "" };
  }
}

/**
 * Выполнить ставку атомарно (идемпотентно по betId).
 */
export const placeBet = transaction(
  (
    telegramId: number,
    betAmount: number,
    betId: string,
    game: string = "roulette",
    choice?: string
  ): { won: boolean; delta: number; outcome?: string; multiplier?: number } => {
    const existing = db
      .prepare(`SELECT spin_result FROM transactions WHERE bet_id = ?`)
      .get(betId);
    if (existing) {
      return {
        won: (existing as any).spin_result === "win",
        delta: (existing as any).spin_result === "win" ? +betAmount : -betAmount,
      };
    }

    const user = getRawUser(telegramId);
    if (!user) throw new Error("user_not_found");
    if (betAmount <= 0) throw new Error("invalid_bet");
    if (betAmount > user.balance) throw new Error("insufficient_balance");

    const outcome = resolveGame(game, choice);
    const delta = outcome.won ? Math.round(betAmount * outcome.multiplier) : -betAmount;

    db.prepare(`UPDATE users SET balance = balance + ? WHERE telegram_id = ?`).run(delta, telegramId);
    db.prepare(
      `INSERT INTO transactions (user_id, type, amount, bet_id, spin_result, game, choice)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      telegramId,
      outcome.won ? "bet_win" : "bet_lose",
      delta,
      betId,
      outcome.won ? "win" : "lose",
      game,
      choice ?? null
    );

    return { won: outcome.won, delta, outcome: outcome.label, multiplier: outcome.multiplier };
  }
);

/** Накрутка звёзд админом. */
export function adminCredit(telegramId: number, amount: number): number {
  applyTx(telegramId, "admin_credit", amount);
  return getRawUser(telegramId).balance;
}

/** Создание заказа для invoice. */
export function createOrder(payload: string, userId: number, packageId: string, amount: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO orders (payload, user_id, package_id, amount) VALUES (?,?,?,?)`
  ).run(payload, userId, packageId, amount);
}

export function getOrder(payload: string): any {
  return db.prepare(`SELECT * FROM orders WHERE payload = ?`).get(payload);
}

export function markOrderPaid(payload: string): void {
  db.prepare(`UPDATE orders SET status = 'paid' WHERE payload = ?`).run(payload);
}

/** Московская дата (YYYY-MM-DD). */
export function moscowDay(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Начислить ежедневный бонус, если сегодня ещё не начисляли. */
export function claimDailyBonus(telegramId: number, amount: number): { granted: boolean; bonus: number } {
  const day = moscowDay();
  const row: any = db.prepare(`SELECT last_day FROM daily_bonus WHERE user_id = ?`).get(telegramId);
  if (row && row.last_day === day) return { granted: false, bonus: 0 };

  const changed = transaction(() => {
    const before: any = db
      .prepare(`SELECT last_day FROM daily_bonus WHERE user_id = ?`)
      .get(telegramId);
    if (before && before.last_day === day) return false; // параллельный запрос уже начислил

    db.prepare(
      `INSERT INTO daily_bonus (user_id, last_day) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_day = excluded.last_day`
    ).run(telegramId, day);

    applyTx(telegramId, "daily_bonus", amount);
    return true;
  })();

  return changed ? { granted: true, bonus: amount } : { granted: false, bonus: 0 };
}

/** Бонус пригласившему за покупку. */
export function grantReferralBonus(referrerId: number, purchaseAmount: number): number {
  const bonus = Math.round(purchaseAmount * (REFERRAL_PERCENT / 100));
  if (bonus <= 0) return 0;
  applyTx(referrerId, "referral_bonus", bonus);
  return bonus;
}

export { db };