/**
 * 모바일 기기 터치 햅틱 반응(Vibration API) 유틸리티
 * - Android 크롬, 삼성 인터넷 등 진동 지원 브라우저에서 동작합니다.
 * - 진동 미지원 기기(iOS Safari 등)나 권한이 없는 환경에서는 오류 없이 조용히 무시됩니다.
 */

function vibrate(pattern: number | number[]) {
  if (typeof window !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // 일부 브라우저 권한/제한 무시
    }
  }
}

/** 호별 방문 체크 성공 시 (경쾌한 1회 진동) */
export function hapticCheck() {
  vibrate(40);
}

/** 방문 체크 취소 시 (2회 톡톡 진동) */
export function hapticUncheck() {
  vibrate([25, 40, 25]);
}

/** 주의사항 선택, 메모 저장 등 가벼운 탭 반응 */
export function hapticTap() {
  vibrate(25);
}

/** 에러 또는 경고 안내 시 진동 */
export function hapticWarn() {
  vibrate([50, 60, 50]);
}
