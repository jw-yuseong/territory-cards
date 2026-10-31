import { Fragment, useEffect, useMemo, useState } from "react";
import {
  adminAddLetterUnit,
  adminBulkAddLetterUnits,
  adminDeleteLetterBuilding,
  adminDeleteLetterUnit,
  adminRenameLetterBuilding,
  adminUpdateLetterUnit,
  fetchLetterHistory,
  fetchLetterUnits,
  toggleLetterStop,
} from "../api";
import type { LetterHistoryRow, LetterUnitStatus } from "../api";
import { friendlyError } from "../errors";

function fmtDate(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y.slice(2)}.${Number(m)}.${Number(day)}`;
}
function rateClass(pct: number): string {
  if (pct <= 0) return "rate-0";
  if (pct < 30) return "rate-low";
  if (pct < 60) return "rate-mid";
  return "rate-high";
}

type RoundInfo = { date: string; pub: string | null };

export default function LetterStatus({ isAdmin = false }: { isAdmin?: boolean }) {
  const [units, setUnits] = useState<LetterUnitStatus[]>([]);
  const [history, setHistory] = useState<LetterHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [round, setRound] = useState(1);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [buildingModal, setBuildingModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; currentName: string }
    | null
  >(null);

  const [unitModal, setUnitModal] = useState<
    | { mode: "create"; building: string; defaultPostal: string }
    | { mode: "edit"; unit: LetterUnitStatus }
    | null
  >(null);

  async function load() {
    setLoading(true);
    try {
      const [u, h] = await Promise.all([fetchLetterUnits(), fetchLetterHistory()]);
      setUnits(u);
      setHistory(h);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function doToggleStop(unitId: string, current: boolean) {
    if (!isAdmin) return;
    if (
      !window.confirm(
        `이 세대(호수)의 편지 발송을 ${current ? "다시 배정되도록 해제" : "중단(배정 제외)"}하시겠습니까?`
      )
    )
      return;
    try {
      await toggleLetterStop(unitId, !current);
      setUnits((us) => us.map((u) => (u.id === unitId ? { ...u, is_stopped: !current } : u)));
    } catch (e) {
      alert(friendlyError(e));
    }
  }

  async function handleSaveCreateBuilding(building: string, postal: string, hoListText: string) {
    setBusy(true);
    try {
      const list = hoListText
        ? hoListText
            .split(/[\r\n,]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      if (list.length > 0) {
        await adminBulkAddLetterUnits(building, list, postal || null, null);
      } else {
        await adminAddLetterUnit(building, "101", postal || null, null);
      }
      setBuildingModal(null);
      await load();
      setExpanded(building);
    } catch (e) {
      alert("건물 등록 실패: " + friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEditBuilding(oldName: string, newName: string) {
    if (oldName === newName) {
      setBuildingModal(null);
      return;
    }
    setBusy(true);
    try {
      await adminRenameLetterBuilding(oldName, newName);
      setBuildingModal(null);
      await load();
      setExpanded(newName);
    } catch (e) {
      alert("건물명 수정 실패: " + friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteBuilding(buildingName: string, unitCount: number) {
    if (
      !window.confirm(
        `"${buildingName}" 건물과 소속된 세대 ${unitCount}개를 모두 삭제할까요?\n편지 발송 기록이 있는 경우 기록도 함께 삭제됩니다.`
      )
    )
      return;
    setBusy(true);
    try {
      await adminDeleteLetterBuilding(buildingName);
      if (expanded === buildingName) setExpanded(null);
      await load();
    } catch (e) {
      alert("건물 삭제 실패: " + friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCreateUnit(building: string, hoText: string, postal: string, note: string) {
    setBusy(true);
    try {
      const list = hoText
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 1) {
        await adminBulkAddLetterUnits(building, list, postal || null, note || null);
      } else if (list.length === 1) {
        await adminAddLetterUnit(building, list[0], postal || null, note || null);
      }
      setUnitModal(null);
      await load();
    } catch (e) {
      alert("세대 추가 실패: " + friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEditUnit(unitId: string, ho: string, postal: string, note: string) {
    setBusy(true);
    try {
      await adminUpdateLetterUnit(unitId, ho, postal || null, note || null);
      setUnitModal(null);
      await load();
    } catch (e) {
      alert("세대 수정 실패: " + friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteUnit(u: LetterUnitStatus) {
    const warn =
      u.letter_count > 0
        ? `\n⚠ 이미 편지 발송 이력 ${u.letter_count}건이 있습니다. 함께 삭제됩니다.`
        : "";
    if (!window.confirm(`${u.building} ${u.ho}호 세대를 삭제할까요?${warn}`)) return;
    setBusy(true);
    try {
      await adminDeleteLetterUnit(u.id);
      await load();
    } catch (e) {
      alert("세대 삭제 실패: " + friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  // 세대별 편지 회차 목록 (날짜 오름차순 = 1차,2차,...)
  const unitRounds = useMemo(() => {
    const byUnit = new Map<string, LetterHistoryRow[]>();
    for (const r of history) {
      const arr = byUnit.get(r.unit_id);
      if (arr) arr.push(r);
      else byUnit.set(r.unit_id, [r]);
    }
    const m = new Map<string, RoundInfo[]>();
    for (const [uid, arr] of byUnit) {
      arr.sort((a, b) => (a.written_date < b.written_date ? -1 : a.written_date > b.written_date ? 1 : 0));
      m.set(uid, arr.map((r) => ({ date: r.written_date, pub: r.publisher_name })));
    }
    return m;
  }, [history]);

  // 건물별 그룹 (입력 순서 유지)
  const buildings = useMemo(() => {
    const order: string[] = [];
    const byB = new Map<string, LetterUnitStatus[]>();
    for (const u of units) {
      const arr = byB.get(u.building);
      if (arr) arr.push(u);
      else {
        byB.set(u.building, [u]);
        order.push(u.building);
      }
    }
    return order.map((b) => ({ building: b, units: byB.get(b) as LetterUnitStatus[] }));
  }, [units]);

  // 선택 회차 기준 건물별 완료 현황
  const rows = useMemo(() => {
    return buildings.map((b, i) => {
      let done = 0;
      let recent: string | null = null;
      for (const u of b.units) {
        const rr = unitRounds.get(u.id);
        if (rr && rr.length >= round) {
          done++;
          const d = rr[round - 1].date;
          if (!recent || d > recent) recent = d;
        }
      }
      return {
        idx: i + 1,
        building: b.building,
        total: b.units.length,
        done,
        recent,
        pct: b.units.length ? (100 * done) / b.units.length : 0,
        units: b.units,
      };
    });
  }, [buildings, unitRounds, round]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return rows;
    return rows.filter((r) => r.building.includes(q));
  }, [rows, query]);

  const totalDone = useMemo(() => {
    let d = 0;
    for (const u of units) {
      const rr = unitRounds.get(u.id);
      if (rr && rr.length >= round) d++;
    }
    return d;
  }, [units, unitRounds, round]);

  if (loading && units.length === 0) return <div className="loading">편지봉사 현황을 불러오는 중...</div>;
  if (error && units.length === 0) return <div className="error-msg">{error}</div>;

  const totalPct = units.length ? (100 * totalDone) / units.length : 0;
  const shown = showAll ? filtered : filtered.slice(0, 50);

  return (
    <div>
      <div className="round-tabs">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            className={round === n ? "active" : ""}
            onClick={() => {
              setRound(n);
              setExpanded(null);
            }}
          >
            {n}차
          </button>
        ))}
      </div>

      {isAdmin && (
        <div style={{ marginBottom: 10 }}>
          <button
            className="btn-primary"
            style={{
              width: "100%",
              padding: "10px 14px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onClick={() => setBuildingModal({ mode: "create" })}
          >
            + 🏢 새 편지봉사 건물 주소 등록
          </button>
        </div>
      )}

      <div className="field">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowAll(false);
          }}
          placeholder="건물(주소) 검색"
        />
      </div>

      <div className="muted" style={{ marginBottom: 8 }}>
        <b>{round}차</b> · 전체 {units.length}세대 중 <b>{totalDone}세대</b> 완료 (
        {totalPct.toFixed(1)}%) · 건물 {filtered.length}개 · 건물을 누르면 세대별로 볼 수 있어요
      </div>

      <table className="prog-table">
        <thead>
          <tr>
            <th>№</th>
            <th>건물(주소)</th>
            <th>세대</th>
            <th>{round}차 완료</th>
            <th>최근일자</th>
            <th>%</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const isOpen = expanded === r.building;
            return (
              <Fragment key={r.building}>
                <tr onClick={() => setExpanded(isOpen ? null : r.building)}>
                  <td style={{ fontWeight: 700, color: "var(--c-primary)" }}>{r.idx}</td>
                  <td className="tname">{r.building}</td>
                  <td>{r.total}</td>
                  <td>{r.done}</td>
                  <td>{fmtDate(r.recent)}</td>
                  <td className={rateClass(r.pct)}>{r.pct.toFixed(0)}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={6} style={{ padding: 0, background: "var(--c-bg, #f7f7f9)" }}>
                      <div style={{ padding: "8px 10px" }}>
                        {/* 관리자 전용 액션 바 */}
                        {isAdmin && (
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              marginBottom: 8,
                              paddingBottom: 8,
                              borderBottom: "1px dashed var(--c-border)",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              className="btn-line"
                              style={{
                                fontSize: "var(--fs-small)",
                                padding: "4px 10px",
                                borderColor: "#2563eb",
                                color: "#1d4ed8",
                                fontWeight: 700,
                              }}
                              onClick={() =>
                                setUnitModal({
                                  mode: "create",
                                  building: r.building,
                                  defaultPostal: r.units[0]?.postal ?? "",
                                })
                              }
                            >
                              + 세대(집) 추가
                            </button>
                            <button
                              className="btn-line"
                              style={{
                                fontSize: "var(--fs-small)",
                                padding: "4px 8px",
                                fontWeight: 600,
                              }}
                              onClick={() =>
                                setBuildingModal({ mode: "edit", currentName: r.building })
                              }
                            >
                              ✏️ 건물명 수정
                            </button>
                            <button
                              className="btn-line"
                              style={{
                                fontSize: "var(--fs-small)",
                                padding: "4px 8px",
                                fontWeight: 600,
                                color: "var(--c-danger)",
                                borderColor: "var(--c-danger)",
                              }}
                              onClick={() => handleDeleteBuilding(r.building, r.units.length)}
                            >
                              🗑 건물 전체 삭제
                            </button>
                          </div>
                        )}

                        {/* 세대 목록 */}
                        {r.units.map((u) => {
                          const rr = unitRounds.get(u.id);
                          const info = rr && rr.length >= round ? rr[round - 1] : null;
                          return (
                            <div
                              key={u.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 0",
                                borderBottom: "1px solid var(--c-border)",
                                opacity: u.is_stopped ? 0.4 : 1,
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: u.is_stopped ? "normal" : "bold" }}>
                                  {u.ho}호
                                </span>
                                {u.postal && (
                                  <span style={{ fontSize: "0.8em", color: "var(--c-muted)", marginLeft: 6 }}>
                                    ({u.postal})
                                  </span>
                                )}
                                {u.note && (
                                  <span style={{ fontSize: "0.8em", color: "var(--c-muted)", marginLeft: 4 }}>
                                    · {u.note}
                                  </span>
                                )}
                                {u.is_stopped && (
                                  <span style={{ marginLeft: 6, fontSize: "0.8em", color: "var(--c-danger)" }}>
                                    (중단됨)
                                  </span>
                                )}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: info ? "var(--c-text)" : "#aaa", fontSize: "0.9em", marginRight: 4 }}>
                                  {info ? `${fmtDate(info.date)} · ${info.pub ?? "?"}` : "미완료"}
                                </span>
                                {isAdmin && (
                                  <>
                                    <button
                                      className="btn-line"
                                      style={{ padding: "2px 6px", fontSize: "0.75em" }}
                                      onClick={() => setUnitModal({ mode: "edit", unit: u })}
                                    >
                                      수정
                                    </button>
                                    <button
                                      className="btn-line"
                                      style={{
                                        padding: "2px 6px",
                                        fontSize: "0.75em",
                                        color: "var(--c-danger)",
                                        borderColor: "var(--c-danger)",
                                      }}
                                      onClick={() => handleDeleteUnit(u)}
                                    >
                                      삭제
                                    </button>
                                    <button
                                      className="btn-line"
                                      style={{ padding: "2px 6px", fontSize: "0.75em" }}
                                      onClick={() => doToggleStop(u.id, u.is_stopped)}
                                    >
                                      {u.is_stopped ? "해제" : "중단"}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {!showAll && filtered.length > 50 && (
        <button className="btn-line" style={{ width: "100%", marginTop: 8 }} onClick={() => setShowAll(true)}>
          전체보기 (나머지 {filtered.length - 50}개)
        </button>
      )}

      {/* 건물 등록/수정 모달 */}
      {buildingModal && (
        <BuildingModal
          modal={buildingModal}
          busy={busy}
          onClose={() => setBuildingModal(null)}
          onSaveCreate={handleSaveCreateBuilding}
          onSaveEdit={handleSaveEditBuilding}
        />
      )}

      {/* 세대 추가/수정 모달 */}
      {unitModal && (
        <UnitModal
          modal={unitModal}
          busy={busy}
          onClose={() => setUnitModal(null)}
          onSaveCreate={handleSaveCreateUnit}
          onSaveEdit={handleSaveEditUnit}
        />
      )}
    </div>
  );
}

function BuildingModal({
  modal,
  busy,
  onClose,
  onSaveCreate,
  onSaveEdit,
}: {
  modal: { mode: "create" } | { mode: "edit"; currentName: string };
  busy: boolean;
  onClose: () => void;
  onSaveCreate: (building: string, postal: string, hoListText: string) => Promise<void>;
  onSaveEdit: (oldName: string, newName: string) => Promise<void>;
}) {
  const isCreate = modal.mode === "create";
  const [building, setBuilding] = useState(isCreate ? "" : modal.currentName);
  const [postal, setPostal] = useState("");
  const [hoText, setHoText] = useState("");

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isCreate ? "새 편지봉사 건물 주소 등록" : "건물 주소(이름) 수정"}</h3>

        <div className="field">
          <label>건물 주소 (도로명 및 건물명, 필수)</label>
          <input
            type="text"
            value={building}
            autoFocus
            onChange={(e) => setBuilding(e.target.value)}
            placeholder="예: 노은서로142번길 33 은구비빌라"
          />
        </div>

        {isCreate && (
          <>
            <div className="field">
              <label>우편번호 (선택)</label>
              <input
                type="text"
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
                placeholder="예: 34045"
              />
            </div>

            <div className="field">
              <label>초기 세대(호수) 목록 (선택)</label>
              <textarea
                value={hoText}
                rows={3}
                onChange={(e) => setHoText(e.target.value)}
                placeholder="쉼표(,) 또는 줄바꿈으로 호수들을 입력하세요.&#10;예: 101, 102, 201, 202"
                style={{
                  width: "100%",
                  fontFamily: "inherit",
                  fontSize: "var(--fs-base)",
                  padding: "10px 12px",
                  border: "1px solid var(--c-border)",
                  borderRadius: 10,
                }}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                * 비워두고 나중에 세대를 하나씩 추가할 수도 있습니다.
              </div>
            </div>
          </>
        )}

        <button
          className="btn-primary"
          disabled={busy || building.trim() === ""}
          onClick={async () => {
            if (isCreate) {
              await onSaveCreate(building.trim(), postal.trim(), hoText.trim());
            } else {
              await onSaveEdit(modal.currentName, building.trim());
            }
          }}
        >
          {busy ? "저장 중..." : isCreate ? "등록" : "저장"}
        </button>

        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}

function UnitModal({
  modal,
  busy,
  onClose,
  onSaveCreate,
  onSaveEdit,
}: {
  modal:
    | { mode: "create"; building: string; defaultPostal: string }
    | { mode: "edit"; unit: LetterUnitStatus };
  busy: boolean;
  onClose: () => void;
  onSaveCreate: (building: string, hoText: string, postal: string, note: string) => Promise<void>;
  onSaveEdit: (unitId: string, ho: string, postal: string, note: string) => Promise<void>;
}) {
  const isCreate = modal.mode === "create";
  const [ho, setHo] = useState(isCreate ? "" : modal.unit.ho);
  const [postal, setPostal] = useState(
    isCreate ? modal.defaultPostal : modal.unit.postal ?? ""
  );
  const [note, setNote] = useState(isCreate ? "" : modal.unit.note ?? "");

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          {isCreate
            ? `[${modal.building}] 세대 추가`
            : `[${modal.unit.building}] ${modal.unit.ho}호 수정`}
        </h3>

        <div className="field">
          <label>호수 (필수)</label>
          {isCreate ? (
            <>
              <textarea
                value={ho}
                rows={2}
                autoFocus
                onChange={(e) => setHo(e.target.value)}
                placeholder="예: 305 또는 여러 개 (101, 102, 201)"
                style={{
                  width: "100%",
                  fontFamily: "inherit",
                  fontSize: "var(--fs-base)",
                  padding: "10px 12px",
                  border: "1px solid var(--c-border)",
                  borderRadius: 10,
                }}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                쉼표(,)나 줄바꿈으로 여러 호수를 한 번에 추가할 수도 있습니다.
              </div>
            </>
          ) : (
            <input
              type="text"
              value={ho}
              autoFocus
              onChange={(e) => setHo(e.target.value)}
              placeholder="예: 305"
            />
          )}
        </div>

        <div className="field">
          <label>우편번호 (선택)</label>
          <input
            type="text"
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            placeholder="예: 34045"
          />
        </div>

        <div className="field">
          <label>비고 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 수취함 없음, 반송됨"
          />
        </div>

        <button
          className="btn-primary"
          disabled={busy || ho.trim() === ""}
          onClick={async () => {
            if (isCreate) {
              await onSaveCreate(modal.building, ho.trim(), postal.trim(), note.trim());
            } else {
              await onSaveEdit(modal.unit.id, ho.trim(), postal.trim(), note.trim());
            }
          }}
        >
          {busy ? "저장 중..." : isCreate ? "추가" : "저장"}
        </button>

        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  );
}
