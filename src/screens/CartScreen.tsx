import { useEffect, useMemo, useState } from "react";
import {
  applyCartSlot,
  cancelCartSlot,
  fetchCartApplications,
  fetchCartLocations,
  fetchCartPublishers,
  fetchCartSchedules,
  fetchCartTeamPlans,
} from "../api";
import type {
  CartApplication,
  CartLocation,
  CartPublisher,
  CartSchedule,
  CartTeamPlan,
} from "../types";
import { friendlyError } from "../errors";
import { matchName } from "../chosung";
import CartAdmin, { DAY_NAMES, formatScheduleFullTitle } from "./CartAdmin";
import CartTeamPlanner, { buildTeamSummaryText } from "./CartTeamPlanner";

/** Date -> 'YYYY-MM-DD' */
function fmtYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** '2026-11-24' -> '11월 24일' */
function fmtMonthDay(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

/**
 * 이번 주가 이미 완료된 전시대는 숨기고 다음 주 전시대를 보여주기 위해,
 * 각 전시대 일정(schedule)마다 다가오는 날짜('YYYY-MM-DD')를 계산하고 날짜·시간순으로 정렬한다.
 */
function getUpcomingServiceDate(s: CartSchedule, now: Date): string {
  const jsDay = now.getDay(); // 0=일, 1=월 ... 6=토
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=월 ... 7=일
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (isoDay - 1));
  const thisWeekDate = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + (s.day_of_week - 1)
  );

  const [endH, endM] = (s.end_time || s.start_time || "23:59")
    .split(":")
    .map((v) => Number(v) || 0);
  const endDateTime = new Date(
    thisWeekDate.getFullYear(),
    thisWeekDate.getMonth(),
    thisWeekDate.getDate(),
    endH,
    endM,
    0,
    0
  );

  if (now.getTime() >= endDateTime.getTime()) {
    const nextWeekDate = new Date(
      thisWeekDate.getFullYear(),
      thisWeekDate.getMonth(),
      thisWeekDate.getDate() + 7
    );
    return fmtYmd(nextWeekDate);
  }
  return fmtYmd(thisWeekDate);
}

/** 조회할 신청 내역의 날짜 범위 (이번 주 월요일 ~ 다음 주 일요일) 및 최근 3개월 조 배정 기록 조회 범위 */
function getTwoWeekQueryRange(now: Date): {
  startYmd: string;
  endYmd: string;
  todayYmd: string;
  weekEndYmd: string;
  threeMonthsAgoYmd: string;
} {
  const jsDay = now.getDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (isoDay - 1));
  const nextSunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 13);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
  return {
    startYmd: fmtYmd(monday),
    endYmd: fmtYmd(nextSunday),
    todayYmd: fmtYmd(today),
    weekEndYmd: fmtYmd(weekEnd),
    threeMonthsAgoYmd: fmtYmd(threeMonthsAgo),
  };
}

export type WindowCheck = {
  allowed: boolean;
  status: "before" | "open" | "closed";
  openAtStr: string;
  closeAtStr: string;
};

/**
 * 신청 가능 시간 판별:
 * 그 전날(00:00)부터 전시대가 시작되기 4시간 전까지 신청 및 취소 가능
 */
function checkApplicationWindow(
  serviceDateYmd: string,
  startTime: string,
  now: Date
): WindowCheck {
  const [y, m, d] = serviceDateYmd.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map((v) => Number(v) || 0);

  // 전날 00:00:00
  const openAt = new Date(y, m - 1, d - 1, 0, 0, 0, 0);
  // 전시대 시작 시각 - 4시간
  const startAt = new Date(y, m - 1, d, hh, mm, 0, 0);
  const closeAt = new Date(startAt.getTime() - 4 * 60 * 60 * 1000);

  const openMonth = openAt.getMonth() + 1;
  const openDate = openAt.getDate();
  const closeMonth = closeAt.getMonth() + 1;
  const closeDate = closeAt.getDate();
  const closeHour = closeAt.getHours();
  const closeMin = closeAt.getMinutes();
  const closePeriod = closeHour < 12 ? "오전" : "오후";
  const closeH12 = closeHour % 12 === 0 ? 12 : closeHour % 12;

  const openAtStr = `${openMonth}월 ${openDate}일 오전 0시(자정)`;
  const closeAtStr = `${closeMonth}월 ${closeDate}일 ${closePeriod} ${closeH12}시${closeMin > 0 ? ` ${closeMin}분` : ""}`;

  const nowMs = now.getTime();
  if (nowMs < openAt.getTime()) {
    return { allowed: false, status: "before", openAtStr, closeAtStr };
  }
  if (nowMs > closeAt.getTime()) {
    return { allowed: false, status: "closed", openAtStr, closeAtStr };
  }
  return { allowed: true, status: "open", openAtStr, closeAtStr };
}

const CANCEL_REASON_PRESETS = [
  "건강 / 컨디션 문제",
  "직장 / 학업 / 가족 일정",
  "날짜·시간 착오 (잘못 신청함)",
  "개인 사정 (급한 용무)",
] as const;

export default function CartScreen({
  isAdmin = false,
  isConductor = false,
}: {
  isAdmin?: boolean;
  isConductor?: boolean;
}) {
  const canPlanTeams = isConductor || isAdmin;

  const [schedules, setSchedules] = useState<CartSchedule[]>([]);
  const [locations, setLocations] = useState<CartLocation[]>([]);
  const [publishers, setPublishers] = useState<CartPublisher[]>([]);
  const [applications, setApplications] = useState<CartApplication[]>([]);
  const [teamPlans, setTeamPlans] = useState<CartTeamPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 선택한 전시대 일정 및 고정 날짜, 화면 모드 ('plan' = 인도자 조 편성, 'apply' = 전도인 신청)
  const [selectedSchedule, setSelectedSchedule] = useState<CartSchedule | null>(null);
  const [selectedServiceDate, setSelectedServiceDate] = useState<string>("");
  const [detailMode, setDetailMode] = useState<"plan" | "apply">("apply");
  // 구역관리자일 때 전시대 설정 화면으로 전환
  const [showAdminConfig, setShowAdminConfig] = useState(false);

  // 신청 불가 시간 안내 팝업 모달
  const [popupMessage, setPopupMessage] = useState<string | null>(null);
  // 신청 취소 확인 팝업 모달 대상, 단계(1단계: 본인 확인 / 2단계: 사유 선택) 및 취소 사유 상태
  const [confirmCancelApp, setConfirmCancelApp] = useState<CartApplication | null>(null);
  const [cancelStep, setCancelStep] = useState<1 | 2>(1);
  const [cancelReasonChoice, setCancelReasonChoice] = useState<string>(CANCEL_REASON_PRESETS[0]);
  const [cancelReasonCustom, setCancelReasonCustom] = useState<string>("");

  // 신청 화면에서 전도인 검색 및 선택 상태
  const [searchPub, setSearchPub] = useState("");
  const [selectedPubId, setSelectedPubId] = useState<string>(
    () => localStorage.getItem("lastCartPublisherId") ?? ""
  );

  const [now, setNow] = useState<Date>(() => new Date());

  // 30초마다 현재 시각 갱신
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const queryRange = useMemo(() => getTwoWeekQueryRange(now), [now]);

  // 각 일정별 다가오는 날짜를 계산하고, 다가오는 날짜 + 시작 시각 순으로 정렬
  const upcomingItems = useMemo(() => {
    return schedules
      .map((schedule) => ({
        schedule,
        serviceDate: getUpcomingServiceDate(schedule, now),
      }))
      .sort((a, b) => {
        if (a.serviceDate !== b.serviceDate) {
          return a.serviceDate.localeCompare(b.serviceDate);
        }
        if (a.schedule.start_time !== b.schedule.start_time) {
          return a.schedule.start_time.localeCompare(b.schedule.start_time);
        }
        return a.schedule.sort_order - b.schedule.sort_order;
      });
  }, [schedules, now]);

  async function loadAll() {
    try {
      const [sc, locs, ps, apps, plans] = await Promise.all([
        fetchCartSchedules(),
        fetchCartLocations(),
        fetchCartPublishers(),
        fetchCartApplications(queryRange.startYmd, queryRange.endYmd),
        fetchCartTeamPlans(queryRange.threeMonthsAgoYmd, queryRange.endYmd),
      ]);
      setSchedules(sc);
      setLocations(locs);
      setPublishers(ps);
      setApplications(apps);
      setTeamPlans(plans);
    } catch (e) {
      setError(friendlyError(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, [queryRange.threeMonthsAgoYmd, queryRange.startYmd, queryRange.endYmd]);

  /** 최근 3개월 이내에 전시대 조에 배정되어 참여한 전도인별 횟수 집계 */
  const threeMonthParticipationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plan of teamPlans) {
      if (plan.service_date < queryRange.threeMonthsAgoYmd) continue;
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
    return counts;
  }, [teamPlans, queryRange.threeMonthsAgoYmd]);

  // 뒤로가기(쓸어넘기기) 시 상세 화면에서 리스트 화면으로 복귀
  useEffect(() => {
    function onPop() {
      setSelectedSchedule(null);
      setSelectedServiceDate("");
      setError("");
      setMsg("");
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function showWindowNoticePopup(s: CartSchedule, serviceDate: string, win: WindowCheck) {
    const title = formatScheduleFullTitle(s);
    setPopupMessage(
      `전시대 신청 및 취소는 그 전날부터 전시대가 시작되기 4시간 전까지만 가능합니다.\n\n` +
        `📌 선택한 일정:\n${fmtMonthDay(serviceDate)} ${title}\n\n` +
        `⏰ 신청·취소 가능 시간:\n${win.openAtStr} ~ ${win.closeAtStr}까지`
    );
  }

  function handleSelectSchedule(s: CartSchedule, serviceDate: string) {
    // 봉사인도자 또는 구역관리자는 신청 시간 여부와 관계없이 곧바로 전시대 조 계획 화면으로 진입
    if (canPlanTeams) {
      setError("");
      setMsg("");
      setSearchPub("");
      setDetailMode("plan");
      setSelectedServiceDate(serviceDate);
      setSelectedSchedule(s);
      window.history.pushState({ cartDetail: true }, "");
      return;
    }

    const win = checkApplicationWindow(serviceDate, s.start_time, new Date());
    if (!win.allowed) {
      showWindowNoticePopup(s, serviceDate, win);
      return;
    }
    setError("");
    setMsg("");
    setSearchPub("");
    setDetailMode("apply");
    setSelectedServiceDate(serviceDate);
    setSelectedSchedule(s);
    window.history.pushState({ cartDetail: true }, "");
  }

  function closeDetail() {
    if (window.history.state && window.history.state.cartDetail) {
      window.history.back();
    } else {
      setSelectedSchedule(null);
      setSelectedServiceDate("");
      setError("");
      setMsg("");
    }
  }

  async function handleApply() {
    if (!selectedSchedule || !selectedPubId) return;
    const serviceDate = selectedServiceDate || getUpcomingServiceDate(selectedSchedule, new Date());
    if (!canPlanTeams) {
      const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, new Date());
      if (!win.allowed) {
        showWindowNoticePopup(selectedSchedule, serviceDate, win);
        return;
      }
    }

    setBusy(true);
    setError("");
    setMsg("");
    try {
      await applyCartSlot(selectedSchedule.id, serviceDate, selectedPubId);
      localStorage.setItem("lastCartPublisherId", selectedPubId);
      const pubName = publishers.find((p) => p.id === selectedPubId)?.name ?? "";
      setMsg(`'${pubName}' 전도인 전시대 신청이 완료되었습니다.`);
      const apps = await fetchCartApplications(queryRange.startYmd, queryRange.endYmd);
      setApplications(apps);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  function requestCancel(app: CartApplication) {
    if (!selectedSchedule) return;
    const serviceDate = selectedServiceDate || getUpcomingServiceDate(selectedSchedule, new Date());
    if (!canPlanTeams) {
      const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, new Date());
      if (!win.allowed) {
        showWindowNoticePopup(selectedSchedule, serviceDate, win);
        return;
      }
    }
    setCancelStep(1);
    setCancelReasonChoice(CANCEL_REASON_PRESETS[0]);
    setCancelReasonCustom("");
    setConfirmCancelApp(app);
  }

  async function executeCancel() {
    if (!confirmCancelApp) return;
    const finalReason =
      cancelReasonChoice === "custom" ? cancelReasonCustom.trim() : cancelReasonChoice;
    if (!finalReason) {
      setError("취소 사유를 입력해 주세요.");
      return;
    }
    const app = confirmCancelApp;
    setConfirmCancelApp(null);
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await cancelCartSlot(app.id, finalReason);
      setMsg(
        `'${app.publisher_name}' 전도인의 신청이 취소되어 '신청 취소자' 명단으로 이동되었습니다. (사유: ${finalReason})`
      );
      const apps = await fetchCartApplications(queryRange.startYmd, queryRange.endYmd);
      setApplications(apps);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleRestoreCancelled(app: CartApplication) {
    if (!selectedSchedule) return;
    const serviceDate = selectedServiceDate || getUpcomingServiceDate(selectedSchedule, new Date());
    if (!canPlanTeams) {
      const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, new Date());
      if (!win.allowed) {
        showWindowNoticePopup(selectedSchedule, serviceDate, win);
        return;
      }
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await applyCartSlot(selectedSchedule.id, serviceDate, app.publisher_id);
      setMsg(`'${app.publisher_name}' 전도인의 전시대 신청이 다시 복구되었습니다.`);
      const apps = await fetchCartApplications(queryRange.startYmd, queryRange.endYmd);
      setApplications(apps);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  const filteredPublishers = useMemo(() => {
    const q = searchPub.trim();
    if (!q) return publishers;
    return publishers.filter((p) => matchName(p.name, q));
  }, [publishers, searchPub]);

  /** 특정 일정에 편성된 장소별 조 요약 배열 생성 */
  function getFormattedPlansForSlot(scheduleId: string, serviceDate: string) {
    const list: { locName: string; teamCount: number; teamLines: string[] }[] = [];
    for (const loc of locations) {
      const plan = teamPlans.find(
        (p) =>
          p.schedule_id === scheduleId &&
          p.service_date === serviceDate &&
          p.location_id === loc.id
      );
      if (!plan) continue;
      const lines: string[] = [];
      (plan.teams ?? []).slice(0, plan.team_count).forEach((members, idx) => {
        const valid = members.map((m) => m.trim()).filter(Boolean);
        if (valid.length > 0) {
          lines.push(`${idx + 1}조: ${valid.join(", ")}`);
        }
      });
      if (lines.length > 0) {
        list.push({ locName: loc.name, teamCount: plan.team_count, teamLines: lines });
      }
    }
    return list;
  }

  async function copySlotTeamSummary(s: CartSchedule, serviceDate: string) {
    const slotPlans = teamPlans.filter(
      (p) => p.schedule_id === s.id && p.service_date === serviceDate
    );
    const text = buildTeamSummaryText(s, serviceDate, locations, slotPlans);
    try {
      await navigator.clipboard.writeText(text);
      setMsg("📋 조 편성 내역이 복사되었습니다. 카카오톡 등에 붙여넣기 하세요.");
    } catch {
      window.prompt("아래 조 편성 내용을 복사하세요:", text);
    }
  }

  if (showAdminConfig) {
    return (
      <CartAdmin
        onBack={() => {
          setShowAdminConfig(false);
          loadAll();
        }}
      />
    );
  }

  if (loading) return <div className="loading">전시대 일정을 불러오는 중...</div>;

  // 신청 불가 시간 안내 팝업
  const popupModal = popupMessage && (
    <div className="modal-back" onClick={() => setPopupMessage(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>⏰ 전시대 신청 가능 시간 안내</h3>
        <div
          className="notice"
          style={{ whiteSpace: "pre-line", lineHeight: 1.6, fontSize: "var(--fs-base)" }}
        >
          {popupMessage}
        </div>
        <button className="btn-primary" onClick={() => setPopupMessage(null)}>
          확인
        </button>
      </div>
    </div>
  );

  // 신청 취소 2단계 팝업 모달 (1단계: 취소 대상 이름 확인 -> 2단계: 취소 사유 선택 및 직접 입력)
  const cancelConfirmModal = confirmCancelApp && (
    <div className="modal-back" onClick={() => setConfirmCancelApp(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {cancelStep === 1 ? (
          <>
            <h3>⚠ 전시대 신청 취소 확인 (1/2)</h3>
            <div
              className="notice"
              style={{ lineHeight: 1.6, fontSize: "var(--fs-base)", marginBottom: 14 }}
            >
              정말 <b style={{ color: "var(--c-danger)" }}>'{confirmCancelApp.publisher_name}'</b> 전도인의 전시대 신청을 취소하는 것이 맞습니까?
              <div className="muted" style={{ marginTop: 6, fontSize: "var(--fs-small)" }}>
                본인이 맞으시면 [예, 맞습니다]를 눌러 다음 단계에서 취소 사유를 선택해 주세요.
              </div>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn-danger"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => setCancelStep(2)}
              >
                예, 맞습니다 →
              </button>
              <button
                type="button"
                className="btn-line"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => setConfirmCancelApp(null)}
              >
                아니오 (닫기)
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>📝 취소 사유 선택 (2/2)</h3>
            <div className="muted" style={{ marginBottom: 10, fontSize: "var(--fs-small)" }}>
              <b>'{confirmCancelApp.publisher_name}'</b> 전도인의 신청 취소 사유를 선택해 주세요.
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {CANCEL_REASON_PRESETS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    className={`choice-btn ${cancelReasonChoice === reason ? "selected" : ""}`}
                    onClick={() => setCancelReasonChoice(reason)}
                    style={{ textAlign: "left" }}
                  >
                    {cancelReasonChoice === reason ? "✓ " : ""}
                    {reason}
                  </button>
                ))}
                <button
                  type="button"
                  className={`choice-btn ${cancelReasonChoice === "custom" ? "selected" : ""}`}
                  onClick={() => setCancelReasonChoice("custom")}
                  style={{ textAlign: "left" }}
                >
                  {cancelReasonChoice === "custom" ? "✓ " : ""}
                  직접 입력
                </button>
              </div>
              {cancelReasonChoice === "custom" && (
                <input
                  type="text"
                  value={cancelReasonCustom}
                  onChange={(e) => setCancelReasonCustom(e.target.value)}
                  placeholder="취소 사유를 직접 입력해 주세요"
                  autoFocus
                  style={{ marginTop: 8 }}
                />
              )}
            </div>

            <div className="muted" style={{ marginBottom: 12, fontSize: "var(--fs-small)" }}>
              취소하면 삭제되지 않고 아래 '신청 취소자' 명단으로 이동되며, 언제든 다시 신청(복구)할 수 있습니다.
            </div>

            <div className="row">
              <button
                type="button"
                className="btn-danger"
                style={{ flex: 1 }}
                disabled={busy || (cancelReasonChoice === "custom" && !cancelReasonCustom.trim())}
                onClick={executeCancel}
              >
                취소 완료
              </button>
              <button
                type="button"
                className="btn-line"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => setConfirmCancelApp(null)}
              >
                닫기 (유지)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // 2) 일정을 선택했을 때: 인도자 조 편성 화면('plan') 또는 전시대 신청 화면('apply')
  if (selectedSchedule) {
    const serviceDate = selectedServiceDate || getUpcomingServiceDate(selectedSchedule, now);
    const allSlotApps = applications.filter(
      (a) => a.schedule_id === selectedSchedule.id && a.service_date === serviceDate
    );
    const activeSlotApps = allSlotApps.filter((a) => !a.is_cancelled);
    const cancelledSlotApps = allSlotApps.filter((a) => a.is_cancelled);
    const slotPlans = teamPlans.filter(
      (p) => p.schedule_id === selectedSchedule.id && p.service_date === serviceDate
    );

    if (canPlanTeams && detailMode === "plan") {
      return (
        <CartTeamPlanner
          key={`${selectedSchedule.id}-${serviceDate}`}
          schedule={selectedSchedule}
          serviceDate={serviceDate}
          locations={locations}
          slotApplications={activeSlotApps}
          cancelledApplications={cancelledSlotApps}
          existingPlans={slotPlans}
          allRecentPlans={teamPlans}
          threeMonthsAgoYmd={queryRange.threeMonthsAgoYmd}
          onBack={closeDetail}
          onReload={loadAll}
          onSwitchToApplyView={() => setDetailMode("apply")}
        />
      );
    }

    const appliedPubIds = new Set(activeSlotApps.map((a) => a.publisher_id));
    const cancelledPubIds = new Set(cancelledSlotApps.map((a) => a.publisher_id));
    const selectedPub = publishers.find((p) => p.id === selectedPubId);
    const alreadyAppliedApp = activeSlotApps.find((a) => a.publisher_id === selectedPubId);
    const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, now);
    const formattedPlans = getFormattedPlansForSlot(selectedSchedule.id, serviceDate);

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
          <button className="btn-line" onClick={closeDetail}>
            ← 전시대 목록으로
          </button>
          {canPlanTeams && (
            <button
              className="btn-line"
              style={{ fontSize: "var(--fs-small)", padding: "6px 12px" }}
              onClick={() => setDetailMode("plan")}
            >
              📋 조 편성 화면으로
            </button>
          )}
        </div>

        <div className="card-box" style={{ padding: 14, borderColor: "var(--c-primary)" }}>
          <div className="muted" style={{ fontSize: "var(--fs-small)", marginBottom: 2 }}>
            {fmtMonthDay(serviceDate)} ({DAY_NAMES[selectedSchedule.day_of_week]})
          </div>
          <div style={{ fontWeight: 700, fontSize: "var(--fs-lg)", marginBottom: 6 }}>
            {formatScheduleFullTitle(selectedSchedule)}
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-small)" }}>
            신청·취소 마감: {win.closeAtStr}까지 (시작 4시간 전)
          </div>
        </div>

        {/* 편성된 조 현황이 있으면 신청 화면 상단에도 표시 */}
        {formattedPlans.length > 0 && (
          <div
            className="card-box"
            style={{
              padding: 12,
              background: "#f0fdf4",
              borderColor: "#86efac",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: "var(--fs-small)", color: "#166534" }}>
                📍 편성된 전시대 조 현황
              </span>
              <button
                type="button"
                className="btn-line"
                style={{ minHeight: 0, padding: "2px 8px", fontSize: 12 }}
                onClick={() => copySlotTeamSummary(selectedSchedule, serviceDate)}
              >
                📋 복사
              </button>
            </div>
            {formattedPlans.map((fp, i) => (
              <div key={i} style={{ fontSize: "var(--fs-small)", marginTop: i > 0 ? 6 : 0 }}>
                <div style={{ fontWeight: 700, color: "#15803d" }}>
                  • {fp.locName} ({fp.teamCount}조)
                </div>
                <div style={{ paddingLeft: 10, color: "#166534" }}>
                  {fp.teamLines.join(" / ")}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 이미 신청한 사람들 이름 (작게 표시 + 취소 가능) */}
        <div className="card-box" style={{ padding: 12 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: "var(--fs-small)",
              color: "var(--c-muted)",
              marginBottom: 8,
            }}
          >
            신청한 전도인 ({activeSlotApps.length}명)
          </div>
          {activeSlotApps.length === 0 ? (
            <div className="muted" style={{ fontSize: "var(--fs-small)" }}>
              아직 신청한 사람이 없습니다. 아래에서 이름을 선택해 신청해 주세요.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {activeSlotApps.map((a) => {
                const cnt = threeMonthParticipationCounts.get(a.publisher_name.trim()) ?? 0;
                return (
                  <span
                    key={a.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      fontSize: "var(--fs-small)",
                      fontWeight: 600,
                      color: "#1e40af",
                    }}
                  >
                    <span>
                      {a.publisher_name}
                      {canPlanTeams && (
                        <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.85 }}>
                          ({cnt}회)
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => requestCancel(a)}
                      style={{
                        minHeight: 0,
                        padding: "1px 6px",
                        fontSize: 12,
                        borderRadius: 999,
                        border: "1px solid #fca5a5",
                        background: "#fef2f2",
                        color: "#b91c1c",
                        fontWeight: 700,
                      }}
                    >
                      취소
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* 신청 취소자 명단 (삭제하지 않고 따로 표시 + 다시 신청하면 복구) */}
          {cancelledSlotApps.length > 0 && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px dashed var(--c-border)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "var(--fs-small)",
                  color: "var(--c-muted)",
                  marginBottom: 6,
                }}
              >
                신청 취소자 ({cancelledSlotApps.length}명) — 실수로 취소한 경우 [재신청]을 누르세요
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {cancelledSlotApps.map((a) => {
                  const cnt = threeMonthParticipationCounts.get(a.publisher_name.trim()) ?? 0;
                  return (
                    <span
                      key={a.id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "#f8fafc",
                        border: "1px solid #cbd5e1",
                        fontSize: "var(--fs-small)",
                        fontWeight: 600,
                        color: "#64748b",
                      }}
                    >
                      <span>
                        <span style={{ textDecoration: "line-through" }}>
                          {a.publisher_name}
                          {canPlanTeams && (
                            <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3 }}>
                              ({cnt}회)
                            </span>
                          )}
                        </span>
                        {a.cancel_reason && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 400,
                              marginLeft: 4,
                              color: "#94a3b8",
                            }}
                          >
                            · {a.cancel_reason}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRestoreCancelled(a)}
                        style={{
                          minHeight: 0,
                          padding: "1px 6px",
                          fontSize: 12,
                          borderRadius: 999,
                          border: "1px solid #86efac",
                          background: "#f0fdf4",
                          color: "#15803d",
                          fontWeight: 700,
                        }}
                      >
                        재신청
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {error && <div className="error-msg">{error}</div>}
        {msg && <div className="notice">{msg}</div>}

        {/* 신청자 본인 이름 선택 */}
        <div className="field" style={{ marginTop: 14 }}>
          <label>
            신청할 본인 이름 선택
            {selectedPub && (
              <span style={{ color: "var(--c-primary)", marginLeft: 8, fontWeight: 700 }}>
                · 선택됨: {selectedPub.name}
              </span>
            )}
          </label>
          <input
            type="text"
            value={searchPub}
            onChange={(e) => setSearchPub(e.target.value)}
            placeholder="이름 또는 초성 검색 (예: 박보람, ㅂㅂㄹ)"
            style={{ marginBottom: 8 }}
          />
          <div className="choice-grid" style={{ maxHeight: 240, overflowY: "auto" }}>
            {filteredPublishers.length === 0 ? (
              <div className="muted" style={{ padding: "8px 0" }}>
                검색 결과가 없습니다.
              </div>
            ) : (
              filteredPublishers.map((p) => {
                const isApplied = appliedPubIds.has(p.id);
                const isCancelled = cancelledPubIds.has(p.id);
                const isSelected = selectedPubId === p.id;
                const cnt = threeMonthParticipationCounts.get(p.name.trim()) ?? 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`choice-btn ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedPubId(p.id)}
                  >
                    {p.name}
                    {canPlanTeams && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 400,
                          marginLeft: 3,
                          color: isSelected ? "#fff" : "var(--c-muted)",
                        }}
                      >
                        ({cnt}회)
                      </span>
                    )}
                    {isApplied ? " (신청됨)" : isCancelled ? " (취소됨)" : ""}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {alreadyAppliedApp ? (
          <button
            className="btn-danger"
            style={{ width: "100%", marginTop: 8 }}
            disabled={busy}
            onClick={() => requestCancel(alreadyAppliedApp)}
          >
            {busy ? "처리 중..." : `'${selectedPub?.name}' 신청 취소하기`}
          </button>
        ) : (
          <button
            className="btn-primary"
            style={{ marginTop: 8 }}
            disabled={busy || !selectedPubId}
            onClick={handleApply}
          >
            {busy
              ? "신청 중..."
              : selectedPub
                ? `'${selectedPub.name}' 이름으로 전시대 신청하기`
                : "이름을 선택해 주세요"}
          </button>
        )}

        {popupModal}
        {cancelConfirmModal}
      </div>
    );
  }

  // 1) 첫 화면: 다가오는 전시대 리스트 (이미 완료된 일정은 다음 주로 전환하여 표시)
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          🛒 전시대 신청 ({fmtMonthDay(queryRange.todayYmd)} ~ {fmtMonthDay(queryRange.weekEndYmd)})
        </h2>
        {isAdmin && (
          <button
            className="btn-line"
            style={{ padding: "6px 12px", minHeight: 0, fontSize: "var(--fs-small)" }}
            onClick={() => setShowAdminConfig(true)}
          >
            ⚙ 전시대 설정
          </button>
        )}
      </div>

      <div className="notice">
        {canPlanTeams ? (
          <>
            인도자 화면입니다. 일정을 선택하면 <b>장소별(최대 3곳) 전시대 조를 계획·편성</b>할 수 있습니다.
          </>
        ) : (
          <>
            전시대 신청 및 취소는 <b>그 전날(오전 0시)부터 전시대 시작 4시간 전까지</b> 가능합니다.
            신청할 시간대를 눌러 주세요.
          </>
        )}
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      {upcomingItems.length === 0 ? (
        <div className="muted" style={{ padding: "16px 0" }}>
          등록된 전시대 일정이 없습니다.
        </div>
      ) : (
        upcomingItems.map(({ schedule: s, serviceDate }) => {
          const win = checkApplicationWindow(serviceDate, s.start_time, now);
          const allSlotApps = applications.filter(
            (a) => a.schedule_id === s.id && a.service_date === serviceDate
          );
          const slotApps = allSlotApps.filter((a) => !a.is_cancelled);
          const cancelledApps = allSlotApps.filter((a) => a.is_cancelled);
          const formattedPlans = getFormattedPlansForSlot(s.id, serviceDate);

          return (
            <div
              key={`${s.id}-${serviceDate}`}
              className="card-box"
              style={{
                padding: 14,
                borderColor: win.allowed || canPlanTeams ? "var(--c-primary)" : "var(--c-border)",
              }}
            >
              <div
                onClick={() => handleSelectSchedule(s, serviceDate)}
                style={{ cursor: "pointer" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span className="muted" style={{ fontSize: "var(--fs-small)", fontWeight: 600 }}>
                    {fmtMonthDay(serviceDate)} ({DAY_NAMES[s.day_of_week]})
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {canPlanTeams && (
                      <span
                        className="round-badge-2"
                        style={{ padding: "3px 8px", fontSize: 12 }}
                      >
                        조 계획하기 →
                      </span>
                    )}
                    {win.status === "open" ? (
                      <span
                        className="done-badge"
                        style={{ background: "#16a34a", color: "#fff", padding: "3px 10px" }}
                      >
                        신청 가능
                      </span>
                    ) : win.status === "before" ? (
                      <span
                        className="caution-badge soft"
                        style={{ background: "#64748b", color: "#fff", padding: "3px 10px" }}
                      >
                        전날부터 신청 가능
                      </span>
                    ) : (
                      <span
                        className="caution-badge soft"
                        style={{ background: "#94a3b8", color: "#fff", padding: "3px 10px" }}
                      >
                        마감
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "var(--fs-base)",
                    color: "var(--c-text)",
                    marginBottom: 6,
                  }}
                >
                  {formatScheduleFullTitle(s)}
                </div>

                {/* 이미 신청한 사람들 이름 작게 표시 */}
                <div
                  style={{
                    fontSize: "var(--fs-small)",
                    color: slotApps.length > 0 ? "var(--c-primary)" : "var(--c-muted)",
                    fontWeight: slotApps.length > 0 ? 600 : 400,
                  }}
                >
                  {slotApps.length > 0 ? (
                    <>
                      신청자 ({slotApps.length}명):{" "}
                      {slotApps.map((a, idx) => {
                        const cnt = threeMonthParticipationCounts.get(a.publisher_name.trim()) ?? 0;
                        return (
                          <span key={a.id}>
                            {idx > 0 ? ", " : ""}
                            {a.publisher_name}
                            {canPlanTeams && (
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 400,
                                  color: "var(--c-muted)",
                                  marginLeft: 2,
                                }}
                              >
                                ({cnt}회)
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </>
                  ) : (
                    "신청자 없음"
                  )}
                </div>

                {/* 신청 취소자가 있는 경우 아래에 작게 표시 */}
                {cancelledApps.length > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--c-muted)",
                      marginTop: 4,
                    }}
                  >
                    신청 취소자 ({cancelledApps.length}명):{" "}
                    {cancelledApps.map((a, idx) => (
                      <span key={a.id}>
                        {idx > 0 ? ", " : ""}
                        <span style={{ textDecoration: "line-through" }}>{a.publisher_name}</span>
                        {a.cancel_reason ? `(${a.cancel_reason})` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 편성된 전시대 조 현황 표시 (전시대 계정 & 인도자 계정 공통) */}
              {formattedPlans.length > 0 && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px dashed var(--c-border)",
                    fontSize: "var(--fs-small)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: "#166534" }}>
                      📍 편성된 전시대 조
                    </span>
                    <button
                      type="button"
                      className="btn-line"
                      style={{ minHeight: 0, padding: "2px 8px", fontSize: 12 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        copySlotTeamSummary(s, serviceDate);
                      }}
                    >
                      📋 조 편성 복사
                    </button>
                  </div>
                  {formattedPlans.map((fp, idx) => (
                    <div key={idx} style={{ marginTop: 4 }}>
                      <span style={{ fontWeight: 700, color: "#15803d" }}>
                        [{fp.locName}]
                      </span>{" "}
                      <span style={{ color: "#334155" }}>{fp.teamLines.join(" / ")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {popupModal}
    </div>
  );
}
