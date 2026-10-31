export interface Conductor {
  id: string;
  name: string;
  is_admin: boolean;
  is_active: boolean;
}

export interface Publisher {
  id: string;
  name: string;
  is_active: boolean;
}

export interface CautionType {
  id: number;
  label: string;
  is_do_not_call: boolean;
}

export interface CardSummary {
  id: string;
  card_number: number;
  legacy_number: number | null; // 기존 종이카드 번호 (화면 표시용, 중복 있음)
  name: string;
  address_summary: string | null;
  total_units: number;
  do_not_call_units: number;
}

/** 화면에 보여줄 카드 번호 = 기존 종이카드 번호 */
export function displayNo(c: { legacy_number: number | null }): string {
  return c.legacy_number === null ? "?" : String(c.legacy_number);
}

export interface TerritoryUnit {
  id: string;
  card_id: string;
  seq_no: number;
  address_unit: string;
  caution_type_id: number | null;
  note: string | null;
  letter_zone: "requested" | "active" | null;
}

export interface VisitRecord {
  id: string;
  unit_id: string;
  round_no: number;
  conductor_id: string;
  publisher_id: string;
  visited_date: string;
  checked_at: string; // 체크한 시각 (같은 카드에 다시 들어올 때 마지막 기록 찾기용)
}

export interface CardAssignment {
  id: string;
  card_id: string;
  round_no: number;
  publisher_id: string;
  assigned_by: string;
}

export interface CardProgress {
  card_id: string;
  card_number: number;
  legacy_number: number | null;
  name: string;
  total_units: number;
  r1_visited: number;
  r2_visited: number;
  r3_visited: number;
  r4_visited: number;
  r1_publisher: string | null;
  r2_publisher: string | null;
  r3_publisher: string | null;
  r4_publisher: string | null;
  last_visited_date: string | null;
  r1_first_date?: string | null;
  r2_first_date?: string | null;
  r3_first_date?: string | null;
  r4_first_date?: string | null;
}

/** 선택 회차의 첫 방문일 (patch4 적용 전에는 undefined일 수 있음) */
export function roundFirstDate(p: CardProgress, round: number): string | null {
  return (
    [p.r1_first_date, p.r2_first_date, p.r3_first_date, p.r4_first_date][round - 1] ?? null
  );
}

export function roundVisited(p: CardProgress, round: number): number {
  return [p.r1_visited, p.r2_visited, p.r3_visited, p.r4_visited][round - 1] ?? 0;
}

export function roundPublisher(p: CardProgress, round: number): string | null {
  return [p.r1_publisher, p.r2_publisher, p.r3_publisher, p.r4_publisher][round - 1] ?? null;
}

export interface CardIncompleteNote {
  card_id: string;
  round_no: number;
  publisher_id: string | null;
  note: string;
  updated_at: string;
}

/** 501~519번 상가 구역카드 여부 판별 */
export function isCommercialCard(c: {
  legacy_number?: number | null;
  card_number?: number;
  name?: string;
}): boolean {
  const num = c.legacy_number ?? c.card_number;
  if (num !== undefined && num !== null && num >= 501 && num <= 519) return true;
  if (c.name && c.name.startsWith("(상)")) return true;
  return false;
}

/** 카드의 특정 회차가 완료되었는지 판별 */
export function isCardRoundDone(
  p: CardProgress,
  round: number,
  incompleteNote?: CardIncompleteNote
): boolean {
  if (p.total_units === 0) return false;
  // 미완료 보고가 있으면 해당 회차는 완료되지 않음
  if (incompleteNote && incompleteNote.round_no === round) return false;

  const visited = roundVisited(p, round);
  // 1) 전체 가구수를 모두 방문한 경우
  if (visited >= p.total_units) return true;

  // 2) 다음 회차에 이미 방문 기록이나 배정이 있으면 이전 회차는 완료된 것
  if (round < 4) {
    if (roundVisited(p, round + 1) > 0 || roundPublisher(p, round + 1)) {
      return true;
    }
  }

  // 3) 방문 기록이 있고, 오늘 방문 중이 아니며, 미완료 메모도 없는 경우 (과거 완료)
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (visited > 0 && p.last_visited_date !== todayStr) {
    return true;
  }

  return false;
}

/** 카드가 현재 진행해야 하는 활성 회차 (1~4) */
export function getCardActiveRound(
  p: CardProgress,
  incompleteNotesMap?: Map<string, CardIncompleteNote>
): number {
  for (let r = 1; r <= 3; r++) {
    const inc = incompleteNotesMap?.get(`${p.card_id}-${r}`) ?? incompleteNotesMap?.get(p.card_id);
    if (!isCardRoundDone(p, r, inc)) {
      return r;
    }
  }
  return 4;
}
