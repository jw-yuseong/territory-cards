import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { CONFIG_OK, EMAIL_TO_ROLE, Role } from "./config";
import Login from "./screens/Login";
import PublisherScreen from "./screens/PublisherScreen";
import ConductorScreen from "./screens/ConductorScreen";
import AdminScreen from "./screens/AdminScreen";

type Tab = "publisher" | "conductor" | "admin";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [tab, setTab] = useState<Tab>("publisher");
  const [fontLevel, setFontLevel] = useState(() => {
    const saved = Number(localStorage.getItem("fontLevel"));
    if (saved >= 1 && saved <= 5) return saved;
    return localStorage.getItem("fontMode") === "big" ? 4 : 2;
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const role: Role = EMAIL_TO_ROLE[session?.user.email ?? ""] ?? "publisher";

  // 역할이 바뀌면(다른 아이디로 로그인) 허용되지 않은 탭에 남지 않도록 초기화
  useEffect(() => {
    setTab("publisher");
  }, [session?.user.email]);

  function changeFont(delta: number) {
    const next = Math.min(7, Math.max(1, fontLevel + delta));
    if (next === fontLevel) return;
    document.documentElement.classList.remove("font-" + fontLevel);
    document.documentElement.classList.add("font-" + next);
    setFontLevel(next);
    localStorage.setItem("fontLevel", String(next));
  }

  const fontButtons = (
    <>
      <button onClick={() => changeFont(-1)} disabled={fontLevel <= 1} aria-label="글씨 작게">
        가−
      </button>
      <button onClick={() => changeFont(1)} disabled={fontLevel >= 7} aria-label="글씨 크게">
        가＋
      </button>
    </>
  );

  if (!CONFIG_OK) {
    return (
      <div className="screen">
        <div className="notice">
          아직 Supabase 연결 정보가 설정되지 않았습니다.
          <br />
          <code>src/config.ts</code> 파일에 Supabase 프로젝트의 URL과 anon key를
          입력해 주세요.
        </div>
      </div>
    );
  }

  if (!sessionReady) return <div className="loading">불러오는 중...</div>;

  if (!session) {
    return (
      <>
        <header className="header">
          <h1>구역카드</h1>
          {fontButtons}
        </header>
        <Login />
      </>
    );
  }

  const showConductor = role === "conductor" || role === "admin";
  const showAdmin = role === "admin";

  return (
    <>
      <header className="header">
        <h1>구역카드</h1>
        {fontButtons}
        <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
      </header>

      <main className="screen">
        {tab === "publisher" && <PublisherScreen />}
        {tab === "conductor" && showConductor && <ConductorScreen />}
        {tab === "admin" && showAdmin && <AdminScreen />}
      </main>

      {(showConductor || showAdmin) && (
        <nav className="tabbar">
          <button
            className={tab === "publisher" ? "active" : ""}
            onClick={() => setTab("publisher")}
          >
            봉사 기록
          </button>
          {showConductor && (
            <button
              className={tab === "conductor" ? "active" : ""}
              onClick={() => setTab("conductor")}
            >
              인도자
            </button>
          )}
          {showAdmin && (
            <button
              className={tab === "admin" ? "active" : ""}
              onClick={() => setTab("admin")}
            >
              관리자
            </button>
          )}
        </nav>
      )}
    </>
  );
}
