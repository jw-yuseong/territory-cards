import { useState } from "react";
import { supabase } from "../supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.");
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <h1>구역카드 관리</h1>
      <div className="field">
        <label>이메일</label>
        <input
          type="email"
          value={email}
          autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일 주소"
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
      <button className="btn-primary" onClick={signIn} disabled={busy || !email || !password}>
        {busy ? "로그인 중..." : "로그인"}
      </button>
    </div>
  );
}
