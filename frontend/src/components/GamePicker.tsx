export type GameId = "roulette" | "coin" | "dice" | "highlow" | "lucky";

export const GAMES: { id: GameId; name: string; emoji: string; desc: string }[] = [
  { id: "roulette", name: "Рулетка", emoji: "🎰", desc: "50/50 ×2" },
  { id: "coin", name: "Монетка", emoji: "🪙", desc: "Орёл/Решка ×2" },
  { id: "dice", name: "Кубик", emoji: "🎲", desc: "Чёт/Больше ×2" },
  { id: "highlow", name: "Карты", emoji: "🃏", desc: "Выше/Ниже ×1.8" },
  { id: "lucky", name: "Лотерея", emoji: "🍀", desc: "Джекпот ×3" },
];

type Props = {
  game: GameId;
  onSelect: (g: GameId) => void;
};

export default function GamePicker({ game, onSelect }: Props) {
  return (
    <div className="game-picker">
      {GAMES.map((g) => (
        <button
          key={g.id}
          className={`game-tab ${game === g.id ? "game-tab--active" : ""}`}
          onClick={() => onSelect(g.id)}
        >
          <span className="game-tab-emoji">{g.emoji}</span>
          <span>{g.name}</span>
        </button>
      ))}
    </div>
  );
}