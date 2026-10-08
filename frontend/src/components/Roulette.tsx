import { useState } from "react";
import { api } from "../lib/api";
import { GameId } from "./GamePicker";

const QUICK = [10, 25, 50, 100];

type Props = {
  balance: number;
  game: GameId;
  onBalanceChanged: (balance: number) => void;
};

// Выбор для игры
function ChoiceSelector({ game, choice, setChoice }: {
  game: GameId;
  choice: string;
  setChoice: (c: string) => void;
}) {
  if (game === "coin") {
    const opts = [
      { id: "heads", label: "🦅 Орёл" },
      { id: "tails", label: "🪙 Решка" },
    ];
    return (
      <div className="quick-row">
        {opts.map((o) => (
          <button
            key={o.id}
            className={`quick ${choice === o.id ? "quick--active" : ""}`}
            onClick={() => setChoice(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (game === "dice") {
    const opts = [
      { id: "even", label: "Чёт" },
      { id: "over", label: "4+" },
    ];
    return (
      <div className="quick-row">
        {opts.map((o) => (
          <button
            key={o.id}
            className={`quick ${choice === o.id ? "quick--active" : ""}`}
            onClick={() => setChoice(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (game === "highlow") {
    const opts = [
      { id: "higher", label: "⬆ Выше" },
      { id: "lower", label: "⬇ Ниже" },
    ];
    return (
      <div className="quick-row">
        {opts.map((o) => (
          <button
            key={o.id}
            className={`quick ${choice === o.id ? "quick--active" : ""}`}
            onClick={() => setChoice(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (game === "lucky") {
    return <p className="referral-note">Шанс 1/25 на джекпот ×3</p>;
  }
  return null; // roulette — без выбора
}

export default function GameBoard({ balance, game, onBalanceChanged }: Props) {
  const [amount, setAmount] = useState<string>("25");
  const [choice, setChoice] = useState<string>("heads");
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ won: boolean; delta: number; outcome?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const num = parseInt(amount, 10) || 0;

  const play = async () => {
    if (spinning) return;
    // Для coin/dice/highlow нужен выбор
    if (["coin", "dice", "highlow"].includes(game) && !choice) {
      setError("Сделай выбор (орёл/решка, чёт/4+, выше/ниже)");
      return;
    }

    if (num <= 0) { setError("Введи ставку больше 0"); return; }
    if (num > balance) { setError("Не хватает звёзд"); return; }

    setSpinning(true);
    setResult(null);
    setError(null);

    try {
      const betId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "" + Date.now() + Math.random().toString(16).slice(2);
      const [res] = await Promise.all([
        api.bet(num, betId, game, game === "roulette" || game === "lucky" ? undefined : choice),
        new Promise((r) => setTimeout(r, 1000)),
      ]);

      setResult(res);
      onBalanceChanged(res.balance);
    } catch (e: any) {
      setError(e.message || "Ошибка ставки");
    } finally {
      setSpinning(false);
    }
  };

  return (
    <section className="roulette">
      {/* Игровое поле */}
      <div className={`wheel ${result ? (result.won ? "wheel--win" : "wheel--lose") : ""} ${spinning ? "wheel--spinning" : ""}`}>
        <div className="pointer">⬆️</div>
        <div className="label">{
          game === "roulette" ? "🎰 ×2" :
          game === "coin" ? "🪙" :
          game === "dice" ? "🎲" :
          game === "highlow" ? "🃏" :
          "🍀"
        }</div>
      </div>

      {/* Результат */}
      <div className={`reveal ${result ? (result.won ? "reveal--win" : "reveal--lose") : ""}`}>
        {result
          ? result.won
            ? `🎉 Выигрыш +${result.delta}${result.outcome ? ` (${result.outcome})` : ""}!`
            : `💔 Проигрыш −${Math.abs(result.delta)}${result.outcome ? ` (${result.outcome})` : ""}`
          : "Сделай ставку!"}
      </div>

      {/* Выбор (для coin/dice/highlow) */}
      <ChoiceSelector game={game} choice={choice} setChoice={setChoice} />

      {/* Быстрые ставки */}
      <div className="quick-row">
        {QUICK.map((q) => (
          <button
            key={q}
            className={`quick ${num === q ? "quick--active" : ""}`}
            onClick={() => { setAmount(String(q)); setError(null); }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Ввод ставки */}
      <div className="bet-input-wrap">
        <span className="star">⭐</span>
        <input
          className="bet-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={balance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="btn btn--ghost" onClick={() => { setAmount(String(Math.max(0, balance))); setError(null); }}>
          All-in
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <button className="btn btn--block btn--r" onClick={play} disabled={spinning}>
        {spinning ? "Играем..." : "▶ Играть"}
      </button>
    </section>
  );
}