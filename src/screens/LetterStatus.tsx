import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchLetterHistory, fetchLetterUnits, toggleLetterStop } from "../api";
import type { LetterHistoryRow, LetterUnitStatus } from "../api";
import { friendlyError } from "../errors";
import { supabase } from "../supabase";
import { EMAIL_TO_ROLE } from "../config";

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

export default function LetterStatus() {
  const [units, setUnits] = useState<LetterUnitStatus[]>([]);
  const [history, setHistory] = useState<LetterHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [round, setRound] = useState(1);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  async function doToggleStop(unitId: string, current: boolean) {
    if (!isAdmin) return;
    if (!window.confirm(`이 세대(호수)의 편지 발송을 ${current ? "다시 배정되도록 해제" : "중단(배정 제외)"}하시겠습니까?`)) return;
    try {
      await toggleLetterStop(unitId, !current);
      setUnits((us) => us.map(u => u.id === unitId ? { ...u, is_stopped: !current } : u));
    } catch (e) {
      alert(friendlyError(e));
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setIsAdmin(EMAIL_TO_ROLE[data.session.user.email ?? ""] === "admin");
      }
    });

    Promise.all([fetchLetterUnits(), fetchLetterHistory()])
      .then(([u, h]) => {
        setUnits(u);
        setHistory(h);
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <div className="loading">편지봉사 현황을 불러오는 중...</div>;
  if (error) return <div className="error-msg">{error}</div>;

  const totalPct = units.length ? (100 * totalDone) / units.length : 0;
  const shown = showAll ? filtered : filtered.slice(0, 50);

  return (
    <div>
      <div className="round-tabs">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} className={round === n ? "active" : ""} onClick={() => { setRound(n); setExpanded(null); }}>
            {n}차
          </button>
        ))}
      </div>

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
                      <div style={{ padding: "6px 10px" }}>
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
                                {u.is_stopped && <span style={{ marginLeft: 6, fontSize: "0.8em", color: "var(--c-danger)" }}>(중단됨)</span>}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <span style={{ color: info ? "var(--c-text)" : "#aaa", fontSize: "0.9em" }}>
                                  {info ? `${fmtDate(info.date)} · ${info.pub ?? "?"}` : "미완료"}
                                </span>
                                {isAdmin && (
                                  <button
                                    className="btn-line"
                                    style={{ padding: "2px 6px", fontSize: "0.75em" }}
                                    onClick={() => doToggleStop(u.id, u.is_stopped)}
                                  >
                                    {u.is_stopped ? "해제" : "중단"}
                                  </button>
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
    </div>
  );
}
