import type { CartSchedule } from "./types";

export const GEMINI_KEY_STORAGE = "jw_cart_gemini_api_key";

export type ExtractedConductorRow = {
  schedule_id: string;
  service_date: string; // 'YYYY-MM-DD'
  start_time: string; // 'HH:MM'
  day_of_week: number; // 1..7
  conductor_name: string;
  is_closed: boolean;
  closure_reason: string;
};

const DAY_KO: Record<number, string> = {
  1: "월요일",
  2: "화요일",
  3: "수요일",
  4: "목요일",
  5: "금요일",
  6: "토요일",
  7: "일요일",
};

/** 시간('18:00', '16:00', '14:00' 등)을 달력 표에서 흔히 쓰는 시간대 키워드로 설명 */
function timePeriodHint(startTime: string): string {
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

/** 주어진 날짜('YYYY-MM-DD')가 속한 주의 월요일~일요일 Date 배열 반환 */
function getWeekDatesMonToSun(ymd: string): Date[] {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const jsDay = dt.getDay(); // 0=일..6=토
  const isoDay = jsDay === 0 ? 7 : jsDay; // 1=월..7=일
  const monday = new Date(y, m - 1, d - (isoDay - 1));
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

/** 상가봉사 주간에 휴무 처리할 전시대 시간대인지 판별 (목요일 저녁, 토요일 오후) */
function isBusinessTerritoryClosedSlot(s: CartSchedule): boolean {
  const hour = Number(s.start_time.split(":")[0]) || 0;
  // 목요일(4) 저녁(17시 이후) 또는 토요일(6) 오후(12시 이후)
  if (s.day_of_week === 4 && hour >= 17) return true;
  if (s.day_of_week === 6 && hour >= 12) return true;
  return false;
}

/** 이미지를 최대 너비 1600px로 적절히 축소해 base64(JPEG/PNG)로 변환 */
async function fileToBase64Image(file: File): Promise<{ base64: string; mimeType: string }> {
  if (file.type === "image/png" && file.size <= 2 * 1024 * 1024) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다."));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    return { base64, mimeType: "image/png" };
  }

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

  const maxW = 1600;
  const scale = img.width > maxW ? maxW / img.width : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지 처리 컨텍스트를 생성할 수 없습니다.");
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { base64: dataUrl.split(",")[1] ?? "", mimeType: "image/jpeg" };
}

/** Gemini API 호출 (gemini-2.5-flash 우선, 실패 시 gemini-2.0-flash 폴백) */
async function callGeminiVision(
  apiKey: string,
  prompt: string,
  base64: string,
  mimeType: string
): Promise<string> {
  const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
  let lastError = "";

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey.trim()
    )}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) {
        return text;
      }
      lastError = "AI 응답이 비어 있습니다.";
      continue;
    }

    const errBody = await res.text().catch(() => "");
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new Error(
        "Gemini API 키가 올바르지 않거나 권한이 없습니다. 키를 다시 확인해 주세요."
      );
    }
    if (res.status === 429) {
      throw new Error("AI 요청 한도를 잠시 초과했습니다. 1분 후 다시 시도해 주세요.");
    }
    lastError = `HTTP ${res.status}: ${errBody.slice(0, 120)}`;
  }

  throw new Error(`AI 분석에 실패했습니다. (${lastError})`);
}

/**
 * 달력 일정표 사진에서 활성 전시대 시간표에 해당하는 인도자 형제 이름과
 * '상가봉사주간'(목요일 저녁·토요일 오후 전시대 휴무)을 자동 추출한다.
 */
export async function extractCartConductorsFromPhoto(
  file: File,
  apiKey: string,
  year: number,
  month: number,
  schedules: CartSchedule[]
): Promise<ExtractedConductorRow[]> {
  if (!apiKey.trim()) {
    throw new Error("먼저 Gemini API 키를 입력해 저장해 주세요.");
  }
  if (schedules.length === 0) {
    throw new Error("등록된 전시대 시간표가 없습니다.");
  }

  const { base64, mimeType } = await fileToBase64Image(file);

  const scheduleDesc = schedules
    .map((s) => {
      const day = DAY_KO[s.day_of_week] ?? "";
      const period = timePeriodHint(s.start_time);
      return `- ${day} ${period} (start_time: "${s.start_time.slice(0, 5)}", 표시: ${s.time_label})`;
    })
    .join("\n");

  const mm = String(month).padStart(2, "0");

  const prompt = `당신은 한국어 월간 봉사 일정표(달력 표) 이미지를 정확하게 읽는 도우미입니다.
이 일정표는 **${year}년 ${month}월** 달력입니다.
표 안에는 호별봉사 인도자, 전시대 봉사 인도자, 그리고 '상가봉사주간' 같은 특별 주간 표시가 함께 적혀 있습니다.

당신은 다음 두 가지를 정확히 추출해야 합니다:
(A) 아래에 지정된 **전시대 봉사 시간대**의 인도자 이름:
${scheduleDesc}
(B) 달력에서 **"상가봉사주간"** (또는 "상가봉사 주간", "상가봉사")이라고 적힌 날짜(보통 해당 주 월요일 칸에 적혀 있음)

규칙:
1. 달력에서 ${year}년 ${month}월에 해당하는 날짜(1일~말일)만 읽으세요. 이전 달/다음 달의 흐린 날짜 칸은 무시하세요.
2. 각 날짜 칸 안에 적힌 "오전:", "오후:", "저녁:" 라벨을 정확히 구분하여, 위 지정된 전시대 봉사 요일과 시간대(오전/오후/저녁)에 일치하는 인도자 이름만 conductors에 추출하세요.
3. 예를 들어 화요일 칸에 "오전: 강영출 / 저녁: 김용훈"이 있고 전시대 일정이 "화요일 저녁(18:00)"이라면 "김용훈"만 추출하고 "강영출"은 무시합니다.
4. 토요일 칸에 "오전: 김동근 / 오후: 최호운" 또는 "특별모임 / 오후: 박용진"이 있고 전시대 일정이 "토요일 오후(14:00)"라면 "최호운", "박용진"만 추출합니다.
5. "특별모임", "집단봉사", "상가봉사주간" 같은 행사 문구는 인도자 이름이 아니므로 conductors에 넣지 마세요.
6. 인도자 이름에 "형제"가 붙어 있으면 제거하고 순수 한글 성명만 넣으세요.
7. 달력의 어느 주(보통 마지막 주 월요일 칸)에 "상가봉사주간"이 적혀 있으면, 그 칸의 날짜(YYYY-MM-DD)를 business_territory_weeks 배열에 넣으세요. 없으면 빈 배열 []을 넣으세요.
8. 반드시 아래 형식의 JSON 객체만 출력하세요:
{
  "conductors": [
    {"service_date": "${year}-${mm}-03", "start_time": "18:00", "conductor_name": "김용훈"}
  ],
  "business_territory_weeks": ["${year}-${mm}-23"]
}`;

  const rawText = await callGeminiVision(apiKey, prompt, base64, mimeType);

  let parsed: unknown;
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI가 반환한 결과를 해석하지 못했습니다. 사진을 다시 시도해 주세요.");
  }

  let rawConductors: unknown[] = [];
  let rawBizWeeks: unknown[] = [];

  if (Array.isArray(parsed)) {
    rawConductors = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.conductors)) rawConductors = obj.conductors;
    if (Array.isArray(obj.business_territory_weeks)) rawBizWeeks = obj.business_territory_weeks;
  } else {
    throw new Error("AI 응답 형식이 올바르지 않습니다.");
  }

  const byKey = new Map<string, ExtractedConductorRow>();

  // 1) AI가 추출한 일반 전시대 인도자 반영
  for (const item of rawConductors) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const serviceDate = String(rec.service_date ?? "").trim();
    const rawTime = String(rec.start_time ?? "").trim();
    const rawName = String(rec.conductor_name ?? "")
      .trim()
      .replace(/\s*형제$/, "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !rawName) continue;
    const [hStr, mStr] = rawTime.split(":");
    if (hStr === undefined || mStr === undefined) continue;
    const startTimeNorm = `${String(Number(hStr)).padStart(2, "0")}:${mStr.slice(0, 2)}`;

    const [yy, mon, dd] = serviceDate.split("-").map(Number);
    if (yy !== year || mon !== month) continue;
    const jsDay = new Date(yy, mon - 1, dd).getDay();
    const dow = jsDay === 0 ? 7 : jsDay;

    const matched = schedules.find(
      (s) => s.day_of_week === dow && s.start_time.slice(0, 5) === startTimeNorm
    );
    if (!matched) continue;

    const key = `${matched.id}:${serviceDate}`;
    byKey.set(key, {
      schedule_id: matched.id,
      service_date: serviceDate,
      start_time: startTimeNorm,
      day_of_week: dow,
      conductor_name: rawName,
      is_closed: false,
      closure_reason: "",
    });
  }

  // 2) 상가봉사 주간 감지 시 해당 주(월~일)의 목요일 저녁·토요일 오후를 자동으로 휴무 처리
  for (const rawDate of rawBizWeeks) {
    const ymd = String(rawDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    const weekDates = getWeekDatesMonToSun(ymd);
    for (const dt of weekDates) {
      if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month) continue;
      const jsDay = dt.getDay();
      const dow = jsDay === 0 ? 7 : jsDay;
      const serviceDate = fmtYmd(dt);

      for (const s of schedules) {
        if (s.day_of_week !== dow) continue;
        if (!isBusinessTerritoryClosedSlot(s)) continue;
        const key = `${s.id}:${serviceDate}`;
        byKey.set(key, {
          schedule_id: s.id,
          service_date: serviceDate,
          start_time: s.start_time.slice(0, 5),
          day_of_week: dow,
          conductor_name: "",
          is_closed: true,
          closure_reason: "상가봉사 주간",
        });
      }
    }
  }

  const results = Array.from(byKey.values());
  results.sort((a, b) =>
    a.service_date === b.service_date
      ? a.start_time.localeCompare(b.start_time)
      : a.service_date.localeCompare(b.service_date)
  );

  return results;
}
