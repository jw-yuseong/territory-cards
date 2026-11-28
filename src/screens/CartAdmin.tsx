import { useEffect, useMemo, useState } from "react";
import {
  addCartLocation,
  addCartPublisher,
  addCartSchedule,
  bulkUpsertCartSlotConductors,
  deleteCartLocation,
  deleteCartSchedule,
  deleteCartSlotConductor,
  fetchCartLocations,
  fetchCartPublishers,
  fetchCartSchedules,
  fetchCartSlotConductors,
  removeCartPublisher,
  updateCartLocation,
  updateCartSchedule,
  upsertCartSlotConductor,
} from "../api";
import type {
  CartLocation,
  CartPublisher,
  CartSchedule,
  CartSlotConductor,
} from "../types";
import { friendlyError } from "../errors";
import { matchName } from "../chosung";

export const DAY_NAMES: Record<number, string> = {
  1: "월요일",
  2: "화요일",
  3: "수요일",
  4: "목요일",
  5: "금요일",
  6: "토요일",
  7: "일요일",
};

/** '18:00', '20:00' -> '오후 6시~8시' */
export function buildTimeLabel(startTime: string, endTime: string): string {
  function fmt(t: string): { period: string; hour: number; min: number } {
    const [hStr, mStr] = t.split(":");
    const h = Number(hStr) || 0;
    const m = Number(mStr) || 0;
    const period = h < 12 ? "오전" : "오후";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return { period, hour: hour12, min: m };
  }
  const s = fmt(startTime);
  const e = fmt(endTime);
  const sText = `${s.period} ${s.hour}시${s.min > 0 ? ` ${s.min}분` : ""}`;
  const ePrefix = s.period === e.period ? "" : `${e.period} `;
  const eText = `${ePrefix}${e.hour}시${e.min > 0 ? ` ${e.min}분` : ""}`;
  return `${sText}~${eText}`;
}

export function formatScheduleFullTitle(s: CartSchedule): string {
  const day = DAY_NAMES[s.day_of_week] ?? "";
  const note = s.meeting_note ? `(${s.meeting_note})` : "";
  return `${day} ${s.time_label}${note}`;
}

const DAY_SHORT: Record<number, string> = {
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
  6: "토",
  7: "일",
};

function getCurrentYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function shiftYearMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(ym: string): {
  year: number;
  month: number;
  daysInMonth: number;
  from: string;
  to: string;
} {
  const [yStr, mStr] = ym.split("-");
  const year = Number(yStr);
  const month = Number(mStr);
  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  return {
    year,
    month,
    daysInMonth,
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const hh = String(h).padStart(2, "0");
  const period = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { value: `${hh}:00`, label: `${period} ${h12}시 (${hh}:00)` };
});

export default function CartAdmin({ onBack }: { onBack?: () => void }) {
  const [schedules, setSchedules] = useState<CartSchedule[]>([]);
  const [locations, setLocations] = useState<CartLocation[]>([]);
  const [publishers, setPublishers] = useState<CartPublisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 일정 추가/수정 모달 상태
  const [editingSchedule, setEditingSchedule] = useState<CartSchedule | null>(null);
  const [isAddingSchedule, setIsAddingSchedule] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState<number>(2);
  const [startTime, setStartTime] = useState<string>("18:00");
  const [endTime, setEndTime] = useState<string>("20:00");
  const [timeLabel, setTimeLabel] = useState<string>("오후 6시~8시");
  const [meetingNote, setMeetingNote] = useState<string>("봉사모임 5시45분");

  // 전시대 장소(최대 3곳) 수정/추가 상태
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editingLocationName, setEditingLocationName] = useState<string>("");
  const [newLocationName, setNewLocationName] = useState<string>("");

  // 승인 전도인 추가 및 검색 상태
  const [newPubName, setNewPubName] = useState("");
  const [searchPub, setSearchPub] = useState("");

  // 월별 전시대 인도자 배정 상태
  const [conductorMonth, setConductorMonth] = useState<string>(getCurrentYearMonth);
  const [slotConductors, setSlotConductors] = useState<CartSlotConductor[]>([]);
  const [loadingConductors, setLoadingConductors] = useState(false);
  const [editingConductorKey, setEditingConductorKey] = useState<string | null>(null);
  const [editingConductorName, setEditingConductorName] = useState<string>("");
  const [showBulkBox, setShowBulkBox] = useState(false);
  const [bulkText, setBulkText] = useState("");

  async function reloadConductors(ym: string) {
    setLoadingConductors(true);
    try {
      const { from, to } = getMonthRange(ym);
      const list = await fetchCartSlotConductors(from, to);
      setSlotConductors(list);
    } catch {
      // 테이블 미적용 등의 경우 조용히 빈 목록 유지
      setSlotConductors([]);
    }
    setLoadingConductors(false);
  }

  async function reload() {
    try {
      const [sc, locs, ps] = await Promise.all([
        fetchCartSchedules(),
        fetchCartLocations(),
        fetchCartPublishers(),
      ]);
      setSchedules(sc);
      setLocations(locs);
      setPublishers(ps);
    } catch (e) {
      setError(friendlyError(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    reloadConductors(conductorMonth);
  }, [conductorMonth]);

  function openAddSchedule() {
    setEditingSchedule(null);
    setDayOfWeek(2);
    setStartTime("18:00");
    setEndTime("20:00");
    setTimeLabel("오후 6시~8시");
    setMeetingNote("봉사모임 5시45분");
    setIsAddingSchedule(true);
    setError("");
    setMsg("");
  }

  function openEditSchedule(s: CartSchedule) {
    setEditingSchedule(s);
    setDayOfWeek(s.day_of_week);
    setStartTime(s.start_time);
    setEndTime(s.end_time);
    setTimeLabel(s.time_label);
    setMeetingNote(s.meeting_note);
    setIsAddingSchedule(true);
    setError("");
    setMsg("");
  }

  function onChangeStartOrEnd(nextStart: string, nextEnd: string) {
    setStartTime(nextStart);
    setEndTime(nextEnd);
    setTimeLabel(buildTimeLabel(nextStart, nextEnd));
  }

  async function saveSchedule() {
    if (!timeLabel.trim()) {
      setError("시간 표시 문구를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const payload = {
        day_of_week: dayOfWeek,
        start_time: startTime,
        end_time: endTime,
        time_label: timeLabel.trim(),
        meeting_note: meetingNote.trim(),
      };
      if (editingSchedule) {
        await updateCartSchedule(editingSchedule.id, payload);
        setMsg("전시대 시간표가 수정되었습니다.");
      } else {
        await addCartSchedule(payload);
        setMsg("새 전시대 시간표가 추가되었습니다.");
      }
      setIsAddingSchedule(false);
      setEditingSchedule(null);
      await reload();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function removeSchedule(s: CartSchedule) {
    const title = formatScheduleFullTitle(s);
    if (
      !window.confirm(
        `'${title}' 일정을 목록에서 삭제할까요?\n(과거 3개월 전시대 참여 횟수 기록은 안전하게 보존됩니다.)`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await deleteCartSchedule(s.id);
      setMsg(`'${title}' 일정이 삭제되었습니다.`);
      await reload();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleSaveLocationName(loc: CartLocation) {
    const trimmed = editingLocationName.trim();
    if (!trimmed) {
      setError("장소 이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await updateCartLocation(loc.id, trimmed);
      setEditingLocationId(null);
      setEditingLocationName("");
      setMsg(`전시대 장소 이름이 '${trimmed}'(으)로 변경되었습니다.`);
      await reload();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleAddLocation() {
    const trimmed = newLocationName.trim();
    if (!trimmed) return;
    if (locations.length >= 3) {
      setError("전시대 장소는 최대 3곳까지만 등록할 수 있습니다.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const maxSort = locations.reduce((m, l) => Math.max(m, l.sort_order), 0);
      await addCartLocation(trimmed, maxSort + 1);
      setNewLocationName("");
      setMsg(`전시대 장소 '${trimmed}' 추가됨`);
      await reload();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleDeleteLocation(loc: CartLocation) {
    if (!window.confirm(`전시대 장소 '${loc.name}'을(를) 삭제할까요?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await deleteCartLocation(loc.id);
      setMsg(`전시대 장소 '${loc.name}'이(가) 삭제되었습니다.`);
      await reload();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleAddPublisher() {
    const name = newPubName.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await addCartPublisher(name);
      setNewPubName("");
      setMsg(`전시대 승인 전도인 '${name}' 추가됨`);
      await reload();
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleRemovePublisher(p: CartPublisher) {
    if (!window.confirm(`전시대 승인 명단에서 '${p.name}' 전도인을 삭제할까요?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await removeCartPublisher(p.id);
      setMsg(
        res === "hidden"
          ? `'${p.name}' 전도인은 신청 기록이 있어 명단에서 숨김 처리했습니다.`
          : `'${p.name}' 전도인이 명단에서 삭제되었습니다.`
      );
      await reload();
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

  const conductorBySlot = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of slotConductors) {
      map.set(`${c.schedule_id}:${c.service_date}`, c.conductor_name);
    }
    return map;
  }, [slotConductors]);

  /** 선택된 월의 모든 전시대 일정 슬롯 (날짜순 -> 시작시간순) */
  const monthlySlots = useMemo(() => {
    const { year, month, daysInMonth } = getMonthRange(conductorMonth);
    const mm = String(month).padStart(2, "0");
    const result: {
      key: string;
      serviceDate: string;
      day: number;
      dayOfWeek: number;
      schedule: CartSchedule;
    }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const jsDay = new Date(year, month - 1, d).getDay();
      const dow = jsDay === 0 ? 7 : jsDay;
      const matching = schedules
        .filter((s) => s.day_of_week === dow)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      const serviceDate = `${year}-${mm}-${String(d).padStart(2, "0")}`;
      for (const s of matching) {
        result.push({
          key: `${s.id}:${serviceDate}`,
          serviceDate,
          day: d,
          dayOfWeek: dow,
          schedule: s,
        });
      }
    }
    return result;
  }, [conductorMonth, schedules]);

  async function handleSaveConductor(scheduleId: string, serviceDate: string) {
    const cleaned = editingConductorName.trim().replace(/\s*형제$/, "");
    if (!cleaned) {
      setError("인도자 형제 이름을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await upsertCartSlotConductor(scheduleId, serviceDate, cleaned);
      setEditingConductorKey(null);
      setEditingConductorName("");
      setMsg(`${serviceDate} 인도자가 '${cleaned} 형제'로 저장되었습니다.`);
      await reloadConductors(conductorMonth);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleDeleteConductor(scheduleId: string, serviceDate: string) {
    if (!window.confirm(`${serviceDate} 배정된 인도자를 삭제할까요?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await deleteCartSlotConductor(scheduleId, serviceDate);
      setMsg(`${serviceDate} 인도자 배정이 삭제되었습니다.`);
      await reloadConductors(conductorMonth);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleBulkSaveConductors() {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));

    if (lines.length === 0) {
      setError("붙여넣을 내용이 없습니다. 예: 2026-11-03 18:00 김용훈");
      return;
    }

    const items: { schedule_id: string; service_date: string; conductor_name: string }[] = [];
    const unmatched: string[] = [];
    const seenMonths = new Set<string>();

    for (const line of lines) {
      // 허용 형식: "2026-11-03 18:00 김용훈" 또는 "2026-11-03 화 18:00 김용훈" 등
      const m = line.match(
        /^(\d{4}-\d{2}-\d{2})[\s,|\t]+(?:[월화수목금토일]\(?[월화수목금토일]?\)?[\s,|\t]+)?(\d{1,2}:\d{2})[\s,|\t]+(.+)$/
      );
      if (!m) {
        unmatched.push(line);
        continue;
      }
      const serviceDate = m[1];
      const [hStr, minStr] = m[2].split(":");
      const startTimeNorm = `${String(Number(hStr)).padStart(2, "0")}:${minStr}`;
      const conductorName = m[3].trim().replace(/\s*형제$/, "");
      if (!conductorName) {
        unmatched.push(line);
        continue;
      }

      const [yy, mm, dd] = serviceDate.split("-").map(Number);
      const jsDay = new Date(yy, mm - 1, dd).getDay();
      const dow = jsDay === 0 ? 7 : jsDay;

      const matchedSchedule = schedules.find(
        (s) => s.day_of_week === dow && s.start_time.slice(0, 5) === startTimeNorm
      );
      if (!matchedSchedule) {
        unmatched.push(`${line} (일치하는 전시대 시간표 없음)`);
        continue;
      }

      items.push({
        schedule_id: matchedSchedule.id,
        service_date: serviceDate,
        conductor_name: conductorName,
      });
      seenMonths.add(serviceDate.slice(0, 7));
    }

    if (items.length === 0) {
      setError(
        `저장할 수 있는 항목이 없습니다.\n형식 확인: YYYY-MM-DD HH:MM 이름\n실패 항목: ${unmatched
          .slice(0, 3)
          .join(" / ")}`
      );
      return;
    }

    setBusy(true);
    setError("");
    setMsg("");
    try {
      await bulkUpsertCartSlotConductors(items);
      const targetMonth =
        seenMonths.size === 1 ? Array.from(seenMonths)[0] : conductorMonth;
      setBulkText("");
      setShowBulkBox(false);
      if (targetMonth !== conductorMonth) {
        setConductorMonth(targetMonth);
      } else {
        await reloadConductors(conductorMonth);
      }
      const warnText =
        unmatched.length > 0 ? ` (미일치 ${unmatched.length}건 제외)` : "";
      setMsg(`전시대 인도자 ${items.length}건이 일괄 저장되었습니다.${warnText}`);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  if (loading) return <div className="loading">전시대 설정을 불러오는 중...</div>;

  return (
    <div>
      {onBack && (
        <button className="btn-line" onClick={onBack} style={{ marginBottom: 10 }}>
          ← 이전 화면으로
        </button>
      )}
      <h2 className="section-title" style={{ marginTop: 4 }}>
        🛒 전시대 관리 (요일·시간표, 장소 및 승인 명단)
      </h2>
      <div className="notice">
        <b>전시대 요일·시간표</b>, <b>전시대 장소(최대 3곳)</b>, <b>전시대 승인 전도인 명단</b>을 추가, 변경, 삭제할 수 있습니다.
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      {/* 1. 전시대 요일 및 봉사 시간 관리 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 18,
          marginBottom: 8,
        }}
      >
        <div className="section-title" style={{ margin: 0 }}>
          📅 전시대 요일 및 봉사 시간 ({schedules.length}개)
        </div>
        <button
          className="btn-primary"
          style={{ width: "auto", padding: "8px 14px", minHeight: 0 }}
          disabled={busy}
          onClick={openAddSchedule}
        >
          + 시간 추가
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          등록된 전시대 시간이 없습니다. [+ 시간 추가]를 눌러 등록해 주세요.
        </div>
      ) : (
        schedules.map((s) => (
          <div key={s.id} className="card-box" style={{ padding: 12 }}>
            <div style={{ fontWeight: 700, fontSize: "var(--fs-base)", marginBottom: 4 }}>
              {formatScheduleFullTitle(s)}
            </div>
            <div className="muted" style={{ fontSize: "var(--fs-small)", marginBottom: 10 }}>
              시작: {s.start_time} ~ 종료: {s.end_time} (신청 마감: 당일{" "}
              {(() => {
                const h = Number(s.start_time.split(":")[0]) || 0;
                const m = s.start_time.split(":")[1] ?? "00";
                const closeH = Math.max(0, h - 1);
                return `${String(closeH).padStart(2, "0")}:${m}`;
              })()}
              )
            </div>
            <div className="row">
              <button
                className="btn-line"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => openEditSchedule(s)}
              >
                변경
              </button>
              <button
                className="btn-danger"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => removeSchedule(s)}
              >
                삭제
              </button>
            </div>
          </div>
        ))
      )}

      {/* 시간 추가 / 변경 모달 */}
      {isAddingSchedule && (
        <div className="modal-back" onClick={() => setIsAddingSchedule(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingSchedule ? "전시대 시간 변경" : "새 전시대 시간 추가"}</h3>

            <div className="field">
              <label>요일 선택</label>
              <div className="choice-grid">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`choice-btn ${dayOfWeek === d ? "selected" : ""}`}
                    onClick={() => setDayOfWeek(d)}
                  >
                    {DAY_NAMES[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ marginBottom: 12 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>시작 시각</label>
                <select
                  value={startTime}
                  onChange={(e) => onChangeStartOrEnd(e.target.value, endTime)}
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>종료 시각</label>
                <select
                  value={endTime}
                  onChange={(e) => onChangeStartOrEnd(startTime, e.target.value)}
                >
                  {HOUR_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label>화면 표시용 시간 문구 (예: 오후 6시~8시)</label>
              <input
                type="text"
                value={timeLabel}
                onChange={(e) => setTimeLabel(e.target.value)}
                placeholder="예: 오후 6시~8시"
              />
            </div>

            <div className="field">
              <label>봉사모임 안내 (괄호 안에 표시될 내용)</label>
              <input
                type="text"
                value={meetingNote}
                onChange={(e) => setMeetingNote(e.target.value)}
                placeholder="예: 봉사모임 5시45분 또는 봉사모임 없음"
              />
            </div>

            <div className="notice" style={{ fontSize: "var(--fs-small)" }}>
              미리보기:{" "}
              <b>
                {DAY_NAMES[dayOfWeek]} {timeLabel}
                {meetingNote.trim() ? `(${meetingNote.trim()})` : ""}
              </b>
            </div>

            <button className="btn-primary" disabled={busy} onClick={saveSchedule}>
              {busy ? "저장 중..." : editingSchedule ? "변경 내용 저장" : "추가하기"}
            </button>
            <button
              type="button"
              className="choice-btn"
              style={{ marginTop: 8 }}
              onClick={() => setIsAddingSchedule(false)}
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 2. 전시대 장소 관리 (최대 3곳) */}
      <div className="section-title" style={{ marginTop: 28 }}>
        📍 전시대 장소 관리 ({locations.length} / 최대 3곳)
      </div>
      <div className="muted" style={{ marginBottom: 8, fontSize: "var(--fs-small)" }}>
        인도자가 전시대 조를 편성할 때 사용하는 장소입니다. 장소 이름을 변경하거나 삭제·추가(최대 3곳)할 수 있습니다.
      </div>

      {locations.map((loc, idx) => {
        const isEditing = editingLocationId === loc.id;
        return (
          <div key={loc.id} className="card-box" style={{ padding: 12 }}>
            {isEditing ? (
              <div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>장소 {idx + 1} 이름 수정</label>
                  <input
                    type="text"
                    value={editingLocationName}
                    onChange={(e) => setEditingLocationName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveLocationName(loc)}
                    autoFocus
                  />
                </div>
                <div className="row">
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    disabled={busy || !editingLocationName.trim()}
                    onClick={() => handleSaveLocationName(loc)}
                  >
                    저장
                  </button>
                  <button
                    className="btn-line"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onClick={() => {
                      setEditingLocationId(null);
                      setEditingLocationName("");
                    }}
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: "var(--fs-base)" }}>
                  📍 {idx + 1}. {loc.name}
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn-line"
                    style={{ padding: "6px 12px", minHeight: 0 }}
                    disabled={busy}
                    onClick={() => {
                      setEditingLocationId(loc.id);
                      setEditingLocationName(loc.name);
                    }}
                  >
                    이름 변경
                  </button>
                  <button
                    className="btn-line"
                    style={{
                      padding: "6px 12px",
                      minHeight: 0,
                      color: "var(--c-danger)",
                      borderColor: "var(--c-danger)",
                    }}
                    disabled={busy}
                    onClick={() => handleDeleteLocation(loc)}
                  >
                    삭제
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {locations.length < 3 && (
        <div className="row" style={{ marginTop: 8 }}>
          <input
            type="text"
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddLocation()}
            placeholder="새 전시대 장소 이름 입력 (최대 3곳)"
          />
          <button
            className="btn-primary"
            style={{ width: "auto", flexShrink: 0 }}
            disabled={busy || !newLocationName.trim()}
            onClick={handleAddLocation}
          >
            장소 추가
          </button>
        </div>
      )}

      {/* 3. 월별 전시대 인도자 배정 */}
      <div
        className="row-between"
        style={{ marginTop: 28, marginBottom: 8, alignItems: "center" }}
      >
        <div className="section-title" style={{ margin: 0 }}>
          👤 월별 전시대 인도자 배정
        </div>
        <button
          className="btn-line"
          style={{ padding: "6px 12px", minHeight: 0, fontSize: 13 }}
          onClick={() => {
            setShowBulkBox((v) => !v);
            setError("");
            setMsg("");
          }}
        >
          {showBulkBox ? "일괄 입력 닫기" : "📋 한 달 치 일괄 입력"}
        </button>
      </div>

      {showBulkBox && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
            한 달 치 전시대 인도자 일괄 붙여넣기
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
            한 줄에 하나씩 <code>YYYY-MM-DD HH:MM 이름</code> 형식으로 붙여넣고 저장하세요.
            <br />
            예: <code>2026-11-03 18:00 김용훈</code> / <code>2026-11-05 16:00 김윤건</code>
          </div>
          <textarea
            rows={7}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"2026-11-03 18:00 김용훈\n2026-11-05 16:00 김윤건\n2026-11-05 18:00 김상철\n2026-11-07 14:00 최호운"}
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--c-border)",
              fontSize: 13,
              fontFamily: "monospace",
              boxSizing: "border-box",
              marginBottom: 8,
            }}
          />
          <div className="row">
            <button
              className="btn-primary"
              disabled={busy || !bulkText.trim()}
              onClick={handleBulkSaveConductors}
            >
              일괄 저장
            </button>
            <button
              className="btn-line"
              disabled={busy}
              onClick={() => {
                setShowBulkBox(false);
                setBulkText("");
              }}
            >
              취소
            </button>
          </div>
        </div>
      )}

      <div
        className="row-between"
        style={{
          marginBottom: 10,
          padding: "8px 12px",
          background: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          borderRadius: 10,
          alignItems: "center",
        }}
      >
        <button
          className="btn-line"
          style={{ padding: "6px 10px", minHeight: 0, fontSize: 13 }}
          disabled={busy}
          onClick={() => setConductorMonth((m) => shiftYearMonth(m, -1))}
        >
          ◀ 이전 달
        </button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {(() => {
            const { year, month } = getMonthRange(conductorMonth);
            return `${year}년 ${month}월`;
          })()}
        </div>
        <button
          className="btn-line"
          style={{ padding: "6px 10px", minHeight: 0, fontSize: 13 }}
          disabled={busy}
          onClick={() => setConductorMonth((m) => shiftYearMonth(m, 1))}
        >
          다음 달 ▶
        </button>
      </div>

      {loadingConductors ? (
        <div className="muted" style={{ padding: "10px 0" }}>
          인도자 배정 불러오는 중…
        </div>
      ) : monthlySlots.length === 0 ? (
        <div className="muted" style={{ padding: "10px 0" }}>
          등록된 전시대 시간표가 없습니다.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {monthlySlots.map((slot) => {
            const assigned = conductorBySlot.get(slot.key);
            const isEditing = editingConductorKey === slot.key;
            const monthNum = Number(slot.serviceDate.slice(5, 7));
            return (
              <div
                key={slot.key}
                className="card"
                style={{ padding: "10px 12px", marginBottom: 0 }}
              >
                {isEditing ? (
                  <div className="row" style={{ gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {monthNum}/{slot.day} ({DAY_SHORT[slot.dayOfWeek]}){" "}
                      {slot.schedule.start_time.slice(0, 5)}
                    </div>
                    <input
                      type="text"
                      value={editingConductorName}
                      onChange={(e) => setEditingConductorName(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" &&
                        handleSaveConductor(slot.schedule.id, slot.serviceDate)
                      }
                      placeholder="인도자 이름 (예: 김용훈)"
                      style={{ flex: 1, minWidth: 80 }}
                      autoFocus
                    />
                    <button
                      className="btn-primary"
                      style={{ width: "auto", padding: "6px 12px", minHeight: 0, fontSize: 13 }}
                      disabled={busy}
                      onClick={() =>
                        handleSaveConductor(slot.schedule.id, slot.serviceDate)
                      }
                    >
                      저장
                    </button>
                    <button
                      className="btn-line"
                      style={{ padding: "6px 10px", minHeight: 0, fontSize: 13 }}
                      disabled={busy}
                      onClick={() => {
                        setEditingConductorKey(null);
                        setEditingConductorName("");
                      }}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <div className="row-between" style={{ alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 14 }}>
                      <strong>
                        {monthNum}월 {slot.day}일 ({DAY_SHORT[slot.dayOfWeek]})
                      </strong>{" "}
                      <span className="muted" style={{ fontSize: 13 }}>
                        {slot.schedule.start_time.slice(0, 5)}
                      </span>
                      <div style={{ marginTop: 2, fontSize: 13 }}>
                        {assigned ? (
                          <span style={{ color: "var(--c-primary)", fontWeight: 700 }}>
                            👤 {assigned} 형제
                          </span>
                        ) : (
                          <span className="muted">미배정</span>
                        )}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                      <button
                        className="btn-line"
                        style={{ padding: "5px 10px", minHeight: 0, fontSize: 13 }}
                        disabled={busy}
                        onClick={() => {
                          setEditingConductorKey(slot.key);
                          setEditingConductorName(assigned ?? "");
                          setError("");
                          setMsg("");
                        }}
                      >
                        {assigned ? "변경" : "지정"}
                      </button>
                      {assigned && (
                        <button
                          className="btn-line"
                          style={{
                            padding: "5px 10px",
                            minHeight: 0,
                            fontSize: 13,
                            color: "var(--c-danger)",
                            borderColor: "var(--c-danger)",
                          }}
                          disabled={busy}
                          onClick={() =>
                            handleDeleteConductor(slot.schedule.id, slot.serviceDate)
                          }
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 4. 전시대 승인 전도인 명단 관리 */}
      <div className="section-title" style={{ marginTop: 28 }}>
        👥 전시대 봉사 승인 전도인 ({publishers.length}명)
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={newPubName}
          onChange={(e) => setNewPubName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddPublisher()}
          placeholder="새 승인 전도인 이름 입력"
        />
        <button
          className="btn-primary"
          style={{ width: "auto", flexShrink: 0 }}
          disabled={busy || !newPubName.trim()}
          onClick={handleAddPublisher}
        >
          추가
        </button>
      </div>

      <div className="field">
        <input
          type="text"
          value={searchPub}
          onChange={(e) => setSearchPub(e.target.value)}
          placeholder="명단 검색 (이름 또는 초성 예: 박보람, ㅂㅂㄹ)"
        />
      </div>

      {filteredPublishers.length === 0 ? (
        <div className="muted" style={{ padding: "10px 0" }}>
          검색 결과가 없습니다.
        </div>
      ) : (
        filteredPublishers.map((p) => (
          <div key={p.id} className="card-item">
            <span className="name">{p.name}</span>
            <button
              className="btn-line"
              style={{ color: "var(--c-danger)", borderColor: "var(--c-danger)", flexShrink: 0 }}
              disabled={busy}
              onClick={() => handleRemovePublisher(p)}
            >
              삭제
            </button>
          </div>
        ))
      )}
    </div>
  );
}
