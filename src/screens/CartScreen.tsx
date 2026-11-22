import { useEffect, useMemo, useState } from "react";
import {
  applyCartSlot,
  cancelCartSlot,
  fetchCartApplications,
  fetchCartPublishers,
  fetchCartSchedules,
} from "../api";
import type { CartApplication, CartPublisher, CartSchedule } from "../types";
import { friendlyError } from "../errors";
import { matchName } from "../chosung";
import CartAdmin, { DAY_NAMES, formatScheduleFullTitle } from "./CartAdmin";

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
 * - 이번 주 해당 요일의 전시대 종료 시각(end_time)이 현재 시각보다 아직 지나지 않았으면 -> 이번 주 날짜
 * - 이미 종료 시각이 지났으면(완료됨) -> 다음 주(+7일) 날짜
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

/** 조회할 신청 내역의 날짜 범위 (이번 주 월요일 ~ 다음 주 일요일, 총 14일) */
function getTwoWeekQueryRange(now: Date): { startYmd: string; endYmd: string } {
  const jsDay = now.getDay();
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (isoDay - 1));
  const nextSunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 13);
  return {
    startYmd: fmtYmd(monday),
    endYmd: fmtYmd(nextSunday),
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

export default function CartScreen({ isAdmin = false }: { isAdmin?: boolean }) {
  const [schedules, setSchedules] = useState<CartSchedule[]>([]);
  const [publishers, setPublishers] = useState<CartPublisher[]>([]);
  const [applications, setApplications] = useState<CartApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 선택한 전시대 일정 (신청 화면 진입)
  const [selectedSchedule, setSelectedSchedule] = useState<CartSchedule | null>(null);
  // 구역관리자일 때 전시대 설정 화면으로 전환
  const [showAdminConfig, setShowAdminConfig] = useState(false);

  // 신청 불가 시간 안내 팝업 모달
  const [popupMessage, setPopupMessage] = useState<string | null>(null);

  // 신청 화면에서 전도인 검색 및 선택 상태
  const [searchPub, setSearchPub] = useState("");
  const [selectedPubId, setSelectedPubId] = useState<string>(
    () => localStorage.getItem("lastCartPublisherId") ?? ""
  );

  const [now, setNow] = useState<Date>(() => new Date());

  // 30초마다 현재 시각 갱신 (완료된 일정이 다음 주로 넘어가는 것 & 마감 시각 실시간 반영)
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const queryRange = useMemo(() => getTwoWeekQueryRange(now), [now]);

  // 각 일정별 다가오는 날짜를 계산하고, 다가오는 날짜 + 시작 시각 순으로 정렬
  // (예: 수요일에는 이번 주 목요일, 토요일이 먼저 오고, 완료된 화요일은 다음 주 화요일로서 맨 아래에 위치)
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
      const [sc, ps, apps] = await Promise.all([
        fetchCartSchedules(),
        fetchCartPublishers(),
        fetchCartApplications(queryRange.startYmd, queryRange.endYmd),
      ]);
      setSchedules(sc);
      setPublishers(ps);
      setApplications(apps);
    } catch (e) {
      setError(friendlyError(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, [queryRange.startYmd, queryRange.endYmd]);

  // 뒤로가기(쓸어넘기기) 시 신청 화면에서 리스트 화면으로 복귀
  useEffect(() => {
    function onPop() {
      setSelectedSchedule(null);
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
    const win = checkApplicationWindow(serviceDate, s.start_time, new Date());
    if (!win.allowed) {
      showWindowNoticePopup(s, serviceDate, win);
      return;
    }
    setError("");
    setMsg("");
    setSearchPub("");
    setSelectedSchedule(s);
    window.history.pushState({ cartDetail: true }, "");
  }

  function closeDetail() {
    if (window.history.state && window.history.state.cartDetail) {
      window.history.back();
    } else {
      setSelectedSchedule(null);
      setError("");
      setMsg("");
    }
  }

  async function handleApply() {
    if (!selectedSchedule || !selectedPubId) return;
    const serviceDate = getUpcomingServiceDate(selectedSchedule, new Date());
    const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, new Date());
    if (!win.allowed) {
      showWindowNoticePopup(selectedSchedule, serviceDate, win);
      return;
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

  async function handleCancel(app: CartApplication) {
    if (!selectedSchedule) return;
    const serviceDate = getUpcomingServiceDate(selectedSchedule, new Date());
    const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, new Date());
    if (!win.allowed) {
      showWindowNoticePopup(selectedSchedule, serviceDate, win);
      return;
    }
    if (!window.confirm(`'${app.publisher_name}' 전도인의 전시대 신청을 취소할까요?`)) return;

    setBusy(true);
    setError("");
    setMsg("");
    try {
      await cancelCartSlot(app.id);
      setMsg(`'${app.publisher_name}' 전도인의 신청이 취소되었습니다.`);
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

  // 2) 전시대 신청 화면 (일정을 선택했을 때)
  if (selectedSchedule) {
    const serviceDate = getUpcomingServiceDate(selectedSchedule, now);
    const slotApps = applications.filter(
      (a) => a.schedule_id === selectedSchedule.id && a.service_date === serviceDate
    );
    const appliedPubIds = new Set(slotApps.map((a) => a.publisher_id));
    const selectedPub = publishers.find((p) => p.id === selectedPubId);
    const alreadyAppliedApp = slotApps.find((a) => a.publisher_id === selectedPubId);
    const win = checkApplicationWindow(serviceDate, selectedSchedule.start_time, now);

    return (
      <div>
        <button className="btn-line" onClick={closeDetail} style={{ marginBottom: 12 }}>
          ← 전시대 목록으로
        </button>

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
            신청한 전도인 ({slotApps.length}명)
          </div>
          {slotApps.length === 0 ? (
            <div className="muted" style={{ fontSize: "var(--fs-small)" }}>
              아직 신청한 사람이 없습니다. 아래에서 이름을 선택해 신청해 주세요.
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {slotApps.map((a) => (
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
                  {a.publisher_name}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleCancel(a)}
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
              ))}
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
                const isSelected = selectedPubId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`choice-btn ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedPubId(p.id)}
                  >
                    {p.name}
                    {isApplied ? " (신청됨)" : ""}
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
            onClick={() => handleCancel(alreadyAppliedApp)}
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
          🛒 전시대 신청
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
        전시대 신청 및 취소는 <b>그 전날(오전 0시)부터 전시대 시작 4시간 전까지</b> 가능합니다.
        신청할 시간대를 눌러 주세요.
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
          const slotApps = applications.filter(
            (a) => a.schedule_id === s.id && a.service_date === serviceDate
          );

          return (
            <button
              key={`${s.id}-${serviceDate}`}
              type="button"
              className="card-box"
              onClick={() => handleSelectSchedule(s, serviceDate)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: 14,
                display: "block",
                cursor: "pointer",
                borderColor: win.allowed ? "var(--c-primary)" : "var(--c-border)",
              }}
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
                {slotApps.length > 0
                  ? `신청자 (${slotApps.length}명): ${slotApps.map((a) => a.publisher_name).join(", ")}`
                  : "신청자 없음"}
              </div>
            </button>
          );
        })
      )}

      {popupModal}
    </div>
  );
}
