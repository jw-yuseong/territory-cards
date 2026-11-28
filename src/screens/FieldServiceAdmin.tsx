import { useEffect, useMemo, useState } from "react";
import {
  deleteFieldServiceConductor,
  deletePastFieldServiceConductors,
  fetchFieldServiceConductors,
  upsertFieldServiceConductor,
} from "../api";
import type { FieldServiceConductor, FieldServiceSpecialType } from "../types";
import { FIELD_MEETING_LABELS } from "../extractCartConductors";
import { friendlyError } from "../errors";

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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getTodayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function shiftYearMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split("-");
  const d = new Date(Number(yStr), Number(mStr) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthRange(ym: string) {
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

export default function FieldServiceAdmin({ onBack }: { onBack: () => void }) {
  const todayYmd = getTodayYmd();
  const currentMonthYm = getCurrentYearMonth();

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthYm);
  const [rows, setRows] = useState<FieldServiceConductor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // 날짜별 인라인 편집 상태
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editType, setEditType] = useState<FieldServiceSpecialType>("");
  const [editMeetingLabel, setEditMeetingLabel] = useState<string>("");
  const [editConductorName, setEditConductorName] = useState<string>("");
  const [editSpecialLabel, setEditSpecialLabel] = useState<string>("");

  // 상단 '특별 행사 추가' 폼 상태
  const [addingSpecial, setAddingSpecial] = useState(false);
  const [newSpecialDate, setNewSpecialDate] = useState<string>(todayYmd);
  const [newSpecialType, setNewSpecialType] = useState<FieldServiceSpecialType>("special_event");
  const [newSpecialLabel, setNewSpecialLabel] = useState<string>("특별모임");
  const [newSpecialMeeting, setNewSpecialMeeting] = useState<string>("");

  async function reload(ym: string) {
    setLoading(true);
    try {
      const { from, to } = getMonthRange(ym);
      const list = await fetchFieldServiceConductors(from, to);
      setRows(list);
    } catch (e) {
      setError(friendlyError(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    deletePastFieldServiceConductors(getTodayYmd()).then(() => {
      reload(selectedMonth);
    });
  }, []);

  useEffect(() => {
    reload(selectedMonth);
    setEditingDate(null);
    setAddingSpecial(false);
  }, [selectedMonth]);

  const rowByDate = useMemo(() => {
    const map = new Map<string, FieldServiceConductor>();
    for (const r of rows) {
      map.set(r.service_date, r);
    }
    return map;
  }, [rows]);

  /** 선택한 월의 오늘 이후 모든 날짜 (월~일) */
  const upcomingDays = useMemo(() => {
    const { year, month, daysInMonth } = getMonthRange(selectedMonth);
    const mm = String(month).padStart(2, "0");
    const list: {
      serviceDate: string;
      day: number;
      dow: number;
      defaultMeetingLabel: string;
    }[] = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const serviceDate = `${year}-${mm}-${String(d).padStart(2, "0")}`;
      if (serviceDate < todayYmd) continue;
      const jsDay = new Date(year, month - 1, d).getDay();
      const dow = jsDay === 0 ? 7 : jsDay;
      list.push({
        serviceDate,
        day: d,
        dow,
        defaultMeetingLabel: FIELD_MEETING_LABELS[dow] ?? "",
      });
    }
    return list;
  }, [selectedMonth, todayYmd]);

  /** 이번 달 등록된 특별 행사 목록 (집단봉사 · 특별 행사 · 봉사 없음) */
  const specialEvents = useMemo(() => {
    return rows
      .filter((r) => r.service_date >= todayYmd && r.special_type !== "")
      .sort((a, b) => a.service_date.localeCompare(b.service_date));
  }, [rows, todayYmd]);

  function openEdit(serviceDate: string, dow: number) {
    const existing = rowByDate.get(serviceDate);
    setEditingDate(serviceDate);
    setAddingSpecial(false);
    setError("");
    setMsg("");

    if (existing) {
      setEditType(existing.special_type);
      setEditMeetingLabel(existing.meeting_label || FIELD_MEETING_LABELS[dow] || "");
      setEditConductorName(existing.conductor_name || "");
      setEditSpecialLabel(existing.special_label || "");
    } else {
      setEditType(dow === 1 ? "none" : "");
      setEditMeetingLabel(FIELD_MEETING_LABELS[dow] ?? "");
      setEditConductorName("");
      setEditSpecialLabel("");
    }
  }

  async function handleSaveEdit() {
    if (!editingDate) return;
    if (editType === "" && !editConductorName.trim()) {
      setError("인도자 형제 이름을 입력하거나, 일정 유형을 변경해 주세요.");
      return;
    }
    if (editType === "special_event" && !editSpecialLabel.trim()) {
      setError("특별 행사 이름을 입력해 주세요. (예: 특별모임, 순회대회)");
      return;
    }

    const finalSpecialLabel =
      editType === "group_service"
        ? "집단봉사"
        : editType === "none"
        ? "봉사 없음"
        : editType === "special_event"
        ? editSpecialLabel.trim()
        : "";

    setBusy(true);
    setError("");
    setMsg("");
    try {
      await upsertFieldServiceConductor({
        service_date: editingDate,
        meeting_label: editMeetingLabel.trim(),
        conductor_name: editType === "" ? editConductorName.trim().replace(/\s*형제$/, "") : "",
        special_type: editType,
        special_label: finalSpecialLabel,
      });
      setMsg(`${editingDate} 호별봉사 일정이 저장되었습니다.`);
      setEditingDate(null);
      await reload(selectedMonth);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  async function handleDelete(serviceDate: string) {
    if (!window.confirm(`${serviceDate}에 저장된 호별봉사·행사 정보를 삭제할까요?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await deleteFieldServiceConductor(serviceDate);
      if (editingDate === serviceDate) setEditingDate(null);
      setMsg(`${serviceDate} 정보가 삭제되었습니다.`);
      await reload(selectedMonth);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  function openAddSpecialForm() {
    const firstDate = upcomingDays[0]?.serviceDate ?? todayYmd;
    const firstDow = upcomingDays[0]?.dow ?? 7;
    setNewSpecialDate(firstDate);
    setNewSpecialType("special_event");
    setNewSpecialLabel("특별모임");
    setNewSpecialMeeting(FIELD_MEETING_LABELS[firstDow] ?? "");
    setAddingSpecial(true);
    setEditingDate(null);
    setError("");
    setMsg("");
  }

  async function handleSaveNewSpecial() {
    if (!newSpecialDate) return;
    if (newSpecialType === "special_event" && !newSpecialLabel.trim()) {
      setError("특별 행사 이름을 입력해 주세요.");
      return;
    }
    const finalLabel =
      newSpecialType === "group_service"
        ? "집단봉사"
        : newSpecialType === "none"
        ? "봉사 없음"
        : newSpecialLabel.trim();

    setBusy(true);
    setError("");
    setMsg("");
    try {
      await upsertFieldServiceConductor({
        service_date: newSpecialDate,
        meeting_label: newSpecialMeeting.trim(),
        conductor_name: "",
        special_type: newSpecialType,
        special_label: finalLabel,
      });
      setAddingSpecial(false);
      setMsg(`${newSpecialDate}에 '${finalLabel}'이(가) 등록되었습니다.`);
      await reload(selectedMonth);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  const { year, month } = getMonthRange(selectedMonth);

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 10, alignItems: "center" }}>
        <button className="btn-line" style={{ padding: "6px 12px", minHeight: 0 }} onClick={onBack}>
          ← 뒤로
        </button>
        <div style={{ fontWeight: 700, fontSize: 16 }}>🏠 호별봉사 관리</div>
        <div style={{ width: 60 }} />
      </div>

      <div className="muted" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        봉사자 계정 상단에 표시되는 <b>오늘의 호별봉사 인도자 · 봉사모임 시간 · 특별 행사</b>를
        확인하고 수정할 수 있습니다.
        <br />
        💡 매달 사진 1장으로 한 번에 입력하려면 <b>전시대 관리 → 사진으로 자동 입력</b>을
        이용하세요.
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      {/* 월 선택 바 */}
      <div
        className="row-between"
        style={{
          marginBottom: 14,
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
          disabled={busy || selectedMonth <= currentMonthYm}
          onClick={() => setSelectedMonth((m) => shiftYearMonth(m, -1))}
        >
          ◀ 이전 달
        </button>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {year}년 {month}월
        </div>
        <button
          className="btn-line"
          style={{ padding: "6px 10px", minHeight: 0, fontSize: 13 }}
          disabled={busy}
          onClick={() => setSelectedMonth((m) => shiftYearMonth(m, 1))}
        >
          다음 달 ▶
        </button>
      </div>

      {/* 1. 이번 달 특별 행사 확인 및 수정 */}
      <div
        className="row-between"
        style={{ marginBottom: 8, alignItems: "center" }}
      >
        <div className="section-title" style={{ margin: 0 }}>
          📢 {month}월 특별 행사 확인 ({specialEvents.length}건)
        </div>
        {upcomingDays.length > 0 && (
          <button
            className="btn-primary"
            style={{ width: "auto", padding: "6px 12px", minHeight: 0, fontSize: 13 }}
            disabled={busy}
            onClick={() => (addingSpecial ? setAddingSpecial(false) : openAddSpecialForm())}
          >
            {addingSpecial ? "닫기" : "+ 특별 행사 추가"}
          </button>
        )}
      </div>

      {addingSpecial && (
        <div className="card" style={{ marginBottom: 14, borderColor: "#3b82f6" }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            새 특별 행사 등록
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12 }}>날짜 선택</label>
            <select
              value={newSpecialDate}
              onChange={(e) => {
                const d = e.target.value;
                setNewSpecialDate(d);
                const found = upcomingDays.find((x) => x.serviceDate === d);
                if (found) setNewSpecialMeeting(found.defaultMeetingLabel);
              }}
            >
              {upcomingDays.map((d) => (
                <option key={d.serviceDate} value={d.serviceDate}>
                  {month}월 {d.day}일 ({DAY_SHORT[d.dow]})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12 }}>행사 유형</label>
            <select
              value={newSpecialType}
              onChange={(e) => {
                const v = e.target.value as FieldServiceSpecialType;
                setNewSpecialType(v);
                if (v === "group_service") setNewSpecialLabel("집단봉사");
                else if (v === "special_event" && (!newSpecialLabel || newSpecialLabel === "집단봉사")) {
                  setNewSpecialLabel("특별모임");
                }
              }}
            >
              <option value="special_event">📢 특별 행사 (특별모임·대회·기념식 등)</option>
              <option value="group_service">👥 집단봉사 (인도자 이름 미표시)</option>
              <option value="none">🚫 회중 봉사 마련 없음</option>
            </select>
          </div>
          {newSpecialType === "special_event" && (
            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>행사 이름 (봉사자 계정에 그대로 표시)</label>
              <input
                type="text"
                value={newSpecialLabel}
                onChange={(e) => setNewSpecialLabel(e.target.value)}
                placeholder="예: 특별모임, 순회대회, 지역대회"
              />
            </div>
          )}
          {newSpecialType === "group_service" && (
            <div className="field" style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>봉사모임 시간 문구 (선택)</label>
              <input
                type="text"
                value={newSpecialMeeting}
                onChange={(e) => setNewSpecialMeeting(e.target.value)}
                placeholder="예: 일요일 주말 집회 이후 봉사모임"
              />
            </div>
          )}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn-primary" disabled={busy} onClick={handleSaveNewSpecial}>
              저장
            </button>
            <button className="btn-line" disabled={busy} onClick={() => setAddingSpecial(false)}>
              취소
            </button>
          </div>
        </div>
      )}

      {specialEvents.length === 0 ? (
        <div
          className="card"
          style={{
            marginBottom: 18,
            padding: "12px 14px",
            background: "var(--c-surface)",
            fontSize: 13,
          }}
        >
          <span className="muted">이 달에 등록된 특별 행사가 없습니다.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
          {specialEvents.map((ev) => {
            const [yy, mm, dd] = ev.service_date.split("-").map(Number);
            const jsDay = new Date(yy, mm - 1, dd).getDay();
            const dow = jsDay === 0 ? 7 : jsDay;
            const isGroup = ev.special_type === "group_service";
            const isNone = ev.special_type === "none";
            return (
              <div
                key={ev.service_date}
                className="card"
                style={{
                  marginBottom: 0,
                  padding: "10px 12px",
                  background: isGroup ? "#fffbeb" : isNone ? "var(--c-surface)" : "#eff6ff",
                  borderColor: isGroup ? "#f59e0b" : isNone ? "var(--c-border)" : "#93c5fd",
                }}
              >
                <div className="row-between" style={{ alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {mm}월 {dd}일 ({DAY_SHORT[dow]}) ·{" "}
                      <span
                        style={{
                          color: isGroup ? "#b45309" : isNone ? "var(--c-muted)" : "#1d4ed8",
                        }}
                      >
                        {isGroup
                          ? "👥 집단봉사"
                          : isNone
                          ? "🚫 봉사 마련 없음"
                          : `📢 ${ev.special_label || "특별 행사"}`}
                      </span>
                    </div>
                    {ev.meeting_label && !isNone && (
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        ⏰ {ev.meeting_label}
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn-line"
                      style={{ padding: "4px 9px", minHeight: 0, fontSize: 12 }}
                      disabled={busy}
                      onClick={() => openEdit(ev.service_date, dow)}
                    >
                      수정
                    </button>
                    <button
                      className="btn-line"
                      style={{
                        padding: "4px 9px",
                        minHeight: 0,
                        fontSize: 12,
                        color: "var(--c-danger)",
                        borderColor: "var(--c-danger)",
                      }}
                      disabled={busy}
                      onClick={() => handleDelete(ev.service_date)}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 2. 날짜별 호별봉사 인도자 및 봉사모임 시간 수정 */}
      <div className="section-title" style={{ marginBottom: 8 }}>
        📅 {month}월 날짜별 호별봉사 인도자 · 모임 시간
      </div>

      {loading ? (
        <div className="muted" style={{ padding: "10px 0" }}>
          호별봉사 일정 불러오는 중…
        </div>
      ) : upcomingDays.length === 0 ? (
        <div className="muted" style={{ padding: "10px 0", fontSize: 13 }}>
          이 달에 남아 있는 예정 날짜가 없습니다. (이미 지난 날짜는 자동 삭제됩니다)
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {upcomingDays.map((slot) => {
            const info = rowByDate.get(slot.serviceDate);
            const isEditing = editingDate === slot.serviceDate;
            const isMonday = slot.dow === 1;
            const effectiveType: FieldServiceSpecialType =
              info?.special_type ?? (isMonday ? "none" : "");
            const effectiveMeeting = info?.meeting_label || slot.defaultMeetingLabel;

            return (
              <div
                key={slot.serviceDate}
                className="card"
                style={{
                  padding: "10px 12px",
                  marginBottom: 0,
                  background:
                    effectiveType === "group_service"
                      ? "#fffbeb"
                      : effectiveType === "special_event"
                      ? "#eff6ff"
                      : effectiveType === "none"
                      ? "var(--c-surface)"
                      : undefined,
                }}
              >
                {isEditing ? (
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                      {month}월 {slot.day}일 ({DAY_SHORT[slot.dow]}) 수정
                    </div>

                    <div className="field" style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 12 }}>일정 유형</label>
                      <select
                        value={editType}
                        onChange={(e) => {
                          const v = e.target.value as FieldServiceSpecialType;
                          setEditType(v);
                          if (v === "group_service") setEditSpecialLabel("집단봉사");
                          else if (v === "special_event" && !editSpecialLabel) {
                            setEditSpecialLabel("특별모임");
                          }
                        }}
                      >
                        <option value="">🏠 일반 호별봉사</option>
                        <option value="group_service">👥 집단봉사 (인도자 미표시)</option>
                        <option value="special_event">📢 특별 행사 (특별모임·대회 등)</option>
                        <option value="none">🚫 회중 봉사 마련 없음</option>
                      </select>
                    </div>

                    {editType !== "none" && (
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>봉사모임 시간 문구</label>
                        <input
                          type="text"
                          value={editMeetingLabel}
                          onChange={(e) => setEditMeetingLabel(e.target.value)}
                          placeholder="예: 화요일 오전 10시 봉사모임"
                        />
                      </div>
                    )}

                    {editType === "" && (
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>호별봉사 인도자 형제 이름</label>
                        <input
                          type="text"
                          value={editConductorName}
                          onChange={(e) => setEditConductorName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                          placeholder="예: 강영출"
                          autoFocus
                        />
                      </div>
                    )}

                    {editType === "special_event" && (
                      <div className="field" style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 12 }}>특별 행사 이름</label>
                        <input
                          type="text"
                          value={editSpecialLabel}
                          onChange={(e) => setEditSpecialLabel(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                          placeholder="예: 특별모임, 순회대회, 지역대회"
                          autoFocus
                        />
                      </div>
                    )}

                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn-primary"
                        disabled={busy}
                        onClick={handleSaveEdit}
                      >
                        저장
                      </button>
                      <button
                        className="btn-line"
                        disabled={busy}
                        onClick={() => setEditingDate(null)}
                      >
                        취소
                      </button>
                      {info && (
                        <button
                          className="btn-line"
                          style={{
                            color: "var(--c-danger)",
                            borderColor: "var(--c-danger)",
                          }}
                          disabled={busy}
                          onClick={() => handleDelete(slot.serviceDate)}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="row-between" style={{ alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 14 }}>
                      <strong>
                        {month}월 {slot.day}일 ({DAY_SHORT[slot.dow]})
                      </strong>
                      {effectiveType !== "none" && effectiveMeeting && (
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          ⏰ {effectiveMeeting}
                        </div>
                      )}
                      <div style={{ marginTop: 2, fontSize: 13 }}>
                        {effectiveType === "none" ? (
                          <span className="muted">회중 봉사 마련 없음</span>
                        ) : effectiveType === "group_service" ? (
                          <span style={{ color: "#b45309", fontWeight: 700 }}>
                            👥 집단봉사
                          </span>
                        ) : effectiveType === "special_event" ? (
                          <span style={{ color: "#1d4ed8", fontWeight: 700 }}>
                            📢 {info?.special_label || "특별 행사"}
                          </span>
                        ) : info?.conductor_name ? (
                          <span style={{ color: "var(--c-primary)", fontWeight: 700 }}>
                            👤 {info.conductor_name} 형제
                          </span>
                        ) : (
                          <span className="muted">인도자 미배정</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="btn-line"
                      style={{ padding: "5px 12px", minHeight: 0, fontSize: 13, flexShrink: 0 }}
                      disabled={busy}
                      onClick={() => openEdit(slot.serviceDate, slot.dow)}
                    >
                      수정
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
