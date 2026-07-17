// Supabase 프로젝트 연결 정보
// Supabase 대시보드 → Project Settings → API 에서 확인
// anon key는 공개되어도 안전하도록 설계된 키입니다 (RLS로 접근 제어).
export const SUPABASE_URL = "PASTE_SUPABASE_URL_HERE";
export const SUPABASE_ANON_KEY = "PASTE_SUPABASE_ANON_KEY_HERE";

// 키가 아직 입력되지 않았는지 확인 (입력 전에는 앱이 안내 문구를 보여줌)
export const CONFIG_OK = SUPABASE_URL.startsWith("https://");
