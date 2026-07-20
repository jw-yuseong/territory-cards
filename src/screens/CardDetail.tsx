import { useEffect, useMemo, useState } from "react";
import {
  addVisit,
  fetchAssignments,
  fetchCardStartPoint,
  fetchUnits,
  fetchVisits,
  removeVisit,
  setUnitCaution,
  setUnitNote,
} from "../api";
import { getCautionTypes, getConductors, getPublishers } from "../lists";
import { buildGroups } from "../groups";
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
  const [memoText, setMemoText] = useState("");
  const [busyUnit, setBusyUnit] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [startUrl, setStartUrl] = useState<string | null>(null);

  // 구역 시작점 카카오맵 링크 (없으면 버튼 숨김)
  useEffect(() => {
    fetchCardStartPoint(card.id).then(setStartUrl).catch(() => setStartUrl(null));
  }, [card.id]);

  // 엑셀 A6에 넣어둔 카카오맵 시작점(kko.to)을 새 창으로 연다.
  // 카카오맵에서 그 지점이 표시되고 '길찾기'로 바로 안내받을 수 있다.
  function openStartPoint() {
    if (startUrl) window.open(startUrl, "_blank");
  }

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openCautionModal(u: TerritoryUnit) {
    setCautionUnit(u);
    setMemoText(u.note ?? "");
  }

  // 회차에 맞게 인도자/전도인 칸 채우기:
  //  1) 그 회차에 방문 기록이 있으면 -> 마지막 기록의 이름
  //  2) 기록은 없지만 인도자가 배정해둔 회차면 -> 배정한 인도자 + 배정받은 전도인
  //  3) 둘 다 없으면 -> 빈 값
  function prefillForRound(r: number, vs: VisitRecord[], asg: CardAssignment[]) {
    const roundVisits = vs.filter((x) => x.round_no === r);
    if (roundVisits.length > 0) {
      const latest = roundVisits.reduce((a, b) =>
        a.checked_at > b.checked_at ? a : b
      );
      setConductorId(latest.conductor_id);
      setPublisherId(latest.publisher_id);
      // 이미 방문한 회차는 기록된 호별일자를 그대로 보여줌 (오늘 날짜로 덮지 않음)
      setDate(latest.visited_date);
    } else {
      const assigned = asg.find((x) => x.round_no === r);
      if (assigned) {
        setConductorId(assigned.assigned_by);
        setPublisherId(assigned.publisher_id);
      } else {
        setConductorId("");
        setPublisherId("");
      }
      setDate(today());
    }
  }

  function changeRound(r: number) {
    setRound(r);
    prefillForRound(r, visits, assignments);
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
        // 카드를 열면 동(그룹)은 모두 접힌 상태로 시작
        setCollapsed(
          new Set(
            buildGroups(u)
              .filter((b) => b.group !== null)
              .map((b) => b.key)
          )
        );
        setVisits(v);
        setAssignments(a);
        setConductors(cs);
        setPublishers(ps);
        setCautions(ct);
        // 기본 회차 정하기:
        //  1) 오늘 이미 이 카드에 기록했다면 그 회차 (봉사를 이어서 하는 경우)
        //  2) 인도자가 배정해뒀는데 아직 기록이 없는 회차가 있으면 그 회차
        //     (1회차 배정이면 1회차, 2회차 배정이면 2회차가 바로 열림)
        //  3) 아니면 아직 방문 기록이 없는 첫 회차
        const todayStr = today();
        const todayVisits = v.filter((x) => x.visited_date === todayStr);
        let chosen: number;
        if (todayVisits.length > 0) {
          chosen = Math.max(...todayVisits.map((x) => x.round_no));
        } else {
          const assignedNoVisit = a
            .filter((x) => !v.some((vv) => vv.round_no === x.round_no))
            .map((x) => x.round_no)
            .sort((x, y) => x - y)[0];
          if (assignedNoVisit) {
            chosen = assignedNoVisit;
          } else {
            chosen = 1;
            for (; chosen < 4; chosen++) {
              if (!v.some((x) => x.round_no === chosen)) break;
            }
          }
        }
        setRound(chosen);
        prefillForRound(chosen, v, a);
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

  // 동(그룹)별로 묶기
  const blocks = useMemo(() => buildGroups(units), [units]);

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
      // 메모를 이어서 쓸 수 있도록 창은 열어둔 채 선택 상태만 갱신
      setCautionUnit({ ...cautionUnit, caution_type_id: cautionTypeId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCautionUnit(null);
    }
  }

  async function saveMemo() {
    if (!cautionUnit) return;
    const value = memoText.trim() === "" ? null : memoText.trim();
    try {
      await setUnitNote(cautionUnit.id, value);
      setUnits((us) =>
        us.map((u) => (u.id === cautionUnit.id ? { ...u, note: value } : u))
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
      <div className="row">
        <button className="btn-line" onClick={onBack}>
          ← 카드 목록으로
        </button>
        {startUrl && (
          <button
            className="btn-line"
            style={{ marginLeft: "auto", background: "#ffcd00", borderColor: "#ffcd00", color: "#3a1d1d" }}
            onClick={openStartPoint}
          >
            📍 구역 시작점
          </button>
        )}
      </div>

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

      {blocks.map((b) => {
        const isCollapsed = collapsed.has(b.key);
        const checkedInGroup = b.items.filter((it) => visitByUnit.has(it.unit.id)).length;
        return (
          <div key={b.key}>
            {b.group && (
              <button className="group-header" onClick={() => toggleGroup(b.key)}>
                <span>{isCollapsed ? "▶" : "▼"}</span>
                <span>{b.group}</span>
                <span
                  className={`gh-count ${
                    checkedInGroup >= b.items.length && b.items.length > 0 ? "done" : ""
                  }`}
                >
                  {checkedInGroup}/{b.items.length}
                  {checkedInGroup >= b.items.length && b.items.length > 0 ? " ✓" : ""}
                </span>
              </button>
            )}
            {!isCollapsed &&
              b.items.map(({ unit: u, label, group }) => {
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
                          {group && <span className="unit-group-prefix">{group}</span>}
                          {label}
                        </span>
                        {visit && (
                          <div className="unit-meta">
                            {visit.visited_date}{" "}
                            {publishers.find((p) => p.id === visit.publisher_id)?.name ?? ""}
                          </div>
                        )}
                        {u.note && <div className="unit-meta">📝 {u.note}</div>}
                      </span>
                    </button>
                    {caution && (
                      <span className={`caution-badge ${caution.is_do_not_call ? "" : "soft"}`}>
                        {caution.label}
                      </span>
                    )}
                    <button className="unit-caution-btn" onClick={() => openCautionModal(u)}>
                      ⚠
                    </button>
                  </div>
                );
              })}
          </div>
        );
      })}

      {cautionUnit && (
        <div className="modal-back" onClick={() => setCautionUnit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{cautionUnit.address_unit}</h3>
            <div className="muted" style={{ marginBottom: 6 }}>주의사항 (누르면 바로 저장됩니다)</div>
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

            <div className="field" style={{ marginTop: 14 }}>
              <label>📝 메모 (상호 변경 등 관리자에게 알릴 내용)</label>
              <textarea
                value={memoText}
                rows={3}
                onChange={(e) => setMemoText(e.target.value)}
                placeholder="예: 상호가 '커피천국'으로 바뀜"
                style={{
                  width: "100%",
                  fontFamily: "inherit",
                  fontSize: "var(--fs-base)",
                  padding: "10px 12px",
                  border: "1px solid var(--c-border)",
                  borderRadius: 10,
                }}
              />
            </div>
            <button className="btn-primary" onClick={saveMemo}>
              메모 저장하고 닫기
            </button>
            <button className="choice-btn" style={{ marginTop: 8 }} onClick={() => setCautionUnit(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
