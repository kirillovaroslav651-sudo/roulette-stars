import { useEffect, useState, useCallback } from "react";
import { api, getTgUser, MeData } from "./lib/api";
import GameBoard from "./components/Roulette";
import BuyModal from "./components/BuyModal";
import History from "./components/History";
import InviteCard from "./components/InviteCard";
import GamePicker, { GameId } from "./components/GamePicker";

// Стартовые параметры передаются как ?startparam=ref_<code>. См. /referrals.
const DAILY_BONUS_DISPLAY = 5;

export default function App() {
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [game, setGame] = useState<GameId>("roulette");

  const user = getTgUser();

  const reload = useCallback(async () => {
    try {
      const data = await api.me();
      setMe(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const onPurchased = useCallback(async () => {
    setBuyOpen(false);
    await reload();
  }, [reload]);

  const onBalanceChanged = useCallback((balance: number) => {
    setMe((m) => (m ? { ...m, user: { ...m.user, balance } } : m));
  }, []);

  const claimDaily = async () => {
    try {
      const d = await api.dailyBonus();
      setMe((m) => (m ? { ...m, user: { ...m.user, balance: d.balance, dailyBonusReady: !d.granted } } : m));
      if (d.granted) setError(null);
    } catch (e: any) {
      setError(e.message || "Ошибка");
    }
  };

  if (loading) {
    return (
      <div className="app" style={{ textAlign: "center", paddingTop: 80 }}>
        <div className="wheel" style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="app" style={{ textAlign: "center", paddingTop: 60 }}>
        <p>Ошибка авторизации. Открой приложение через Telegram.</p>
        {error && <div className="error-banner">{error}</div>}
      </div>
    );
  }

  return (
    <div className="app">
      <section className="balance-card">
        <div className="balance-label">Твой баланс</div>
        <div className="balance-value">
          <span className="star">⭐</span>
          <span>{me.user.balance.toLocaleString("ru-RU")}</span>
        </div>
        {user?.username && (
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
            @{user.username}
          </div>
        )}
      </section>

      <section className="actions">
        <button className="btn" onClick={() => setBuyOpen(true)}>
          💎 Купить звёзды
        </button>
        <button
          className={`btn ${me.user.dailyBonusReady ? "" : "btn--ghost"}`}
          onClick={claimDaily}
          disabled={!me.user.dailyBonusReady}
        >
          {me.user.dailyBonusReady ? `🎁 Бонус +${DAILY_BONUS_DISPLAY}` : "✅ Бонус получен"}
        </button>
        {me.user.isAdmin && (
          <button
            className="btn btn--r"
            onClick={() => {
              api.adminCredit(100).then((d) => {
                setMe((m) => (m ? { ...m, user: { ...m.user, balance: d.balance } } : m));
              });
            }}
            title="Магическая кнопка админа"
          >
            🪄 +100
          </button>
        )}
      </section>

      <GamePicker game={game} onSelect={setGame} />

      <GameBoard balance={me.user.balance} game={game} onBalanceChanged={onBalanceChanged} />

      <InviteCard refCode={me.user.refCode} referralCount={me.user.referralCount} bonusPerInvite={10} />

      <History transactions={me.transactions} />

      {error && <div className="error-banner">{error}</div>}

      {buyOpen && <BuyModal onClose={() => setBuyOpen(false)} onPurchased={onPurchased} />}
    </div>
  );
}