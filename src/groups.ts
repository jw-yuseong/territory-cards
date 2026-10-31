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

/** 관리자가 '그룹에서 분리'한 독립 1줄 세대 표시자 (Zero-Width Space) */
export const STANDALONE_MARKER = "\u200B";
/** 관리자가 명시적으로 생성/지정한 그룹 시작 세대 표시자 (Zero-Width Non-Joiner) */
export const GROUP_START_MARKER = "\u200C";
/** 관리자가 명시적으로 그룹에 포함시킨 하위 세대 표시자 (Zero-Width Joiner) */
export const GROUP_MEMBER_MARKER = "\u200D";

/** 관리자 그룹 편집 표시자가 포함되어 있는지 확인 */
export function hasAdminGroupMarker(s: string): boolean {
  return /^[\u200B\u200C\u200D]/.test(s);
}

/** 표시/편집 시 보이지 않는 관리자 그룹 표시자 제거 */
export function stripAdminMarkers(s: string): string {
  return s.replace(/[\u200B\u200C\u200D]/g, "");
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

export const CARD_299_ID = "00088550-6a47-59d8-980f-5c85fe77ba85";
export const CARD_301_ID = "2b31db33-2c11-59dd-a0a7-7f6ccf7e14b8";
export const CARD_302_ID = "04850a17-1510-57bc-ba08-4df4cdaf8b11";
export const CARD_446_ID = "c186ceea-2da8-51a0-a903-4283f2eccb1d";
export const CARD_514_ID = "8716b2e2-f947-5d02-9dd2-f157835b337c";
export const CARD_516_ID = "2468d37e-cacb-5e37-9f2d-70af94eb2614";

// 전체 줄바꿈을 1줄 공백으로 평탄화하는 카드 (446번, 516번 방안 A)
const FLATTEN_ALL_CARD_IDS = new Set([CARD_446_ID, CARD_516_ID]);

// 사용자 컨펌 완료된 개별 세대 정규화 매핑 (`${card_id}:${seq_no}` -> 수정된 주소)
const EXPLICIT_UNIT_OVERRIDES: Record<string, string> = {
  // ③ 다세대 빌라 첫 세대 호수 앞 줄바꿈 추가 (5곳)
  "0fb63f16-231f-583b-834e-26107fd93a87:11": "성우빌라 (왕가봉로2길 19-18)\n401", // 34번 #11
  "c31483db-d845-505a-96e4-d5b0ffc8507b:39": "(현충원로347번길 5-8) jpark빌라\n401", // 71번 #39
  "8502bcad-ce4d-5473-affa-102fb9cbe821:47": "반석빌라 (노은동로75길102-14)\n402", // 138번 #47
  "56b8b743-46a3-549f-9758-8e36ba7c7cd9:34": "9번구역 아인스빌 (유성대로720길 6)\n1202", // 239번 #34
  "0758ea1a-dd40-507e-b3a4-a8b26644efd6:58": "(유성대로719안길9)\n402", // 392번 #58

  // ① 첫 집에만 도로명주소가 적혀 있어 뒤의 개별 상호들이 잘못 묶인 카드 및 209, 210번
  "e452e612-2aa5-5951-b23f-957b494e4b20:3": "(현충원로493) 전원공인중개사", // 64번 #3
  "e452e612-2aa5-5951-b23f-957b494e4b20:26": "(현충원로 489) 위성주유소", // 64번 #26
  "468eee0a-9f86-5fca-a91a-06fa29a0118b:6": "(현충원로455번길 10-9) 천년육개장", // 65번 #6
  "36e7401b-e6bb-5e34-9961-6f6d61eb28de:6": "(현충원로 391) 신신낚시", // 66번 #6
  "36e7401b-e6bb-5e34-9961-6f6d61eb28de:16": "(현충원로 401-9) 알밤가든", // 66번 #16
  "36e7401b-e6bb-5e34-9961-6f6d61eb28de:20": "(현충원로 411) 숑사탕", // 66번 #20
  "36e7401b-e6bb-5e34-9961-6f6d61eb28de:21": "(현충원로 415) 대전지방세무사회", // 66번 #21
  "b745ddf9-3a3e-59ab-98fc-c133d332c998:2": "(현충원로425) 덕송민속원", // 69번 #2
  "b745ddf9-3a3e-59ab-98fc-c133d332c998:12": "(현충원로 431) 이건인력", // 69번 #12
  "c31483db-d845-505a-96e4-d5b0ffc8507b:27": "(현충원로 357) 삼영목재", // 71번 #27

  // 209번: 전체 1줄 개별 주소로 평탄화
  "bd2838c0-ab43-5554-a384-9279d53d8616:2": "유성선병원 (병교위/환자방문단)",
  "bd2838c0-ab43-5554-a384-9279d53d8616:3": "[시작] (북유성대로 89) 유성대학약국",
  "bd2838c0-ab43-5554-a384-9279d53d8616:4": "(북유성대로35-35) 우리약국",
  "bd2838c0-ab43-5554-a384-9279d53d8616:8": "도우미꽃식물원 (다육식물마트부터 도우미 꽃 식물원 사이에 꽃집들 있으면 댓글로 남겨주세요.)",

  // 210번: 전체 1줄 개별 주소로 평탄화
  "4356263e-9b49-54b1-957f-474080327188:1": "A구역 시작 (북유성대로106) 부암야생화",
  "4356263e-9b49-54b1-957f-474080327188:2": "A구역 끝 대전철쭉분재원",
  "4356263e-9b49-54b1-957f-474080327188:3": "B구역 시작 (노은동 141-7) 솔초농원",
  "4356263e-9b49-54b1-957f-474080327188:4": "B구역 끝 대전꽃백화점",
  "4356263e-9b49-54b1-957f-474080327188:5": "C구역 시작 (북유성대로 42) 밷엘농원",
  "4356263e-9b49-54b1-957f-474080327188:7": "C구역 끝 취미분재원",

  // ④ 514번 #12 오타 `2)` 제거
  "8716b2e2-f947-5d02-9dd2-f157835b337c:12": "(은구비남로 33번길68)\n4층 작심스터디",

  // ⑤ 엑셀 수식(=HYPERLINK) 및 날짜 자동변환 오류 수정 (365, 371, 449번)
  "58567a27-0f60-5410-97d1-9f315edc9281:1": "A구역 (은구비로138번길 75)",
  "58567a27-0f60-5410-97d1-9f315edc9281:2": "(후문정문있음=한집) 35-10",
  "58567a27-0f60-5410-97d1-9f315edc9281:11": "B구역 (은구비로138번길 33)",
  "58567a27-0f60-5410-97d1-9f315edc9281:17": "5-4",
  "58567a27-0f60-5410-97d1-9f315edc9281:22": "5-5",
  "58567a27-0f60-5410-97d1-9f315edc9281:23": "5-6",
  "58567a27-0f60-5410-97d1-9f315edc9281:24": "5-9",
  "58567a27-0f60-5410-97d1-9f315edc9281:25": "5-10",
  "58567a27-0f60-5410-97d1-9f315edc9281:26": "5-11",
  "58567a27-0f60-5410-97d1-9f315edc9281:27": "5-12",
  "58567a27-0f60-5410-97d1-9f315edc9281:28": "5-15",
  "58567a27-0f60-5410-97d1-9f315edc9281:29": "5-16",
  "58567a27-0f60-5410-97d1-9f315edc9281:30": "5-17",
  "58567a27-0f60-5410-97d1-9f315edc9281:31": "5-20",

  "59337748-ec38-5ccd-aeff-e338e864db24:1": "구역 시작 (하기로66번길 64) [안쪽 마을 모두 해주세요]",
  "59337748-ec38-5ccd-aeff-e338e864db24:2": "(하기로41) 새뜰농장",

  "67b587b2-ce55-5507-a1ba-92917a65fb70:1": "1번구역 유성IC쪽 (월드컵대로 49-1)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:2": "49-6 갑동골푸드",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:6": "(월드컵대로49-20) (주)수성이엔지",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:7": "(월드컵대로49-22) 금강사",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:11": '(월드컵대로 31) 커피숍 유성IC쪽길 "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:12": "1번구역 유성IC반대쪽길 (월드컵대로51번길1)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:14": "9-2",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:15": "9-4",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:16": "9-5",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:17": "위 안쪽길 (월드컵대로51번길9-7)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:19": '2층 안쪽길 "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:24": "(월드컵대로51번길32) 227-3번지",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:25": "(월드컵대로51번길31) 흰색울타리집",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:27": "51-72 (개 많음 작은개부터 큰개까지 울타리안에 풀려있음)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:32": "갈림길 오른쪽안길 (월드컵대로51번길42-6) (주)화신테크",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:34": '36 갈림길오른쪽안길 "끝" 다시 갈림길로',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:40": '49 1번구역 "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:41": "2번구역 (월드컵대로51번길52)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:42": "(월드컵대로51번길 51-4) 식자재 회사",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:43": "식자재회사 기준으로 왼쪽길 (유성대로51번길51-7)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:47": '51-66 두갈래왼쪽길 "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:48": '두갈래 오른쪽길 (유성대로51번길51-40) "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:49": '2번시작지점 "(주)정채움" 기준으로 오른쪽길',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:50": "올라가서왼쪽길 (유성대로51번길51-18)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:52": "53-27 (개 조심 울타리안에 풀려있음)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:53": '53-39,53-48 개있음 왼쪽길 "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:54": "끝에서 나오면서 왼쪽길로 (유성대로51번길53-30) Made Club",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:58": '53-20 공사중인건물기준 오른쪽길 "끝"',
  "67b587b2-ce55-5507-a1ba-92917a65fb70:59": "3번구역 (월드컵대로67-10) 쌍용자동차 서비스센터",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:60": "(월드컵대로 63-1) 세차장",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:66": "(현충원로507) 대한민국고엽제전우회",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:67": "(현충원로509) SK주유소",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:69": "(현충원로519-10) YK기업",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:70": "(현충원로519-4) 장대8통 마을회관",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:71": "(현충원로521) 다모아축산",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:72": "다모아축산에서 쭉 올라오세요 (월드컵대로51번길57)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:73": "왼쪽작은덩어리입니다 (월드컵대로51번길57-18)",
  "67b587b2-ce55-5507-a1ba-92917a65fb70:77": '92 작은덩어리구역 "끝" 이 길로 더 나오면 축복받는교회 나옴',

  // 기타 단독 번지 연속 구간(337, 393번)
  "32d6f4b1-0460-5505-a251-5d9756758034:81": '여기서부터는 "은구비로 146번길" 입니다. 46',
  "a9c67653-3250-5b01-86c2-5b6cf785ab5e:14": "(유성대로729번길 49-10) 새중앙교회",
  "a9c67653-3250-5b01-86c2-5b6cf785ab5e:56": "(유성대로719번길 41) (주)융창전력",
  "a9c67653-3250-5b01-86c2-5b6cf785ab5e:59": "안쪽길 (유성대로719번길 19)",
  "a9c67653-3250-5b01-86c2-5b6cf785ab5e:80": "(유성대로719번길 1) 템퍼",
};

export interface NormalizeResult {
  units: TerritoryUnit[];
  updatedUnits: { id: string; address_unit: string }[];
  deletedUnitIds: string[];
}

/**
 * 299·301·302번 카드의 도로명주소 단독 행을 다음 상가 행과 결합(방안 B)
 */
function applyPlanBMerge(cardId: string, units: TerritoryUnit[]): {
  merged: TerritoryUnit[];
  deletedIds: string[];
} {
  if (cardId !== CARD_299_ID && cardId !== CARD_301_ID && cardId !== CARD_302_ID) {
    return { merged: units, deletedIds: [] };
  }

  const deletedIds: string[] = [];
  const merged: TerritoryUnit[] = [];

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const addr = u.address_unit.trim();
    const next = i + 1 < units.length ? units[i + 1] : null;
    const nextAddr = next ? next.address_unit.trim() : "";

    if (cardId === CARD_299_ID) {
      if (addr.includes("은구비서로3길34") && addr.includes("오땅비어")) {
        merged.push({
          ...u,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로3길34) "상가구역 입니다" 오땅비어',
        });
        continue;
      }
      if (addr === "(은구비서로3번길 20)" && next && nextAddr.includes("남도주막")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로3번길 20) "상가 구역입니다." 1층 남도주막',
        });
        i++;
        continue;
      }
      if (addr === "(은구비서로3길8-5)" && next && nextAddr.includes("샤넬")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로3길8-5) "상가 구역입니다"\n1층 샤넬',
        });
        i++;
        continue;
      }
      if (addr === "(은구비서로3길8-9)" && next && nextAddr.includes("기타교실")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로3길8-9) "상가 구역입니다"\n1층 기타교실',
        });
        i++;
        continue;
      }
      if (addr === "(은구비서로3길8-13)" && next && nextAddr.includes("타임")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로3길8-13) "상가 구역입니다" 1층 타임',
        });
        i++;
        continue;
      }
    } else if (cardId === CARD_301_ID) {
      if (addr === "(은구비서로23번길 52)" && next && nextAddr.includes("라드커피")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로23번길 52) "상가구역 입니다" 1층 라드커피',
        });
        i++;
        continue;
      }
      if (addr === "(은구비서로23번길 8-24)" && next && nextAddr.includes("근육풀이")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로23번길 8-24) "상가 구역입니다"\n1층 근육풀이',
        });
        i++;
        continue;
      }
      if (addr === "(은구비서로 31)" && next && nextAddr.includes("여유사")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로 31) "상가 구역입니다"\n여유사',
        });
        i++;
        continue;
      }
      if (addr.startsWith("(은구비서로 31-1)") && !addr.includes("3층") && next && nextAddr === "3층") {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로 31-1)\n"상가는 하지말아주세요"\n3층',
        });
        i++;
        continue;
      }
    } else if (cardId === CARD_302_ID) {
      if (addr === "(은구비서로23길8-7)" && next && nextAddr.includes("피아노")) {
        deletedIds.push(u.id);
        merged.push({
          ...next,
          seq_no: merged.length + 1,
          address_unit: '(은구비서로23길8-7) "상가 구역입니다" 1층 피아노',
        });
        i++;
        continue;
      }
    }

    merged.push(u.seq_no !== merged.length + 1 ? { ...u, seq_no: merged.length + 1 } : u);
  }

  return { merged, deletedIds };
}

/**
 * 카드의 집 주소 목록에서 엑셀 줄바꿈으로 인해 잘못 묶인 주소들을 정규화한다 (상세 변경내역 포함).
 */
export function normalizeCardUnitsDetailed(units: TerritoryUnit[]): NormalizeResult {
  if (units.length === 0) {
    return { units, updatedUnits: [], deletedUnitIds: [] };
  }
  const cardId = units[0].card_id;
  const origAddrById = new Map<string, string>();
  for (const u of units) {
    origAddrById.set(u.id, u.address_unit);
  }

  // 446번, 516번(방안 A) 카드는 모든 줄바꿈을 공백으로 1줄 평탄화
  if (FLATTEN_ALL_CARD_IDS.has(cardId)) {
    const normalized = units.map((u) => {
      if (hasAdminGroupMarker(u.address_unit) || !/\r?\n/.test(u.address_unit)) return u;
      const singleLine = u.address_unit
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ");
      return singleLine !== u.address_unit ? { ...u, address_unit: singleLine } : u;
    });
    const updatedUnits: { id: string; address_unit: string }[] = [];
    for (const u of normalized) {
      if (u.address_unit !== origAddrById.get(u.id)) {
        updatedUnits.push({ id: u.id, address_unit: u.address_unit });
      }
    }
    return { units: normalized, updatedUnits, deletedUnitIds: [] };
  }

  // 299, 301, 302번 방안 B 병합 먼저 적용
  const { merged: afterPlanB, deletedIds } = applyPlanBMerge(cardId, units);

  // Pass 0: 사용자 컨펌 완료된 개별 세대 매핑 우선 적용
  const pass0 = afterPlanB.map((u) => {
    const key = `${u.card_id}:${u.seq_no}`;
    if (hasAdminGroupMarker(u.address_unit)) return u;
    const override = EXPLICIT_UNIT_OVERRIDES[key];
    if (override !== undefined && override !== u.address_unit) {
      return { ...u, address_unit: override };
    }
    return u;
  });

  // Pass 1: 괄호 내부 줄바꿈 결합(Rule A), 마지막 줄 괄호 메모 결합(Rule B), 층/호수 줄바꿈 결합(Rule C)
  const pass1 = pass0.map((u) => {
    const key = `${u.card_id}:${u.seq_no}`;
    if (hasAdminGroupMarker(u.address_unit) || EXPLICIT_UNIT_OVERRIDES[key] !== undefined) return u;

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
    const nextCur = cur.replace(
      /\(([^()]*?)\r?\n\s*([^()]*?)\)/g,
      (_, g1: string, g2: string) => `(${g1.trim()} ${g2.trim()})`
    );
    if (nextCur !== cur) {
      cur = nextCur;
      triggered = true;
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
  const finalUnits = pass1.map((u, idx) => {
    const key = `${u.card_id}:${u.seq_no}`;
    if (hasAdminGroupMarker(u.address_unit) || EXPLICIT_UNIT_OVERRIDES[key] !== undefined) return u;

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
      if (followAddr.startsWith(STANDALONE_MARKER)) break;
      if (!followAddr.startsWith(GROUP_MEMBER_MARKER) && isRoadAddress(stripAdminMarkers(followAddr))) break;
      nonRoadSubCount++;
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

  const updatedUnits: { id: string; address_unit: string }[] = [];
  for (const u of finalUnits) {
    if (u.address_unit !== origAddrById.get(u.id)) {
      updatedUnits.push({ id: u.id, address_unit: u.address_unit });
    }
  }

  return { units: finalUnits, updatedUnits, deletedUnitIds: deletedIds };
}

export function normalizeCardUnits(units: TerritoryUnit[]): TerritoryUnit[] {
  return normalizeCardUnitsDetailed(units).units;
}

/** 주소 한 칸을 (그룹 제목 줄들, 호수)로 분해 */
export function splitAddress(address: string): { groupTitle: string | null; label: string } {
  const lines = stripAdminMarkers(address)
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
      const shouldBreakGroup =
        unit.address_unit.startsWith(STANDALONE_MARKER) ||
        (!unit.address_unit.startsWith(GROUP_MEMBER_MARKER) && isRoadAddress(label));
      if (!current || (current.group !== null && shouldBreakGroup)) {
        current = { key: `top-${unit.id}`, group: null, items: [] };
        blocks.push(current);
      }
      current.items.push({ unit, group: current.group, label, definesGroup: false });
    }
  }
  return blocks;
}
