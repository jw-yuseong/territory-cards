import { useEffect, useMemo, useState } from "react";
import { fetchCardProgress, fetchIncompleteNotes } from "../api";
import { getCardSummaries } from "../lists";
import type { CardProgress, CardSummary, CardIncompleteNote } from "../types";
import {
  displayNo,
  isCommercialCard,
  isCardRoundDone,
  getCardActiveRound,
  roundPublisher,
  roundVisited,
} from "../types";
import CardDetail from "./CardDetail";
import { friendlyError } from "../errors";
import { hapticTap } from "../haptics";

export default function PublisherScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, CardProgress>>(new Map());
  const [incompleteNotes, setIncompleteNotes] = useState<Map<string, CardIncompleteNote>>(new Map());
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
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
    hapticTap();
    setSelected(c);
    window.history.pushState({ cardOpen: true }, "");
  }

  function closeCard() {
    if (window.history.state && window.history.state.cardOpen) {
      window.history.back();
    } else {
      setSelected(null);
    }
  }

  useEffect(() => {
    Promise.all([getCardSummaries(), fetchCardProgress(), fetchIncompleteNotes()])
      .then(([cs, pr, inc]) => {
        setCards(cs);
        setProgressMap(new Map(pr.map((p) => [p.card_id, p])));

        const incMap = new Map<string, CardIncompleteNote>();
        for (const note of inc) {
          incMap.set(`${note.card_id}-${note.round_no}`, note);
          incMap.set(note.card_id, note);
        }
        setIncompleteNotes(incMap);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, []);

  const { round1Cards, round2Cards, commercialCards, searchCards } = useMemo(() => {
    const q = query.trim();
    if (q) {
      const searched = cards.filter(
        (c) => (c.legacy_number !== null && String(c.legacy_number).includes(q)) || c.name.includes(q)
      );
      return { round1Cards: [], round2Cards: [], commercialCards: [], searchCards: searched };
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const today = `${y}-${m}-${d}`;

    function isCardActive(c: CardSummary, targetRound: number): boolean {
      const incKey = `${c.id}-${targetRound}`;
      if (incompleteNotes.has(incKey)) return true;

      const pg = progressMap.get(c.id);
      if (!pg) return true;

      const pub = roundPublisher(pg, targetRound);
      const visitedCount = roundVisited(pg, targetRound);

      // 배정 안 된 카드는 방문 안 한(0집) 상태일 때만 표시 (추천 카드)
      if (!pub) return visitedCount === 0;

      // 배정된 카드의 경우: 방문 전이거나 오늘 방문한 기록이 있으면 표시
      if (visitedCount === 0) return true;
      return pg.last_visited_date === today;
    }

    function sortActiveCards(list: CardSummary[], targetRound: number) {
      return [...list].sort((a, b) => {
        const incA = incompleteNotes.has(`${a.id}-${targetRound}`);
        const incB = incompleteNotes.has(`${b.id}-${targetRound}`);
        if (incA && !incB) return -1;
        if (!incA && incB) return 1;

        const pgA = progressMap.get(a.id);
        const pgB = progressMap.get(b.id);
        const pubA = pgA ? roundPublisher(pgA, targetRound) : null;
        const pubB = pgB ? roundPublisher(pgB, targetRound) : null;
        if (pubA && !pubB) return -1;
        if (!pubA && pubB) return 1;
        return 0; // 나머지는 기본(byLegacy 번호순) 유지
      });
    }

    const comm: CardSummary[] = [];
    const r1Raw: CardSummary[] = [];
    const r2Raw: CardSummary[] = [];

    for (const c of cards) {
      if (isCommercialCard(c)) {
        comm.push(c);
        continue;
      }
      const pg = progressMap.get(c.id);
      const activeRound = pg ? getCardActiveRound(pg, incompleteNotes) : 1;
      if (activeRound === 1) {
        if (isCardActive(c, 1)) r1Raw.push(c);
      } else {
        if (isCardActive(c, activeRound)) r2Raw.push(c);
      }
    }

    return {
      round1Cards: sortActiveCards(r1Raw, 1),
      round2Cards: sortActiveCards(r2Raw, 2),
      commercialCards: comm,
      searchCards: null,
    };
  }, [cards, query, progressMap, incompleteNotes]);

  if (selected) {
    return <CardDetail key={selected.id} card={selected} onBack={closeCard} />;
  }

  if (loading) return <div className="loading">카드 목록을 불러오는 중...</div>;

  function renderCardItem(c: CardSummary, targetRound: number, isCommercial = false) {
    const pg = progressMap.get(c.id);
    const pub = pg ? roundPublisher(pg, targetRound) : null;
    const incNote = incompleteNotes.get(`${c.id}-${targetRound}`) ?? incompleteNotes.get(c.id);
    const visited = pg ? roundVisited(pg, targetRound) : 0;
    const isDone = pg ? isCardRoundDone(pg, targetRound, incNote) : false;

    return (
      <button key={`${c.id}-${targetRound}`} className="card-item" onClick={() => openCard(c)}>
        <span className="card-no">{displayNo(c)}</span>
        <span className="name">
          {c.name}
          {pub && <div className="unit-meta">배정: {pub}</div>}
          {incNote && (
            <div className="unit-meta" style={{ color: "#e65100", fontWeight: "bold" }}>
              🚨 미완료: {incNote.note}
            </div>
          )}
        </span>
        {isCommercial ? (
          <span className="caution-badge soft" style={{ background: "#475569" }}>
            상가 · {c.total_units}집
          </span>
        ) : targetRound >= 2 ? (
          <span className="round-badge-2">
            {targetRound}차 {visited > 0 && !isDone ? `(${visited}집)` : "대기"}
          </span>
        ) : isDone ? (
          <span className="done-badge">1회 방문완료</span>
        ) : (
          <span className="units">{c.total_units}집</span>
        )}
      </button>
    );
  }

  const totalRegularCount = round1Cards.length + round2Cards.length;

  return (
    <div>
      <div className="field">
        <label>구역카드 찾기</label>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowAll(false);
          }}
          placeholder="카드 번호 또는 구역 이름"
        />
      </div>
      {error && <div className="error-msg">{error}</div>}

      <div className="muted" style={{ marginBottom: 8 }}>
        {searchCards !== null
          ? `검색 결과 ${searchCards.length}개`
          : round1Cards.length > 0
            ? `1차 방문 카드 ${round1Cards.length}개 ${round2Cards.length > 0 ? `· 2차 대기 ${round2Cards.length}개` : ""}`
            : `2차 방문 구역 (${round2Cards.length}개 카드)`}
      </div>

      {/* 1) 검색 중일 때 */}
      {searchCards !== null && (
        <div>
          {searchCards.map((c) => {
            const isComm = isCommercialCard(c);
            const pg = progressMap.get(c.id);
            const ar = pg ? getCardActiveRound(pg, incompleteNotes) : 1;
            return renderCardItem(c, ar, isComm);
          })}
        </div>
      )}

      {/* 2) 평상시: 1차 진행 구역 -> (조건부 구분선) -> 2차 순환 구역 -> 상가 구역 */}
      {searchCards === null && (
        <div>
          {/* 1차 진행 카드 */}
          {(showAll ? round1Cards : round1Cards.slice(0, 50)).map((c) => renderCardItem(c, 1, false))}

          {/* 2차 순환 카드: 455번 아래에 1번부터 시작 */}
          {round2Cards.length > 0 && (
            <div>
              {/* 455번까지 1차가 완료되어 2차만 남은 경우에는 구분선 자동 생략! */}
              {round1Cards.length > 0 && (
                <div className="round-divider">
                  🔄 2차 방문 구역 (1차 완료된 카드 · 1번부터)
                </div>
              )}
              {(showAll ? round2Cards : round2Cards.slice(0, 50)).map((c) => renderCardItem(c, 2, false))}
            </div>
          )}

          {!showAll && totalRegularCount > 50 && (
            <button
              className="btn-line"
              style={{ width: "100%", margin: "10px 0" }}
              onClick={() => setShowAll(true)}
            >
              일반 구역 전체보기
            </button>
          )}

          {/* 3) 501~519번 상가 구역카드 (별도 하단 섹션) */}
          {commercialCards.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="commercial-divider">
                <span>🏬 상가 구역 (501번~519번)</span>
                <span className="count-badge">{commercialCards.length}개</span>
              </div>
              {commercialCards.map((c) => {
                const pg = progressMap.get(c.id);
                const ar = pg ? getCardActiveRound(pg, incompleteNotes) : 1;
                return renderCardItem(c, ar, true);
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
