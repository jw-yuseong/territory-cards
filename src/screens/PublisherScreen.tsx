import { useEffect, useMemo, useState } from "react";
import { fetchCardProgress } from "../api";
import { getCardSummaries } from "../lists";
import type { CardProgress, CardSummary } from "../types";
import { displayNo, roundVisited } from "../types";
import CardDetail from "./CardDetail";

export default function PublisherScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, CardProgress>>(new Map());
  const [currentRound, setCurrentRound] = useState(1);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 뒤로가기(아이폰 쓸어넘기기 포함)를 누르면 카드 상세에서 목록으로 돌아감
  useEffect(() => {
    function onPop() {
      setSelected(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openCard(c: CardSummary) {
    setSelected(c);
    // 방문 기록에 한 단계를 쌓아서, 뒤로가기가 앱 이탈이 아니라 목록 복귀가 되게 함
    window.history.pushState({ cardOpen: true }, "");
  }

  function closeCard() {
    // '← 카드 목록으로' 버튼도 뒤로가기와 동일하게 처리 (쌓아둔 기록 정리)
    if (window.history.state && window.history.state.cardOpen) {
      window.history.back();
    } else {
      setSelected(null);
    }
  }

  useEffect(() => {
    Promise.all([getCardSummaries(), fetchCardProgress()])
      .then(([cs, pr]) => {
        setCards(cs);
        setProgressMap(new Map(pr.map((p) => [p.card_id, p])));
        // 현재 회차 = 아직 기록이 하나도 없는 카드가 남아있는 가장 낮은 회차
        let r = 1;
        for (; r < 4; r++) {
          if (pr.some((p) => p.total_units > 0 && roundVisited(p, r) === 0)) break;
        }
        setCurrentRound(r);
      })
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
    // key로 카드가 바뀔 때마다 화면을 완전히 새로 그림 (이전 입력값이 남지 않도록)
    return <CardDetail key={selected.id} card={selected} onBack={closeCard} />;
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
        {filtered.length}개 카드 · 지금은 {currentRound}회차
      </div>
      {filtered.slice(0, 100).map((c) => {
        const pg = progressMap.get(c.id);
        // 회차별 완료 = 그 회차에 인도자·전도인 이름과 함께 기록된 방문이 있음
        // (이름 없이는 체크가 저장되지 않으므로 기록 존재 = 이름도 기록됨)
        const doneRounds = pg
          ? [1, 2, 3, 4].filter((r) => roundVisited(pg, r) > 0)
          : [];
        return (
          <button key={c.id} className="card-item" onClick={() => openCard(c)}>
            <span className="card-no">{displayNo(c)}</span>
            <span className="name">{c.name}</span>
            {doneRounds.length > 0 ? (
              <span className="done-badge">{doneRounds.join("·")}회 방문완료</span>
            ) : (
              <span className="units">{c.total_units}집</span>
            )}
          </button>
        );
      })}
      {filtered.length > 100 && (
        <div className="muted">100개까지만 표시됩니다. 검색으로 좁혀 주세요.</div>
      )}
    </div>
  );
}
