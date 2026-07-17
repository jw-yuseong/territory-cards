import { useEffect, useMemo, useState } from "react";
import { getCardSummaries } from "../lists";
import type { CardSummary } from "../types";
import { displayNo } from "../types";
import CardDetail from "./CardDetail";

export default function PublisherScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getCardSummaries()
      .then(setCards)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return cards;
    return cards.filter(
      (c) => (c.legacy_number !== null && String(c.legacy_number).includes(q)) || c.name.includes(q)
    );
  }, [cards, query]);

  if (selected) {
    return <CardDetail card={selected} onBack={() => setSelected(null)} />;
  }

  if (loading) return <div className="loading">카드 목록을 불러오는 중...</div>;

  return (
    <div>
      <div className="field">
        <label>구역카드 찾기</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="카드 번호 또는 구역 이름"
        />
      </div>
      {error && <div className="error-msg">{error}</div>}
      <div className="muted" style={{ marginBottom: 8 }}>
        {filtered.length}개 카드
      </div>
      {filtered.slice(0, 100).map((c) => (
        <button key={c.id} className="card-item" onClick={() => setSelected(c)}>
          <span className="card-no">{displayNo(c)}</span>
          <span className="name">{c.name}</span>
          <span className="units">{c.total_units}집</span>
        </button>
      ))}
      {filtered.length > 100 && (
        <div className="muted">100개까지만 표시됩니다. 검색으로 좁혀 주세요.</div>
      )}
    </div>
  );
}
