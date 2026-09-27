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
