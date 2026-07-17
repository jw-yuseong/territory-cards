import { useEffect, useMemo, useState } from "react";
import { assignCard, fetchCardProgress, unassignCard } from "../api";
import { getConductors, getPublishers } from "../lists";
import type { CardProgress, Conductor, Publisher } from "../types";
import { roundPublisher, roundVisited } from "../types";

type AssignTarget = { card: CardProgress; round: number };

export default function ConductorScreen() {
  const [progress, setProgress] = useState<CardProgress[]>([]);
  const [conductors, setConductors] = useState<Conductor[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"recommend" | "all">("recommend");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [target, setTarget] = useState<AssignTarget | null>(null);

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

  // 현재 회차: 모든 카드가 아직 끝나지 않은 가장 낮은 회차
  const currentRound = useMemo(() => {
    for (let r = 1; r <= 4; r++) {
      const incomplete = progress.some(
        (p) => p.total_units > 0 && roundVisited(p, r) < p.total_units
      );
      if (incomplete) return r;
    }
    return 4;
  }, [progress]);

  // 추천: 현재 회차에서 아직 시작도 안 했고 배정도 안 된, 번호가 가장 낮은 카드들
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

  // 현재 회차에서 아직 완료되지 않은 모든 카드 (순서대로)
  const remaining = useMemo(
    () =>
      progress.filter(
        (p) => p.total_units > 0 && roundVisited(p, currentRound) < p.total_units
      ),
    [progress, currentRound]
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return progress;
    return progress.filter(
      (p) => String(p.card_number).includes(q) || p.name.includes(q)
    );
  }, [progress, query]);

  function roundChip(p: CardProgress, r: number) {
    const visited = roundVisited(p, r);
    const pub = roundPublisher(p, r);
    const done = p.total_units > 0 && visited >= p.total_units;
    const cls = done ? "done" : visited > 0 || pub ? "doing" : "";
    return (
      <span key={r} className={`round-chip ${cls}`}>
        {r}회 {visited}/{p.total_units}
        {pub ? ` · ${pub}` : ""}
      </span>
    );
  }

  function cardRow(p: CardProgress, showAssignFor?: number) {
    const isOpen = expanded === p.card_id;
    return (
      <div key={p.card_id} className="card-box" style={{ padding: 10 }}>
        <button
          className="unit-main"
          style={{ width: "100%" }}
          onClick={() => setExpanded(isOpen ? null : p.card_id)}
        >
          <span className="card-no">{p.card_number}</span>
          <span style={{ flex: 1, fontWeight: 600, textAlign: "left" }}>
            {p.name}
            <div className="unit-meta">{p.total_units}집</div>
          </span>
          <span className="muted">{isOpen ? "▲" : "▼"}</span>
        </button>

        {!isOpen && <div className="progress-rounds">{[1, 2, 3, 4].map((r) => roundChip(p, r))}</div>}

        {isOpen && (
          <div>
            {[1, 2, 3, 4].map((r) => {
              const visited = roundVisited(p, r);
              const pub = roundPublisher(p, r);
              return (
                <div key={r} className="row" style={{ marginTop: 8 }}>
                  <span style={{ flex: 1 }}>
                    {roundChip(p, r)}
                  </span>
                  <button className="btn-line" onClick={() => setTarget({ card: p, round: r })}>
                    {pub ? "재배정" : "배정"}
                  </button>
                  {pub && (
                    <button
                      className="btn-line"
                      style={{ color: "var(--c-danger)", borderColor: "var(--c-danger)" }}
                      onClick={() => doUnassign(p, r)}
                    >
                      회수
                    </button>
                  )}
                  {visited > 0 && <span className="muted"> </span>}
                </div>
              );
            })}
          </div>
        )}

        {showAssignFor !== undefined && !isOpen && (
          <button
            className="btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => setTarget({ card: p, round: showAssignFor })}
          >
            {showAssignFor}회차 배정하기
          </button>
        )}
      </div>
    );
  }

  async function doUnassign(p: CardProgress, r: number) {
    if (!window.confirm(`${p.card_number}번 카드 ${r}회차 배정을 회수할까요?`)) return;
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
            순서대로 배정해 주세요.
          </div>

          <div className="section-title">추천 카드 (번호 낮은 순)</div>
          {recommended.length === 0 && (
            <div className="muted">배정할 수 있는 새 카드가 없습니다.</div>
          )}
          {recommended.slice(0, 10).map((p) => cardRow(p, currentRound))}

          <div className="section-title">
            {currentRound}회차 미완료 카드 전체 ({remaining.length}개)
          </div>
          {remaining.slice(0, 100).map((p) => cardRow(p))}
          {remaining.length > 100 && (
            <div className="muted">100개까지만 표시됩니다.</div>
          )}
        </div>
      )}

      {view === "all" && (
        <div>
          <div className="field">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="카드 번호 또는 구역 이름 검색"
            />
          </div>
          {filtered.slice(0, 100).map((p) => cardRow(p))}
          {filtered.length > 100 && (
            <div className="muted">100개까지만 표시됩니다. 검색으로 좁혀 주세요.</div>
          )}
        </div>
      )}

      {target && (
        <AssignModal
          target={target}
          conductors={conductors}
          publishers={publishers}
          onClose={() => setTarget(null)}
          onDone={(publisherName) => {
            patchProgress(target.card.card_id, target.round, publisherName);
            setTarget(null);
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function AssignModal({
  target,
  conductors,
  publishers,
  onClose,
  onDone,
  onError,
}: {
  target: AssignTarget;
  conductors: Conductor[];
  publishers: Publisher[];
  onClose: () => void;
  onDone: (publisherName: string) => void;
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
          {target.card.card_number}번 {target.card.name} — {target.round}회차 배정
        </h3>
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
          {busy ? "배정 중..." : "배정하기"}
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}
