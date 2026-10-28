// 구역카드의 집 주소를 '동(그룹) + 호수'로 해석하는 공용 로직
//
// 엑셀 원본 규칙:
//   - "(801동)\n202" 처럼 여러 줄인 집 = 새 그룹 시작. 마지막 줄이 호수,
//     앞 줄들이 그룹 제목(동, 상가 이름 등).
//   - 그 아래 "201", "102" 같은 한 줄짜리 집들은 위 그룹을 이어받음.
//   - "열매5단지상가\n2층 세탁소" 처럼 괄호 없는 제목도 같은 방식.
import type { TerritoryUnit } from "./types";

export interface ParsedUnit {
  unit: TerritoryUnit;
  /** 이 집이 속한 그룹 이름 (없으면 null), 괄호는 벗겨서 보관 */
  group: string | null;
  /** 호수(마지막 줄)만 남긴 표시용 텍스트 */
  label: string;
  /** 이 집의 주소에 그룹 제목이 저장되어 있는지 (그룹 시작 집) */
  definesGroup: boolean;
}

export interface GroupBlock {
  /** 접기 상태 저장용 고유 키 */
  key: string;
  group: string | null;
  items: ParsedUnit[];
}

function stripParens(s: string): string {
  const t = s.trim();
  return t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1).trim() : t;
}

/** 도로명 + 건물번호가 포함된 주소인지 판별 */
export function isRoadAddress(s: string): boolean {
  return /([가-힣0-9]+(대로|로|번길|번안길|안길|길)\s*\d+|\d+번길\s*\d+)/.test(s);
}

/** 마지막 줄이 도로명/동/건물이 아닌 단순 괄호 메모인지 판별 (예: "(개짖음)", "(무인)", "(목사)") */
function isParenNote(s: string): boolean {
  const t = s.trim();
  if (!((t.startsWith("(") && t.endsWith(")")) || (t.startsWith("[") && t.endsWith("]")))) {
    return false;
  }
  if (isRoadAddress(t)) return false;
  if (/(\d+\s*동|\d+\s*라인|단지|상가|빌딩|타운|하우스|아파트|오피스텔|빌라|맨션)/.test(t)) {
    return false;
  }
  return true;
}

/** 줄 텍스트가 건물이름/도로명이 아닌 층수·호수 표시인지 판별 (예: "1층", "2,3층", "지하", "302", "501") */
function isFloorOrRoomLine(s: string): boolean {
  const p = s.trim();
  if (p.startsWith("(") && p.endsWith(")")) {
    const inner = p.slice(1, -1).trim();
    return /^(지하\s*\d*층?|\d+층)$/.test(inner);
  }
  if (
    /(대로|로|길|빌|하우스|타운|맨션|아파트|오피스텔|캐슬|팰리스|프라자|시장|경기장|구역|동|단지|상가|노인정|경로당|관리실)/.test(
      p
    )
  ) {
    return false;
  }
  return /^(\d+(?:[,~\-]\d+)*층(?:\s*\d{3}호?|\(내부\))?|지하\s*(?:\d+층)?|B\d+층?|\d{3,4}(?:,\d{3,4})*호?|뒷면|뒷편)$/.test(
    p
  );
}

// 사용자 컨펌 대기 중인 보류 카드 ID 목록 (209, 210, 365, 371, 449, 516번)
const AMBIGUOUS_CARD_IDS = new Set([
  "bd2838c0-ab43-5554-a384-9279d53d8616", // 209번
  "4356263e-9b49-54b1-957f-474080327188", // 210번
  "58567a27-0f60-5410-97d1-9f315edc9281", // 365번
  "59337748-ec38-5ccd-aeff-e338e864db24", // 371번
  "67b587b2-ce55-5507-a1ba-92917a65fb70", // 449번
  "2468d37e-cacb-5e37-9f2d-70af94eb2614", // 516번
]);

const CARD_514_ID = "8716b2e2-f947-5d02-9dd2-f157835b337c";
const CARD_446_ID = "c186ceea-2da8-51a0-a903-4283f2eccb1d";

/**
 * 카드의 집 주소 목록에서 엑셀 줄바꿈으로 인해 잘못 묶인 주소들을 정규화한다.
 * - 괄호 유지 및 원본 숫자 보존
 * - 보류 카드(AMBIGUOUS_CARD_IDS)나 HYPERLINK 수식, "상가 구역입니다" 항목은 건드리지 않음
 */
export function normalizeCardUnits(units: TerritoryUnit[]): TerritoryUnit[] {
  if (units.length === 0) return units;
  const cardId = units[0].card_id;
  if (AMBIGUOUS_CARD_IDS.has(cardId)) return units;

  // 446번 카드는 모든 줄바꿈을 공백으로 1줄 평탄화 (사용자 컨펌 완료)
  if (cardId === CARD_446_ID) {
    return units.map((u) => {
      if (!/\r?\n/.test(u.address_unit)) return u;
      const singleLine = u.address_unit
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ");
      return singleLine !== u.address_unit ? { ...u, address_unit: singleLine } : u;
    });
  }

  // Pass 1: 괄호 내부 줄바꿈 결합(Rule A), 마지막 줄 괄호 메모 결합(Rule B), 층/호수 줄바꿈 결합(Rule C)
  const pass1 = units.map((u) => {
    const addr = u.address_unit;
    if (
      !/\r?\n/.test(addr) ||
      addr.includes("HYPERLINK") ||
      addr.includes("상가 구역입니다") ||
      addr.includes("상가구역 입니다")
    ) {
      return u;
    }

    let cur = addr;
    let triggered = false;

    // Rule A: 괄호 안의 줄바꿈 제거 (예: "(왕가봉로2번길 \n 57)" -> "(왕가봉로2번길 57)")
    if (!(cardId === CARD_514_ID && u.seq_no === 12)) {
      const nextCur = cur.replace(
        /\(([^()]*?)\r?\n\s*([^()]*?)\)/g,
        (_, g1: string, g2: string) => `(${g1.trim()} ${g2.trim()})`
      );
      if (nextCur !== cur) {
        cur = nextCur;
        triggered = true;
      }
    }

    let lines = cur
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");

    // Rule B: 마지막 줄이 단순 괄호 메모인 경우 앞 줄에 합침 (예: "501\n(개짖음)" -> "501 (개짖음)")
    while (lines.length > 1 && isParenNote(lines[lines.length - 1])) {
      lines[lines.length - 2] = `${lines[lines.length - 2]} ${lines[lines.length - 1]}`;
      lines.pop();
      triggered = true;
    }

    // Rule C: 층/호수 줄과 상호/메모 줄 결합
    if (lines.length > 1) {
      const prefix = lines.slice(0, -1).join(" ");
      if (isFloorOrRoomLine(prefix) || isFloorOrRoomLine(lines[0])) {
        lines = [lines.join(" ")];
        triggered = true;
      } else if (lines.length >= 3 && isFloorOrRoomLine(lines[lines.length - 2])) {
        const mergedLast = `${lines[lines.length - 2]} ${lines[lines.length - 1]}`;
        lines = [...lines.slice(0, -2), mergedLast];
        triggered = true;
      }
    }

    if (!triggered) return u;
    const nextAddr = lines.join("\n");
    return nextAddr !== addr ? { ...u, address_unit: nextAddr } : u;
  });

  // Pass 2: 하위 호수(비도로명 1줄 집)가 하나도 없는 나홀로 다중줄 집을 1줄로 평탄화(Rule D)
  return pass1.map((u, idx) => {
    const addr = u.address_unit;
    if (
      !/\r?\n/.test(addr) ||
      addr.includes("HYPERLINK") ||
      addr.includes("상가 구역입니다") ||
      addr.includes("상가구역 입니다")
    ) {
      return u;
    }

    // 아파트 동/라인 그룹 시작은 유지
    if (/(\d+\s*동|\d+\s*라인)/.test(addr)) {
      return u;
    }

    let nonRoadSubCount = 0;
    for (let j = idx + 1; j < pass1.length; j++) {
      const followAddr = pass1[j].address_unit;
      if (/\r?\n/.test(followAddr)) break;
      if (!isRoadAddress(followAddr)) {
        nonRoadSubCount++;
      }
    }

    if (nonRoadSubCount === 0) {
      const lines = addr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== "");
      const flat = lines.join(" ");
      return flat !== addr ? { ...u, address_unit: flat } : u;
    }
    return u;
  });
}

/** 주소 한 칸을 (그룹 제목 줄들, 호수)로 분해 */
export function splitAddress(address: string): { groupTitle: string | null; label: string } {
  const lines = address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length <= 1) {
    return { groupTitle: null, label: lines[0] ?? "" };
  }
  const label = lines[lines.length - 1];
  const groupTitle = stripParens(lines.slice(0, -1).join(" "));
  return { groupTitle, label };
}

/** 집 목록(번호순)을 그룹 블록들로 묶는다 */
export function buildGroups(units: TerritoryUnit[]): GroupBlock[] {
  const blocks: GroupBlock[] = [];
  let current: GroupBlock | null = null;

  for (const unit of units) {
    const { groupTitle, label } = splitAddress(unit.address_unit);
    if (groupTitle !== null) {
      // 새 그룹 시작
      current = { key: `${unit.id}`, group: groupTitle, items: [] };
      blocks.push(current);
      current.items.push({ unit, group: groupTitle, label, definesGroup: true });
    } else {
      // 한 줄짜리 도로명주소 집이 앞 건물의 하위 그룹으로 잘못 빨려 들어가지 않도록 분리
      if (!current || (current.group !== null && isRoadAddress(label))) {
        current = { key: `top-${unit.id}`, group: null, items: [] };
        blocks.push(current);
      }
      current.items.push({ unit, group: current.group, label, definesGroup: false });
    }
  }
  return blocks;
}
