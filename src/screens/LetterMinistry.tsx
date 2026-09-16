import { useEffect, useMemo, useState } from "react";
import { fetchLetterUnits, letterAssign } from "../api";
import type { LetterUnitStatus } from "../api";
import type { Publisher } from "../types";
import { matchName } from "../chosung";
import { friendlyError } from "../errors";
import LetterHistory from "./LetterHistory";
import LetterStatus from "./LetterStatus";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
function numMark(i: number): string {
  return i < CIRCLED.length ? CIRCLED[i] : `${i + 1}.`;
}

// 선정: 중단된 집 제외 + 마지막 편지가 오래된 순(한 번도 안 쓴 집 최우선) + 한 건물당 1집
function pickHouses(units: LetterUnitStatus[], n: number): LetterUnitStatus[] {
  const available = units.filter(u => !u.is_stopped);
  const sorted = [...available].sort((a, b) => {
    const aw = a.last_written;
    const bw = b.last_written;
    if (aw === null && bw !== null) return -1;
    if (aw !== null && bw === null) return 1;
    if (aw !== null && bw !== null && aw !== bw) return aw < bw ? -1 : 1;
    return a.seq_no - b.seq_no;
  });
  const picked: LetterUnitStatus[] = [];
  const usedBuildings = new Set<string>();
  for (const u of sorted) {
    if (usedBuildings.has(u.building)) continue;
    picked.push(u);
    usedBuildings.add(u.building);
    if (picked.length >= n) break;
  }
  return picked;
}

// '2026-04-08' -> '26.4.8' (안 쓴 집은 '없음')
function fmtLast(d: string | null): string {
  if (!d) return "없음";
  const [y, m, day] = d.split("-");
  return `${y.slice(2)}.${Number(m)}.${Number(day)}`;
}

function buildMessage(picked: LetterUnitStatus[], pubName: string): string {
  const head = `📮 편지봉사 배정 — ${pubName} (${today()})`;
  const lines = picked.map((u, i) => {
    const postal = u.postal ? ` (우 ${u.postal})` : "";
    return `${numMark(i)} ${u.building}, ${u.ho}호${postal}`;
  });
  return [head, ...lines].join("\n");
}

export default function LetterMinistry({ publishers, isAdmin = false }: { publishers: Publisher[], isAdmin?: boolean }) {
  const [mode, setMode] = useState<"pick" | "history" | "status">("pick");
  const [units, setUnits] = useState<LetterUnitStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pubQuery, setPubQuery] = useState("");
  const [publisherId, setPublisherId] = useState("");
  const [count, setCount] = useState(4);
  const [picked, setPicked] = useState<LetterUnitStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  async function load() {
    setLoading(true);
    try {
      setUnits(await fetchLetterUnits());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/letter_units|v_letter_unit_status|schema cache|PGRST205/i.test(msg)) {
        setError("편지봉사 데이터가 아직 준비되지 않았습니다. 관리자가 DB 설정(SQL)을 실행해야 합니다.");
      } else {
        setError(friendlyError(e));
      }
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const filteredPubs = useMemo(
    () => publishers.filter((p) => matchName(p.name, pubQuery)),
    [publishers, pubQuery]
  );
  const pubName = publishers.find((p) => p.id === publisherId)?.name ?? "";

  const availableUnits = useMemo(() => units.filter(u => !u.is_stopped), [units]);
  const buildings = useMemo(() => new Set(availableUnits.map((u) => u.building)).size, [availableUnits]);
  const neverWritten = useMemo(() => availableUnits.filter((u) => u.last_written === null).length, [availableUnits]);

  function doPick() {
    setDone("");
    setError("");
    if (units.length === 0) {
      setError("편지봉사 데이터가 아직 없습니다. 관리자가 DB 설정(SQL)을 실행해야 합니다.");
      return;
    }
    const n = Math.max(1, Math.min(20, count || 4));
    const result = pickHouses(units, n);
    if (result.length < n) {
      setError(`서로 다른 건물이 ${result.length}곳뿐이라 ${result.length}집만 뽑았습니다.`);
    }
    setPicked(result);
  }

  async function copyAndRecord() {
    if (!picked || picked.length === 0 || !publisherId) return;
    setBusy(true);
    setError("");
    setDone("");
    const message = buildMessage(picked, pubName);
    try {
      // 1) 클립보드 복사 (실패해도 기록은 진행)
      let copied = false;
      try {
        await navigator.clipboard.writeText(message);
        copied = true;
      } catch {
        copied = false;
      }
      // 2) 편지 이력 기록
      await letterAssign(picked.map((u) => u.id), today(), publisherId);
      setDone(
        (copied ? "복사 완료 & " : "") +
          `${pubName} 님에게 ${picked.length}집 기록했습니다.` +
          (copied ? " 문자에 붙여넣기 하세요." : " (자동 복사가 안 돼 아래 내용을 길게 눌러 복사하세요.)")
      );
      setPicked(null);
      setPubQuery("");
      setPublisherId("");
      await load(); // 마지막 편지날짜 갱신
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  const message = picked ? buildMessage(picked, pubName || "○○○") : "";

  const subTabs = (
    <div className="round-tabs">
      <button className={mode === "pick" ? "active" : ""} onClick={() => setMode("pick")}>
        집 뽑기
      </button>
      <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}>
        기록 취소
      </button>
      <button className={mode === "status" ? "active" : ""} onClick={() => setMode("status")}>
        전체 현황
      </button>
    </div>
  );

  if (mode === "history") {
    return (
      <div>
        {subTabs}
        <LetterHistory publishers={publishers} />
      </div>
    );
  }

  if (mode === "status") {
    return (
      <div>
        {subTabs}
        <LetterStatus isAdmin={isAdmin} />
      </div>
    );
  }

  if (loading)
    return (
      <div>
        {subTabs}
        <div className="loading">편지봉사 세대를 불러오는 중...</div>
      </div>
    );

  return (
    <div>
      {subTabs}
      <div className="notice">
        전도인을 고르고 집 수를 정한 뒤 <b>집 뽑기</b>를 누르면, 편지를 오래 못 받은
        집을 <b>건물마다 1집씩</b> 자동으로 골라줍니다. 총 {units.length}세대 ·{" "}
        {buildings}건물 · 아직 안 쓴 집 {neverWritten}곳.
      </div>
      {error && <div className="error-msg">{error}</div>}

      <div className="field">
        <label>
          전도인 (편지 쓸 사람)
          {pubName && <span style={{ color: "var(--c-primary)" }}> — 선택: {pubName}</span>}
        </label>
        <input
          type="text"
          value={pubQuery}
          onChange={(e) => setPubQuery(e.target.value)}
          placeholder="이름 또는 초성 (예: ㅅㅎㅂ)"
        />
        <div
          style={{
            maxHeight: 200,
            overflowY: "auto",
            border: "1px solid var(--c-border)",
            borderRadius: 10,
            marginTop: 6,
          }}
        >
          {filteredPubs.length === 0 && (
            <div className="muted" style={{ padding: 10 }}>검색 결과가 없습니다</div>
          )}
          {filteredPubs.map((p) => (
            <button
              key={p.id}
              className={`choice-btn ${publisherId === p.id ? "selected" : ""}`}
              style={{ marginBottom: 0, borderRadius: 0, border: "none", borderBottom: "1px solid var(--c-border)" }}
              onClick={() => setPublisherId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ flex: 1 }}>
          <label>집 수</label>
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <button
          className="btn-primary"
          style={{ flex: 2 }}
          disabled={!publisherId || units.length === 0}
          onClick={doPick}
        >
          집 뽑기
        </button>
      </div>

      {picked && picked.length > 0 && (
        <div className="card-box" style={{ padding: 12, marginTop: 12 }}>
          <div className="section-title" style={{ marginTop: 0 }}>뽑은 집 ({picked.length})</div>
          {picked.map((u, i) => (
            <div key={u.id} className="card-item" style={{ cursor: "default" }}>
              <span className="card-no" style={{ minWidth: 28 }}>{numMark(i)}</span>
              <span className="name">
                {u.building}, {u.ho}호
                <div className="unit-meta">
                  {u.postal ? `우 ${u.postal} · ` : ""}지난 편지: {fmtLast(u.last_written)}
                  {u.letter_count > 0 ? ` (${u.letter_count}회)` : ""}
                </div>
              </span>
            </div>
          ))}

          <div className="notice" style={{ whiteSpace: "pre-line", marginTop: 10 }}>{message}</div>

          <button
            className="btn-primary"
            style={{ marginTop: 10 }}
            disabled={busy || !publisherId}
            onClick={copyAndRecord}
          >
            {busy ? "기록 중..." : "📋 복사 & 기록"}
          </button>
          <button
            className="choice-btn"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => setPicked(null)}
          >
            취소 (기록 안 함)
          </button>
        </div>
      )}

      {done && <div className="notice" style={{ marginTop: 12 }}>{done}</div>}
    </div>
  );
}
