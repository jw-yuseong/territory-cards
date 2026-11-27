import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, tryRecoverSession } from "./supabase";
import { CONFIG_OK, EMAIL_TO_ROLE, Role } from "./config";
import Login from "./screens/Login";
import PublisherScreen from "./screens/PublisherScreen";
import ConductorScreen from "./screens/ConductorScreen";
import AdminScreen from "./screens/AdminScreen";
import CartScreen from "./screens/CartScreen";

type Tab = "publisher" | "conductor" | "admin" | "cart";

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
    let active = true;

    async function initSession() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      if (data.session) {
        // 기존 세션이 만료되었거나 곧 만료될 경우 미리 조용히 갱신 시도
        const expMs = (data.session.expires_at ?? 0) * 1000;
        if (expMs > 0 && expMs - Date.now() < 60 * 1000) {
          const recovered = await tryRecoverSession();
          if (!active) return;
          if (recovered) {
            const { data: latest } = await supabase.auth.getSession();
            if (!active) return;
            setSession(latest.session);
            setSessionReady(true);
            return;
          }
          // 갱신도 실패하면 만료된 세션을 정리해 깨끗하게 로그인 화면으로 이동
          await supabase.auth.signOut().catch(() => {});
          if (!active) return;
          setSession(null);
          setSessionReady(true);
          return;
        }
        setSession(data.session);
      } else {
        setSession(null);
      }
      setSessionReady(true);
    }

    initSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (active) setSession(s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const role: Role = EMAIL_TO_ROLE[session?.user.email ?? ""] ?? "publisher";

  // 역할이 바뀌면(다른 아이디로 로그인) 허용되지 않은 탭에 남지 않도록 초기화
  useEffect(() => {
    setTab(role === "cart" ? "cart" : "publisher");
  }, [session?.user.email, role]);

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
  const isCart = role === "cart";

  return (
    <>
      <header className="header">
        <h1>구역카드</h1>
        {fontButtons}
        <button onClick={() => supabase.auth.signOut()}>로그아웃</button>
      </header>

      <main className="screen">
        {isCart ? (
          <CartScreen />
        ) : (
          <>
            {tab === "publisher" && <PublisherScreen />}
            {tab === "conductor" && showConductor && <ConductorScreen isAdmin={showAdmin} />}
            {tab === "admin" && showAdmin && <AdminScreen />}
            {tab === "cart" && showConductor && (
              <CartScreen isAdmin={showAdmin} isConductor={showConductor} />
            )}
          </>
        )}
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
          {showConductor && (
            <button
              className={tab === "cart" ? "active" : ""}
              onClick={() => setTab("cart")}
            >
              전시대
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
