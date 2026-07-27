import { SUPABASE_URL } from "./config";

// 기기 시계와 서버 시계 차이(초)를 확인한다.
// Supabase(PostgREST)는 로그인 토큰의 발급시각(iat)이 서버 시간보다 미래면
// 거부하는데, 이 검사는 서버 쪽 보안 장치라 클라이언트에서 "여유"를 늘릴 수
// 없다. 대신 여기서 미리 시계 차이를 재서, 문제가 될 만큼 크면(2분 이상)
// 실제 오류가 나기 전에 먼저 경고해 준다.
const SKEW_WARN_SECONDS = 120;

export async function checkClockSkew(): Promise<number | null> {
  try {
    const localBefore = Date.now();
    const res = await fetch(SUPABASE_URL + "/auth/v1/health", { method: "GET" });
    const serverDate = res.headers.get("date");
    if (!serverDate) return null;
    const serverMs = new Date(serverDate).getTime();
    const localMs = (localBefore + Date.now()) / 2; // 왕복 시간 절반 보정
    return Math.round((localMs - serverMs) / 1000); // 양수 = 기기가 더 빠름
  } catch {
    return null; // 네트워크 문제 등은 조용히 무시 (별도 오류로 다룸)
  }
}

export function clockSkewMessage(_skewSeconds: number): string {
  return "화면이 정상적으로 뜨지 않으면, 로그아웃한 뒤 다시 로그인해 주세요.";
}

export { SKEW_WARN_SECONDS };

// 자주 발생하는 오류를 사용자가 이해할 수 있는 한글 메시지로 바꾼다.
// (특히 "JWT issued at future"는 코드 버그가 아니라 기기 시계가 실제 시간보다
//  늦게 맞춰져 있을 때 Supabase 인증 라이브러리가 토큰을 거부하며 나는 오류)
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  if (/issued at future/i.test(msg) || /clock skew/i.test(msg)) {
    return "로그아웃한 뒤 다시 로그인해 주세요.";
  }
  if (/jwt expired/i.test(msg) || /invalid jwt/i.test(msg)) {
    return "로그인이 만료되었습니다. 로그아웃 후 다시 로그인해 주세요.";
  }
  if (/failed to fetch/i.test(msg) || /network/i.test(msg)) {
    return "인터넷 연결을 확인해 주세요.";
  }
  return msg;
}
