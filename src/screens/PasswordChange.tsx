import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { ID_TO_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";

const IDS = Object.keys(ID_TO_EMAIL);

export default function PasswordChange({ onBack }: { onBack: () => void }) {
  const [account, setAccount] = useState(IDS[0]);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function submit() {
    setError("");
    setMsg("");
    if (!curPw) {
      setError("현재 비밀번호를 입력해 주세요.");
      return;
    }
    if (newPw.length < 4) {
      setError("새 비밀번호는 4자 이상으로 해주세요.");
      return;
    }
    if (newPw !== newPw2) {
      setError("새 비밀번호 두 개가 서로 다릅니다. 다시 확인해 주세요.");
      return;
    }
    setBusy(true);
    // 지금 로그인한 세션(관리자)을 건드리지 않도록 별도 임시 클라이언트로 처리
    const temp = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const email = ID_TO_EMAIL[account];
      const { error: e1 } = await temp.auth.signInWithPassword({ email, password: curPw });
      if (e1) throw new Error("현재 비밀번호가 맞지 않습니다.");
      const { error: e2 } = await temp.auth.updateUser({ password: newPw });
      if (e2) throw new Error(e2.message);
      await temp.auth.signOut();
      setMsg(`'${account}' 계정 비밀번호가 변경되었습니다.`);
      setCurPw("");
      setNewPw("");
      setNewPw2("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div>
      <button className="btn-line" onClick={onBack}>
        ← 관리자 화면으로
      </button>
      <h2 className="section-title">계정 비밀번호 변경</h2>
      <div className="notice">
        바꿀 계정을 고르고, <b>그 계정의 현재 비밀번호</b>와 새 비밀번호(2번)를 입력하세요.
        비밀번호는 서버(Supabase)에만 저장되며 앱·GitHub에는 남지 않습니다.
      </div>

      <div className="field">
        <label>비밀번호를 바꿀 계정</label>
        <div className="round-tabs">
          {IDS.map((id) => (
            <button key={id} className={account === id ? "active" : ""} onClick={() => setAccount(id)}>
              {id}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>현재 비밀번호</label>
        <input type="password" value={curPw} autoComplete="off" onChange={(e) => setCurPw(e.target.value)} />
      </div>
      <div className="field">
        <label>새 비밀번호</label>
        <input type="password" value={newPw} autoComplete="new-password" onChange={(e) => setNewPw(e.target.value)} />
      </div>
      <div className="field">
        <label>새 비밀번호 다시 입력 (확인)</label>
        <input type="password" value={newPw2} autoComplete="new-password" onChange={(e) => setNewPw2(e.target.value)} />
      </div>

      {error && <div className="error-msg">{error}</div>}
      {msg && <div className="notice">{msg}</div>}

      <button className="btn-primary" disabled={busy} onClick={submit}>
        {busy ? "변경 중..." : "비밀번호 변경"}
      </button>
      <div className="muted" style={{ marginTop: 10 }}>
        ⚠ 변경 후에는 그 계정으로 로그인하는 모든 사람에게 새 비밀번호를 알려주세요.
        (봉사자·봉사인도자는 여러 사람이 공용으로 쓰는 계정입니다.)
      </div>
    </div>
  );
}
