import { useEffect, useMemo, useState } from "react";
import {
  addVisit,
  fetchAssignments,
  fetchUnits,
  fetchVisits,
  removeVisit,
  setUnitCaution,
} from "../api";
import { getCautionTypes, getConductors, getPublishers } from "../lists";
import type {
  CardAssignment,
  CardSummary,
  CautionType,
  Conductor,
  Publisher,
  TerritoryUnit,
  VisitRecord,
} from "../types";

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function CardDetail({
  card,
  onBack,
}: {
  card: CardSummary;
  onBack: () => void;
}) {
  const [units, setUnits] = useState<TerritoryUnit[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [assignments, setAssignments] = useState<CardAssignment[]>([]);
  const [conductors, setConductors] = useState<Conductor[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [cautions, setCautions] = useState<CautionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 카드를 새로 열 때마다 인도자/전도인은 빈 값, 호별일자는 오늘 날짜로 시작
  const [round, setRound] = useState(1);
  const [conductorId, setConductorId] = useState("");
  const [publisherId, setPublisherId] = useState("");
  const [date, setDate] = useState(today());
  const [cautionUnit, setCautionUnit] = useState<TerritoryUnit | null>(null);
  const [busyUnit, setBusyUnit] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [u, v, a, cs, ps, ct] = await Promise.all([
          fetchUnits(card.id),
          fetchVisits(card.id),
          fetchAssignments(card.id),
          getConductors(),
          getPublishers(),
          getCautionTypes(),
        ]);
        if (!alive) return;
        setUnits(u);
        setVisits(v);
        setAssignments(a);
        setConductors(cs);
        setPublishers(ps);
        setCautions(ct);
        // 기본 회차 = 아직 다 돌지 않은 첫 회차
        const total = u.length;
        let r = 1;
        for (; r < 4; r++) {
          const done = v.filter((x) => x.round_no === r).length;
          if (done < total) break;
        }
        setRound(r);
        setLoading(false);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [card.id]);

  const visitByUnit = useMemo(() => {
    const m = new Map<string, VisitRecord>();
    for (const v of visits) if (v.round_no === round) m.set(v.unit_id, v);
    return m;
  }, [visits, round]);

  const cautionById = useMemo(() => {
    const m = new Map<number, CautionType>();
    for (const c of cautions) m.set(c.id, c);
    return m;
  }, [cautions]);

  const roundDone = (r: number) =>
    units.length > 0 && visits.filter((v) => v.round_no === r).length >= units.length;

  const assignment = assignments.find((a) => a.round_no === round);
  const assignedName = assignment
    ? publishers.find((p) => p.id === assignment.publisher_id)?.name
    : null;

  async function toggleUnit(unit: TerritoryUnit) {
    setError("");
    const existing = visitByUnit.get(unit.id);
    if (existing) {
      if (!window.confirm(`${unit.address_unit} 방문 체크를 취소할까요?`)) return;
      setBusyUnit(unit.id);
      try {
        await removeVisit(existing.id);
        setVisits((vs) => vs.filter((v) => v.id !== existing.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setBusyUnit(null);
      return;
    }
    if (!conductorId || !publisherId) {
      setError("먼저 위에서 인도자와 전도인 이름을 선택해 주세요.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusyUnit(unit.id);
    try {
      const created = await addVisit({
        unit_id: unit.id,
        round_no: round,
        conductor_id: conductorId,
        publisher_id: publisherId,
        visited_date: date,
      });
      setVisits((vs) => [...vs, created]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusyUnit(null);
  }

  async function changeCaution(cautionTypeId: number | null) {
    if (!cautionUnit) return;
    try {
      await setUnitCaution(cautionUnit.id, cautionTypeId);
      setUnits((us) =>
        us.map((u) =>
          u.id === cautionUnit.id ? { ...u, caution_type_id: cautionTypeId } : u
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCautionUnit(null);
  }

  if (loading) return <div className="loading">카드를 불러오는 중...</div>;

  const visitedCount = visitByUnit.size;

  return (
    <div>
      <button className="btn-line" onClick={onBack}>
        ← 카드 목록으로
      </button>

      <h2 className="section-title">
        {card.legacy_number !== null ? `${card.legacy_number}번 ` : ""}
        {card.name}
      </h2>
      {card.address_summary && <div className="muted">{card.address_summary}</div>}

      <div className="round-tabs">
        {[1, 2, 3, 4].map((r) => (
          <button
            key={r}
            className={`${round === r ? "active" : ""} ${roundDone(r) ? "done" : ""}`}
            onClick={() => setRound(r)}
          >
            {r}회{roundDone(r) ? " ✓" : ""}
          </button>
        ))}
      </div>

      <div className="card-box">
        {assignedName && (
          <div className="muted" style={{ marginBottom: 8 }}>
            이 카드 {round}회차 배정: <b>{assignedName}</b>
          </div>
        )}
        <div className="field">
          <label>봉사 인도자</label>
          <select
            value={conductorId}
            onChange={(e) => setConductorId(e.target.value)}
          >
            <option value="">— 선택 —</option>
            {conductors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>전도인 (내 이름)</label>
          <select
            value={publisherId}
            onChange={(e) => setPublisherId(e.target.value)}
          >
            <option value="">— 선택 —</option>
            {publishers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>호별일자</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {error && <div className="error-msg">{error}</div>}

      <div className="section-title">
        방문 체크 ({visitedCount}/{units.length})
      </div>
      <div className="muted" style={{ marginBottom: 8 }}>
        방문한 집을 누르면 체크됩니다. ⚠ 버튼으로 주의사항을 설정합니다.
      </div>

      {units.map((u) => {
        const visit = visitByUnit.get(u.id);
        const caution = u.caution_type_id ? cautionById.get(u.caution_type_id) : null;
        return (
          <div
            key={u.id}
            className={`unit-row ${visit ? "visited" : ""} ${
              caution?.is_do_not_call ? "dnc" : ""
            }`}
          >
            <button
              className="unit-main"
              disabled={busyUnit === u.id}
              onClick={() => toggleUnit(u)}
            >
              <span className="unit-check">{visit ? "✓" : ""}</span>
              <span>
                <span className="unit-addr">
                  {u.seq_no}. {u.address_unit}
                </span>
                {visit && (
                  <div className="unit-meta">
                    {visit.visited_date}{" "}
                    {publishers.find((p) => p.id === visit.publisher_id)?.name ?? ""}
                  </div>
                )}
              </span>
            </button>
            {caution && (
              <span className={`caution-badge ${caution.is_do_not_call ? "" : "soft"}`}>
                {caution.label}
              </span>
            )}
            <button className="unit-caution-btn" onClick={() => setCautionUnit(u)}>
              ⚠
            </button>
          </div>
        );
      })}

      {cautionUnit && (
        <div className="modal-back" onClick={() => setCautionUnit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {cautionUnit.seq_no}. {cautionUnit.address_unit} 주의사항
            </h3>
            {cautions.map((c) => (
              <button
                key={c.id}
                className={`choice-btn ${
                  cautionUnit.caution_type_id === c.id ? "selected" : ""
                } ${c.is_do_not_call ? "danger" : ""}`}
                onClick={() => changeCaution(c.id)}
              >
                {c.label}
                {c.is_do_not_call ? " (방문 주의)" : ""}
              </button>
            ))}
            <button className="choice-btn" onClick={() => changeCaution(null)}>
              주의사항 없음 (해제)
            </button>
            <button className="btn-primary" onClick={() => setCautionUnit(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
