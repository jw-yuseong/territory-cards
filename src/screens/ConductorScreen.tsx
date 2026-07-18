import { useEffect, useMemo, useState } from "react";
import { assignCard, fetchCardProgress, unassignCard } from "../api";
import { getConductors, getPublishers } from "../lists";
import type { CardProgress, Conductor, Publisher } from "../types";
import { displayNo, roundFirstDate, roundPublisher, roundVisited } from "../types";

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

export default function ConductorScreen() {
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [conductors, setConductors] = useState<Conductor[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"recommend" | "all">("recommend");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const [tableRound, setTableRound] = useState<number | null>(null); // 전체 현황 표의 회차

  async function load() {
    try {
      const [pr, cs, ps] = await Promise.all([
        fetchCardProgress(),
        getConductors(),
        getPublishers(),
      ]);
      setProgress(pr);
      setConductors(cs);
      setPublishers(ps);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // 카드는 한 집이라도 방문 기록이 있으면 그 회차를 '방문완료'로 본다.
  // 현재 회차 = 기록이 하나도 없는 카드가 아직 남아있는 가장 낮은 회차
  const currentRound = useMemo(() => {
    for (let r = 1; r <= 4; r++) {
      const untouched = progress.some(
        (p) => p.total_units > 0 && roundVisited(p, r) === 0
      );
      if (untouched) return r;
    }
    return 4;
  }, [progress]);

  // 추천: 현재 회차에서 아직 방문 기록이 없고 배정도 안 된, 번호가 가장 낮은 카드들
  const recommended = useMemo(
    () =>
      progress.filter(
        (p) =>
          p.total_units > 0 &&
          roundVisited(p, currentRound) === 0 &&
          !roundPublisher(p, currentRound)
      ),
    [progress, currentRound]
  );

  // 현재 회차에서 아직 방문 기록이 없는 모든 카드 (순서대로)
  const remaining = useMemo(
    () =>
      progress.filter(
        (p) => p.total_units > 0 && roundVisited(p, currentRound) === 0
      ),
    [progress, currentRound]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return progress;
    return progress.filter(
      (p) => (p.legacy_number !== null && String(p.legacy_number).includes(q)) || p.name.includes(q)
    );
  }, [progress, query]);

  // 추천 카드 화면용 간단한 한 줄 카드 (누르면 현재 회차 배정창)
  function simpleCardRow(p: CardProgress) {
    const pub = roundPublisher(p, currentRound);
    return (
      <button
        key={p.card_id}
        className="card-item"
        onClick={() => setTarget({ card: p, round: currentRound })}
      >
        <span className="card-no">{displayNo(p)}</span>
        <span className="name">
          {p.name}
          {pub && <div className="unit-meta">배정: {pub}</div>}
        </span>
        <span className="units">{p.total_units}집</span>
      </button>
    );
  }

  async function doUnassign(p: CardProgress, r: number) {
    if (!window.confirm(`${displayNo(p)}번 카드(${p.name}) ${r}회차 배정을 회수할까요?`)) return;
    try {
      await unassignCard(p.card_id, r);
      patchProgress(p.card_id, r, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      </div>

      {view === "recommend" && (
        <div>
          <div className="notice">
            지금은 <b>{currentRound}회차</b> 진행 중입니다. 번호가 낮은 카드부터
            순서대로 배정해 주세요. 카드를 누르면 배정할 수 있습니다.
          </div>

          <div className="section-title">추천 카드 (번호 낮은 순)</div>
          {recommended.length === 0 && (
            <div className="muted">배정할 수 있는 새 카드가 없습니다.</div>
          )}
          {recommended.slice(0, 10).map((p) => simpleCardRow(p))}

          <div className="section-title">
            {currentRound}회차에 아직 방문 안 한 카드 ({remaining.length}개)
          </div>
          {remaining.slice(0, 100).map((p) => simpleCardRow(p))}
          {remaining.length > 100 && (
            <div className="muted">100개까지만 표시됩니다.</div>
          )}
        </div>
      )}

      {view === "all" && (() => {
        const r = tableRound ?? currentRound;
        const rows = filtered;
        const withUnits = rows.filter((p) => p.total_units > 0);
        const avg =
          withUnits.length > 0
            ? withUnits.reduce(
                (s, p) => s + (100 * roundVisited(p, r)) / p.total_units,
                0
              ) / withUnits.length
            : 0;
        const doneCount = withUnits.filter((p) => roundVisited(p, r) > 0).length;
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
                onChange={(e) => setQuery(e.target.value)}
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
                {rows.slice(0, 200).map((p) => {
                  const visited = roundVisited(p, r);
                  const pct =
                    p.total_units > 0 ? (100 * visited) / p.total_units : 0;
                  return (
                    <tr key={p.card_id} onClick={() => setTarget({ card: p, round: r })}>
                      <td style={{ fontWeight: 700, color: "var(--c-primary)" }}>
                        {displayNo(p)}
                      </td>
                      <td className="tname">{p.name}</td>
                      <td>{p.total_units}</td>
                      <td>{fmtDate(roundFirstDate(p, r))}</td>
                      <td>{roundPublisher(p, r) ?? ""}</td>
                      <td className={rateClass(pct)}>{pct.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 200 && (
              <div className="muted" style={{ marginTop: 8 }}>
                200개까지만 표시됩니다. 검색으로 좁혀 주세요.
              </div>
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
            setTarget(null);
            doUnassign(target.card, target.round);
          }}
          onError={setError}
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
  onError,
}: {
  target: AssignTarget;
  existingPublisher: string | null;
  conductors: Conductor[];
  publishers: Publisher[];
  onClose: () => void;
  onDone: (publisherName: string) => void;
  onUnassign: () => void;
  onError: (msg: string) => void;
}) {
  const [publisherId, setPublisherId] = useState("");
  const [conductorId, setConductorId] = useState(
    () => localStorage.getItem("lastAssignerId") ?? ""
  );
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!publisherId || !conductorId) return;
    setBusy(true);
    try {
      await assignCard({
        card_id: target.card.card_id,
        round_no: target.round,
        publisher_id: publisherId,
        assigned_by: conductorId,
      });
      localStorage.setItem("lastAssignerId", conductorId);
      onDone(publishers.find((p) => p.id === publisherId)?.name ?? "");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      onClose();
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {displayNo(target.card)}번 {target.card.name} — {target.round}회차 배정
        </h3>
        {existingPublisher && (
          <div className="notice">
            현재 <b>{existingPublisher}</b> 님에게 배정되어 있습니다. 다른 사람을
            선택하면 재배정됩니다.
          </div>
        )}
        <div className="field">
          <label>전도인 (카드를 받을 사람)</label>
          <select value={publisherId} onChange={(e) => setPublisherId(e.target.value)}>
            <option value="">— 선택 —</option>
            {publishers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>배정하는 인도자 (내 이름)</label>
          <select value={conductorId} onChange={(e) => setConductorId(e.target.value)}>
            <option value="">— 선택 —</option>
            {conductors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn-primary"
          disabled={busy || !publisherId || !conductorId}
          onClick={submit}
        >
          {busy ? "배정 중..." : existingPublisher ? "재배정하기" : "배정하기"}
        </button>
        {existingPublisher && (
          <button
            className="choice-btn danger"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={onUnassign}
          >
            배정 회수 (배정 취소)
          </button>
        )}
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}
