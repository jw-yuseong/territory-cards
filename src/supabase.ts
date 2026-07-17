import { createClient } from "@supabase/supabase-js";
import { CONFIG_OK, SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// 키 입력 전에는 더미 값으로 클라이언트를 만들어 앱 자체는 뜨게 한다
// (App이 CONFIG_OK를 보고 설정 안내 화면을 보여줌)
export const supabase = createClient(
  CONFIG_OK ? SUPABASE_URL : "https://placeholder.supabase.co",
  CONFIG_OK ? SUPABASE_ANON_KEY : "placeholder-key"
);
