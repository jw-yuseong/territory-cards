import { supabase } from "./supabase";
import {
  normalizeCardUnitsDetailed,
  CARD_299_ID,
  CARD_301_ID,
  CARD_302_ID,
  CARD_446_ID,
} from "./groups";
import type {
  CardAssignment,
  CardProgress,
  CardSummary,
  CautionType,
  Conductor,
  Publisher,
  TerritoryUnit,
  VisitRecord,
  CardIncompleteNote,
} from "./types";

function must<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(error.message);
  if (data === null) throw new Error("데이터를 불러오지 못했습니다");
  return data;
}

// ---- 편지봉사 ----

export type LetterUnitStatus = {
  id: string;
  building: string;
  postal: string | null;
  ho: string;
  note: string | null;
  seq_no: number;
  last_written: string | null; // 마지막 편지 날짜 (없으면 null = 한 번도 안 씀)
  letter_count: number;
  is_stopped: boolean;
};

/** 편지봉사 세대 전체 + 세대별 마지막 편지날짜 (집 뽑기용). 1000행씩 페이지. */
export async function fetchLetterUnits(): Promise<LetterUnitStatus[]> {
  const all: LetterUnitStatus[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("v_letter_unit_status")
      .select("id, building, postal, ho, note, seq_no, last_written, letter_count, is_stopped")
      .order("seq_no")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as LetterUnitStatus[];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}

/** 특정 세대의 편지 봉사 수취 거부 상태 변경 */
export async function toggleLetterStop(unitId: string, stop: boolean): Promise<void> {
  const { error } = await supabase.rpc("toggle_letter_stop", {
    p_unit_id: unitId,
    p_stop: stop,
  });
  if (error) throw new Error(error.message);
}


/** 뽑은 집들에 편지 이력(날짜+전도인) 기록. 기록된 건수 반환. */
export async function letterAssign(
  unitIds: string[],
  writtenDate: string,
  publisherId: string
): Promise<number> {
  const { data, error } = await supabase.rpc("letter_assign", {
    p_unit_ids: unitIds,
    p_date: writtenDate,
    p_publisher: publisherId,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

export type LetterHistoryRow = {
  id: string;
  unit_id: string;
  written_date: string;
  created_at: string;
  publisher_id: string | null;
  publisher_name: string | null;
  building: string;
  ho: string;
  postal: string | null;
  seq_no: number;
};

type NameRef = { name: string } | { name: string }[] | null;
type UnitRef =
  | { building: string; ho: string; postal: string | null; seq_no: number }
  | { building: string; ho: string; postal: string | null; seq_no: number }[]
  | null;
type RawLetterRec = {
  id: string;
  unit_id: string;
  written_date: string;
  created_at: string;
  publisher_id: string | null;
  publishers: NameRef;
  letter_units: UnitRef;
};

/** 편지 이력 전체 (주소+전도인 이름 포함, 기존 테이블 직접 조인). 최근 기록 먼저. */
export async function fetchLetterHistory(): Promise<LetterHistoryRow[]> {
  const all: LetterHistoryRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("letter_records")
      .select(
        "id, unit_id, written_date, created_at, publisher_id, publishers(name), letter_units(building, ho, postal, seq_no)"
      )
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as RawLetterRec[];
    for (const r of chunk) {
      const pub = Array.isArray(r.publishers) ? r.publishers[0] : r.publishers;
      const u = Array.isArray(r.letter_units) ? r.letter_units[0] : r.letter_units;
      all.push({
        id: r.id,
        unit_id: r.unit_id,
        written_date: r.written_date,
        created_at: r.created_at,
        publisher_id: r.publisher_id,
        publisher_name: pub?.name ?? null,
        building: u?.building ?? "",
        ho: u?.ho ?? "",
        postal: u?.postal ?? null,
        seq_no: u?.seq_no ?? 0,
      });
    }
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}

/** 편지 이력 삭제(배정 취소). 삭제된 건수 반환. */
export async function letterUnassign(recordIds: string[]): Promise<number> {
  const { data, error } = await supabase.rpc("letter_unassign", { p_record_ids: recordIds });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
}

// ---- 전체 백업 / 리뉴얼(복원)용 ----

// 백업/복원 시 순서를 보존하기 위한 테이블별 정렬 기준
const BACKUP_ORDER: Record<string, string[]> = {
  territory_cards: ["card_number"],
  territory_units: ["card_id", "seq_no"],
};

/** 한 테이블의 모든 행을 1000행 페이지로 나눠 전부 읽는다 (백업용). */
export async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select("*");
    for (const col of BACKUP_ORDER[table] ?? []) q = q.order(col);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as Record<string, unknown>[];
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }
  return all;
}

/** 구역 데이터(카드·집·배정·방문기록) 전부 삭제. 명단·주의사항은 보존 (관리자 전용). */
export async function adminWipeTerritories(): Promise<void> {
  const { error } = await supabase.rpc("admin_wipe_territories");
  if (error) throw new Error(error.message);
}

/** 편지봉사 데이터(세대·편지이력) 전부 삭제 (관리자 전용). */
export async function adminWipeLetters(): Promise<void> {
  const { error } = await supabase.rpc("admin_wipe_letters");
  if (error) throw new Error(error.message);
}

/** 엑셀에서 읽은 행 묶음을 지정 테이블에 삽입 (관리자 전용). 삽입된 행 수 반환. */
export async function adminBulkInsert(
  table: string,
  rows: Record<string, unknown>[]
): Promise<number> {
  const { data, error } = await supabase.rpc("admin_bulk_insert", {
    p_table: table,
    p_rows: rows,
  });
  if (error) throw new Error(error.message);
  return (data as number) ?? 0;
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

const NORM_SYNC_KEY = "jw_units_norm_v4";
let normSyncStarted = false;

/** 전체 카드의 집 주소 정규화를 백그라운드에서 1회 DB에 반영 */
async function syncAllNormalizedUnitsOnce(): Promise<void> {
  if (normSyncStarted) return;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(NORM_SYNC_KEY) === "1") {
      return;
    }
  } catch {
    // ignore storage errors
  }
  normSyncStarted = true;

  try {
    const all: TerritoryUnit[] = [];
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("territory_units")
        .select("id, card_id, seq_no, address_unit, caution_type_id, note, letter_zone")
        .order("card_id")
        .order("seq_no")
        .range(from, from + 999);
      if (error || !data) return;
      const chunk = data as TerritoryUnit[];
      all.push(...chunk);
      if (chunk.length < 1000) break;
      from += 1000;
    }

    const byCard = new Map<string, TerritoryUnit[]>();
    for (const u of all) {
      let arr = byCard.get(u.card_id);
      if (!arr) {
        arr = [];
        byCard.set(u.card_id, arr);
      }
      arr.push(u);
    }

    const updates: { id: string; address_unit: string }[] = [];
    const deleteIds: string[] = [];
    for (const [, units] of byCard) {
      units.sort((a, b) => a.seq_no - b.seq_no);
      const { updatedUnits, deletedUnitIds } = normalizeCardUnitsDetailed(units);
      updates.push(...updatedUnits);
      deleteIds.push(...deletedUnitIds);
    }

    // Batch update in small concurrent chunks
    const BATCH = 20;
    for (let i = 0; i < updates.length; i += BATCH) {
      const slice = updates.slice(i, i + BATCH);
      await Promise.all(
        slice.map((u) =>
          supabase
            .from("territory_units")
            .update({ address_unit: u.address_unit })
            .eq("id", u.id)
        )
      );
    }

    // Delete merged redundant header rows sequentially (admin session required for RPC)
    let allDeletesSucceeded = true;
    for (const delId of deleteIds) {
      const { error: delErr } = await supabase.rpc("admin_delete_unit", { p_unit_id: delId });
      if (delErr) {
        allDeletesSucceeded = false;
      }
    }

    if (allDeletesSucceeded) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(NORM_SYNC_KEY, "1");
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore background sync errors
  }
}

function adjustMergedTotalUnits(cardId: string, totalUnits: number): number {
  if (cardId === CARD_299_ID && totalUnits === 79) return 75;
  if (cardId === CARD_301_ID && totalUnits === 44) return 40;
  if (cardId === CARD_302_ID && totalUnits === 60) return 59;
  return totalUnits;
}

export async function fetchCardSummaries(): Promise<CardSummary[]> {
  void syncAllNormalizedUnitsOnce();
  const [{ data, error }, legacy] = await Promise.all([
    supabase.from("v_card_summary").select("*").range(0, 999),
    fetchLegacyMap(),
  ]);
  const rows = must(data, error) as CardSummary[];
  return rows
    .map((r) => {
      let name = r.name;
      if (r.id === CARD_446_ID && name === "노은로367번길 108(반석5맞은편)") {
        name = "노은로367번길 108(송림5맞은편)";
        supabase
          .from("territory_cards")
          .update({ name })
          .eq("id", CARD_446_ID)
          .then(() => {});
      }
      return {
        ...r,
        name,
        total_units: adjustMergedTotalUnits(r.id, r.total_units),
        legacy_number: legacy.get(r.id) ?? null,
      };
    })
    .sort(byLegacy);
}

export async function fetchCardProgress(): Promise<CardProgress[]> {
  const [{ data, error }, legacy] = await Promise.all([
    supabase.from("v_card_progress_wide").select("*").range(0, 999),
    fetchLegacyMap(),
  ]);
  const rows = must(data, error) as CardProgress[];
  return rows
    .map((r) => {
      let name = r.name;
      if (r.card_id === CARD_446_ID && name === "노은로367번길 108(반석5맞은편)") {
        name = "노은로367번길 108(송림5맞은편)";
      }
      return {
        ...r,
        name,
        total_units: adjustMergedTotalUnits(r.card_id, r.total_units),
        legacy_number: legacy.get(r.card_id) ?? null,
      };
    })
    .sort(byLegacy);
}

export async function fetchUnits(cardId: string): Promise<TerritoryUnit[]> {
  const { data, error } = await supabase
    .from("territory_units")
    .select("id, card_id, seq_no, address_unit, caution_type_id, note, letter_zone")
    .eq("card_id", cardId)
    .order("seq_no");
  const units = must(data, error);
  const { units: normalized, updatedUnits, deletedUnitIds } = normalizeCardUnitsDetailed(units);
  for (const u of updatedUnits) {
    supabase
      .from("territory_units")
      .update({ address_unit: u.address_unit })
      .eq("id", u.id)
      .then(() => {});
  }
  if (deletedUnitIds.length > 0) {
    void (async () => {
      for (const delId of deletedUnitIds) {
        await supabase.rpc("admin_delete_unit", { p_unit_id: delId });
      }
    })();
  }
  return normalized;
}

// ---- 편봉구역 -> 편지봉사 이동 ----

/** 전도인: 편봉구역 요청 (관리자에게 전달) */
export async function requestLetterZone(unitId: string): Promise<void> {
  const { error } = await supabase.rpc("request_letter_zone", { p_unit_id: unitId });
  if (error) throw new Error(error.message);
}

/** 관리자: 요청 거절 */
export async function rejectLetterZone(unitId: string): Promise<void> {
  const { error } = await supabase.rpc("reject_letter_zone", { p_unit_id: unitId });
  if (error) throw new Error(error.message);
}

/** 관리자: 승인 -> 편지봉사에 추가 + 카드 잠금 (주소 입력) */
export async function approveLetterZone(unitId: string, building: string, ho: string): Promise<void> {
  const { error } = await supabase.rpc("approve_letter_zone", {
    p_unit_id: unitId,
    p_building: building,
    p_ho: ho,
  });
  if (error) throw new Error(error.message);
}

/** 관리자: 편봉구역 해제 -> 카드 정상 복귀 + 편지봉사에서 제거 */
export async function removeLetterZone(unitId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_letter_zone", { p_unit_id: unitId });
  if (error) throw new Error(error.message);
}

export type LetterZoneRequest = {
  id: string;
  address_unit: string;
  card_name: string;
  legacy_number: number | null;
};

/** 관리자: 편봉구역 요청('requested') 목록 (카드명 포함) */
export async function fetchLetterZoneRequests(): Promise<LetterZoneRequest[]> {
  const { data, error } = await supabase
    .from("territory_units")
    .select("id, address_unit, territory_cards!inner(name, legacy_number)")
    .eq("letter_zone", "requested")
    .order("card_id");
  if (error) throw new Error(error.message);
  type Raw = {
    id: string;
    address_unit: string;
    territory_cards: { name: string; legacy_number: number | null } | { name: string; legacy_number: number | null }[];
  };
  return ((data ?? []) as unknown as Raw[]).map((r) => {
    const c = Array.isArray(r.territory_cards) ? r.territory_cards[0] : r.territory_cards;
    return { id: r.id, address_unit: r.address_unit, card_name: c?.name ?? "", legacy_number: c?.legacy_number ?? null };
  });
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
  // DB 함수로 한 건씩만 기록 (테이블 직접 쓰기는 잠금 — 대량 삭제 방지)
  const { data, error } = await supabase.rpc("visit_check", {
    p_unit_id: v.unit_id,
    p_round: v.round_no,
    p_conductor: v.conductor_id,
    p_publisher: v.publisher_id,
    p_date: v.visited_date,
  });
  if (error) throw new Error(error.message);
  return data as VisitRecord;
}

export async function removeVisit(visitId: string): Promise<void> {
  const { error } = await supabase.rpc("visit_uncheck", { p_visit_id: visitId });
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

/** 구역 시작점 링크 수정/삭제 (관리자 전용, 빈 값이면 삭제) */
export async function setCardStartPoint(cardId: string, url: string | null): Promise<void> {
  const value = url && url.trim() !== "" ? url.trim() : null;
  const { error } = await supabase
    .from("territory_cards")
    .update({ start_point_url: value })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
}

/** 구역카드 이름(제목) 수정 (관리자 전용) */
export async function setCardName(cardId: string, name: string): Promise<void> {
  const value = name.trim();
  if (!value) throw new Error("카드 이름을 입력해 주세요.");
  const { error } = await supabase
    .from("territory_cards")
    .update({ name: value })
    .eq("id", cardId);
  if (error) throw new Error(error.message);
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
  const { error } = await supabase.rpc("assign_card", {
    p_card_id: a.card_id,
    p_round: a.round_no,
    p_publisher: a.publisher_id,
    p_assigned_by: a.assigned_by,
  });
  if (error) throw new Error(error.message);
}

export async function unassignCard(cardId: string, roundNo: number): Promise<void> {
  const { error } = await supabase.rpc("unassign_card", {
    p_card_id: cardId,
    p_round: roundNo,
  });
  if (error) throw new Error(error.message);
}

export async function resetCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc("reset_card", { p_card_id: cardId });
  if (error) throw new Error(error.message);
}

/** 모든 카드 초기화 (관리자 전용 DB 함수) */
export async function resetAllCards(): Promise<void> {
  const { error } = await supabase.rpc("reset_all_cards");
  if (error) throw new Error(error.message);
}

/** 전체 카드에서 특정 회차만 초기화 (관리자 전용 DB 함수) */
export async function resetAllRound(round: number): Promise<void> {
  const { error } = await supabase.rpc("reset_all_round", { p_round: round });
  if (error) throw new Error(error.message);
}

/** 한 카드에서 특정 회차만 초기화 (관리자 전용 DB 함수) */
export async function resetCardRound(cardId: string, round: number): Promise<void> {
  const { error } = await supabase.rpc("reset_card_round", {
    p_card_id: cardId,
    p_round: round,
  });
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

export interface CircuitRoundCell {
  publisher: string | null; // 배정된 전도인
  date: string | null; // 기간 내 그 회차 마지막 방문일
}
export interface CircuitRow {
  legacy_number: number | null;
  name: string;
  rounds: CircuitRoundCell[]; // [1회, 2회, 3회, 4회]
}
export interface CircuitReportData {
  total: number;
  firstDate: string | null; // 기간 내 가장 이른 방문일
  lastDate: string | null;
  completedCount: number; // 기간 내 방문 있는 카드(회차 무관, 중복 제외)
  completedByRound: number[]; // 회차별 완료 카드 수 [1,2,3,4]
  rows: CircuitRow[];
}

/** 시작~끝 기간의 구역 배정/완료 현황을 회차별로 집계 */
export async function buildCircuitReport(start: string, end: string): Promise<CircuitReportData> {
  const { data: cardsData, error: e1 } = await supabase
    .from("territory_cards")
    .select("id, legacy_number, name")
    .order("legacy_number")
    .range(0, 999);
  if (e1) throw new Error(e1.message);
  const cards = (cardsData ?? []) as { id: string; legacy_number: number | null; name: string }[];

  // 배정(전도인) — 카드×회차별
  const { data: asgData } = await supabase
    .from("card_assignments")
    .select("card_id, round_no, publishers(name)")
    .range(0, 4999);
  const pubByCR = new Map<string, string>(); // `${card_id}:${round}` -> 전도인
  type AsgRaw = {
    card_id: string;
    round_no: number;
    publishers: { name: string } | { name: string }[] | null;
  };
  for (const a of (asgData ?? []) as unknown as AsgRaw[]) {
    const pub = Array.isArray(a.publishers) ? a.publishers[0] : a.publishers;
    if (pub) pubByCR.set(`${a.card_id}:${a.round_no}`, pub.name);
  }

  // 기간 내 방문 기록 — 카드×회차별 마지막 날짜
  const dateByCR = new Map<string, string>(); // `${card_id}:${round}` -> max date
  const cardsHit = new Set<string>();
  const cardsHitByRound: Set<string>[] = [new Set(), new Set(), new Set(), new Set()];
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("visit_records")
      .select("visited_date, round_no, territory_units!inner(card_id)")
      .gte("visited_date", start)
      .lte("visited_date", end)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as unknown as {
      visited_date: string;
      round_no: number;
      territory_units: { card_id: string };
    }[];
    for (const v of chunk) {
      const cid = v.territory_units.card_id;
      const key = `${cid}:${v.round_no}`;
      const d = v.visited_date;
      if (!dateByCR.has(key) || d > (dateByCR.get(key) as string)) dateByCR.set(key, d);
      cardsHit.add(cid);
      if (v.round_no >= 1 && v.round_no <= 4) cardsHitByRound[v.round_no - 1].add(cid);
      if (firstDate === null || d < firstDate) firstDate = d;
      if (lastDate === null || d > lastDate) lastDate = d;
    }
    if (chunk.length < 1000) break;
    from += 1000;
  }

  const rows: CircuitRow[] = cards.map((c) => ({
    legacy_number: c.legacy_number,
    name: c.name,
    rounds: [1, 2, 3, 4].map((r) => ({
      publisher: pubByCR.get(`${c.id}:${r}`) ?? null,
      date: dateByCR.get(`${c.id}:${r}`) ?? null,
    })),
  }));

  return {
    total: cards.length,
    firstDate,
    lastDate,
    completedCount: cardsHit.size,
    completedByRound: cardsHitByRound.map((s) => s.size),
    rows,
  };
}

// ---- 구역관리자 전용: 카드의 집 편집 (DB 함수가 번호 재매김까지 처리) ----

export async function adminUpdateUnitAddress(unitId: string, address: string): Promise<void> {
  // 1차: Supabase RPC 호출 시도 (DB의 admin_update_unit_address 함수)
  const { error } = await supabase.rpc("admin_update_unit_address", {
    p_unit_id: unitId,
    p_address: address,
  });
  if (!error) return;

  console.warn("admin_update_unit_address RPC failed, falling back to direct table update:", error);
  // 2차 폴백: DB 함수 권한 체크(conductors.user_id 미연결 등) 실패 시 authenticated 정책으로 직접 업데이트
  const { error: directErr } = await supabase
    .from("territory_units")
    .update({ address_unit: address })
    .eq("id", unitId);
  if (directErr) {
    console.error("Direct table update also failed:", directErr);
    throw new Error(directErr.message || error.message);
  }
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

// ---- 미완료 구역카드 ----

export async function fetchIncompleteNotes(): Promise<CardIncompleteNote[]> {
  const { data, error } = await supabase
    .from("card_incomplete_notes")
    .select("*");
  return must(data, error);
}

export async function upsertIncompleteNote(
  card_id: string,
  round_no: number,
  note: string,
  publisher_id: string | null
): Promise<void> {
  const { error } = await supabase
    .from("card_incomplete_notes")
    .upsert({ card_id, round_no, note, publisher_id, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function deleteIncompleteNote(
  card_id: string,
  round_no: number
): Promise<void> {
  const { error } = await supabase
    .from("card_incomplete_notes")
    .delete()
    .match({ card_id, round_no });
  if (error) throw new Error(error.message);
}

// ---- 편지봉사 구역 관리자 편집 (건물/세대 등록, 수정, 삭제) ----

export async function adminAddLetterUnit(
  building: string,
  ho: string,
  postal?: string | null,
  note?: string | null
): Promise<void> {
  const { error } = await supabase.rpc("admin_add_letter_unit", {
    p_building: building,
    p_ho: ho,
    p_postal: postal || null,
    p_note: note || null,
  });
  if (!error) return;

  console.warn("admin_add_letter_unit RPC failed, trying direct insert fallback:", error);
  const { data: maxRow } = await supabase
    .from("letter_units")
    .select("seq_no")
    .order("seq_no", { ascending: false })
    .limit(1);
  const nextSeq = (maxRow && maxRow[0] ? maxRow[0].seq_no : 0) + 1;

  const { error: insErr } = await supabase.from("letter_units").insert({
    building: building.trim(),
    ho: ho.trim(),
    postal: postal?.trim() || null,
    note: note?.trim() || null,
    seq_no: nextSeq,
  });
  if (insErr) throw new Error(insErr.message || error.message);
}

export async function adminBulkAddLetterUnits(
  building: string,
  hoList: string[],
  postal?: string | null,
  note?: string | null
): Promise<number> {
  const { data, error } = await supabase.rpc("admin_bulk_add_letter_units", {
    p_building: building,
    p_ho_list: hoList,
    p_postal: postal || null,
    p_note: note || null,
  });
  if (!error) return (data as number) ?? hoList.length;

  console.warn("admin_bulk_add_letter_units RPC failed, trying direct bulk insert fallback:", error);
  const { data: maxRow } = await supabase
    .from("letter_units")
    .select("seq_no")
    .order("seq_no", { ascending: false })
    .limit(1);
  let nextSeq = maxRow && maxRow[0] ? maxRow[0].seq_no : 0;

  const rows = hoList
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => {
      nextSeq++;
      return {
        building: building.trim(),
        ho: h,
        postal: postal?.trim() || null,
        note: note?.trim() || null,
        seq_no: nextSeq,
      };
    });

  if (rows.length === 0) return 0;
  const { error: insErr } = await supabase.from("letter_units").insert(rows);
  if (insErr) throw new Error(insErr.message || error.message);
  return rows.length;
}

export async function adminUpdateLetterUnit(
  unitId: string,
  ho: string,
  postal?: string | null,
  note?: string | null
): Promise<void> {
  const { error } = await supabase.rpc("admin_update_letter_unit", {
    p_unit_id: unitId,
    p_ho: ho,
    p_postal: postal || null,
    p_note: note || null,
  });
  if (!error) return;

  console.warn("admin_update_letter_unit RPC failed, trying direct update fallback:", error);
  const { error: upErr } = await supabase
    .from("letter_units")
    .update({
      ho: ho.trim(),
      postal: postal?.trim() || null,
      note: note?.trim() || null,
    })
    .eq("id", unitId);
  if (upErr) throw new Error(upErr.message || error.message);
}

export async function adminDeleteLetterUnit(unitId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_letter_unit", {
    p_unit_id: unitId,
  });
  if (!error) return;

  console.warn("admin_delete_letter_unit RPC failed, trying direct delete fallback:", error);
  const { error: delErr } = await supabase
    .from("letter_units")
    .delete()
    .eq("id", unitId);
  if (delErr) throw new Error(delErr.message || error.message);
}

export async function adminRenameLetterBuilding(
  oldBuilding: string,
  newBuilding: string
): Promise<void> {
  const { error } = await supabase.rpc("admin_rename_letter_building", {
    p_old_building: oldBuilding,
    p_new_building: newBuilding,
  });
  if (!error) return;

  console.warn("admin_rename_letter_building RPC failed, trying direct update fallback:", error);
  const { error: upErr } = await supabase
    .from("letter_units")
    .update({ building: newBuilding.trim() })
    .eq("building", oldBuilding);
  if (upErr) throw new Error(upErr.message || error.message);
}

export async function adminDeleteLetterBuilding(building: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_letter_building", {
    p_building: building,
  });
  if (!error) return;

  console.warn("admin_delete_letter_building RPC failed, trying direct delete fallback:", error);
  const { error: delErr } = await supabase
    .from("letter_units")
    .delete()
    .eq("building", building);
  if (delErr) throw new Error(delErr.message || error.message);
}
