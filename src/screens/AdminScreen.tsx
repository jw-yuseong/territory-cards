import { useEffect, useMemo, useState } from "react";
import { resetCard } from "../api";
import { getCardSummaries } from "../lists";
import type { CardSummary } from "../types";

export default function AdminScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    getCardSummaries()
      .then(setCards)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return cards;
    return cards.filter(
      (c) => String(c.card_number).includes(q) || c.name.includes(q)
    );
  }, [cards, query]);

  async function doReset(card: CardSummary) {
    setMessage("");
    setError("");
    if (
      !window.confirm(
        `${card.card_number}번 ${card.name} 카드를 초기화할까요?\n1~4회차 방문 기록과 배정이 모두 지워집니다.`
      )
    )
      return;
    if (!window.confirm("정말 초기화합니까? 되돌릴 수 없습니다.")) return;
    setBusyId(card.id);
    try {
      await resetCard(card.id);
      setMessage(`${card.card_number}번 ${card.name} 카드가 초기화되었습니다.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("admin")
          ? "관리자 권한이 없습니다. 관리자 계정으로 로그인했는지 확인해 주세요."
          : msg
      );
    }
    setBusyId(null);
  }

  return (
    <div>
      <div className="notice">
        초기화하면 해당 카드의 1~4회차 방문 체크와 배정 기록이 모두 지워집니다.
        집 주소와 주의사항은 그대로 유지됩니다.
      </div>
      <div className="field">
        <label>카드 검색</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="카드 번호 또는 구역 이름"
        />
      </div>
      {message && <div className="notice">{message}</div>}
      {error && <div className="error-msg">{error}</div>}
      {filtered.slice(0, 50).map((c) => (
        <div key={c.id} className="card-item">
          <span className="card-no">{c.card_number}</span>
          <span className="name">{c.name}</span>
          <button
            className="btn-danger"
            disabled={busyId === c.id}
            onClick={() => doReset(c)}
          >
            {busyId === c.id ? "초기화 중..." : "초기화"}
          </button>
        </div>
      ))}
      {filtered.length > 50 && (
        <div className="muted">50개까지만 표시됩니다. 검색으로 좁혀 주세요.</div>
      )}
    </div>
  );
}
