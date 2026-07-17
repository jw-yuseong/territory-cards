import { useState } from "react";
import { supabase } from "../supabase";
import { ID_TO_EMAIL } from "../config";

export default function Login() {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError("");
    const id = loginId.trim();
    // 한글 아이디면 매핑된 이메일로, 이메일을 직접 입력했으면 그대로 사용
    const email = ID_TO_EMAIL[id] ?? id;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("로그인에 실패했습니다. 아이디와 비밀번호를 확인해 주세요.");
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <h1>구역카드 관리</h1>
      <div className="field">
        <label>아이디</label>
        <input
          type="text"
          value={loginId}
          autoComplete="username"
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="봉사자 / 봉사인도자 / 구역관리자"
        />
      </div>
      <div className="field">
        <label>비밀번호</label>
        <input
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && signIn()}
          placeholder="비밀번호"
        />
      </div>
      {error && <div className="error-msg">{error}</div>}
      <button className="btn-primary" onClick={signIn} disabled={busy || !loginId || !password}>
        {busy ? "로그인 중..." : "로그인"}
      </button>
    </div>
  );
}
