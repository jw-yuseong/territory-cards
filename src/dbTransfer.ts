// 전체 DB 백업(엑셀 내보내기) + 전체 리뉴얼(엑셀에서 복원)
import { adminBulkInsert, adminWipeTerritories, fetchAllRows } from "./api";

type Row = Record<string, unknown>;

// 백업 파일에 담는 테이블과 컬럼 순서 (엑셀 시트 헤더로도 사용)
const COLS: Record<string, string[]> = {
  conductors: ["id", "user_id", "name", "phone", "is_admin", "is_active", "created_at"],
  publishers: ["id", "user_id", "name", "is_active", "created_at"],
  caution_types: ["id", "label", "is_do_not_call"],
  territory_cards: [
    "id", "card_number", "legacy_number", "name", "address_summary", "source_file",
    "created_at", "dest_lat", "dest_lng", "dest_label", "start_point_url",
  ],
  territory_units: ["id", "card_id", "seq_no", "address_unit", "caution_type_id", "note", "created_at"],
  card_assignments: ["id", "card_id", "round_no", "publisher_id", "assigned_by", "assigned_at"],
  visit_records: ["id", "unit_id", "round_no", "conductor_id", "publisher_id", "visited_date", "checked_at"],
};

const BACKUP_TABLES = Object.keys(COLS);
// 리뉴얼 때 실제로 지우고 다시 채우는 테이블 (FK 순서). 명단·주의사항은 건드리지 않음.
const RESTORE_TABLES = ["territory_cards", "territory_units", "card_assignments", "visit_records"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v.trim());
}
function newId(): string {
  return crypto.randomUUID();
}
function keyOf(v: unknown): string {
  return String(v ?? "").trim();
}

// ---------- 백업: 전체 테이블 -> 엑셀 다운로드 ----------
export async function downloadBackup(onProgress?: (msg: string) => void): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const t of BACKUP_TABLES) {
    onProgress?.(`${t} 읽는 중...`);
    const rows = await fetchAllRows(t);
    const ws =
      rows.length > 0
        ? XLSX.utils.json_to_sheet(rows, { header: COLS[t] })
        : XLSX.utils.aoa_to_sheet([COLS[t]]); // 빈 테이블도 헤더는 남김
    XLSX.utils.book_append_sheet(wb, ws, t);
  }
  const today = new Date().toISOString().slice(0, 10);
  onProgress?.("엑셀 파일 만드는 중...");
  XLSX.writeFile(wb, `JW01_전체백업_${today}.xlsx`);
}

export type RestoreSummary = { [table: string]: number };

// ---------- 리뉴얼: 엑셀 파일 -> 구역 데이터 완전 교체 ----------
export async function restoreFromFile(
  file: File,
  existingPublisherIds: Set<string>,
  existingConductorIds: Set<string>,
  onProgress?: (msg: string) => void
): Promise<RestoreSummary> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const read = (name: string): Row[] => {
    const ws = wb.Sheets[name];
    return ws ? (XLSX.utils.sheet_to_json(ws, { defval: null }) as Row[]) : [];
  };

  const cards = read("territory_cards");
  const units = read("territory_units");
  const assignments = read("card_assignments");
  const visits = read("visit_records");

  if (cards.length === 0) {
    throw new Error("'territory_cards' 시트가 비어 있습니다. 백업 파일과 같은 양식인지 확인해 주세요.");
  }

  // --- id 재매핑: 유효한 UUID는 그대로, 아니면 새로 발급하고 관계를 이어준다 ---
  // (백업 파일은 그대로 복원되고, 사람이 만든 파일은 임의 키로도 연결됨)
  const cardMap = new Map<string, string>();
  for (const c of cards) {
    if (!keyOf(c.name)) throw new Error("이름(name)이 없는 카드가 있습니다.");
    const orig = keyOf(c.id);
    const id = isUuid(orig) ? orig : newId();
    if (orig) cardMap.set(orig, id);
    c.id = id;
  }

  const unitMap = new Map<string, string>();
  for (const u of units) {
    const orig = keyOf(u.id);
    const id = isUuid(orig) ? orig : newId();
    if (orig) unitMap.set(orig, id);
    u.id = id;
    const ck = keyOf(u.card_id);
    const mapped = cardMap.get(ck);
    if (!mapped) {
      throw new Error(`집(주소 "${keyOf(u.address_unit)}")이 참조하는 카드 id(${ck})가 카드 시트에 없습니다.`);
    }
    u.card_id = mapped;
    if (u.seq_no === null || u.seq_no === undefined || u.seq_no === "") {
      throw new Error(`집(주소 "${keyOf(u.address_unit)}")에 번호(seq_no)가 없습니다.`);
    }
  }

  for (const a of assignments) {
    a.id = isUuid(keyOf(a.id)) ? keyOf(a.id) : newId();
    const ck = keyOf(a.card_id);
    const mapped = cardMap.get(ck);
    if (!mapped) throw new Error(`배정 기록이 참조하는 카드 id(${ck})가 카드 시트에 없습니다.`);
    a.card_id = mapped;
    if (!existingPublisherIds.has(keyOf(a.publisher_id)))
      throw new Error(`배정 기록의 전도인 id(${keyOf(a.publisher_id)})가 현재 명단에 없습니다. 명단을 먼저 맞춰 주세요.`);
    if (!existingConductorIds.has(keyOf(a.assigned_by)))
      throw new Error(`배정 기록의 인도자 id(${keyOf(a.assigned_by)})가 현재 명단에 없습니다.`);
  }

  for (const v of visits) {
    v.id = isUuid(keyOf(v.id)) ? keyOf(v.id) : newId();
    const uk = keyOf(v.unit_id);
    const mapped = unitMap.get(uk);
    if (!mapped) throw new Error(`방문 기록이 참조하는 집 id(${uk})가 집 시트에 없습니다.`);
    v.unit_id = mapped;
    if (!existingConductorIds.has(keyOf(v.conductor_id)))
      throw new Error(`방문 기록의 인도자 id(${keyOf(v.conductor_id)})가 현재 명단에 없습니다.`);
    if (!existingPublisherIds.has(keyOf(v.publisher_id)))
      throw new Error(`방문 기록의 전도인 id(${keyOf(v.publisher_id)})가 현재 명단에 없습니다.`);
  }

  // --- 여기까지 통과하면 데이터가 안전하므로 삭제 후 삽입 ---
  const byTable: Record<string, Row[]> = {
    territory_cards: cards,
    territory_units: units,
    card_assignments: assignments,
    visit_records: visits,
  };

  onProgress?.("기존 구역 데이터 삭제 중...");
  await adminWipeTerritories();

  const summary: RestoreSummary = {};
  for (const t of RESTORE_TABLES) {
    const rows = byTable[t];
    let done = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      await adminBulkInsert(t, batch);
      done += batch.length;
      onProgress?.(`${t} 복원 중... ${done}/${rows.length}`);
    }
    summary[t] = rows.length;
  }
  return summary;
}
