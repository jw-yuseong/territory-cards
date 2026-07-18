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
export async function fetchCardDest(
  cardId: string
): Promise<{ lat: number; lng: number; label: string } | null> {
  const { data, error } = await supabase
    .from("territory_cards")
    .select("dest_lat, dest_lng, dest_label")
    .eq("id", cardId)
    .single();
  if (error || !data || data.dest_lat == null || data.dest_lng == null) return null;
  return { lat: data.dest_lat, lng: data.dest_lng, label: data.dest_label ?? "구역카드" };
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
