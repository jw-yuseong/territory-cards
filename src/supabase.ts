import { createClient } from "@supabase/supabase-js";
import { CONFIG_OK, ID_TO_EMAIL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// 키 입력 전에는 더미 값으로 클라이언트를 만들어 앱 자체는 뜨게 한다
// (App이 CONFIG_OK를 보고 설정 안내 화면을 보여줌)
export const supabase = createClient(
  CONFIG_OK ? SUPABASE_URL : "https://placeholder.supabase.co",
  CONFIG_OK ? SUPABASE_ANON_KEY : "placeholder-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);

let recoveringPromise: Promise<boolean> | null = null;

/**
 * 세션이 만료되었거나 토큰 검증 오류가 발생했을 때,
 * 1) refreshSession()으로 토큰 갱신을 시도하고
 * 2) 실패 시 이 기기에 비밀번호가 저장되어 있다면 백그라운드에서 자동 재로그인한다.
 */
export async function tryRecoverSession(): Promise<boolean> {
  if (recoveringPromise) return recoveringPromise;

  recoveringPromise = (async () => {
    try {
      const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr && refreshed.session) {
        return true;
      }
    } catch {
      // fall through to saved credential relogin
    }

    try {
      const lastId = localStorage.getItem("lastLoginId");
      if (!lastId) return false;
      const email = ID_TO_EMAIL[lastId];
      const savedPw = localStorage.getItem("savedPw_" + lastId);
      if (!email || !savedPw) return false;

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: savedPw,
      });
      return !error && Boolean(data.session);
    } catch {
      return false;
    }
  })().finally(() => {
    recoveringPromise = null;
  });

  return recoveringPromise;
}

export function isAuthTokenError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /jwt expired|invalid jwt|issued at future|clock skew|not authenticated|401/i.test(msg);
}
