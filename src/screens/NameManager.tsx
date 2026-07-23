import { useEffect, useState } from "react";
import {
  addConductor,
  addPublisher,
  fetchConductors,
  fetchPublishers,
  removeConductor,
  removePublisher,
} from "../api";
import { invalidateNameCaches } from "../lists";
import type { Conductor, Publisher } from "../types";
import { friendlyError } from "../errors";

export default function NameManager({ onBack }: { onBack: () => void }) {
  const [conductors, setConductors] = useState<Conductor[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [newCond, setNewCond] = useState("");
  const [newPub, setNewPub] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [cs, ps] = await Promise.all([fetchConductors(), fetchPublishers()]);
    setConductors(cs);
    setPublishers(ps);
    invalidateNameCaches();
  }

  useEffect(() => {
    reload().catch((e) => setError(friendlyError(e)));
  }, []);

  async function run(op: () => Promise<void>, okMsg: string) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await op();
      await reload();
      setMsg(okMsg);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  function addC() {
    if (!newCond.trim()) return;
    const name = newCond.trim();
    run(() => addConductor(name), `인도자 '${name}' 추가됨`).then(() => setNewCond(""));
  }
  function addP() {
    if (!newPub.trim()) return;
    const name = newPub.trim();
    run(() => addPublisher(name), `전도인 '${name}' 추가됨`).then(() => setNewPub(""));
  }

  async function delC(c: Conductor) {
    if (!window.confirm(`인도자 '${c.name}'을(를) 삭제할까요?`)) return;
    run(async () => {
      const r = await removeConductor(c.id);
      setMsg(r === "hidden" ? `'${c.name}'은 기록이 있어 목록에서 숨김 처리했습니다.` : `'${c.name}' 삭제됨`);
    }, "");
  }
  async function delP(p: Publisher) {
    if (!window.confirm(`전도인 '${p.name}'을(를) 삭제할까요?`)) return;
    run(async () => {
      const r = await removePublisher(p.id);
      setMsg(r === "hidden" ? `'${p.name}'은 기록이 있어 목록에서 숨김 처리했습니다.` : `'${p.name}' 삭제됨`);
    }, "");
  }

  return (
    <div>
      <button className="btn-line" onClick={onBack}>
        ← 관리자 화면으로
      </button>
      <h2 className="section-title">명단 관리</h2>
      <div className="notice">
        이름을 추가하거나 삭제합니다. 방문·배정 기록이 있는 사람은 완전히 지워지지
        않고 <b>목록에서만 숨겨집니다</b> (기록 보존).
      </div>
      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      <div className="section-title">봉사 인도자 ({conductors.length}명)</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          type="text"
          value={newCond}
          onChange={(e) => setNewCond(e.target.value)}
          placeholder="인도자 이름 추가"
        />
        <button className="btn-primary" style={{ width: "auto", flexShrink: 0 }} disabled={busy} onClick={addC}>
          추가
        </button>
      </div>
      {conductors.map((c) => (
        <div key={c.id} className="card-item">
          <span className="name">{c.name}</span>
          <button
            className="btn-line"
            style={{ color: "var(--c-danger)", borderColor: "var(--c-danger)", flexShrink: 0 }}
            disabled={busy}
            onClick={() => delC(c)}
          >
            삭제
          </button>
        </div>
      ))}

      <div className="section-title">전도인 ({publishers.length}명)</div>
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          type="text"
          value={newPub}
          onChange={(e) => setNewPub(e.target.value)}
          placeholder="전도인 이름 추가"
        />
        <button className="btn-primary" style={{ width: "auto", flexShrink: 0 }} disabled={busy} onClick={addP}>
          추가
        </button>
      </div>
      {publishers.map((p) => (
        <div key={p.id} className="card-item">
          <span className="name">{p.name}</span>
          <button
            className="btn-line"
            style={{ color: "var(--c-danger)", borderColor: "var(--c-danger)", flexShrink: 0 }}
            disabled={busy}
            onClick={() => delP(p)}
          >
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}
