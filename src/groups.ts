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
      if (!current) {
        // 카드 첫 부분에 그룹 없이 시작하는 집들 (호별 구역 등)
        current = { key: `top-${unit.id}`, group: null, items: [] };
        blocks.push(current);
      }
      current.items.push({ unit, group: current.group, label, definesGroup: false });
    }
  }
  return blocks;
}
