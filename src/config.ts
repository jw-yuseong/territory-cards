// Supabase 프로젝트 연결 정보
// Supabase 대시보드 → Project Settings → API 에서 확인
// anon key는 공개되어도 안전하도록 설계된 키입니다 (RLS로 접근 제어).
export const SUPABASE_URL = "https://hsjtwmczjdklyicnonkq.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzanR3bWN6amRrbHlpY25vbmtxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxODkzMDYsImV4cCI6MjA5OTc2NTMwNn0.JddEQjwdaERzCtPs9Y8c-ogGloMrhA5SkU0Yw6F1YsY";

// 키가 아직 입력되지 않았는지 확인 (입력 전에는 앱이 안내 문구를 보여줌)
export const CONFIG_OK = SUPABASE_URL.startsWith("https://");

// ----------------------------------------------------------------------------
// 로그인 아이디 → Supabase Auth 이메일 매핑
// 사용자는 한글 아이디로 로그인하고, 내부적으로 이메일 계정을 사용한다.
// ----------------------------------------------------------------------------
export const ID_TO_EMAIL: Record<string, string> = {
  봉사자: "user@jw.org",
  봉사인도자: "conductor@jw.org",
  구역관리자: "jwyuseong99@gmail.com",
};

export type Role = "publisher" | "conductor" | "admin";

// 로그인된 이메일 → 역할 (봉사자: 봉사기록만 / 인도자: +인도자 화면 / 관리자: 전부)
export const EMAIL_TO_ROLE: Record<string, Role> = {
  "user@jw.org": "publisher",
  "conductor@jw.org": "conductor",
  "jwyuseong99@gmail.com": "admin",
};
