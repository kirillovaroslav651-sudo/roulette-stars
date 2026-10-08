import { Router, Response } from "express";
import crypto from "crypto";
import {
  db,
  ensureUser,
  getUser,
  getTransactions,
  placeBet,
  adminCredit,
  grantReferralBonus,
  createOrder,
  getOrder,
  markOrderPaid,
  applyTx,
  claimDailyBonus,
  moscowDay,
  PACKAGES,
} from "./db";
import { authGuard, requireAuth, TgUser } from "./auth";
import { isAdmin, toInt } from "./helpers";

const router = Router();
const BOT_TOKEN = process.env.BOT_TOKEN as string;

router.use(authGuard);

/** Resolve ref-кода в telegram_id (для /me). */
function resolveRef(refCode: string | null): number | null {
  if (!refCode) return null;
  const row = db
    .prepare(`SELECT telegram_id FROM users WHERE ref_code = ?`)
    .get(refCode);
  return row ? (row as any).telegram_id : null;
}

/** GET /api/me — юзер + баланс + история + флаги админа. */
router.get("/me", requireAuth, (req: any, res: Response) => {
  const u = req.auth.user as TgUser;
  const refId = resolveRef(req.auth.refCode ?? null);

  const user = ensureUser(u.id, u.username, refId && refId !== u.id ? refId : null);
  const tx = getTransactions(u.id, 25);

  res.json({
    ok: true,
    data: {
      user: {
        telegramId: user.telegram_id,
        username: user.username,
        balance: user.balance,
        refCode: user.ref_code,
        isAdmin: isAdmin(u.id),
        referralCount: countReferrals(u.id),
        dailyBonusReady: dailyBonusReady(u.id),
      },
      transactions: tx,
    },
  });
});

/** Проверить, доступен ли ежедневный бонус сегодня. */
function dailyBonusReady(userId: number): boolean {
  const row: any = db
    .prepare(`SELECT last_day FROM daily_bonus WHERE user_id = ?`)
    .get(userId);
  return !(row && row.last_day === moscowDay());
}

/** GET /api/referrals — рефералы. */
router.get("/referrals", requireAuth, (req: any, res: Response) => {
  const id = req.auth.user.id;
  const myCode = getUser(id)?.ref_code ?? null;
  const refs = db
    .prepare(
      `SELECT username, created_at FROM users
       WHERE referred_by = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(id);
  res.json({ ok: true, data: { refCode: myCode, referrals: refs } });
});

/** POST /api/admin/credit — magic-кнопка накрутки (только админ). */
router.post("/admin/credit", requireAuth, (req: any, res: Response) => {
  const id = req.auth.user.id;
  if (!isAdmin(id)) return res.status(403).json({ ok: false, error: "forbidden" });

  const amount = toInt(req.body.amount);
  const target = toInt(req.body.target);
  const targetId = target && target > 0 ? target : id;
  if (!amount || amount <= 0)
    return res.status(400).json({ ok: false, error: "invalid_amount" });

  const balance = adminCredit(targetId, amount);
  res.json({ ok: true, data: { target: targetId, credited: amount, balance } });
});

/** POST /api/daily-bonus — бесплатные звёзды раз в сутки. */
router.post("/daily-bonus", requireAuth, (req: any, res: Response) => {
  const id = req.auth.user.id;
  const DAILY_BONUS = parseInt(process.env.DAILY_BONUS ?? "5", 10);
  const { granted, bonus } = claimDailyBonus(id, DAILY_BONUS);
  const balance = getUser(id)?.balance ?? 0;
  res.json({ ok: true, data: { granted, bonus, balance } });
});

/** POST /api/invoice — создать invoice link для покупки XTR. */
router.post("/invoice", requireAuth, async (req: any, res: Response) => {
  const u = req.auth.user as TgUser;
  const pkg = PACKAGES.find((p) => p.id === req.body.packageId);
  if (!pkg) return res.status(400).json({ ok: false, error: "invalid_package" });

  // Уникальный payload для связки вебхука и юзера.
  const payload = `o_${crypto.randomBytes(10).toString("hex")}`;
  createOrder(payload, u.id, pkg.id, pkg.amount);

  try {
    const invoiceLink = await createInvoiceLink(
      pkg.title,
      pkg.amount,
      payload
    );
    return res.json({ ok: true, data: { invoiceLink, payload } });
  } catch (err) {
    console.error("invoice error", err);
    return res.status(500).json({ ok: false, error: "invoice_failed" });
  }
});

/** POST /api/bet — выбрать игру и поставить. */
router.post("/bet", requireAuth, (req: any, res: Response) => {
  const u = req.auth.user as TgUser;
  const betAmount = toInt(req.body.amount);
  const betId = (req.body.betId as string) ?? "";
  const game = (req.body.game as string) ?? "roulette";
  const choice = (req.body.choice as string) ?? undefined;

  const VALID_GAMES = ["roulette", "coin", "dice", "highlow", "lucky"];
  if (!VALID_GAMES.includes(game))
    return res.status(400).json({ ok: false, error: "invalid_game" });

  if (!betId) return res.status(400).json({ ok: false, error: "missing_bet_id" });
  if (!betAmount || betAmount <= 0)
    return res.status(400).json({ ok: false, error: "invalid_bet" });

  try {
    const user = getUser(u.id);
    if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });
    if (betAmount > user.balance)
      return res.status(400).json({ ok: false, error: "insufficient_balance" });

    const result = placeBet(u.id, betAmount, betId, game, choice);
    const balance = getUser(u.id).balance;
    return res.json({ ok: true, data: { ...result, balance } });
  } catch (err: any) {
    if (err?.message === "insufficient_balance")
      return res.status(400).json({ ok: false, error: "insufficient_balance" });
    console.error("bet error", err);
    return res.status(500).json({ ok: false, error: "bet_failed" });
  }
});

/**
 * Обработка апдейта Telegram (вебхук): successful_payment → пополнение + реф.
 * Вызывается bot'om после проверки секрета.
 */
export async function handlePaymentUpdate(msg: {
  successful_payment?: { invoice_payload?: string; telegram_payment_charge_id?: string; total_amount?: number };
}): Promise<void> {
  const payment = msg.successful_payment;
  if (!payment) return;

  const payload = payment.invoice_payload ?? "";
  const order = getOrder(payload);
  if (!order) return;

  // Идемпотентность: если уже paid/пополнен — не трогаем
  if (order.status === "paid") return;

  // Проверяем, что сумма совпадает с пакетом
  if (order.amount !== payment.total_amount) return;

  const ref = `${order.user_id}:${payment.telegram_payment_charge_id ?? payload}`;
  applyTx(order.user_id, "purchase", order.amount, { ref });
  markOrderPaid(payload);

  // Бонус пригласившему
  const me = getUser(order.user_id);
  if (me?.referred_by) {
    grantReferralBonus(me.referred_by, order.amount);
  }
  console.log(`✅ пополнено ${order.amount} звёзд юзеру ${order.user_id}`);
}

function countReferrals(userId: number): number {
  const r = db
    .prepare(`SELECT COUNT(*) c FROM users WHERE referred_by = ?`)
    .get(userId) as any;
  return r?.c ?? 0;
}

/** Прямой вызов Bot API createInvoiceLink. */
async function createInvoiceLink(title: string, amount: number, payload: string): Promise<string> {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description: "Пополнение баланса в игре «Рулетка Звёзд»",
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `${amount} звёзд`, amount }],
    }),
  });
  const json: any = await res.json();
  if (!json.ok) throw new Error(`Bot API: ${json.description}`);
  return json.result;
}

export default router;