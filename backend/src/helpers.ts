/** Разделяет ADMIN_IDS из env. */
export function isAdmin(telegramId: number): boolean {
  const raw = process.env.ADMIN_IDS ?? "";
  return raw
    .split(/[\s,;]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n))
    .includes(telegramId);
}

/** Безопасный parseInt. */
export function toInt(v: any): number | null {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}