// 자주 발생하는 오류를 사용자가 이해할 수 있는 한글 메시지로 바꾼다.
// (특히 "JWT issued at future"는 코드 버그가 아니라 기기 시계가 실제 시간보다
//  늦게 맞춰져 있을 때 Supabase 인증 라이브러리가 토큰을 거부하며 나는 오류)
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  if (/issued at future/i.test(msg) || /clock skew/i.test(msg)) {
    return "스마트폰의 날짜·시간이 잘못 설정되어 있습니다.\n설정 → 일반 → 날짜 및 시간에서 '자동으로 설정'을 켠 뒤, 로그아웃하고 다시 로그인해 주세요.";
  }
  if (/jwt expired/i.test(msg) || /invalid jwt/i.test(msg)) {
    return "로그인이 만료되었습니다. 로그아웃 후 다시 로그인해 주세요.";
  }
  if (/failed to fetch/i.test(msg) || /network/i.test(msg)) {
    return "인터넷 연결을 확인해 주세요.";
  }
  return msg;
}
