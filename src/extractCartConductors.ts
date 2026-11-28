import type { CartSchedule } from "./types";

export type ExtractedConductorRow = {
  schedule_id: string;
  service_date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:MM'
  day_of_week: number; // 1..7
  conductor_name: string;
  is_closed: boolean;
  closure_reason: string;
};

/** 시간('18:00', '16:00', '14:00' 등) -> '오전' | '오후' | '저녁' */
function timePeriodOf(startTime: string): "오전" | "오후" | "저녁" {
  const h = Number(startTime.split(":")[0]) || 0;
  if (h < 12) return "오전";
  if (h < 17) return "오후";
  return "저녁";
}

/** Date -> 'YYYY-MM-DD' */
function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** 상가봉사 주간에 휴무 처리할 전시대 시간대인지 판별 (목요일 저녁, 토요일 오후) */
function isBusinessTerritoryClosedSlot(s: CartSchedule): boolean {
  const hour = Number(s.start_time.split(":")[0]) || 0;
  if (s.day_of_week === 4 && hour >= 17) return true;
  if (s.day_of_week === 6 && hour >= 12) return true;
  return false;
}

/** 월요일 시작 기준 해당 연·월의 달력 주 배열 (각 주는 7일, 월~일) */
function buildCalendarWeeks(year: number, month: number): Date[][] {
  const first = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const firstIso = first.getDay() === 0 ? 7 : first.getDay(); // 1=월..7=일
  const startMonday = new Date(year, month - 1, 1 - (firstIso - 1));

  const weeks: Date[][] = [];
  let cursor = new Date(startMonday);
  while (true) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + i));
    }
    weeks.push(week);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7);
    const lastOfMonth = new Date(year, month - 1, lastDay);
    if (cursor.getTime() > lastOfMonth.getTime()) break;
  }
  return weeks;
}

/** 한글 문자열을 자모(초성·중성·종성) 배열로 분해 (OCR 오타 유사도 보정용) */
function toJamo(str: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const offset = code - 0xac00;
      const cho = Math.floor(offset / 588);
      const jung = Math.floor((offset % 588) / 28);
      const jong = offset % 28;
      out.push(cho, 100 + jung);
      if (jong > 0) out.push(200 + jong);
    } else {
      out.push(1000 + code);
    }
  }
  return out;
}

function levenshtein(a: number[], b: number[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = tmp;
    }
  }
  return dp[n];
}

/** OCR로 읽은 이름을 등록된 명단(승인 전도인·기존 인도자)과 자모 유사도로 자동 보정 */
function autoCorrectName(raw: string, knownNames: string[]): string {
  const cleaned = raw.replace(/[^가-힣]/g, "").replace(/형제$/, "");
  if (!cleaned) return "";
  if (knownNames.includes(cleaned)) return cleaned;
  if (cleaned.length < 2 || knownNames.length === 0) return cleaned;

  const rawJamo = toJamo(cleaned);
  let bestName = cleaned;
  let bestDist = Infinity;
  let tie = false;

  for (const candidate of knownNames) {
    if (Math.abs(candidate.length - cleaned.length) > 1) continue;
    const dist = levenshtein(rawJamo, toJamo(candidate));
    if (dist < bestDist) {
      bestDist = dist;
      bestName = candidate;
      tie = false;
    } else if (dist === bestDist) {
      tie = true;
    }
  }

  // 자모 2개 이하 차이이고 유일한 최선 매칭일 때만 자동 교정
  if (!tie && bestDist <= 2) {
    return bestName;
  }
  return cleaned;
}

/** 이미지 파일을 로드해 원본 크기의 canvas 반환 */
async function loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 불러올 수 없습니다."));
    };
    el.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("이미지 캔버스를 생성할 수 없습니다.");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

/**
 * 요일 헤더 바(어두운 남색/파랑/빨강 줄)의 하단 Y 좌표를 자동 탐지한다.
 */
function detectHeaderBottomY(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const maxScanY = Math.floor(height * 0.45);
  const imgData = ctx.getImageData(0, 0, width, maxScanY).data;

  let bandStart = -1;
  let bandEnd = -1;
  let bestStart = -1;
  let bestEnd = -1;

  for (let y = 0; y < maxScanY; y++) {
    let darkCount = 0;
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x += 2) {
      const idx = rowOff + x * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum < 135) darkCount++;
    }
    const darkRatio = darkCount / (width / 2);
    if (darkRatio > 0.5) {
      if (bandStart === -1) bandStart = y;
      bandEnd = y;
    } else if (bandStart !== -1) {
      if (bandEnd - bandStart > bestEnd - bestStart) {
        bestStart = bandStart;
        bestEnd = bandEnd;
      }
      bandStart = -1;
      bandEnd = -1;
    }
  }
  if (bandStart !== -1 && bandEnd - bandStart > bestEnd - bestStart) {
    bestStart = bandStart;
    bestEnd = bandEnd;
  }

  return bestEnd > 0 ? bestEnd + 2 : 0;
}

/**
 * 달력 본문(gridTop ~ height)이 실제로 몇 개 주 행(4, 5, 6 중 하나)으로 나뉘어 있는지
 * 수평 경계선 정렬 점수로 자동 판별한다.
 */
function detectRowCount(
  canvas: HTMLCanvasElement,
  gridTop: number,
  calendarWeekCount: number
): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width, height } = canvas;
  const bodyH = height - gridTop;
  if (bodyH <= 50) return calendarWeekCount;

  const imgData = ctx.getImageData(0, gridTop, width, bodyH).data;

  // 각 y행이 가로 격자선/날짜띠 경계인지 점수 계산 (흰색이 아닌 픽셀 비율)
  const lineScore = new Float32Array(bodyH);
  for (let y = 0; y < bodyH; y++) {
    let nonWhite = 0;
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x += 3) {
      const idx = rowOff + x * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      // 연한 회색/파랑 격자선 또는 배경띠
      if (r < 245 || g < 245 || b < 245) nonWhite++;
    }
    lineScore[y] = nonWhite / (width / 3);
  }

  // 후보 행 수 (달력 주 수와 5를 우선 후보로 평가)
  const candidates = Array.from(new Set([calendarWeekCount, 5, 4, 6])).filter(
    (n) => n >= 4 && n <= 6
  );

  let bestN = calendarWeekCount;
  let bestScore = -1;

  for (const n of candidates) {
    const rowH = bodyH / n;
    let total = 0;
    for (let k = 1; k < n; k++) {
      const expectedY = Math.round(k * rowH);
      let peak = 0;
      for (let dy = -6; dy <= 6; dy++) {
        const yy = expectedY + dy;
        if (yy >= 0 && yy < bodyH && lineScore[yy] > peak) {
          peak = lineScore[yy];
        }
      }
      total += peak;
    }
    const avg = total / (n - 1);
    // 실제 달력 주 수와 같으면 미세 가산점
    const adjusted = avg + (n === calendarWeekCount ? 0.04 : 0);
    if (adjusted > bestScore) {
      bestScore = adjusted;
      bestN = n;
    }
  }

  return bestN;
}

/** 셀 영역에 글자(어두운 픽셀)가 실제로 존재하는지 빠르게 확인 */
function cellHasDarkText(
  canvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const x = Math.max(0, Math.floor(sx));
  const y = Math.max(0, Math.floor(sy));
  const w = Math.max(1, Math.min(canvas.width - x, Math.floor(sw)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.floor(sh)));
  const data = ctx.getImageData(x, y, w, h).data;

  let darkPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 150) {
      darkPixels++;
      if (darkPixels >= 20) return true;
    }
  }
  return false;
}

/**
 * 셀 영역을 3배 확대 + 고대비 흑백 처리 + 흰 여백 패딩한 OCR용 캔버스 생성
 */
function cropCellForOcr(
  srcCanvas: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement {
  const scale = 3;
  const pad = 24;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const out = document.createElement("canvas");
  out.width = dw + pad * 2;
  out.height = dh + pad * 2;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, sx, sy, sw, sh, pad, pad, dw, dh);

  // 고대비 그레이스케일 보정 (노란/회색 배경 제거 -> 깔끔한 검정 글씨)
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    let v: number;
    if (lum > 205) {
      v = 255;
    } else if (lum < 115) {
      v = 0;
    } else {
      v = Math.round(((lum - 115) / (205 - 115)) * 255);
    }
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

/** OCR 텍스트에서 시간대('오전' | '오후' | '저녁')별 인도자 이름 추출 */
function parsePeriodNamesFromCellText(
  text: string,
  knownNames: string[]
): Partial<Record<"오전" | "오후" | "저녁", string>> {
  const result: Partial<Record<"오전" | "오후" | "저녁", string>> = {};
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // 콜론/세미콜론/공백 등 OCR 변형 허용
    const m = line.match(
      /^(오\s*[전진]|오\s*[후무푸추]|저\s*[녁넉낵럭닉녹])\s*[:;.\-\s]+\s*(.+)$/
    );
    if (!m) continue;

    const rawPeriod = m[1].replace(/\s+/g, "");
    let period: "오전" | "오후" | "저녁";
    if (rawPeriod.startsWith("오") && /[전진]/.test(rawPeriod)) {
      period = "오전";
    } else if (rawPeriod.startsWith("오")) {
      period = "오후";
    } else {
      period = "저녁";
    }

    const rawName = m[2].replace(/\s+/g, "").replace(/[^가-힣]/g, "");
    if (!rawName || /특별모임|집단봉사|상가봉사/.test(rawName)) continue;

    const corrected = autoCorrectName(rawName, knownNames);
    if (corrected.length >= 2) {
      result[period] = corrected;
    }
  }

  return result;
}

/**
 * API 키 없이 브라우저 내장 무료 한글 OCR(Tesseract.js)로
 * 달력 일정표 사진에서 전시대 인도자 및 '상가봉사주간'(목 저녁·토 오후 휴무)을 자동 추출한다.
 */
export async function extractCartConductorsFromPhoto(
  file: File,
  year: number,
  month: number,
  schedules: CartSchedule[],
  knownNames: string[] = [],
  onProgress?: (statusText: string) => void
): Promise<ExtractedConductorRow[]> {
  if (schedules.length === 0) {
    throw new Error("등록된 전시대 시간표가 없습니다.");
  }

  onProgress?.("이미지 분석 준비 중…");
  const srcCanvas = await loadImageToCanvas(file);
  const gridTop = detectHeaderBottomY(srcCanvas);
  const calendarWeeks = buildCalendarWeeks(year, month);
  const rowCount = detectRowCount(srcCanvas, gridTop, calendarWeeks.length);
  const usableWeeks = calendarWeeks.slice(0, rowCount);

  const colW = srcCanvas.width / 7;
  const rowH = (srcCanvas.height - gridTop) / rowCount;

  // OCR 대상 셀 목록 구성: (1) 월요일(상가봉사주간 감지용) + (2) 활성 전시대 요일 셀
  const activeDows = new Set(schedules.map((s) => s.day_of_week));

  const mondayTargets: { weekIdx: number; sx: number; sy: number; sw: number; sh: number }[] = [];
  for (let wIdx = 0; wIdx < usableWeeks.length; wIdx++) {
    const sx = 4;
    const sy = gridTop + wIdx * rowH + rowH * 0.16;
    const sw = colW - 8;
    const sh = rowH * 0.8;
    if (cellHasDarkText(srcCanvas, sx, sy, sw, sh)) {
      mondayTargets.push({ weekIdx: wIdx, sx, sy, sw, sh });
    }
  }

  const dayTargets: {
    weekIdx: number;
    dow: number;
    serviceDate: string;
    sx: number;
    sy: number;
    sw: number;
    sh: number;
  }[] = [];

  for (let wIdx = 0; wIdx < usableWeeks.length; wIdx++) {
    const week = usableWeeks[wIdx];
    for (let col = 0; col < 7; col++) {
      const dow = col + 1; // 1=월..7=일
      if (!activeDows.has(dow)) continue;
      const dt = week[col];
      if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month) continue;

      const sx = col * colW + 4;
      const sy = gridTop + wIdx * rowH + rowH * 0.22; // 상단 날짜 숫자 영역 제외
      const sw = colW - 8;
      const sh = rowH * 0.74;
      dayTargets.push({
        weekIdx: wIdx,
        dow,
        serviceDate: fmtYmd(dt),
        sx,
        sy,
        sw,
        sh,
      });
    }
  }

  const totalSteps = mondayTargets.length + dayTargets.length;
  onProgress?.("한글 인식 엔진 불러오는 중… (최초 1회 약 10초 소요)");

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("kor", 1, {
    logger: (m) => {
      if (m.status === "loading language traineddata") {
        const pct = Math.round((m.progress || 0) * 100);
        onProgress?.(`한글 인식 데이터 다운로드 중… (${pct}%)`);
      }
    },
  });

  const businessWeekSet = new Set<number>();
  const results: ExtractedConductorRow[] = [];
  let doneSteps = 0;

  try {
    // 1) 월요일 칸에서 '상가봉사주간' 감지
    for (const mt of mondayTargets) {
      doneSteps++;
      onProgress?.(`일정표 읽는 중… (${doneSteps} / ${totalSteps})`);
      const cellCanvas = cropCellForOcr(srcCanvas, mt.sx, mt.sy, mt.sw, mt.sh);
      const { data } = await worker.recognize(cellCanvas);
      const compact = (data.text || "").replace(/\s+/g, "");
      if (/상가|봉사주간|상가봉사/.test(compact)) {
        businessWeekSet.add(mt.weekIdx);
      }
    }

    // 2) 활성 전시대 요일 칸 OCR 및 시간대 매칭
    for (const dt of dayTargets) {
      doneSteps++;
      onProgress?.(`일정표 읽는 중… (${doneSteps} / ${totalSteps})`);

      const daySchedules = schedules
        .filter((s) => s.day_of_week === dt.dow)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      const isBizWeek = businessWeekSet.has(dt.weekIdx);
      const needOcrSchedules = daySchedules.filter(
        (s) => !(isBizWeek && isBusinessTerritoryClosedSlot(s))
      );

      let periodMap: Partial<Record<"오전" | "오후" | "저녁", string>> = {};
      if (needOcrSchedules.length > 0 && cellHasDarkText(srcCanvas, dt.sx, dt.sy, dt.sw, dt.sh)) {
        const cellCanvas = cropCellForOcr(srcCanvas, dt.sx, dt.sy, dt.sw, dt.sh);
        const { data } = await worker.recognize(cellCanvas);
        periodMap = parsePeriodNamesFromCellText(data.text || "", knownNames);
      }

      for (const s of daySchedules) {
        if (isBizWeek && isBusinessTerritoryClosedSlot(s)) {
          results.push({
            schedule_id: s.id,
            service_date: dt.serviceDate,
            start_time: s.start_time.slice(0, 5),
            day_of_week: dt.dow,
            conductor_name: "",
            is_closed: true,
            closure_reason: "상가봉사 주간",
          });
        } else {
          const period = timePeriodOf(s.start_time);
          const name = periodMap[period] ?? "";
          results.push({
            schedule_id: s.id,
            service_date: dt.serviceDate,
            start_time: s.start_time.slice(0, 5),
            day_of_week: dt.dow,
            conductor_name: name,
            is_closed: false,
            closure_reason: "",
          });
        }
      }
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  results.sort((a, b) =>
    a.service_date === b.service_date
      ? a.start_time.localeCompare(b.start_time)
      : a.service_date.localeCompare(b.service_date)
  );

  return results;
}
