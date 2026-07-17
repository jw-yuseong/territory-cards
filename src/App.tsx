import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { CONFIG_OK } from "./config";
import { fetchIsAdmin } from "./api";
import Login from "./screens/Login";
import PublisherScreen from "./screens/PublisherScreen";
import ConductorScreen from "./screens/ConductorScreen";
import AdminScreen from "./screens/AdminScreen";

type Tab = "publisher" | "conductor" | "admin";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<Tab>("publisher");
  const [bigFont, setBigFont] = useState(
    () => localStorage.getItem("fontMode") === "big"
  );

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

  useEffect(() => {
    if (session) fetchIsAdmin().then(setIsAdmin);
    else setIsAdmin(false);
  }, [session]);

  function toggleFont() {
    const next = !bigFont;
    setBigFont(next);
    document.documentElement.classList.toggle("big", next);
    localStorage.setItem("fontMode", next ? "big" : "normal");
  }

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
          <button onClick={toggleFont}>{bigFont ? "일반 글씨" : "큰 글씨"}</button>
        </header>
        <Login />
      </>
    );
  }

  return (
    <>
      <header className="header">
        <h1>구역카드</h1>
        <button onClick={toggleFont}>{bigFont ? "일반 글씨" : "큰 글씨"}</button>
        <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
      </header>

      <main className="screen">
        {tab === "publisher" && <PublisherScreen />}
        {tab === "conductor" && <ConductorScreen />}
        {tab === "admin" && isAdmin && <AdminScreen />}
      </main>

      <nav className="tabbar">
        <button
          className={tab === "publisher" ? "active" : ""}
          onClick={() => setTab("publisher")}
        >
          봉사 기록
        </button>
        <button
          className={tab === "conductor" ? "active" : ""}
          onClick={() => setTab("conductor")}
        >
          인도자
        </button>
        {isAdmin && (
          <button
            className={tab === "admin" ? "active" : ""}
            onClick={() => setTab("admin")}
          >
            관리자
          </button>
        )}
      </nav>
    </>
  );
}
