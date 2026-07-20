import { useEffect, useMemo, useState } from "react";
import { fetchMemoUnits, resetAllCards, resetCard, setUnitNote } from "../api";
import type { MemoUnit } from "../api";
import { getCardSummaries } from "../lists";
import type { CardSummary } from "../types";
import { displayNo } from "../types";
import UnitEditor from "./UnitEditor";

export default function AdminScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [memos, setMemos] = useState<MemoUnit[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editCard, setEditCard] = useState<CardSummary | null>(null);
  const [resettingAll, setResettingAll] = useState(false);

  async function doResetAll() {
    setMessage("");
    setError("");
    if (
      !window.confirm(
        "모든 카드를 초기화할까요?\n전체 카드의 1~4회차 방문 기록과 배정이 모두 지워집니다."
      )
    )
      return;
    if (
      !window.confirm(
        "⚠ 정말로 전체를 초기화합니까?\n되돌릴 수 없습니다. 한 번 더 확인해 주세요."
      )
    )
      return;
    setResettingAll(true);
    try {
      await resetAllCards();
      setMessage("모든 카드가 초기화되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setResettingAll(false);
  }

  async function loadCards() {
    try {
      const [cs, ms] = await Promise.all([getCardSummaries(), fetchMemoUnits()]);
      setCards(cs);
      setMemos(ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadCards();
  }, []);

  async function resolveMemo(m: MemoUnit) {
    if (
      !window.confirm(
        `${m.territory_cards.legacy_number ?? "?"}번 카드 ${m.seq_no}번 집의 메모를 삭제(반영 완료)할까요?\n"${m.note}"`
      )
    )
      return;
    try {
      await setUnitNote(m.id, null);
      setMemos((ms) => ms.filter((x) => x.id !== m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 뒤로가기(쓸어넘기기)로 편집 화면에서 카드 목록으로 복귀
  useEffect(() => {
    function onPop() {
      setEditCard(null);
      loadCards(); // 편집으로 집수가 바뀌었을 수 있으므로 다시 읽음
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openEditor(c: CardSummary) {
    setEditCard(c);
    window.history.pushState({ editorOpen: true }, "");
  }

  function closeEditor() {
    if (window.history.state && window.history.state.editorOpen) {
      window.history.back();
    } else {
      setEditCard(null);
      loadCards();
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return cards;
    return cards.filter(
      (c) => (c.legacy_number !== null && String(c.legacy_number).includes(q)) || c.name.includes(q)
    );
  }, [cards, query]);

  async function doReset(card: CardSummary) {
    setMessage("");
    setError("");
    if (
      !window.confirm(
        `${displayNo(card)}번 ${card.name} 카드를 초기화할까요?\n1~4회차 방문 기록과 배정이 모두 지워집니다.`
      )
    )
      return;
    if (!window.confirm("정말 초기화합니까? 되돌릴 수 없습니다.")) return;
    setBusyId(card.id);
    try {
      await resetCard(card.id);
      setMessage(`${displayNo(card)}번 ${card.name} 카드가 초기화되었습니다.`);
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

  if (editCard) {
    return <UnitEditor card={editCard} onBack={closeEditor} />;
  }

  return (
    <div>
      <div className="notice">
        <b>편집</b>: 집 주소 수정, 삭제, 사이에 추가 / <b>초기화</b>: 1~4회차
        방문 기록과 배정 삭제 (집 주소·주의사항은 유지)
      </div>

      <button
        className="btn-danger"
        style={{ width: "100%", marginBottom: 14 }}
        disabled={resettingAll}
        onClick={doResetAll}
      >
        {resettingAll ? "전체 초기화 중..." : "🗑 카드 모두 초기화 (전체)"}
      </button>

      {memos.length > 0 && (
        <>
          <div className="section-title">📝 봉사자 메모 ({memos.length}건)</div>
          {memos.map((m) => {
            const cardSummary = cards.find((c) => c.id === m.card_id);
            return (
              <div key={m.id} className="card-box" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {m.territory_cards.legacy_number ?? "?"}번 {m.territory_cards.name} —{" "}
                  {m.seq_no}. {m.address_unit}
                </div>
                <div style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>📝 {m.note}</div>
                <div className="row">
                  {cardSummary && (
                    <button className="btn-line" style={{ flex: 1 }} onClick={() => openEditor(cardSummary)}>
                      카드 편집
                    </button>
                  )}
                  <button
                    className="btn-line"
                    style={{ flex: 1, color: "var(--c-ok)", borderColor: "var(--c-ok)" }}
                    onClick={() => resolveMemo(m)}
                  >
                    반영 완료 (메모 삭제)
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
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
      {filtered.map((c) => (
        <div key={c.id} className="card-item">
          <span className="card-no">{displayNo(c)}</span>
          <span className="name">{c.name}</span>
          <button className="btn-line" onClick={() => openEditor(c)}>
            편집
          </button>
          <button
            className="btn-danger"
            disabled={busyId === c.id}
            onClick={() => doReset(c)}
          >
            {busyId === c.id ? "..." : "초기화"}
          </button>
        </div>
      ))}
    </div>
  );
}
