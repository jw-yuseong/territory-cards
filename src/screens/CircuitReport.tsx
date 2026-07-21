import { useState } from "react";
import { buildCircuitReport } from "../api";
import type { CircuitReportData } from "../api";

const CONGREGATION = "유성중앙";

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// '2026-04-11' -> '26. 4. 11'
function fmt(d: string | null): string {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${y.slice(2)}. ${Number(m)}. ${Number(day)}`;
}
function fmtLong(d: string | null): string {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${y.slice(2)}년 ${Number(m)}월 ${Number(day)}일`;
}
function monthsBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
}

export default function CircuitReport({ onBack }: { onBack: () => void }) {
  const [start, setStart] = useState("2025-09-01");
  const [end, setEnd] = useState(today());
  const [data, setData] = useState<CircuitReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      setData(await buildCircuitReport(start, end));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  const pct = data && data.total > 0 ? (100 * data.completedCount) / data.total : 0;
  const months = data && data.firstDate ? monthsBetween(data.firstDate, end) : 0;

  return (
    <div>
      <div className="no-print">
        <button className="btn-line" onClick={onBack}>
          ← 관리자 화면으로
        </button>
        <h2 className="section-title">순회 방문용 서류 만들기</h2>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>시작 기간</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>끝나는 기간</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <button className="btn-primary" disabled={loading} onClick={generate}>
          {loading ? "집계 중..." : "보고서 만들기"}
        </button>
        {error && <div className="error-msg">{error}</div>}
        {data && (
          <button
            className="btn-line"
            style={{ width: "100%", marginTop: 10, background: "#03c75a", borderColor: "#03c75a", color: "#fff" }}
            onClick={() => window.print()}
          >
            🖨 인쇄 / PDF로 저장
          </button>
        )}
      </div>

      {data && (
        <div className="print-area">
          <div className="report-head">
            <h1>구역 배정 기록 (순회 방문용)</h1>
            <div className="report-sub">
              {CONGREGATION} 회중 · 기간 {fmtLong(start)} ~ {fmtLong(end)}
            </div>
          </div>

          <table className="report-summary">
            <tbody>
              <tr>
                <th>총 구역카드 개수</th>
                <td>{data.total}개</td>
              </tr>
              <tr>
                <th>기록 첫 시작일</th>
                <td>{fmtLong(data.firstDate)}</td>
              </tr>
              <tr>
                <th>{fmtLong(end)}까지 완료한 카드 (약 {months}개월)</th>
                <td>
                  약 {data.completedCount}개 / 약 {pct.toFixed(1)}% 완료
                </td>
              </tr>
            </tbody>
          </table>

          <table className="report-table">
            <thead>
              <tr>
                <th style={{ width: "12%" }}>구역 번호</th>
                <th>구역명</th>
                <th style={{ width: "20%" }}>배정된 전도인</th>
                <th style={{ width: "18%" }}>완료 날짜</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className={r.completed_date ? "done" : ""}>
                  <td style={{ textAlign: "center" }}>{r.legacy_number ?? ""}</td>
                  <td>{r.name}</td>
                  <td style={{ textAlign: "center" }}>{r.publisher ?? ""}</td>
                  <td style={{ textAlign: "center" }}>{fmt(r.completed_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
