import { useEffect, useMemo, useState } from "react";
import { assignCard, fetchCardProgress, unassignCard, fetchIncompleteNotes } from "../api";
import { getConductors, getPublishers } from "../lists";
import type { CardProgress, Conductor, Publisher, CardIncompleteNote } from "../types";
import {
  displayNo,
  isCommercialCard,
  isCardRoundDone,
  getCardActiveRound,
  roundFirstDate,
  roundPublisher,
  roundVisited,
} from "../types";
import { friendlyError } from "../errors";
import { matchName } from "../chosung";
import LetterMinistry from "./LetterMinistry";

type AssignTarget = { card: CardProgress; round: number };

/** '2026-04-11' -> '26. 4. 11' */
function fmtDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y.slice(2)}. ${Number(m)}. ${Number(day)}`;
}

function rateClass(pct: number): string {
  if (pct <= 0) return "rate-0";
  if (pct < 30) return "rate-low";
  if (pct < 60) return "rate-mid";
  return "rate-high";
}

export default function ConductorScreen({ isAdmin = false }: { isAdmin?: boolean }) {
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [conductors, setConductors] = useState<Conductor[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [incompleteNotes, setIncompleteNotes] = useState<Map<string, CardIncompleteNote>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"recommend" | "all" | "letter">("recommend");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const [tableRound, setTableRound] = useState<number | null>(null);
  const [showAllRemain, setShowAllRemain] = useState(false);
  const [showAllTable, setShowAllTable] = useState(false);

  async function load() {
    try {
      const [pr, cs, ps, inc] = await Promise.all([
        fetchCardProgress(),
        getConductors(),
        getPublishers(),
        fetchIncompleteNotes(),
      ]);
      setProgress(pr);
      setConductors(cs);
      setPublishers(ps);
      const incMap = new Map<string, CardIncompleteNote>();
      for (const note of inc) {
        incMap.set(`${note.card_id}-${note.round_no}`, note);
        incMap.set(note.card_id, note);
      }
      setIncompleteNotes(incMap);
    } catch (e) {
      setError(friendlyError(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // 카드 그룹 분류: 상가 카드 / 1차 일반 카드 / 2차 일반 카드
  // "방문이 완료된 카드는 추천/미방문 목록에서 숨김" 정책 적용
  const {
    r1Cards,
    r2Cards,
    commercialCards,
    r1Recommended,
    r1Remaining,
    r2Recommended,
    r2Remaining,
    commRemaining,
  } = useMemo(() => {
    const comm: CardProgress[] = [];
    const r1: CardProgress[] = [];
    const r2: CardProgress[] = [];

    for (const p of progress) {
      if (p.total_units === 0) continue;
      if (isCommercialCard(p)) {
        comm.push(p);
        continue;
      }
      const ar = getCardActiveRound(p, incompleteNotes);
      if (ar === 1) {
        r1.push(p);
      } else {
        r2.push(p);
      }
    }

    function sortRec(list: CardProgress[], round: number) {
      const filtered = list.filter((p) => {
        const isInc = incompleteNotes.has(`${p.card_id}-${round}`);
        if (isInc) return true;
        // 완료된 카드는 추천에서 제외 (방문 안 하고 배정도 안 된 카드만 추천)
        return roundVisited(p, round) === 0 && !roundPublisher(p, round);
      });

      return filtered.sort((a, b) => {
        const incA = incompleteNotes.has(`${a.card_id}-${round}`);
        const incB = incompleteNotes.has(`${b.card_id}-${round}`);
        if (incA && !incB) return -1;
        if (!incA && incB) return 1;
        return 0; // 번호순 유지
      });
    }

    // 미방문 카드 목록에서도 방문완료 카드는 숨김
    const unvisitedR1 = r1.filter((p) => roundVisited(p, 1) === 0);
    const unvisitedR2 = r2.filter((p) => roundVisited(p, 2) === 0);
    const unvisitedComm = comm.filter((p) => roundVisited(p, 1) === 0 || incompleteNotes.has(`${p.card_id}-1`));

    return {
      r1Cards: r1,
      r2Cards: r2,
      commercialCards: comm,
      r1Recommended: sortRec(r1, 1),
      r1Remaining: unvisitedR1,
      r2Recommended: sortRec(r2, 2),
      r2Remaining: unvisitedR2,
      commRemaining: unvisitedComm,
    };
  }, [progress, incompleteNotes]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return progress;
    return progress.filter(
      (p) => (p.legacy_number !== null && String(p.legacy_number).includes(q)) || p.name.includes(q)
    );
  }, [progress, query]);

  // 추천 카드 화면용 간단한 한 줄 카드 (누르면 해당 회차 배정창 열림)
  function simpleCardRow(p: CardProgress, targetRound: number, isCommercial = false) {
    const pub = roundPublisher(p, targetRound);
    const incNote = incompleteNotes.get(`${p.card_id}-${targetRound}`);
    const isDone = isCardRoundDone(p, targetRound, incNote);

    return (
      <button
        key={`${p.card_id}-${targetRound}`}
        className="card-item"
        onClick={() => setTarget({ card: p, round: targetRound })}
      >
        <span className="card-no">{displayNo(p)}</span>
        <span className="name">
          {p.name}
          {pub && <div className="unit-meta">배정: {pub}</div>}
          {incNote && (
            <div className="unit-meta" style={{ color: "#e65100", fontWeight: "bold" }}>
              🚨 미완료: {incNote.note}
            </div>
          )}
        </span>
        {isDone ? (
          <span className="done-badge">
            {isCommercial ? "상가 · 1회 완료" : "1회 방문완료"}
          </span>
        ) : isCommercial ? (
          <span className="caution-badge soft" style={{ background: "#475569" }}>
            상가 · {p.total_units}집
          </span>
        ) : targetRound >= 2 ? (
          <span className="round-badge-2">{targetRound}차 배정</span>
        ) : (
          <span className="units">{p.total_units}집</span>
        )}
      </button>
    );
  }

  async function doUnassign(p: CardProgress, r: number) {
    if (!window.confirm(`${displayNo(p)}번 카드(${p.name}) ${r}회차 배정을 회수할까요?`)) return;
    try {
      await unassignCard(p.card_id, r);
      patchProgress(p.card_id, r, null);
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  function patchProgress(cardId: string, round: number, publisherName: string | null) {
    setProgress((ps) =>
      ps.map((p) => {
        if (p.card_id !== cardId) return p;
        const key = `r${round}_publisher` as keyof CardProgress;
        return { ...p, [key]: publisherName };
      })
    );
  }

  if (loading) return <div className="loading">진행 현황을 불러오는 중...</div>;

  return (
    <div>
      {error && <div className="error-msg">{error}</div>}

      <div className="round-tabs">
        <button
          className={view === "recommend" ? "active" : ""}
          onClick={() => setView("recommend")}
        >
          추천 카드
        </button>
        <button className={view === "all" ? "active" : ""} onClick={() => setView("all")}>
          전체 현황
        </button>
        <button className={view === "letter" ? "active" : ""} onClick={() => setView("letter")}>
          📮 편지봉사
        </button>
      </div>

      {view === "letter" && <LetterMinistry publishers={publishers} isAdmin={isAdmin} />}

      {view === "recommend" && (
        <div>
          <div className="notice">
            {r1Remaining.length > 0 && r2Remaining.length > 0
              ? "지금은 1회차 마무리 및 2회차 순환 진행 중입니다. 카드를 누르면 배정할 수 있습니다."
              : r1Remaining.length === 0
                ? "지금은 2회차 진행 중입니다. 1번 카드부터 순서대로 배정해 주세요."
                : "지금은 1회차 진행 중입니다. 번호가 낮은 카드부터 순서대로 배정해 주세요."}
          </div>

          {/* 1) 1차 진행 구역 (아직 1차 미완료 카드) */}
          {r1Remaining.length > 0 && (
            <div>
              <div className="section-title">1회차 추천 카드 (번호 낮은 순)</div>
              {r1Recommended.length === 0 && (
                <div className="muted">1회차에 새로 배정할 수 있는 카드가 없습니다.</div>
              )}
              {r1Recommended.slice(0, 10).map((p) => simpleCardRow(p, 1))}

              <div className="section-title">
                1회차에 아직 방문 안 한 카드 ({r1Remaining.length}개)
              </div>
              {(showAllRemain ? r1Remaining : r1Remaining.slice(0, 50)).map((p) => simpleCardRow(p, 1))}
            </div>
          )}

          {/* 2) 2차 순환 구역: 455번 아래에 1번부터 시작 */}
          {r2Remaining.length > 0 && (
            <div style={{ marginTop: r1Remaining.length > 0 ? 20 : 0 }}>
              {/* 455번까지 1차가 완료되어 2차만 남은 경우에는 구분선 자동 생략! */}
              {r1Remaining.length > 0 && (
                <div className="round-divider">
                  🔄 2차 배정 구역 (1차 완료된 카드 · 1번부터)
                </div>
              )}

              <div className="section-title">2회차 추천 카드 (1번부터 순환)</div>
              {r2Recommended.length === 0 && (
                <div className="muted">2회차에 새로 배정할 수 있는 카드가 없습니다.</div>
              )}
              {r2Recommended.slice(0, 10).map((p) => simpleCardRow(p, 2))}

              <div className="section-title">
                2회차에 아직 방문 안 한 카드 ({r2Remaining.length}개)
              </div>
              {(showAllRemain ? r2Remaining : r2Remaining.slice(0, 50)).map((p) => simpleCardRow(p, 2))}
            </div>
          )}

          {/* 3) 501~519번 상가 구역카드 (방문완료된 카드는 숨기고 미방문 카드만 표시) */}
          <div style={{ marginTop: 24 }}>
            <div className="commercial-divider">
              <span>🏬 상가 구역 (501번~519번)</span>
              <span className="count-badge">{commRemaining.length}개 남음</span>
            </div>
            {commRemaining.length === 0 ? (
              <div className="muted" style={{ padding: "8px 0" }}>
                상가 구역의 모든 카드가 배정/방문 완료되었습니다. (전체 현황 탭에서 확인 가능)
              </div>
            ) : (
              commRemaining.map((p) => simpleCardRow(p, 1, true))
            )}
          </div>

          {!showAllRemain && (r1Remaining.length > 50 || r2Remaining.length > 50) && (
            <button
              className="btn-line"
              style={{ width: "100%", marginTop: 14 }}
              onClick={() => setShowAllRemain(true)}
            >
              미방문 카드 전체보기
            </button>
          )}
        </div>
      )}

      {view === "all" && (() => {
        const r = tableRound ?? (r1Remaining.length === 0 ? 2 : 1);
        const rows = filtered;
        const regularRows = rows.filter((p) => !isCommercialCard(p));
        const commRows = rows.filter((p) => isCommercialCard(p));

        const withUnits = rows.filter((p) => p.total_units > 0);
        const avg =
          withUnits.length > 0
            ? withUnits.reduce(
                (s, p) => s + (100 * roundVisited(p, r)) / p.total_units,
                0
              ) / withUnits.length
            : 0;
        const doneCount = withUnits.filter((p) => roundVisited(p, r) > 0).length;

        function renderTableRow(p: CardProgress) {
          const visited = roundVisited(p, r);
          const pct = p.total_units > 0 ? (100 * visited) / p.total_units : 0;
          const incNote = incompleteNotes.get(`${p.card_id}-${r}`);
          const isDone = isCardRoundDone(p, r, incNote);

          return (
            <tr key={p.card_id} onClick={() => setTarget({ card: p, round: r })}>
              <td style={{ fontWeight: 700, color: "var(--c-primary)" }}>
                {displayNo(p)}
              </td>
              <td className="tname">
                {p.name}
                {incNote && <div style={{ fontSize: 11, color: "#e65100" }}>🚨미완료</div>}
                {isDone && !incNote && (
                  <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 700, marginLeft: 4 }}>
                    ✓1회완료
                  </span>
                )}
              </td>
              <td>{p.total_units}</td>
              <td>{fmtDate(roundFirstDate(p, r))}</td>
              <td>{roundPublisher(p, r) ?? ""}</td>
              <td className={isDone ? "rate-high" : rateClass(pct)}>
                {isDone ? "완료" : `${pct.toFixed(1)}%`}
              </td>
            </tr>
          );
        }

        return (
          <div>
            <div className="round-tabs">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={r === n ? "active" : ""}
                  onClick={() => setTableRound(n)}
                >
                  {n}회
                </button>
              ))}
            </div>
            <div className="field">
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShowAllTable(false);
                }}
                placeholder="카드 번호 또는 구역 이름 검색"
              />
            </div>
            <div className="muted" style={{ marginBottom: 8 }}>
              {r}회차 · 방문완료 {doneCount}/{withUnits.length}개 · 평균 방문율{" "}
              <b>{avg.toFixed(2)}%</b> · 행을 누르면 배정할 수 있습니다
            </div>
            <table className="prog-table">
              <thead>
                <tr>
                  <th>№</th>
                  <th>구역명</th>
                  <th>가구</th>
                  <th>호별일자</th>
                  <th>전도인</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {/* 1) 일반 구역카드 */}
                {(showAllTable ? regularRows : regularRows.slice(0, 50)).map(renderTableRow)}

                {/* 2) 상가 구역 분리 헤더 및 행 (방문완료 여부 명확히 표시) */}
                {commRows.length > 0 && (
                  <>
                    <tr>
                      <td
                        colSpan={6}
                        style={{
                          background: "#f1f5f9",
                          fontWeight: 700,
                          textAlign: "center",
                          color: "#334155",
                          padding: "8px 0",
                        }}
                      >
                        🏬 상가 구역 (501번~519번)
                      </td>
                    </tr>
                    {commRows.map(renderTableRow)}
                  </>
                )}
              </tbody>
            </table>
            {!showAllTable && regularRows.length > 50 && (
              <button
                className="btn-line"
                style={{ width: "100%", marginTop: 8 }}
                onClick={() => setShowAllTable(true)}
              >
                전체보기 (나머지 {regularRows.length - 50}개)
              </button>
            )}
          </div>
        );
      })()}

      {target && (
        <AssignModal
          target={target}
          existingPublisher={roundPublisher(target.card, target.round)}
          conductors={conductors}
          publishers={publishers}
          onClose={() => setTarget(null)}
          onDone={(publisherName) => {
            patchProgress(target.card.card_id, target.round, publisherName);
            setTarget(null);
          }}
          onUnassign={() => {
            const t = target;
            setTarget(null);
            doUnassign(t.card, t.round);
          }}
        />
      )}
    </div>
  );
}

function AssignModal({
  target,
  existingPublisher,
  conductors,
  publishers,
  onClose,
  onDone,
  onUnassign,
}: {
  target: AssignTarget;
  existingPublisher: string | null;
  conductors: Conductor[];
  publishers: Publisher[];
  onClose: () => void;
  onDone: (publisherName: string) => void;
  onUnassign: () => void;
}) {
  const [selectedConductor, setSelectedConductor] = useState<string>("");
  const [selectedPublisher, setSelectedPublisher] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchPub, setSearchPub] = useState("");

  const filteredPublishers = useMemo(() => {
    const q = searchPub.trim();
    if (!q) return publishers;
    return publishers.filter((p) => matchName(p.name, q));
  }, [publishers, searchPub]);

  async function handleAssign() {
    if (!selectedConductor || !selectedPublisher) return;
    setBusy(true);
    setError("");
    try {
      await assignCard(
        target.card.card_id,
        target.round,
        selectedPublisher,
        selectedConductor
      );
      const pub = publishers.find((p) => p.id === selectedPublisher);
      onDone(pub?.name ?? "");
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {displayNo(target.card)}번 {target.card.name} — {target.round}회차 배정
        </h3>

        {error && <div className="error-msg">{error}</div>}

        <div className="field">
          <label>봉사인도자 선택 (필수)</label>
          <div className="choice-grid">
            {conductors.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`choice-btn ${selectedConductor === c.id ? "selected" : ""}`}
                onClick={() => setSelectedConductor(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>전도인 검색 및 선택 (필수)</label>
          <input
            type="text"
            value={searchPub}
            onChange={(e) => setSearchPub(e.target.value)}
            placeholder="이름 또는 초성 (예: ㄱㄱㅁ)"
            style={{ marginBottom: 6 }}
          />
          <div className="choice-grid" style={{ maxHeight: 180, overflowY: "auto" }}>
            {filteredPublishers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`choice-btn ${selectedPublisher === p.id ? "selected" : ""}`}
                onClick={() => setSelectedPublisher(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn-primary"
          disabled={busy || !selectedConductor || !selectedPublisher}
          onClick={handleAssign}
        >
          {busy ? "배정 중..." : "배정 완료"}
        </button>

        {existingPublisher && (
          <button
            type="button"
            className="btn-danger"
            style={{ width: "100%", marginTop: 8 }}
            disabled={busy}
            onClick={onUnassign}
          >
            배정 취소 (회수)
          </button>
        )}

        <button
          type="button"
          className="choice-btn"
          style={{ marginTop: 8 }}
          onClick={onClose}
        >
          닫기
        </button>
      </div>
    </div>
  );
}
