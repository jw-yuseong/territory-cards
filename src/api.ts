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
  CartSchedule,
  CartPublisher,
  CartApplication,
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

export async function assignCard(
  cardOrObj:
    | {
        card_id: string;
        round_no: number;
        publisher_id: string;
        assigned_by: string;
      }
    | string,
  round_no?: number,
  publisher_id?: string,
  assigned_by?: string
): Promise<void> {
  const p =
    typeof cardOrObj === "string"
      ? {
          card_id: cardOrObj,
          round_no: round_no!,
          publisher_id: publisher_id!,
          assigned_by: assigned_by!,
        }
      : cardOrObj;

  const { error } = await supabase.rpc("assign_card", {
    p_card_id: p.card_id,
    p_round: p.round_no,
    p_publisher: p.publisher_id,
    p_assigned_by: p.assigned_by,
  });
  if (!error) return;

  console.warn("assign_card RPC failed, trying direct upsert fallback:", error);
  const { error: upErr } = await supabase.from("card_assignments").upsert(
    {
      card_id: p.card_id,
      round_no: p.round_no,
      publisher_id: p.publisher_id,
      assigned_by: p.assigned_by,
      assigned_at: new Date().toISOString(),
    },
    { onConflict: "card_id,round_no" }
  );
  if (upErr) throw new Error(upErr.message || error.message);
}

export async function unassignCard(cardId: string, roundNo: number): Promise<void> {
  const { error } = await supabase.rpc("unassign_card", {
    p_card_id: cardId,
    p_round: roundNo,
  });
  if (!error) return;

  console.warn("unassign_card RPC failed, trying direct delete fallback:", error);
  const { error: delErr } = await supabase
    .from("card_assignments")
    .delete()
    .match({ card_id: cardId, round_no: roundNo });
  if (delErr) throw new Error(delErr.message || error.message);
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


// ---- 전시대 (Cart) API ----

export async function fetchCartSchedules(): Promise<CartSchedule[]> {
  const { data, error } = await supabase
    .from("cart_schedules")
    .select("id, day_of_week, start_time, end_time, time_label, meeting_note, sort_order, is_active")
    .eq("is_active", true)
    .order("day_of_week")
    .order("start_time")
    .order("sort_order");
  return must(data, error);
}

export async function addCartSchedule(input: {
  day_of_week: number;
  start_time: string;
  end_time: string;
  time_label: string;
  meeting_note: string;
}): Promise<void> {
  const { error } = await supabase.from("cart_schedules").insert({
    day_of_week: input.day_of_week,
    start_time: input.start_time.trim(),
    end_time: input.end_time.trim(),
    time_label: input.time_label.trim(),
    meeting_note: input.meeting_note.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function updateCartSchedule(
  id: string,
  input: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    time_label: string;
    meeting_note: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from("cart_schedules")
    .update({
      day_of_week: input.day_of_week,
      start_time: input.start_time.trim(),
      end_time: input.end_time.trim(),
      time_label: input.time_label.trim(),
      meeting_note: input.meeting_note.trim(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCartSchedule(id: string): Promise<void> {
  // 과거 전시대 조 편성 기록(3개월 참여 횟수)을 영구 보존하기 위해
  // 물리 삭제 대신 비활성화(is_active = false)로 처리한다.
  const { error } = await supabase
    .from("cart_schedules")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

const CART_PUB_SYNC_KEY = "jw_cart_pub_sync_v1_72";
const APPROVED_72_CART_PUBLISHERS = [
  "강영출", "강은경", "강현화", "곽이연", "권지혜", "김경민", "김광식", "김동근", "김명운", "김미영",
  "김미자", "김상철", "김영경", "김예원", "김용훈", "김윤건", "김윤미", "김윤서", "김은정", "김진기",
  "나성숙", "문지혜", "문현숙", "민소원", "박귀숙", "박보람", "박수빈", "박용진", "박유록", "박정자",
  "박현서", "박희수", "배옥자", "백상기", "백성민", "서미란", "서병순", "손점연", "손필수", "송길순",
  "송진선", "신은영", "양기수", "양승", "양지애", "여향숙", "예진영", "이경복", "이규연", "이선해",
  "이영이", "이윤순", "이은비", "이재준", "이채연", "이하나", "이하영", "이향순", "이형재", "이호석",
  "이화정", "장미선", "전순녀", "정상빈", "조명옥", "채은화", "최광득", "최윤서", "최호운", "켈리타니아",
  "황덕환", "황아경",
];

const REMOVED_19_CART_PUBLISHERS = new Set([
  "강은아", "권순단", "김광택", "노우정", "노화선", "박가원", "박성화", "박시원", "서복순", "서홍범",
  "오연례", "윤혜자", "이미애", "이영자", "임정은", "정순자", "조명희", "최애리", "최화례",
]);

export async function fetchCartPublishers(): Promise<CartPublisher[]> {
  const { data, error } = await supabase
    .from("cart_publishers")
    .select("id, name, is_active")
    .eq("is_active", true)
    .order("name");
  const rows = must(data, error);

  // 구역관리자 세션에서 이전 91명 초기값 중 제외된 19명이 남아있으면 DB에서도 자동 정리
  try {
    const toRemove = rows.filter((r) => REMOVED_19_CART_PUBLISHERS.has(r.name));
    if (toRemove.length > 0 && typeof localStorage !== "undefined" && localStorage.getItem(CART_PUB_SYNC_KEY) !== "1") {
      void (async () => {
        const ids = toRemove.map((r) => r.id);
        const { error: delErr } = await supabase.from("cart_publishers").delete().in("id", ids);
        if (!delErr) {
          localStorage.setItem(CART_PUB_SYNC_KEY, "1");
        } else {
          const { error: hideErr } = await supabase
            .from("cart_publishers")
            .update({ is_active: false })
            .in("id", ids);
          if (!hideErr) localStorage.setItem(CART_PUB_SYNC_KEY, "1");
        }
      })();
    }
  } catch {
    // ignore background sync errors
  }

  // 만약 DB에 아직 초기 91명이 들어있어서 제외된 19명이 포함되어 있다면(정리 전), 화면에서도 즉시 72명만 보이도록 필터링
  // (단, 관리자가 나중에 직접 추가한 다른 새 이름은 그대로 표시됨)
  if (rows.length > 72 && rows.some((r) => REMOVED_19_CART_PUBLISHERS.has(r.name))) {
    const approvedSet = new Set(APPROVED_72_CART_PUBLISHERS);
    return rows.filter((r) => approvedSet.has(r.name) || !REMOVED_19_CART_PUBLISHERS.has(r.name));
  }
  return rows;
}

export async function addCartPublisher(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");
  // 이미 숨김(is_active=false)으로 있는 이름이면 다시 활성화
  const { data: existing } = await supabase
    .from("cart_publishers")
    .select("id, is_active")
    .eq("name", trimmed)
    .limit(1);
  if (existing && existing.length > 0) {
    if (existing[0].is_active) {
      throw new Error(`'${trimmed}' 전도인은 이미 명단에 있습니다.`);
    }
    const { error: upErr } = await supabase
      .from("cart_publishers")
      .update({ is_active: true })
      .eq("id", existing[0].id);
    if (upErr) throw new Error(upErr.message);
    return;
  }
  const { error } = await supabase.from("cart_publishers").insert({ name: trimmed, is_active: true });
  if (error) throw new Error(error.message);
}

export async function removeCartPublisher(id: string): Promise<"deleted" | "hidden"> {
  const { error } = await supabase.from("cart_publishers").delete().eq("id", id);
  if (!error) return "deleted";
  const { error: e2 } = await supabase.from("cart_publishers").update({ is_active: false }).eq("id", id);
  if (e2) throw new Error(e2.message);
  return "hidden";
}

export async function fetchCartApplications(
  startDate: string,
  endDate: string
): Promise<CartApplication[]> {
  type RawRow = {
    id: string;
    schedule_id: string;
    service_date: string;
    publisher_id: string;
    created_at: string;
    is_cancelled?: boolean;
    cancelled_at?: string | null;
    cancel_reason?: string | null;
    cart_publishers: { name: string } | { name: string }[] | null;
  };

  let rows: RawRow[] = [];
  const { data, error } = await supabase
    .from("cart_applications")
    .select(
      "id, schedule_id, service_date, publisher_id, created_at, is_cancelled, cancelled_at, cancel_reason, cart_publishers(name)"
    )
    .gte("service_date", startDate)
    .lte("service_date", endDate)
    .order("created_at");

  if (error) {
    // cancel_reason 또는 is_cancelled 컬럼 적용 전일 경우 단계별 폴백
    const { data: fb1Data, error: fb1Err } = await supabase
      .from("cart_applications")
      .select(
        "id, schedule_id, service_date, publisher_id, created_at, is_cancelled, cancelled_at, cart_publishers(name)"
      )
      .gte("service_date", startDate)
      .lte("service_date", endDate)
      .order("created_at");
    if (!fb1Err) {
      rows = (fb1Data ?? []) as unknown as RawRow[];
    } else {
      const { data: fb2Data, error: fb2Err } = await supabase
        .from("cart_applications")
        .select("id, schedule_id, service_date, publisher_id, created_at, cart_publishers(name)")
        .gte("service_date", startDate)
        .lte("service_date", endDate)
        .order("created_at");
      if (fb2Err) throw new Error(fb2Err.message);
      rows = (fb2Data ?? []) as unknown as RawRow[];
    }
  } else {
    rows = (data ?? []) as unknown as RawRow[];
  }

  return rows.map((r) => {
    const pub = Array.isArray(r.cart_publishers) ? r.cart_publishers[0] : r.cart_publishers;
    return {
      id: r.id,
      schedule_id: r.schedule_id,
      service_date: r.service_date,
      publisher_id: r.publisher_id,
      publisher_name: pub?.name ?? "",
      created_at: r.created_at,
      is_cancelled: Boolean(r.is_cancelled),
      cancelled_at: r.cancelled_at ?? null,
      cancel_reason: r.cancel_reason ?? null,
    };
  });
}

export async function applyCartSlot(
  scheduleId: string,
  serviceDate: string,
  publisherId: string
): Promise<void> {
  // 이미 신청 또는 신청 취소 상태로 행이 있는지 먼저 확인
  const { data: existingRows } = await supabase
    .from("cart_applications")
    .select("id, is_cancelled")
    .match({
      schedule_id: scheduleId,
      service_date: serviceDate,
      publisher_id: publisherId,
    })
    .limit(1);

  if (existingRows && existingRows.length > 0) {
    const row = existingRows[0] as { id: string; is_cancelled?: boolean };
    if (row.is_cancelled) {
      // 신청 취소자 명단에 있던 사람이 다시 신청하면 원래대로 복구
      const { error: upErr } = await supabase
        .from("cart_applications")
        .update({ is_cancelled: false, cancelled_at: null, cancel_reason: null })
        .eq("id", row.id);
      if (upErr) {
        // cancel_reason 컬럼이 없을 경우 폴백
        const { error: upErr2 } = await supabase
          .from("cart_applications")
          .update({ is_cancelled: false, cancelled_at: null })
          .eq("id", row.id);
        if (upErr2) throw new Error(upErr2.message);
      }
      return;
    }
    throw new Error("이미 이 시간대에 신청하셨습니다.");
  }

  const { error } = await supabase.from("cart_applications").insert({
    schedule_id: scheduleId,
    service_date: serviceDate,
    publisher_id: publisherId,
  });
  if (error) {
    if (error.message.includes("duplicate") || error.message.includes("unique")) {
      throw new Error("이미 이 시간대에 신청하셨습니다.");
    }
    throw new Error(error.message);
  }
}

export async function cancelCartSlot(applicationId: string, reason: string): Promise<void> {
  const trimmedReason = reason.trim();
  const nowIso = new Date().toISOString();

  // 1차: 취소 상태 + 취소 사유(cancel_reason) 함께 저장
  const { data, error } = await supabase
    .from("cart_applications")
    .update({
      is_cancelled: true,
      cancelled_at: nowIso,
      cancel_reason: trimmedReason || null,
    })
    .eq("id", applicationId)
    .select("id");

  if (!error && data && data.length > 0) return;

  // 2차 폴백: cancel_reason 컬럼이 아직 없을 때 is_cancelled만 업데이트
  const { data: fbData, error: fbError } = await supabase
    .from("cart_applications")
    .update({
      is_cancelled: true,
      cancelled_at: nowIso,
    })
    .eq("id", applicationId)
    .select("id");

  if (!fbError && fbData && fbData.length > 0) return;

  // 3차 폴백: patch21 SQL 적용 전일 경우 delete
  console.warn("cancelCartSlot soft-cancel failed, falling back to delete:", error || fbError);
  const { error: delErr } = await supabase
    .from("cart_applications")
    .delete()
    .eq("id", applicationId);
  if (delErr) throw new Error(delErr.message || error?.message || "취소에 실패했습니다.");
}


// ---- 전시대 장소 (CartLocation) & 조 편성 (CartTeamPlan) ----

import type { CartLocation, CartTeamPlan } from "./types";

const DEFAULT_CART_LOCATIONS: CartLocation[] = [
  { id: "default-loc-1", name: "노은역 광장", sort_order: 1, is_active: true },
  { id: "default-loc-2", name: "에스컬레이터", sort_order: 2, is_active: true },
  { id: "default-loc-3", name: "코끼리 약국", sort_order: 3, is_active: true },
];

export async function fetchCartLocations(): Promise<CartLocation[]> {
  const { data, error } = await supabase
    .from("cart_locations")
    .select("id, name, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");
  if (error) {
    // patch20 SQL 적용 전에도 기본 3곳이 보이도록 폴백
    console.warn("fetchCartLocations failed, returning defaults:", error);
    return DEFAULT_CART_LOCATIONS;
  }
  const rows = (data ?? []) as CartLocation[];
  if (rows.length === 0) return DEFAULT_CART_LOCATIONS;
  return rows;
}

export async function addCartLocation(name: string, sortOrder: number): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("장소 이름을 입력해 주세요.");
  const { error } = await supabase.from("cart_locations").insert({
    name: trimmed,
    sort_order: sortOrder,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function updateCartLocation(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("장소 이름을 입력해 주세요.");
  const { error } = await supabase
    .from("cart_locations")
    .update({ name: trimmed })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteCartLocation(id: string): Promise<void> {
  // 과거 전시대 조 편성 기록(3개월 참여 횟수)을 영구 보존하기 위해
  // 물리 삭제 대신 비활성화(is_active = false)로 처리한다.
  const { error } = await supabase
    .from("cart_locations")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchCartTeamPlans(
  startDate: string,
  endDate: string
): Promise<CartTeamPlan[]> {
  // 1차: 스냅샷 컬럼(schedule_label, location_name) 포함 조회 (1000행 페이지 처리)
  const all: CartTeamPlan[] = [];
  let from = 0;
  let useLegacySelect = false;

  for (;;) {
    const selectCols = useLegacySelect
      ? "id, schedule_id, service_date, location_id, team_count, teams, updated_at"
      : "id, schedule_id, service_date, location_id, schedule_label, location_name, team_count, teams, updated_at";

    const { data, error } = await supabase
      .from("cart_team_plans")
      .select(selectCols)
      .gte("service_date", startDate)
      .lte("service_date", endDate)
      .order("service_date")
      .range(from, from + 999);

    if (error) {
      if (!useLegacySelect && from === 0) {
        // patch22 적용 전이면 스냅샷 컬럼 없이 다시 조회
        useLegacySelect = true;
        continue;
      }
      console.warn("fetchCartTeamPlans failed (patch20 may not be applied yet):", error);
      return all;
    }

    const chunk = ((data ?? []) as unknown as CartTeamPlan[]).map((row) => ({
      ...row,
      teams: Array.isArray(row.teams) ? row.teams : [],
    }));
    all.push(...chunk);
    if (chunk.length < 1000) break;
    from += 1000;
  }

  return all;
}

export async function upsertCartTeamPlan(input: {
  schedule_id: string;
  service_date: string;
  location_id: string;
  schedule_label?: string;
  location_name?: string;
  team_count: number;
  teams: string[][];
}): Promise<void> {
  const payloadWithSnapshot = {
    schedule_id: input.schedule_id,
    service_date: input.service_date,
    location_id: input.location_id,
    schedule_label: input.schedule_label ?? null,
    location_name: input.location_name ?? null,
    team_count: input.team_count,
    teams: input.teams,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("cart_team_plans")
    .upsert(payloadWithSnapshot, { onConflict: "schedule_id,service_date,location_id" });

  if (!error) return;

  // patch22 SQL 적용 전(스냅샷 컬럼 없음) 폴백
  const { error: fbErr } = await supabase.from("cart_team_plans").upsert(
    {
      schedule_id: input.schedule_id,
      service_date: input.service_date,
      location_id: input.location_id,
      team_count: input.team_count,
      teams: input.teams,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "schedule_id,service_date,location_id" }
  );
  if (fbErr) throw new Error(fbErr.message || error.message);
}

export async function deleteCartTeamPlan(
  scheduleId: string,
  serviceDate: string,
  locationId: string
): Promise<void> {
  const { error } = await supabase
    .from("cart_team_plans")
    .delete()
    .match({ schedule_id: scheduleId, service_date: serviceDate, location_id: locationId });
  if (error) throw new Error(error.message);
}


// ---- 날짜·시간대별 전시대 인도자 (CartSlotConductor) ----

import type { CartSlotConductor } from "./types";

export async function fetchCartSlotConductors(
  startDate: string,
  endDate: string
): Promise<CartSlotConductor[]> {
  const { data, error } = await supabase
    .from("cart_slot_conductors")
    .select("id, schedule_id, service_date, conductor_name, is_closed, closure_reason, updated_at")
    .gte("service_date", startDate)
    .lte("service_date", endDate)
    .order("service_date");
  if (!error) {
    return (data ?? []) as CartSlotConductor[];
  }
  // patch24(is_closed 컬럼) 미적용 시 이전 컬럼만 조회해 호환 유지
  const { data: legacy, error: legacyErr } = await supabase
    .from("cart_slot_conductors")
    .select("id, schedule_id, service_date, conductor_name, updated_at")
    .gte("service_date", startDate)
    .lte("service_date", endDate)
    .order("service_date");
  if (legacyErr) {
    console.warn("fetchCartSlotConductors failed (patch23 may not be applied yet):", legacyErr);
    return [];
  }
  return (legacy ?? []) as CartSlotConductor[];
}

export async function upsertCartSlotConductor(
  scheduleId: string,
  serviceDate: string,
  conductorName: string
): Promise<void> {
  const trimmed = conductorName.trim();
  if (!trimmed) {
    await deleteCartSlotConductor(scheduleId, serviceDate);
    return;
  }
  const { error } = await supabase.from("cart_slot_conductors").upsert(
    {
      schedule_id: scheduleId,
      service_date: serviceDate,
      conductor_name: trimmed,
      is_closed: false,
      closure_reason: "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "schedule_id,service_date" }
  );
  if (error) throw new Error(error.message);
}

/** 특정 날짜·시간대 전시대 휴무 지정/해제 (예: 상가봉사 주간) */
export async function setCartSlotClosed(
  scheduleId: string,
  serviceDate: string,
  isClosed: boolean,
  closureReason = "상가봉사 주간"
): Promise<void> {
  if (!isClosed) {
    await deleteCartSlotConductor(scheduleId, serviceDate);
    return;
  }
  const { error } = await supabase.from("cart_slot_conductors").upsert(
    {
      schedule_id: scheduleId,
      service_date: serviceDate,
      conductor_name: "",
      is_closed: true,
      closure_reason: closureReason.trim() || "전시대 휴무",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "schedule_id,service_date" }
  );
  if (error) throw new Error(error.message);
}

export async function deleteCartSlotConductor(
  scheduleId: string,
  serviceDate: string
): Promise<void> {
  const { error } = await supabase
    .from("cart_slot_conductors")
    .delete()
    .match({ schedule_id: scheduleId, service_date: serviceDate });
  if (error) throw new Error(error.message);
}

export async function bulkUpsertCartSlotConductors(
  rows: {
    schedule_id: string;
    service_date: string;
    conductor_name: string;
    is_closed?: boolean;
    closure_reason?: string;
  }[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const nowIso = new Date().toISOString();
  const payload = rows.map((r) => ({
    schedule_id: r.schedule_id,
    service_date: r.service_date,
    conductor_name: r.is_closed ? "" : r.conductor_name.trim(),
    is_closed: Boolean(r.is_closed),
    closure_reason: r.is_closed ? (r.closure_reason?.trim() || "상가봉사 주간") : "",
    updated_at: nowIso,
  }));
  const { error } = await supabase
    .from("cart_slot_conductors")
    .upsert(payload, { onConflict: "schedule_id,service_date" });
  if (error) throw new Error(error.message);
  return payload.length;
}

/** 오늘(todayYmd) 이전 날짜의 전시대 인도자 배정 레코드를 자동 삭제 */
export async function deletePastCartSlotConductors(todayYmd: string): Promise<void> {
  const { error } = await supabase
    .from("cart_slot_conductors")
    .delete()
    .lt("service_date", todayYmd);
  if (error) {
    console.warn("deletePastCartSlotConductors failed:", error);
  }
}
