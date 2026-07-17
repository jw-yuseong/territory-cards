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

  // 회차에 맞게 인도자/전도인 칸 채우기:
  // 그 회차에 기록이 있으면 마지막 기록의 이름으로, 없으면 빈 값으로 초기화
  function prefillForRound(r: number, vs: VisitRecord[]) {
    const roundVisits = vs.filter((x) => x.round_no === r);
    if (roundVisits.length > 0) {
      const latest = roundVisits.reduce((a, b) =>
        a.checked_at > b.checked_at ? a : b
      );
      setConductorId(latest.conductor_id);
      setPublisherId(latest.publisher_id);
    } else {
      setConductorId("");
      setPublisherId("");
    }
    setDate(today());
  }

  function changeRound(r: number) {
    setRound(r);
    prefillForRound(r, visits);
  }

  // 방문 기록/배정만 다시 불러오기 (다른 사람이 체크한 내용 반영)
  async function refreshRecords() {
    try {
      const [v, a] = await Promise.all([fetchVisits(card.id), fetchAssignments(card.id)]);
      setVisits(v);
      setAssignments(a);
    } catch {
      // 새로고침 실패는 조용히 무시 (기존 화면 유지)
    }
  }

  // 다른 앱/화면에 갔다가 돌아오면 자동으로 최신 기록을 불러옴
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") refreshRecords();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

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
        // 기본 회차 정하기:
        //  - 오늘 이미 이 카드에 기록했다면 그 회차 (봉사를 이어서 하는 경우)
        //  - 아니면 아직 방문 기록이 없는 첫 회차
        // 이름 칸은 선택된 회차의 기록 기준으로 채우거나 비움
        const todayStr = today();
        const todayVisits = v.filter((x) => x.visited_date === todayStr);
        let chosen: number;
        if (todayVisits.length > 0) {
          chosen = Math.max(...todayVisits.map((x) => x.round_no));
        } else {
          chosen = 1;
          for (; chosen < 4; chosen++) {
            if (!v.some((x) => x.round_no === chosen)) break;
          }
        }
        setRound(chosen);
        prefillForRound(chosen, v);
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

  // 한 집이라도 방문 기록이 있으면 그 회차는 '방문완료' (✓ 표시)
  const roundDone = (r: number) => visits.some((v) => v.round_no === r);

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
  const pct = units.length > 0 ? Math.round((100 * visitedCount) / units.length) : 0;

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
            onClick={() => changeRound(r)}
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

      <div className="row" style={{ margin: "18px 0 10px" }}>
        <div className="section-title" style={{ margin: 0, flex: 1 }}>
          방문 {visitedCount}/{units.length} ({pct}%)
        </div>
        <button className="btn-line" onClick={refreshRecords}>
          새로고침
        </button>
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
