import { useEffect, useMemo, useState } from "react";
import {
  deleteCartTeamPlan,
  upsertCartTeamPlan,
} from "../api";
import type {
  CartApplication,
  CartLocation,
  CartSchedule,
  CartTeamPlan,
} from "../types";
import { friendlyError } from "../errors";
import { DAY_NAMES, formatScheduleFullTitle } from "./CartAdmin";

type LocationDraft = {
  enabled: boolean;
  teamCount: number; // 2 | 3 | 4
  teams: string[][]; // 길이 4짜리 배열, 각 원소는 길이 2 또는 3의 문자열 배열 (빈 슬롯은 "")
};

function makeEmptyTeams(): string[][] {
  return [
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
  ];
}

function normalizeLoadedTeams(rawTeams: string[][]): string[][] {
  const result = makeEmptyTeams();
  for (let i = 0; i < 4; i++) {
    const src = Array.isArray(rawTeams[i]) ? rawTeams[i] : [];
    if (src.length >= 3) {
      result[i] = [src[0] ?? "", src[1] ?? "", src[2] ?? ""];
    } else {
      result[i] = [src[0] ?? "", src[1] ?? ""];
    }
  }
  return result;
}

/** '2026-11-24' -> '11월 24일' */
function fmtMonthDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

export function buildTeamSummaryText(
  schedule: CartSchedule,
  serviceDate: string,
  locations: CartLocation[],
  plans: CartTeamPlan[]
): string {
  const lines: string[] = [];
  lines.push(`🛒 전시대 조 편성`);
  lines.push(`📅 ${fmtMonthDay(serviceDate)} ${formatScheduleFullTitle(schedule)}`);

  let anyTeam = false;
  for (const loc of locations) {
    const plan = plans.find(
      (p) =>
        p.schedule_id === schedule.id &&
        p.service_date === serviceDate &&
        p.location_id === loc.id
    );
    if (!plan) continue;
    const activeTeams = (plan.teams ?? [])
      .slice(0, plan.team_count)
      .map((members, idx) => {
        const valid = members.map((m) => m.trim()).filter(Boolean);
        return { idx: idx + 1, valid };
      })
      .filter((t) => t.valid.length > 0);
    if (activeTeams.length === 0) continue;
    anyTeam = true;
    lines.push("");
    lines.push(`📍 ${loc.name} (${plan.team_count}조)`);
    for (const t of activeTeams) {
      lines.push(`  • ${t.idx}조: ${t.valid.join(", ")}`);
    }
  }

  if (!anyTeam) {
    lines.push("");
    lines.push("(아직 편성된 조가 없습니다)");
  }
  return lines.join("\n");
}

function buildInitialDraftByLoc(
  locations: CartLocation[],
  existingPlans: CartTeamPlan[],
  scheduleId: string,
  serviceDate: string
): Record<string, LocationDraft> {
  const next: Record<string, LocationDraft> = {};
  const hasAnySaved = existingPlans.some(
    (p) => p.schedule_id === scheduleId && p.service_date === serviceDate
  );
  locations.forEach((loc, idx) => {
    const found = existingPlans.find(
      (p) =>
        p.schedule_id === scheduleId &&
        p.service_date === serviceDate &&
        p.location_id === loc.id
    );
    if (found) {
      next[loc.id] = {
        enabled: true,
        teamCount: found.team_count >= 2 && found.team_count <= 4 ? found.team_count : 2,
        teams: normalizeLoadedTeams(found.teams),
      };
    } else {
      // 아직 저장된 계획이 전혀 없으면 첫 번째 장소는 기본 2조로 열어둠
      next[loc.id] = {
        enabled: !hasAnySaved && idx === 0,
        teamCount: 2,
        teams: makeEmptyTeams(),
      };
    }
  });
  return next;
}

export default function CartTeamPlanner({
  schedule,
  serviceDate,
  locations,
  slotApplications,
  cancelledApplications = [],
  existingPlans,
  allRecentPlans,
  threeMonthsAgoYmd,
  onBack,
  onReload,
  onSwitchToApplyView,
}: {
  schedule: CartSchedule;
  serviceDate: string;
  locations: CartLocation[];
  slotApplications: CartApplication[];
  cancelledApplications?: CartApplication[];
  existingPlans: CartTeamPlan[];
  allRecentPlans: CartTeamPlan[];
  threeMonthsAgoYmd: string;
  onBack: () => void;
  onReload: () => Promise<void>;
  onSwitchToApplyView: () => void;
}) {
  const [draftByLoc, setDraftByLoc] = useState<Record<string, LocationDraft>>(() =>
    buildInitialDraftByLoc(locations, existingPlans, schedule.id, serviceDate)
  );
  // 사용자가 화면에서 조 개수(2·3·4조)나 배정을 건드렸는지 여부 (편집 중 자동 리셋 원천 방지)
  const [isDirty, setIsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 슬롯 클릭 시 전도인 선택 모달 대상
  const [pickingSlot, setPickingSlot] = useState<{
    locationId: string;
    locationName: string;
    teamIdx: number;
    memberIdx: number;
  } | null>(null);

  // 저장된 계획의 실제 내용이 바뀌었을 때만(그리고 사용자가 편집 중이 아닐 때만) draft 동기화
  const existingPlansKey = useMemo(
    () =>
      JSON.stringify(
        existingPlans.map((p) => ({
          l: p.location_id,
          c: p.team_count,
          t: p.teams,
        }))
      ),
    [existingPlans]
  );
  const locationsKey = useMemo(() => locations.map((l) => l.id).join(","), [locations]);

  useEffect(() => {
    if (isDirty) return;
    setDraftByLoc(buildInitialDraftByLoc(locations, existingPlans, schedule.id, serviceDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationsKey, existingPlansKey, schedule.id, serviceDate, isDirty]);

  // 현재 모든 활성 장소·조에 배치된 전도인 이름과 위치 매핑
  const assignedMap = useMemo(() => {
    const map = new Map<string, string[]>(); // name -> ['노은역 광장 1조', ...]
    for (const loc of locations) {
      const d = draftByLoc[loc.id];
      if (!d || !d.enabled) continue;
      for (let t = 0; t < d.teamCount; t++) {
        const members = d.teams[t] ?? [];
        for (const name of members) {
          const trimmed = name.trim();
          if (!trimmed) continue;
          const list = map.get(trimmed) ?? [];
          list.push(`${loc.name} ${t + 1}조`);
          map.set(trimmed, list);
        }
      }
    }
    return map;
  }, [locations, draftByLoc]);

  // 최근 3개월 이내에 전시대 조에 배정되어 참여한 횟수 집계 (현재 편성 중인 슬롯 제외 + 현재 화면 배정 반영)
  const participationCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plan of allRecentPlans) {
      if (plan.service_date < threeMonthsAgoYmd) continue;
      // 현재 편집 중인 일정·날짜는 화면의 draft 기준으로 더하기 위해 DB 기록에서는 제외
      if (plan.schedule_id === schedule.id && plan.service_date === serviceDate) continue;
      const activeTeams = (plan.teams ?? []).slice(0, plan.team_count);
      for (const members of activeTeams) {
        if (!Array.isArray(members)) continue;
        for (const name of members) {
          const trimmed = (name ?? "").trim();
          if (!trimmed) continue;
          counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
        }
      }
    }
    // 현재 화면에서 배정된 전도인 반영
    for (const [name, places] of assignedMap.entries()) {
      if (places.length > 0) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return counts;
  }, [allRecentPlans, threeMonthsAgoYmd, schedule.id, serviceDate, assignedMap]);

  function setLocationMode(locationId: string, mode: "off" | 2 | 3 | 4) {
    setIsDirty(true);
    setDraftByLoc((prev) => {
      const cur = prev[locationId] ?? {
        enabled: false,
        teamCount: 2,
        teams: makeEmptyTeams(),
      };
      if (mode === "off") {
        return { ...prev, [locationId]: { ...cur, enabled: false } };
      }
      return {
        ...prev,
        [locationId]: {
          ...cur,
          enabled: true,
          teamCount: mode,
        },
      };
    });
    setMsg("");
  }

  function toggleThirdMemberSlot(locationId: string, teamIdx: number, enableThird: boolean) {
    setIsDirty(true);
    setDraftByLoc((prev) => {
      const cur = prev[locationId];
      if (!cur) return prev;
      const newTeams = cur.teams.map((arr, idx) => {
        if (idx !== teamIdx) return arr;
        if (enableThird) {
          return [arr[0] ?? "", arr[1] ?? "", arr[2] ?? ""];
        }
        return [arr[0] ?? "", arr[1] ?? ""];
      });
      return {
        ...prev,
        [locationId]: { ...cur, teams: newTeams },
      };
    });
    setMsg("");
  }

  function assignMemberToSlot(
    locationId: string,
    teamIdx: number,
    memberIdx: number,
    publisherName: string
  ) {
    setIsDirty(true);
    setDraftByLoc((prev) => {
      const cur = prev[locationId];
      if (!cur) return prev;
      const newTeams = cur.teams.map((arr, idx) => {
        if (idx !== teamIdx) return [...arr];
        const copy = [...arr];
        copy[memberIdx] = publisherName;
        return copy;
      });
      return {
        ...prev,
        [locationId]: { ...cur, teams: newTeams },
      };
    });
    setPickingSlot(null);
    setMsg("");
  }

  async function handleSaveAll() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      for (const loc of locations) {
        if (loc.id.startsWith("default-loc-")) {
          throw new Error(
            "전시대 장소 테이블이 아직 DB에 준비되지 않았습니다. 관리자에게 patch20 SQL 실행을 요청해 주세요."
          );
        }
        const d = draftByLoc[loc.id];
        if (!d || !d.enabled) {
          await deleteCartTeamPlan(schedule.id, serviceDate, loc.id);
          continue;
        }
        const cleanedTeams = Array.from({ length: 4 }, (_, idx) => {
          const arr = d.teams[idx] ?? ["", ""];
          if (idx >= d.teamCount) return ["", ""];
          return arr.length >= 3
            ? [arr[0]?.trim() ?? "", arr[1]?.trim() ?? "", arr[2]?.trim() ?? ""]
            : [arr[0]?.trim() ?? "", arr[1]?.trim() ?? ""];
        });
        await upsertCartTeamPlan({
          schedule_id: schedule.id,
          service_date: serviceDate,
          location_id: loc.id,
          team_count: d.teamCount,
          teams: cleanedTeams,
        });
      }
      await onReload();
      setIsDirty(false);
      setMsg("전시대 조 편성이 저장되었습니다! (전시대 계정에는 해당 봉사모임 시간에 자동 공개됩니다)");
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleCopySummary() {
    // 현재 화면의 draft 기준으로 텍스트 생성
    const virtualPlans: CartTeamPlan[] = locations
      .filter((loc) => draftByLoc[loc.id]?.enabled)
      .map((loc) => ({
        id: loc.id,
        schedule_id: schedule.id,
        service_date: serviceDate,
        location_id: loc.id,
        team_count: draftByLoc[loc.id].teamCount,
        teams: draftByLoc[loc.id].teams.slice(0, draftByLoc[loc.id].teamCount),
        updated_at: "",
      }));
    const text = buildTeamSummaryText(schedule, serviceDate, locations, virtualPlans);
    try {
      await navigator.clipboard.writeText(text);
      setMsg("📋 조 편성 내역이 복사되었습니다. 카카오톡 등에 붙여넣기 하세요.");
    } catch {
      window.prompt("아래 조 편성 내용을 복사하세요:", text);
    }
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <button className="btn-line" onClick={onBack}>
          ← 전시대 목록으로
        </button>
        <button
          className="btn-line"
          style={{ fontSize: "var(--fs-small)", padding: "6px 12px" }}
          onClick={onSwitchToApplyView}
        >
          🙋 신청자 추가/취소 화면
        </button>
      </div>

      {/* 상단 일정 제목 */}
      <div className="card-box" style={{ padding: 14, borderColor: "var(--c-primary)" }}>
        <div className="muted" style={{ fontSize: "var(--fs-small)", marginBottom: 2 }}>
          {fmtMonthDay(serviceDate)} ({DAY_NAMES[schedule.day_of_week]}) · 인도자 전시대 조 계획
        </div>
        <div style={{ fontWeight: 700, fontSize: "var(--fs-lg)" }}>
          {formatScheduleFullTitle(schedule)}
        </div>
      </div>

      {/* 이 시간대 신청한 전도인 현황 (배정 여부 및 최근 3개월 참여 횟수 표시) */}
      <div className="card-box" style={{ padding: 12 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: "var(--fs-small)",
            color: "var(--c-muted)",
            marginBottom: 8,
          }}
        >
          신청한 전도인 ({slotApplications.length}명) — 이름 옆은 최근 3개월 참여 횟수
        </div>
        {slotApplications.length === 0 ? (
          <div className="muted" style={{ fontSize: "var(--fs-small)" }}>
            아직 이 시간대에 신청한 전도인이 없습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {slotApplications.map((app) => {
              const assignedPlaces = assignedMap.get(app.publisher_name);
              const isAssigned = assignedPlaces && assignedPlaces.length > 0;
              const cnt = participationCountMap.get(app.publisher_name.trim()) ?? 0;
              return (
                <span
                  key={app.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: isAssigned ? "#dcfce7" : "#f1f5f9",
                    border: `1px solid ${isAssigned ? "#86efac" : "#cbd5e1"}`,
                    fontSize: "var(--fs-small)",
                    fontWeight: 600,
                    color: isAssigned ? "#166534" : "#334155",
                  }}
                >
                  {isAssigned ? "✓ " : ""}
                  {app.publisher_name}
                  <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>
                    ({cnt}회)
                  </span>
                  {isAssigned && (
                    <span style={{ fontSize: 11, opacity: 0.85 }}>
                      · {assignedPlaces.join(", ")}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* 신청 취소자 명단 표시 (조 배정 대상에서는 제외됨) */}
        {cancelledApplications.length > 0 && (
          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: "1px dashed var(--c-border)",
              fontSize: "var(--fs-small)",
              color: "var(--c-muted)",
            }}
          >
            신청 취소자 ({cancelledApplications.length}명 · 조 배정 제외):{" "}
            {cancelledApplications.map((a, idx) => (
              <span key={a.id}>
                {idx > 0 ? ", " : ""}
                <span style={{ textDecoration: "line-through" }}>{a.publisher_name}</span>
                {a.cancel_reason ? `(${a.cancel_reason})` : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      {/* 장소별(최대 3곳) 조 편성 카드 */}
      {locations.slice(0, 3).map((loc, locIdx) => {
        const draft = draftByLoc[loc.id] ?? {
          enabled: false,
          teamCount: 2,
          teams: makeEmptyTeams(),
        };

        return (
          <div
            key={loc.id}
            className="card-box"
            style={{
              padding: 14,
              marginTop: 12,
              borderColor: draft.enabled ? "var(--c-primary)" : "var(--c-border)",
              background: draft.enabled ? "#fff" : "#f8fafc",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: "var(--fs-base)" }}>
                📍 장소 {locIdx + 1}: {loc.name}
              </div>
            </div>

            {/* 미운영 / 2조 / 3조 / 4조 선택 탭 */}
            <div className="round-tabs" style={{ marginBottom: draft.enabled ? 12 : 0 }}>
              <button
                type="button"
                className={!draft.enabled ? "active" : ""}
                onClick={() => setLocationMode(loc.id, "off")}
              >
                미운영
              </button>
              {[2, 3, 4].map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  className={draft.enabled && draft.teamCount === cnt ? "active" : ""}
                  onClick={() => setLocationMode(loc.id, cnt as 2 | 3 | 4)}
                >
                  {cnt}조 운영
                </button>
              ))}
            </div>

            {/* 각 조(1조 ~ teamCount조) 전도인 슬롯 */}
            {draft.enabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Array.from({ length: draft.teamCount }, (_, teamIdx) => {
                  const members = draft.teams[teamIdx] ?? ["", ""];
                  const hasThirdSlot = members.length >= 3;

                  return (
                    <div
                      key={teamIdx}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        background: "#f8fafc",
                        border: "1px solid var(--c-border)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontWeight: 700, color: "var(--c-primary)" }}>
                          {teamIdx + 1}조 ({hasThirdSlot ? "3명" : "2명"})
                        </span>
                        {!hasThirdSlot ? (
                          <button
                            type="button"
                            className="btn-line"
                            style={{
                              minHeight: 0,
                              padding: "3px 10px",
                              fontSize: 12,
                            }}
                            onClick={() => toggleThirdMemberSlot(loc.id, teamIdx, true)}
                          >
                            + 3명째 추가
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-line"
                            style={{
                              minHeight: 0,
                              padding: "3px 10px",
                              fontSize: 12,
                              color: "var(--c-muted)",
                            }}
                            onClick={() => toggleThirdMemberSlot(loc.id, teamIdx, false)}
                          >
                            2명으로 변경
                          </button>
                        )}
                      </div>

                      <div className="row" style={{ gap: 8 }}>
                        {members.map((memberName, memberIdx) => {
                          const trimmedName = memberName.trim();
                          const filled = trimmedName !== "";
                          const cnt = filled ? (participationCountMap.get(trimmedName) ?? 0) : 0;
                          return (
                            <button
                              key={memberIdx}
                              type="button"
                              className="choice-btn"
                              onClick={() =>
                                setPickingSlot({
                                  locationId: loc.id,
                                  locationName: loc.name,
                                  teamIdx,
                                  memberIdx,
                                })
                              }
                              style={{
                                flex: 1,
                                textAlign: "center",
                                fontWeight: filled ? 700 : 400,
                                color: filled ? "var(--c-primary)" : "var(--c-muted)",
                                borderColor: filled ? "var(--c-primary)" : "var(--c-border)",
                                background: filled ? "#eff6ff" : "#fff",
                                padding: "10px 6px",
                              }}
                            >
                              {filled ? (
                                <>
                                  {trimmedName}
                                  <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3 }}>
                                    ({cnt}회)
                                  </span>
                                </>
                              ) : (
                                `+ 전도인 ${memberIdx + 1}`
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* 하단 저장 및 카톡 공유용 복사 버튼 */}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn-primary" disabled={busy} onClick={handleSaveAll}>
          {busy ? "저장 중..." : "💾 전시대 조 편성 저장하기"}
        </button>
        <button className="btn-line" style={{ width: "100%" }} onClick={handleCopySummary}>
          📋 조 편성 결과 복사 (카톡·문자 공유용)
        </button>
      </div>

      {/* 슬롯 클릭 시 신청한 전도인 선택 모달 (이미 다른 자리에 배정된 전도인은 목록에서 제외) */}
      {pickingSlot && (() => {
        const curDraft = draftByLoc[pickingSlot.locationId];
        const currentSelectedName =
          curDraft?.teams[pickingSlot.teamIdx]?.[pickingSlot.memberIdx] ?? "";

        // 현재 클릭한 슬롯이 아닌 다른 자리에 이미 배정된 전도인은 선택 목록에서 제외
        const availableApplications = slotApplications.filter((app) => {
          const name = app.publisher_name.trim();
          if (name === currentSelectedName.trim()) return true;
          const assignedPlaces = assignedMap.get(name) ?? [];
          return assignedPlaces.length === 0;
        });

        return (
          <div className="modal-back" onClick={() => setPickingSlot(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3>
                📍 {pickingSlot.locationName} — {pickingSlot.teamIdx + 1}조 ({pickingSlot.memberIdx + 1}번째 전도인)
              </h3>
              <div className="muted" style={{ marginBottom: 10, fontSize: "var(--fs-small)" }}>
                아직 조에 배정되지 않은 신청 전도인 중에서 선택해 주세요. (괄호는 최근 3개월 참여 횟수)
              </div>

              {slotApplications.length === 0 ? (
                <div className="notice" style={{ marginBottom: 12 }}>
                  이 시간대에 신청한 전도인이 없습니다.
                </div>
              ) : availableApplications.length === 0 ? (
                <div className="notice" style={{ marginBottom: 12 }}>
                  신청한 모든 전도인이 이미 다른 조에 배정되었습니다.
                </div>
              ) : (
                <div className="choice-grid" style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
                  {availableApplications.map((app) => {
                    const name = app.publisher_name;
                    const isCurrent = currentSelectedName === name;
                    const cnt = participationCountMap.get(name.trim()) ?? 0;

                    return (
                      <button
                        key={app.id}
                        type="button"
                        className={`choice-btn ${isCurrent ? "selected" : ""}`}
                        onClick={() =>
                          assignMemberToSlot(
                            pickingSlot.locationId,
                            pickingSlot.teamIdx,
                            pickingSlot.memberIdx,
                            name
                          )
                        }
                      >
                        <div>
                          {name}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 400,
                              marginLeft: 3,
                              color: isCurrent ? "#fff" : "var(--c-muted)",
                            }}
                          >
                            ({cnt}회)
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {currentSelectedName && (
                <button
                  type="button"
                  className="btn-danger"
                  style={{ width: "100%", marginBottom: 8 }}
                  onClick={() =>
                    assignMemberToSlot(
                      pickingSlot.locationId,
                      pickingSlot.teamIdx,
                      pickingSlot.memberIdx,
                      ""
                    )
                  }
                >
                  이 자리 비우기 ('{currentSelectedName}' 배정 해제)
                </button>
              )}

              <button
                type="button"
                className="choice-btn"
                onClick={() => setPickingSlot(null)}
              >
                닫기
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
