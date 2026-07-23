import { useRef, useState } from "react";
import { fetchAllRows } from "../api";
import { downloadBackup, restoreFromFile } from "../dbTransfer";
import type { RestoreSummary } from "../dbTransfer";
import { invalidateCardsCache } from "../lists";
import { friendlyError } from "../errors";

export default function DbBackup({ onBack }: { onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);

  async function doBackup() {
    setBusy(true);
    setError("");
    setDone("");
    setProgress("");
    try {
      await downloadBackup((m) => setProgress(m));
      setDone("백업 엑셀 파일이 다운로드되었습니다.");
    } catch (e) {
      setError(friendlyError(e));
    }
    setProgress("");
    setBusy(false);
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError("");
    setDone("");
    setPending(file);
  }

  async function doRestore() {
    if (!pending) return;
    if (
      !window.confirm(
        "정말 전체 리뉴얼을 진행할까요?\n\n현재 모든 구역카드·집·배정·방문기록이 삭제되고,\n" +
          "선택한 파일의 내용으로 완전히 교체됩니다.\n(인도자·전도인 명단은 유지됩니다.)"
      )
    )
      return;
    if (!window.confirm("⚠ 되돌릴 수 없습니다. 먼저 '전체 백업'을 받아두셨나요?\n계속하려면 확인을 눌러 주세요.")) return;

    setBusy(true);
    setError("");
    setDone("");
    try {
      setProgress("현재 명단 확인 중...");
      const [pubs, conds] = await Promise.all([fetchAllRows("publishers"), fetchAllRows("conductors")]);
      const pubIds = new Set(pubs.map((r) => String(r.id)));
      const condIds = new Set(conds.map((r) => String(r.id)));

      const summary: RestoreSummary = await restoreFromFile(pending, pubIds, condIds, (m) => setProgress(m));
      invalidateCardsCache();
      setPending(null);
      setDone(
        "전체 리뉴얼 완료! " +
          Object.entries(summary)
            .map(([t, n]) => `${label(t)} ${n}건`)
            .join(", ")
      );
    } catch (e) {
      setError(friendlyError(e));
    }
    setProgress("");
    setBusy(false);
  }

  return (
    <div>
      <button className="btn-line" onClick={onBack} disabled={busy}>
        ← 관리자 화면으로
      </button>
      <h2 className="section-title">DB 백업 / 전체 리뉴얼</h2>

      {/* 백업 */}
      <div className="card-box" style={{ padding: 12, marginBottom: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>전체 백업</div>
        <div className="notice">
          모든 테이블(명단·카드·집·배정·방문기록 등)을 <b>테이블별 시트</b>로 담은
          엑셀 파일을 내려받습니다. 이 파일이 곧 리뉴얼용 양식입니다.
        </div>
        <button className="btn-primary" disabled={busy} onClick={doBackup}>
          ⬇ 전체 백업 (엑셀 다운로드)
        </button>
      </div>

      {/* 리뉴얼 */}
      <div className="card-box" style={{ padding: 12, borderColor: "var(--c-danger)" }}>
        <div className="section-title" style={{ marginTop: 0, color: "var(--c-danger)" }}>
          전체 리뉴얼 (구역 데이터 교체)
        </div>
        <div className="notice">
          백업과 <b>같은 양식</b>의 엑셀 파일 하나로 <b>모든 구역카드·집·배정·방문기록을
          지우고</b> 새로 채웁니다. 인도자·전도인 명단과 주의사항 목록은 그대로 유지됩니다.
          <br />
          <b style={{ color: "var(--c-danger)" }}>되돌릴 수 없으니 먼저 위에서 백업을 받아 두세요.</b>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={onPickFile}
          disabled={busy}
          style={{ marginBottom: 10 }}
        />
        {pending && (
          <div className="notice" style={{ marginBottom: 10 }}>
            선택한 파일: <b>{pending.name}</b>
          </div>
        )}
        <button
          className="btn-primary"
          style={{ background: "var(--c-danger)", borderColor: "var(--c-danger)" }}
          disabled={busy || !pending}
          onClick={doRestore}
        >
          🔄 이 파일로 전체 리뉴얼
        </button>
      </div>

      {progress && <div className="notice" style={{ marginTop: 12 }}>{progress}</div>}
      {error && <div className="error-msg" style={{ marginTop: 12, whiteSpace: "pre-line" }}>{error}</div>}
      {done && <div className="notice" style={{ marginTop: 12 }}>{done}</div>}
    </div>
  );
}

function label(table: string): string {
  const m: Record<string, string> = {
    territory_cards: "카드",
    territory_units: "집",
    card_assignments: "배정",
    visit_records: "방문기록",
  };
  return m[table] ?? table;
}
