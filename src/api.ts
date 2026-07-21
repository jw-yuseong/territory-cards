import { supabase } from "./supabase";
import type {
  CardAssignment,
  CardProgress,
  CardSummary,
  CautionType,
  Conductor,
  Publisher,
  TerritoryUnit,
  VisitRecord,
} from "./types";

function must<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("데이터를 불러오지 못했습니다");
  return data;
}

export async function fetchConductors(): Promise<Conductor[]> {
  const { data, error } = await supabase
    .from("conductors")
    .select("id, name, is_admin, is_active")
    .eq("is_active", true)
    .order("name");
  return must(data, error);
}

export async function fetchPublishers(): Promise<Publisher[]> {
  const { data, error } = await supabase
    .from("publishers")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name");
  return must(data, error);
}

export async function fetchCautionTypes(): Promise<CautionType[]> {
  const { data, error } = await supabase
    .from("caution_types")
    .select("id, label, is_do_not_call")
    .order("id");
  return must(data, error);
}

/** 기존 종이카드 번호 매핑 (card id -> legacy_number) */
async function fetchLegacyMap(): Promise<Map<string, number | null>> {
  const { data, error } = await supabase
    .from("territory_cards")
    .select("id, legacy_number")
    .range(0, 999);
  const rows = must(data, error);
  return new Map(rows.map((r) => [r.id as string, r.legacy_number as number | null]));
}

/** 기존 종이카드 번호 순 정렬 (번호 없는 카드는 맨 뒤, 중복은 새 번호 순) */
function byLegacy(a: { legacy_number: number | null; card_number: number },
                  b: { legacy_number: number | null; card_number: number }): number {
  const la = a.legacy_number ?? Number.MAX_SAFE_INTEGER;
  const lb = b.legacy_number ?? Number.MAX_SAFE_INTEGER;
  return la - lb || a.card_number - b.card_number;
}

export async function fetchCardSummaries(): Promise<CardSummary[]> {
  const [{ data, error }, legacy] = await Promise.all([
    supabase.from("v_card_summary").select("*").range(0, 999),
    fetchLegacyMap(),
  ]);
  const rows = must(data, error) as CardSummary[];
  return rows
    .map((r) => ({ ...r, legacy_number: legacy.get(r.id) ?? null }))
    .sort(byLegacy);
}

export async function fetchCardProgress(): Promise<CardProgress[]> {
  const [{ data, error }, legacy] = await Promise.all([
    supabase.from("v_card_progress_wide").select("*").range(0, 999),
    fetchLegacyMap(),
  ]);
  const rows = must(data, error) as CardProgress[];
  return rows
    .map((r) => ({ ...r, legacy_number: legacy.get(r.card_id) ?? null }))
    .sort(byLegacy);
}

export async function fetchUnits(cardId: string): Promise<TerritoryUnit[]> {
  const { data, error } = await supabase
    .from("territory_units")
    .select("id, card_id, seq_no, address_unit, caution_type_id, note")
    .eq("card_id", cardId)
    .order("seq_no");
  return must(data, error);
}

export async function fetchVisits(cardId: string): Promise<VisitRecord[]> {
  const { data, error } = await supabase
    .from("visit_records")
    .select("id, unit_id, round_no, conductor_id, publisher_id, visited_date, checked_at, territory_units!inner(card_id)")
    .eq("territory_units.card_id", cardId);
  return must(data as unknown as VisitRecord[], error);
}

export async function fetchAssignments(cardId: string): Promise<CardAssignment[]> {
  const { data, error } = await supabase
    .from("card_assignments")
    .select("id, card_id, round_no, publisher_id, assigned_by")
    .eq("card_id", cardId);
  return must(data, error);
}

export async function addVisit(v: {
  unit_id: string;
  round_no: number;
  conductor_id: string;
  publisher_id: string;
  visited_date: string;
}): Promise<VisitRecord> {
  const { data, error } = await supabase
    .from("visit_records")
    .insert(v)
    .select("id, unit_id, round_no, conductor_id, publisher_id, visited_date, checked_at")
    .single();
  return must(data, error);
}

export async function removeVisit(visitId: string): Promise<void> {
  const { error } = await supabase.from("visit_records").delete().eq("id", visitId);
  if (error) throw new Error(error.message);
}

export async function setUnitCaution(unitId: string, cautionTypeId: number | null): Promise<void> {
  const { error } = await supabase
    .from("territory_units")
    .update({ caution_type_id: cautionTypeId })
    .eq("id", unitId);
  if (error) throw new Error(error.message);
}

/** 길찾기 도착점 좌표 (patch5 적용 전이거나 좌표가 없으면 null) */
/** 구역 시작점 카카오맵 링크 (엑셀 A6에 넣어둔 kko.to 링크, 없으면 null) */
export async function fetchCardStartPoint(cardId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("territory_cards")
    .select("start_point_url")
    .eq("id", cardId)
    .single();
  if (error || !data || !data.start_point_url) return null;
  return data.start_point_url as string;
}

/** 봉사자 메모 저장/삭제 (빈 문자열이면 삭제) */
export async function setUnitNote(unitId: string, note: string | null): Promise<void> {
  const { error } = await supabase
    .from("territory_units")
    .update({ note: note && note.trim() !== "" ? note.trim() : null })
    .eq("id", unitId);
  if (error) throw new Error(error.message);
}

/** 메모가 남아있는 집 전체 (관리자 '메모 모아보기'용) */
export interface MemoUnit {
  id: string;
  card_id: string;
  seq_no: number;
  address_unit: string;
  note: string;
  territory_cards: { legacy_number: number | null; name: string };
}

export async function fetchMemoUnits(): Promise<MemoUnit[]> {
  const { data, error } = await supabase
    .from("territory_units")
    .select("id, card_id, seq_no, address_unit, note, territory_cards(legacy_number, name)")
    .not("note", "is", null)
    .range(0, 499);
  return must(data as unknown as MemoUnit[], error);
}

export async function assignCard(a: {
  card_id: string;
  round_no: number;
  publisher_id: string;
  assigned_by: string;
}): Promise<void> {
  const { error } = await supabase
    .from("card_assignments")
    .upsert(a, { onConflict: "card_id,round_no" });
  if (error) throw new Error(error.message);
}

export async function unassignCard(cardId: string, roundNo: number): Promise<void> {
  const { error } = await supabase
    .from("card_assignments")
    .delete()
    .eq("card_id", cardId)
    .eq("round_no", roundNo);
  if (error) throw new Error(error.message);
}

export async function resetCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc("reset_card", { p_card_id: cardId });
  if (error) throw new Error(error.message);
}

/** 모든 카드 초기화: 전체 방문 기록과 배정을 삭제 (관리자 화면 전용) */
export async function resetAllCards(): Promise<void> {
  const { error: e1 } = await supabase.from("visit_records").delete().gte("round_no", 1);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase.from("card_assignments").delete().gte("round_no", 1);
  if (e2) throw new Error(e2.message);
}

/** 전체 카드에서 특정 회차만 초기화 (방문 체크 + 배정 삭제) */
export async function resetAllRound(round: number): Promise<void> {
  const { error: e1 } = await supabase.from("visit_records").delete().eq("round_no", round);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await supabase.from("card_assignments").delete().eq("round_no", round);
  if (e2) throw new Error(e2.message);
}

/** 한 카드에서 특정 회차만 초기화 (방문 체크 + 배정 삭제) */
export async function resetCardRound(cardId: string, round: number): Promise<void> {
  const { data: units } = await supabase
    .from("territory_units")
    .select("id")
    .eq("card_id", cardId)
    .range(0, 999);
  const unitIds = (units ?? []).map((u) => (u as { id: string }).id);
  for (let i = 0; i < unitIds.length; i += 100) {
    const { error } = await supabase
      .from("visit_records")
      .delete()
      .eq("round_no", round)
      .in("unit_id", unitIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase
    .from("card_assignments")
    .delete()
    .eq("card_id", cardId)
    .eq("round_no", round);
  if (error) throw new Error(error.message);
}

// ---- 구역관리자 전용: 명단(인도자/전도인) 추가·삭제 ----

export async function addConductor(name: string): Promise<void> {
  const { error } = await supabase.from("conductors").insert({ name: name.trim() });
  if (error) throw new Error(error.message);
}

export async function addPublisher(name: string): Promise<void> {
  const { error } = await supabase.from("publishers").insert({ name: name.trim() });
  if (error) throw new Error(error.message);
}

/** 삭제: 참조 기록이 없으면 완전 삭제, 있으면 비활성화(숨김)로 기록 보존 */
export async function removeConductor(id: string): Promise<"deleted" | "hidden"> {
  const { error } = await supabase.from("conductors").delete().eq("id", id);
  if (!error) return "deleted";
  const { error: e2 } = await supabase.from("conductors").update({ is_active: false }).eq("id", id);
  if (e2) throw new Error(e2.message);
  return "hidden";
}

export async function removePublisher(id: string): Promise<"deleted" | "hidden"> {
  const { error } = await supabase.from("publishers").delete().eq("id", id);
  if (!error) return "deleted";
  const { error: e2 } = await supabase.from("publishers").update({ is_active: false }).eq("id", id);
  if (e2) throw new Error(e2.message);
  return "hidden";
}

// ---- 구역관리자 전용: 새 구역카드 업로드 ----

/** 같은 번호의 카드가 이미 있는지 */
export async function cardExists(legacyNumber: number): Promise<boolean> {
  const { data } = await supabase
    .from("territory_cards")
    .select("id")
    .eq("legacy_number", legacyNumber)
    .limit(1);
  return (data ?? []).length > 0;
}

/** 새 카드를 지정 번호 위치에 끼워넣기 (그 번호부터 뒤 카드는 +1로 밀림). DB 함수가 원자적으로 처리 */
export async function insertCardAt(
  position: number,
  card: { name: string; source_file: string; start_point_url: string | null; units: string[] }
): Promise<void> {
  const { error } = await supabase.rpc("admin_insert_card_at", {
    p_position: position,
    p_name: card.name,
    p_source: card.source_file,
    p_start_url: card.start_point_url,
    p_units: card.units,
  });
  if (error) throw new Error(error.message);
}

/** 카드 삭제 (집·방문기록·배정 함께 삭제, 뒤 번호는 -1로 당김) */
export async function deleteCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_card", { p_card_id: cardId });
  if (error) throw new Error(error.message);
}

// ---- 순회 방문용 서류(구역 배정 기록) 보고서 ----

export interface CircuitRow {
  legacy_number: number | null;
  name: string;
  publisher: string | null;
  completed_date: string | null; // 기간 내 마지막 방문일
}
export interface CircuitReportData {
  total: number;
  firstDate: string | null; // 기간 내 가장 이른 방문일
  lastDate: string | null;
  completedCount: number;
  rows: CircuitRow[];
}

/** 시작~끝 기간의 구역 배정/완료 현황을 집계 */
export async function buildCircuitReport(start: string, end: string): Promise<CircuitReportData> {
  // 1) 카드
  const { data: cardsData, error: e1 } = await supabase
    .from("territory_cards")
    .select("id, legacy_number, name")
    .order("legacy_number")
    .range(0, 999);
  if (e1) throw new Error(e1.message);
  const cards = (cardsData ?? []) as { id: string; legacy_number: number | null; name: string }[];

  // 2) 배정(전도인) — 카드별 가장 높은 회차의 배정 전도인
  const { data: asgData } = await supabase
    .from("card_assignments")
    .select("card_id, round_no, publishers(name)")
    .range(0, 4999);
  const asgByCard = new Map<string, { round: number; name: string }>();
  type AsgRaw = {
    card_id: string;
    round_no: number;
    publishers: { name: string } | { name: string }[] | null;
  };
  for (const a of (asgData ?? []) as unknown as AsgRaw[]) {
    const pub = Array.isArray(a.publishers) ? a.publishers[0] : a.publishers;
    const cur = asgByCard.get(a.card_id);
    if (pub && (!cur || a.round_no > cur.round)) {
      asgByCard.set(a.card_id, { round: a.round_no, name: pub.name });
    }
  }

  // 3) 기간 내 방문 기록 (페이지 처리)
  const dateByCard = new Map<string, string>(); // card_id -> max visited_date
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("visit_records")
      .select("visited_date, territory_units!inner(card_id)")
      .gte("visited_date", start)
      .lte("visited_date", end)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as { visited_date: string; territory_units: { card_id: string } }[];
    for (const v of chunk) {
      const cid = v.territory_units.card_id;
      const d = v.visited_date;
      if (!dateByCard.has(cid) || d > (dateByCard.get(cid) as string)) dateByCard.set(cid, d);
      if (firstDate === null || d < firstDate) firstDate = d;
      if (lastDate === null || d > lastDate) lastDate = d;
    }
    if (chunk.length < 1000) break;
    from += 1000;
  }

  const rows: CircuitRow[] = cards.map((c) => ({
    legacy_number: c.legacy_number,
    name: c.name,
    publisher: asgByCard.get(c.id)?.name ?? null,
    completed_date: dateByCard.get(c.id) ?? null,
  }));

  return {
    total: cards.length,
    firstDate,
    lastDate,
    completedCount: [...dateByCard.keys()].length,
    rows,
  };
}

// ---- 구역관리자 전용: 카드의 집 편집 (DB 함수가 번호 재매김까지 처리) ----

export async function adminUpdateUnitAddress(unitId: string, address: string): Promise<void> {
  const { error } = await supabase.rpc("admin_update_unit_address", {
    p_unit_id: unitId,
    p_address: address,
  });
  if (error) throw new Error(error.message);
}

export async function adminDeleteUnit(unitId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_unit", { p_unit_id: unitId });
  if (error) throw new Error(error.message);
}

export async function adminInsertUnit(
  cardId: string,
  afterSeq: number,
  address: string
): Promise<void> {
  const { error } = await supabase.rpc("admin_insert_unit", {
    p_card_id: cardId,
    p_after_seq: afterSeq,
    p_address: address,
  });
  if (error) throw new Error(error.message);
}

/** 로그인한 계정이 관리자(conductors.is_admin)로 연결되어 있는지 */
export async function fetchIsAdmin(): Promise<boolean> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase
    .from("conductors")
    .select("id")
    .eq("user_id", uid)
    .eq("is_admin", true)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
