import { useEffect, useMemo, useState } from "react";
import {
  adminDeleteUnit,
  adminInsertUnit,
  adminUpdateUnitAddress,
  fetchCardStartPoint,
  fetchUnits,
  fetchVisits,
  removeLetterZone,
  setCardName,
  setCardStartPoint,
  setUnitNote,
} from "../api";
import { invalidateCardsCache } from "../lists";
import {
  buildGroups,
  GROUP_MEMBER_MARKER,
  GROUP_START_MARKER,
  STANDALONE_MARKER,
  stripAdminMarkers,
  type GroupBlock,
  type ParsedUnit,
} from "../groups";
import type { CardSummary, TerritoryUnit } from "../types";
import { displayNo } from "../types";
import { friendlyError } from "../errors";

type ModalState =
  | { mode: "edit"; unit: TerritoryUnit }
  | { mode: "add"; afterSeq: number };

/** 라벨 앞에 중복된 (그룹제목) 접두어가 있으면 제거 (남는 호수/상호가 있을 때만) */
function stripRedundantGroupPrefix(label: string, groupTitle: string): string {
  const cleanLabel = stripAdminMarkers(label).trim();
  const g = groupTitle.trim();
  if (!g) return cleanLabel;
  const parenPrefix = `(${g})`;
  if (cleanLabel.startsWith(parenPrefix)) {
    const rest = cleanLabel.slice(parenPrefix.length).trim();
    if (rest !== "") return rest;
  }
  return cleanLabel;
}

/** 기존 집으로 새 그룹을 만들 때 초기 (그룹제목, 첫 집 호수/이름) 자동 추출 */
function extractInitialGroupAndLabel(item: ParsedUnit): {
  initialGroup: string;
  initialLabel: string;
} {
  const cleanLabel = stripAdminMarkers(item.label).trim();
  if (item.group !== null) {
    return { initialGroup: item.group, initialLabel: cleanLabel };
  }
  const m = cleanLabel.match(/^\(([^()]+)\)\s+(.+)$/);
  if (m) {
    return { initialGroup: m[1].trim(), initialLabel: m[2].trim() };
  }
  return { initialGroup: "", initialLabel: cleanLabel };
}

export default function UnitEditor({
  card,
  onBack,
  focusUnitId,
}: {
  card: CardSummary;
  onBack: () => void;
  focusUnitId?: string | null;
}) {
  const [units, setUnits] = useState<TerritoryUnit[]>([]);
  const [visitCountByUnit, setVisitCountByUnit] = useState<Map<string, number>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cardName, setCardNameState] = useState(card.name);
  const [nameModal, setNameModal] = useState(false);
  const [startUrl, setStartUrl] = useState<string | null>(null);
  const [startModal, setStartModal] = useState(false);

  // 그룹 관련 모달 상태
  const [createGroupTarget, setCreateGroupTarget] = useState<TerritoryUnit | null>(null);
  const [addGroupAfterSeq, setAddGroupAfterSeq] = useState<number | null>(null);
  const [editingGroupBlock, setEditingGroupBlock] = useState<GroupBlock | null>(null);
  const [dissolvingGroupBlock, setDissolvingGroupBlock] = useState<GroupBlock | null>(null);

  useEffect(() => {
    setCardNameState(card.name);
    fetchCardStartPoint(card.id).then(setStartUrl).catch(() => setStartUrl(null));
  }, [card.id, card.name]);

  async function reload() {
    const [u, v] = await Promise.all([fetchUnits(card.id), fetchVisits(card.id)]);
    setUnits(u);
    const counts = new Map<string, number>();
    for (const visit of v) {
      counts.set(visit.unit_id, (counts.get(visit.unit_id) ?? 0) + 1);
    }
    setVisitCountByUnit(counts);
    invalidateCardsCache();
    return u;
  }

  useEffect(() => {
    reload()
      .then((u) => {
        const groups = buildGroups(u);
        // 메모로 지목된 집이 속한 동은 펼쳐두고, 나머지 동은 접어둠
        const focusKey = focusUnitId
          ? groups.find((b) => b.items.some((it) => it.unit.id === focusUnitId))?.key
          : undefined;
        setCollapsed(
          new Set(
            groups
              .filter((b) => b.group !== null && b.key !== focusKey)
              .map((b) => b.key)
          )
        );
        // 그 집을 선택 표시 + 화면 이동
        if (focusUnitId) {
          setSelected(focusUnitId);
          setTimeout(() => {
            document
              .getElementById("ue-" + focusUnitId)
              ?.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 250);
        }
      })
      .catch((e) => setError(friendlyError(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selected) ?? null,
    [units, selected]
  );

  const blocks = useMemo(() => buildGroups(units), [units]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // 전체 집을 번호순으로 펼친 배열 (각 집이 속한 블록 정보 포함)
  const flatItems = useMemo(() => {
    const list: { item: ParsedUnit; block: GroupBlock; indexInBlock: number }[] = [];
    for (const b of blocks) {
      b.items.forEach((it, idx) => {
        list.push({ item: it, block: b, indexInBlock: idx });
      });
    }
    return list;
  }, [blocks]);

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function run(op: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await op();
      await reload();
      return true;
    } catch (e) {
      const msg = friendlyError(e);
      setError(msg);
      alert(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(unit: TerritoryUnit) {
    const visits = visitCountByUnit.get(unit.id) ?? 0;
    const warn =
      visits > 0
        ? `\n⚠ 이 집에는 방문 기록 ${visits}건이 있습니다. 함께 삭제됩니다.`
        : "";
    const block = blocks.find((b) => b.items.some((it) => it.unit.id === unit.id));
    const item = block?.items.find((it) => it.unit.id === unit.id);
    if (
      !window.confirm(
        `${unit.seq_no}번 "${stripAdminMarkers(unit.address_unit)}" 집을 삭제할까요?\n뒤 집들의 번호가 하나씩 당겨집니다.${warn}`
      )
    )
      return;
    setSelected(null);
    await run(async () => {
      // 그룹의 첫 집을 삭제할 때 아래에 같은 그룹 집이 남아 있으면 다음 집에 그룹 제목을 자동 승계
      if (item?.definesGroup && block && block.group !== null && block.items.length > 1) {
        const nextItem = block.items[1];
        const nextAddr = `${GROUP_START_MARKER}(${block.group})\n${stripAdminMarkers(nextItem.label).trim()}`;
        await adminUpdateUnitAddress(nextItem.unit.id, nextAddr);
      }
      await adminDeleteUnit(unit.id);
    });
  }

  /** 1) 원터치 [🔓 그룹에서 분리] */
  async function handleSeparateFromGroup(unitId: string) {
    const found = flatItems.find((x) => x.item.unit.id === unitId);
    if (!found || found.block.group === null) return;

    const groupName = found.block.group;
    const { item, block, indexInBlock } = found;
    const updates: { id: string; address: string }[] = [];

    if (indexInBlock === 0) {
      // 그룹의 첫 번째 집을 분리하는 경우:
      // 첫 집은 (그룹명)을 포함한 1줄 독립 주소로 만들고, 2번째 집이 있으면 그룹 제목을 넘겨줌
      const cleanLabel = stripAdminMarkers(item.label).trim();
      const standaloneText = cleanLabel.includes(groupName)
        ? cleanLabel
        : `(${groupName}) ${cleanLabel}`;
      updates.push({
        id: item.unit.id,
        address: `${STANDALONE_MARKER}${standaloneText}`,
      });

      if (block.items.length > 1) {
        const second = block.items[1];
        const secondLabel = stripAdminMarkers(second.label).trim();
        updates.push({
          id: second.unit.id,
          address: `${GROUP_START_MARKER}(${groupName})\n${secondLabel}`,
        });
      }
    } else {
      // 그룹의 중간 또는 마지막 집을 분리하는 경우:
      const cleanLabel = stripAdminMarkers(item.label).trim();
      updates.push({
        id: item.unit.id,
        address: `${STANDALONE_MARKER}${cleanLabel}`,
      });

      // 첫 집이 1세대만 남더라도 평탄화되지 않도록 그룹 시작 마커 보장
      const first = block.items[0];
      if (!first.unit.address_unit.startsWith(GROUP_START_MARKER)) {
        updates.push({
          id: first.unit.id,
          address: `${GROUP_START_MARKER}(${groupName})\n${stripAdminMarkers(first.label).trim()}`,
        });
      }

      // 중간 집을 분리해서 아래에 같은 그룹 집들이 남아 있다면, 바로 다음 집에 그룹 제목을 부여해 그룹 유지
      if (indexInBlock < block.items.length - 1) {
        const nextInGroup = block.items[indexInBlock + 1];
        const nextLabel = stripAdminMarkers(nextInGroup.label).trim();
        updates.push({
          id: nextInGroup.unit.id,
          address: `${GROUP_START_MARKER}(${groupName})\n${nextLabel}`,
        });
      }
    }

    await run(async () => {
      for (const u of updates) {
        await adminUpdateUnitAddress(u.id, u.address);
      }
    });
  }

  /** 2) 원터치 [🔗 위 그룹에 포함] */
  async function handleJoinAboveGroup(unitId: string) {
    const flatIdx = flatItems.findIndex((x) => x.item.unit.id === unitId);
    if (flatIdx <= 0) return;

    const currentEntry = flatItems[flatIdx];
    const prevEntry = flatItems[flatIdx - 1];
    if (prevEntry.block.group === null) return;

    const aboveGroup = prevEntry.block.group;
    const updates: { id: string; address: string }[] = [];

    // 위 그룹의 첫 집에 그룹 시작 마커 보장
    const aboveFirst = prevEntry.block.items[0];
    if (!aboveFirst.unit.address_unit.startsWith(GROUP_START_MARKER)) {
      updates.push({
        id: aboveFirst.unit.id,
        address: `${GROUP_START_MARKER}(${aboveGroup})\n${stripAdminMarkers(aboveFirst.label).trim()}`,
      });
    }

    // 현재 집을 위 그룹의 하위 세대로 편입
    const cleanLabel = stripRedundantGroupPrefix(currentEntry.item.label, aboveGroup);
    updates.push({
      id: currentEntry.item.unit.id,
      address: `${GROUP_MEMBER_MARKER}${cleanLabel}`,
    });

    // 만약 현재 집이 다른 그룹의 첫 집이었고 그 아래에 세대가 더 있었다면, 다음 집에 기존 그룹 제목을 승계
    if (
      currentEntry.block.group !== null &&
      currentEntry.block.group !== aboveGroup &&
      currentEntry.indexInBlock === 0 &&
      currentEntry.block.items.length > 1
    ) {
      const nextInOldGroup = currentEntry.block.items[1];
      updates.push({
        id: nextInOldGroup.unit.id,
        address: `${GROUP_START_MARKER}(${currentEntry.block.group})\n${stripAdminMarkers(
          nextInOldGroup.label
        ).trim()}`,
      });
    } else if (
      currentEntry.block.group === null &&
      flatIdx + 1 < flatItems.length &&
      flatItems[flatIdx + 1].block.group === null
    ) {
      // 현재 집이 독립 집이었고 바로 아래 집도 독립 집이었다면, 아래 집이 덩달아 위 그룹에 빨려 들어가지 않도록 독립 마커 부여
      const nextStandalone = flatItems[flatIdx + 1].item;
      if (!nextStandalone.unit.address_unit.startsWith(STANDALONE_MARKER)) {
        updates.push({
          id: nextStandalone.unit.id,
          address: `${STANDALONE_MARKER}${stripAdminMarkers(nextStandalone.label).trim()}`,
        });
      }
    }

    // 위 그룹이 접혀 있었다면 펼쳐서 결과를 바로 확인할 수 있게 함
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(prevEntry.block.key);
      return next;
    });

    await run(async () => {
      for (const u of updates) {
        await adminUpdateUnitAddress(u.id, u.address);
      }
    });
  }

  /** 3-A) 기존 집들을 묶어서 새 그룹 생성 */
  async function handleCreateGroupFromUnits(params: {
    startUnitId: string;
    groupTitle: string;
    firstUnitLabel: string;
    includeCount: number; // 첫 집 포함 총 세대 수 (>= 1)
  }) {
    const startIdx = flatItems.findIndex((x) => x.item.unit.id === params.startUnitId);
    if (startIdx < 0) return;

    const endIdx = Math.min(flatItems.length - 1, startIdx + params.includeCount - 1);
    const title = params.groupTitle.trim();
    const firstLabel = params.firstUnitLabel.trim();
    const updates: { id: string; address: string }[] = [];

    // 시작 집이 기존 그룹의 중간 집이었다면, 기존 그룹의 첫 집에 시작 마커 보장
    const startEntry = flatItems[startIdx];
    if (startEntry.block.group !== null && startEntry.indexInBlock > 0) {
      const oldFirst = startEntry.block.items[0];
      if (!oldFirst.unit.address_unit.startsWith(GROUP_START_MARKER)) {
        updates.push({
          id: oldFirst.unit.id,
          address: `${GROUP_START_MARKER}(${startEntry.block.group})\n${stripAdminMarkers(
            oldFirst.label
          ).trim()}`,
        });
      }
    }

    // 1) 첫 집: 새 그룹 시작
    updates.push({
      id: startEntry.item.unit.id,
      address: `${GROUP_START_MARKER}(${title})\n${firstLabel}`,
    });

    // 2) 함께 묶을 하위 집들
    for (let i = startIdx + 1; i <= endIdx; i++) {
      const subItem = flatItems[i].item;
      const subLabel = stripRedundantGroupPrefix(subItem.label, title);
      updates.push({
        id: subItem.unit.id,
        address: `${GROUP_MEMBER_MARKER}${subLabel}`,
      });
    }

    // 3) 범위 바로 다음 집(endIdx + 1)이 새 그룹에 잘못 빨려 들어가지 않도록 경계 처리
    if (endIdx + 1 < flatItems.length) {
      const afterEntry = flatItems[endIdx + 1];
      if (afterEntry.block.group !== null) {
        // 원래 다른 그룹(또는 분할된 기존 그룹)에 속해 있던 집인데 그룹 시작 집이 아니었다면 그룹 제목을 명시
        if (!afterEntry.item.definesGroup) {
          updates.push({
            id: afterEntry.item.unit.id,
            address: `${GROUP_START_MARKER}(${afterEntry.block.group})\n${stripAdminMarkers(
              afterEntry.item.label
            ).trim()}`,
          });
        }
      } else {
        // 원래 독립된 1줄 집이었다면 독립 마커 부여
        updates.push({
          id: afterEntry.item.unit.id,
          address: `${STANDALONE_MARKER}${stripAdminMarkers(afterEntry.item.label).trim()}`,
        });
      }
    }

    setCreateGroupTarget(null);
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(startEntry.item.unit.id);
      return next;
    });

    await run(async () => {
      for (const u of updates) {
        await adminUpdateUnitAddress(u.id, u.address);
      }
    });
  }

  /** 3-B) 새 건물 그룹과 여러 세대를 한 번에 추가 */
  async function handleAddNewGroup(params: {
    afterSeq: number;
    groupTitle: string;
    unitLines: string[];
  }) {
    const title = params.groupTitle.trim();
    const lines = params.unitLines.map((l) => l.trim()).filter(Boolean);
    if (!title || lines.length === 0) return;

    const afterIdx = flatItems.findIndex((x) => x.item.unit.seq_no === params.afterSeq);
    const nextEntry =
      params.afterSeq === 0
        ? flatItems[0] ?? null
        : afterIdx >= 0 && afterIdx + 1 < flatItems.length
          ? flatItems[afterIdx + 1]
          : null;

    setAddGroupAfterSeq(null);
    setSelected(null);

    await run(async () => {
      // 끼워넣는 위치 바로 뒤의 기존 집이 새 그룹에 빨려 들어가거나 기존 그룹을 잃지 않도록 먼저 보정
      if (nextEntry) {
        if (nextEntry.block.group === null) {
          if (!nextEntry.item.unit.address_unit.startsWith(STANDALONE_MARKER)) {
            await adminUpdateUnitAddress(
              nextEntry.item.unit.id,
              `${STANDALONE_MARKER}${stripAdminMarkers(nextEntry.item.label).trim()}`
            );
          }
        } else if (!nextEntry.item.definesGroup) {
          // 기존 그룹의 중간에 새 그룹을 끼워넣는 경우, 뒤쪽 집에 기존 그룹 제목 승계
          await adminUpdateUnitAddress(
            nextEntry.item.unit.id,
            `${GROUP_START_MARKER}(${nextEntry.block.group})\n${stripAdminMarkers(
              nextEntry.item.label
            ).trim()}`
          );
        }
      }

      // 첫 세대는 그룹 제목과 함께 추가, 나머지 세대는 하위 세대로 순서대로 추가
      let seqCursor = params.afterSeq;
      for (let i = 0; i < lines.length; i++) {
        const addr =
          i === 0
            ? `${GROUP_START_MARKER}(${title})\n${lines[i]}`
            : `${GROUP_MEMBER_MARKER}${lines[i]}`;
        await adminInsertUnit(card.id, seqCursor, addr);
        seqCursor++;
      }
    });
  }

  /** 4-A) 그룹 헤더에서 그룹 제목만 수정 */
  async function handleRenameGroup(block: GroupBlock, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed || block.items.length === 0) return;
    const first = block.items[0];
    const firstLabel = stripAdminMarkers(first.label).trim();
    setEditingGroupBlock(null);
    await run(async () => {
      await adminUpdateUnitAddress(
        first.unit.id,
        `${GROUP_START_MARKER}(${trimmed})\n${firstLabel}`
      );
    });
  }

  /** 4-B) 그룹 헤더에서 그룹 전체 해제 (1줄 개별 집으로 전환) */
  async function handleDissolveGroup(block: GroupBlock, keepGroupPrefix: boolean) {
    if (block.group === null || block.items.length === 0) return;
    const groupName = block.group;
    setDissolvingGroupBlock(null);
    await run(async () => {
      for (const it of block.items) {
        const cleanLabel = stripAdminMarkers(it.label).trim();
        const text =
          keepGroupPrefix && !cleanLabel.includes(groupName)
            ? `(${groupName}) ${cleanLabel}`
            : cleanLabel;
        await adminUpdateUnitAddress(it.unit.id, `${STANDALONE_MARKER}${text}`);
      }
    });
  }

  if (loading) return <div className="loading">집 목록을 불러오는 중...</div>;

  return (
    <div>
      <button className="btn-line" onClick={onBack}>
        ← 관리자 카드 목록으로
      </button>

      <h2 className="section-title">
        {displayNo(card)}번 {cardName} — 집 편집
      </h2>
      <div className="notice">
        집을 누르면 <b>주소 수정·삭제·그룹 분리/포함·새 그룹 묶기</b> 버튼이 나타납니다.
        번호는 자동으로 다시 매겨집니다. 총 {units.length}집.
      </div>
      {error && <div className="error-msg">{error}</div>}

      <div className="card-box" style={{ padding: 10 }}>
        <button
          className="btn-line"
          style={{ width: "100%", marginBottom: 8 }}
          disabled={busy}
          onClick={() => setNameModal(true)}
        >
          ✏️ 카드 이름(제목) 수정
        </button>
        <div className="unit-meta" style={{ marginBottom: 6 }}>
          📍 구역 시작점 링크: {startUrl ? "있음" : "없음"}
          {startUrl && (
            <span>
              {" "}
              —{" "}
              <a href={startUrl} target="_blank" rel="noreferrer">
                열어보기
              </a>
            </span>
          )}
        </div>
        <button
          className="btn-line"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={() => setStartModal(true)}
        >
          📍 시작점 링크 수정
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8, gap: 6 }}>
        <button
          className="btn-line"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() => setModal({ mode: "add", afterSeq: 0 })}
        >
          + 맨 위에 집 추가
        </button>
        <button
          className="btn-line"
          style={{
            flex: 1,
            borderColor: "#2563eb",
            color: "#1d4ed8",
            fontWeight: 700,
          }}
          disabled={busy}
          onClick={() =>
            setAddGroupAfterSeq(
              selectedUnit ? selectedUnit.seq_no : units.length > 0 ? units[units.length - 1].seq_no : 0
            )
          }
        >
          + 📁 새 그룹(건물) 추가
        </button>
      </div>

      {blocks.map((b) => {
        const isCollapsed = collapsed.has(b.key);
        return (
          <div key={b.key}>
            {b.group && (
              <div
                className="group-header"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  cursor: " default",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(b.key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                    background: "none",
                    border: "none",
                    padding: 0,
                    font: "inherit",
                    color: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span>{isCollapsed ? "▶" : "▼"}</span>
                  <span style={{ flex: 1 }}>📁 {b.group}</span>
                  <span className="gh-count">{b.items.length}집</span>
                </button>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    className="btn-line"
                    disabled={busy}
                    onClick={() => setEditingGroupBlock(b)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 12,
                      minHeight: 28,
                      background: "#fff",
                    }}
                  >
                    ✏️ 제목 수정
                  </button>
                  <button
                    type="button"
                    className="btn-line"
                    disabled={busy}
                    onClick={() => setDissolvingGroupBlock(b)}
                    style={{
                      padding: "4px 8px",
                      fontSize: 12,
                      minHeight: 28,
                      background: "#fff",
                      color: "#b45309",
                      borderColor: "#f59e0b",
                    }}
                  >
                    🔓 그룹 해제
                  </button>
                </div>
              </div>
            )}
            {!isCollapsed &&
              b.items.map(({ unit: u, label, group, definesGroup }) => {
                const isSel = selected === u.id;
                const visits = visitCountByUnit.get(u.id) ?? 0;
                const flatIdx = flatItems.findIndex((x) => x.item.unit.id === u.id);
                const prevEntry = flatIdx > 0 ? flatItems[flatIdx - 1] : null;
                const canJoinAboveGroup =
                  prevEntry !== null &&
                  prevEntry.block.group !== null &&
                  prevEntry.block.key !== b.key;

                return (
                  <div key={u.id} id={"ue-" + u.id}>
                    <div
                      className="unit-row"
                      style={isSel ? { borderColor: "var(--c-primary)", borderWidth: 2 } : undefined}
                    >
                      <button
                        className="unit-main"
                        onClick={() => setSelected(isSel ? null : u.id)}
                      >
                        <span className="card-no" style={{ minWidth: 44 }}>
                          {u.seq_no}
                        </span>
                        <span style={{ whiteSpace: "pre-wrap" }}>
                          <span className="unit-addr">
                            {group && <span className="unit-group-prefix">{group}</span>}
                            {label}
                          </span>
                          {definesGroup && (
                            <div className="unit-meta">📌 동(그룹) 제목이 이 집 주소에 저장됨</div>
                          )}
                          {visits > 0 && <div className="unit-meta">방문 기록 {visits}건</div>}
                          {u.letter_zone === "active" && (
                            <div
                              className="unit-meta"
                              style={{ color: "#7c3aed", fontWeight: 700 }}
                            >
                              📮 편봉구역 (편지봉사)
                            </div>
                          )}
                          {u.letter_zone === "requested" && (
                            <div className="unit-meta" style={{ color: "#7c3aed" }}>
                              📮 편봉구역 요청됨
                            </div>
                          )}
                          {u.note && <div className="unit-meta">📝 {u.note}</div>}
                        </span>
                      </button>
                    </div>
                    {isSel && selectedUnit && (
                      <div
                        style={{
                          margin: "0 0 10px 0",
                          padding: 8,
                          background: "#f8fafc",
                          border: "1px solid #cbd5e1",
                          borderRadius: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {/* 1열: 기본 편집 버튼 */}
                        <div className="row" style={{ margin: 0, gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="btn-line"
                            style={{ flex: 1 }}
                            disabled={busy}
                            onClick={() => setModal({ mode: "edit", unit: selectedUnit })}
                          >
                            ✏️ 주소 수정
                          </button>
                          <button
                            className="btn-line"
                            style={{
                              flex: 1,
                              color: "var(--c-danger)",
                              borderColor: "var(--c-danger)",
                            }}
                            disabled={busy}
                            onClick={() => doDelete(selectedUnit)}
                          >
                            🗑️ 삭제
                          </button>
                          <button
                            className="btn-line"
                            style={{ flex: 1 }}
                            disabled={busy}
                            onClick={() => setModal({ mode: "add", afterSeq: selectedUnit.seq_no })}
                          >
                            + 아래에 집 추가
                          </button>
                        </div>

                        {/* 2열: 원터치 그룹 분리/포함 및 그룹 생성 버튼 */}
                        <div className="row" style={{ margin: 0, gap: 6, flexWrap: "wrap" }}>
                          {group !== null && (
                            <button
                              className="btn-line"
                              style={{
                                flex: 1,
                                minWidth: 140,
                                borderColor: "#f59e0b",
                                color: "#b45309",
                                background: "#fffbeb",
                                fontWeight: 700,
                              }}
                              disabled={busy}
                              onClick={() => handleSeparateFromGroup(selectedUnit.id)}
                            >
                              🔓 그룹에서 분리
                            </button>
                          )}
                          {canJoinAboveGroup && prevEntry?.block.group && (
                            <button
                              className="btn-line"
                              style={{
                                flex: 1,
                                minWidth: 160,
                                borderColor: "#0284c7",
                                color: "#0369a1",
                                background: "#f0f9ff",
                                fontWeight: 700,
                              }}
                              disabled={busy}
                              onClick={() => handleJoinAboveGroup(selectedUnit.id)}
                            >
                              🔗 위 그룹({prevEntry.block.group})에 포함
                            </button>
                          )}
                          <button
                            className="btn-line"
                            style={{
                              flex: 1,
                              minWidth: 150,
                              borderColor: "#2563eb",
                              color: "#1d4ed8",
                              background: "#eff6ff",
                              fontWeight: 700,
                            }}
                            disabled={busy}
                            onClick={() => setCreateGroupTarget(selectedUnit)}
                          >
                            📁 새 그룹으로 묶기
                          </button>
                          <button
                            className="btn-line"
                            style={{
                              flex: 1,
                              minWidth: 150,
                              borderColor: "#4f46e5",
                              color: "#4338ca",
                            }}
                            disabled={busy}
                            onClick={() => setAddGroupAfterSeq(selectedUnit.seq_no)}
                          >
                            + 📁 아래에 새 그룹 추가
                          </button>
                        </div>

                        {selectedUnit.note && (
                          <button
                            className="btn-line"
                            style={{
                              width: "100%",
                              color: "var(--c-ok)",
                              borderColor: "var(--c-ok)",
                            }}
                            disabled={busy}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `메모를 삭제(반영 완료)할까요?\n"${selectedUnit.note}"`
                                )
                              )
                                return;
                              setSelected(null);
                              await run(() => setUnitNote(selectedUnit.id, null));
                            }}
                          >
                            메모 반영 완료 (삭제)
                          </button>
                        )}
                        {selectedUnit.letter_zone && (
                          <button
                            className="btn-line"
                            style={{
                              width: "100%",
                              borderColor: "#7c3aed",
                              color: "#7c3aed",
                            }}
                            disabled={busy}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  `${stripAdminMarkers(
                                    selectedUnit.address_unit
                                  )}의 편봉구역을 해제할까요?\n카드에서 다시 체크할 수 있게 되고, 편지봉사에서 제거됩니다.`
                                )
                              )
                                return;
                              setSelected(null);
                              await run(() => removeLetterZone(selectedUnit.id));
                            }}
                          >
                            📮 편봉구역 해제 (편지봉사에서 제거)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        );
      })}

      {units.length > 0 && (
        <div className="row" style={{ marginTop: 6, gap: 6 }}>
          <button
            className="btn-line"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() => setModal({ mode: "add", afterSeq: units[units.length - 1].seq_no })}
          >
            + 맨 아래에 집 추가
          </button>
          <button
            className="btn-line"
            style={{
              flex: 1,
              borderColor: "#2563eb",
              color: "#1d4ed8",
              fontWeight: 700,
            }}
            disabled={busy}
            onClick={() => setAddGroupAfterSeq(units[units.length - 1].seq_no)}
          >
            + 📁 맨 아래에 새 그룹 추가
          </button>
        </div>
      )}

      {modal && (
        <AddressModal
          title={
            modal.mode === "edit"
              ? `${modal.unit.seq_no}번 주소 수정`
              : modal.afterSeq === 0
                ? "맨 위에 집 추가"
                : `${modal.afterSeq}번 아래에 집 추가`
          }
          initial={modal.mode === "edit" ? stripAdminMarkers(modal.unit.address_unit) : ""}
          busy={busy}
          onCancel={() => setModal(null)}
          onSave={async (addr) => {
            const m = modal;
            let prefix = STANDALONE_MARKER;
            if (m.mode === "edit") {
              const currentItem = flatItems.find((it) => it.item.unit.id === m.unit.id);
              const isGroupChild =
                currentItem && currentItem.block.group !== null && !currentItem.item.definesGroup;

              if (/\r?\n/.test(addr)) {
                prefix = GROUP_START_MARKER;
              } else if (isGroupChild) {
                prefix = GROUP_MEMBER_MARKER;
              } else if (m.unit.address_unit.startsWith(GROUP_MEMBER_MARKER)) {
                prefix = GROUP_MEMBER_MARKER;
              } else {
                prefix = STANDALONE_MARKER;
              }
              const ok = await run(() => adminUpdateUnitAddress(m.unit.id, `${prefix}${addr}`));
              if (ok) {
                setModal(null);
                setSelected(null);
              }
            } else {
              const prefix = /\r?\n/.test(addr) ? GROUP_START_MARKER : "";
              const ok = await run(() => adminInsertUnit(card.id, m.afterSeq, `${prefix}${addr}`));
              if (ok) {
                setModal(null);
                setSelected(null);
              }
            }
          }}
        />
      )}

      {createGroupTarget && (
        <CreateGroupFromUnitsModal
          targetUnit={createGroupTarget}
          flatItems={flatItems}
          busy={busy}
          onCancel={() => setCreateGroupTarget(null)}
          onSave={handleCreateGroupFromUnits}
        />
      )}

      {addGroupAfterSeq !== null && (
        <AddGroupModal
          initialAfterSeq={addGroupAfterSeq}
          totalUnits={units.length}
          selectedUnit={selectedUnit}
          busy={busy}
          onCancel={() => setAddGroupAfterSeq(null)}
          onSave={handleAddNewGroup}
        />
      )}

      {editingGroupBlock && (
        <GroupTitleModal
          initialTitle={editingGroupBlock.group ?? ""}
          unitCount={editingGroupBlock.items.length}
          busy={busy}
          onCancel={() => setEditingGroupBlock(null)}
          onSave={(newTitle) => handleRenameGroup(editingGroupBlock, newTitle)}
        />
      )}

      {dissolvingGroupBlock && (
        <DissolveGroupModal
          block={dissolvingGroupBlock}
          busy={busy}
          onCancel={() => setDissolvingGroupBlock(null)}
          onConfirm={(keepPrefix) => handleDissolveGroup(dissolvingGroupBlock, keepPrefix)}
        />
      )}

      {nameModal && (
        <CardNameModal
          cardNo={displayNo(card)}
          initial={cardName}
          busy={busy}
          onCancel={() => setNameModal(false)}
          onSave={async (newName) => {
            setNameModal(false);
            setBusy(true);
            setError("");
            try {
              await setCardName(card.id, newName);
              const trimmed = newName.trim();
              setCardNameState(trimmed);
              card.name = trimmed;
              invalidateCardsCache();
            } catch (e) {
              const msg = friendlyError(e);
              setError(msg);
              alert(msg);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {startModal && (
        <StartLinkModal
          initial={startUrl ?? ""}
          busy={busy}
          onCancel={() => setStartModal(false)}
          onSave={async (url) => {
            setStartModal(false);
            setBusy(true);
            setError("");
            try {
              await setCardStartPoint(card.id, url);
              setStartUrl(url.trim() === "" ? null : url.trim());
            } catch (e) {
              const msg = friendlyError(e);
              setError(msg);
              alert(msg);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

/** 방식 A: 기존 집들을 선택해 새 그룹으로 묶는 모달 */
function CreateGroupFromUnitsModal({
  targetUnit,
  flatItems,
  busy,
  onCancel,
  onSave,
}: {
  targetUnit: TerritoryUnit;
  flatItems: { item: ParsedUnit; block: GroupBlock; indexInBlock: number }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (params: {
    startUnitId: string;
    groupTitle: string;
    firstUnitLabel: string;
    includeCount: number;
  }) => void;
}) {
  const startIdx = flatItems.findIndex((x) => x.item.unit.id === targetUnit.id);
  const startEntry = startIdx >= 0 ? flatItems[startIdx] : null;
  const { initialGroup, initialLabel } = startEntry
    ? extractInitialGroupAndLabel(startEntry.item)
    : { initialGroup: "", initialLabel: stripAdminMarkers(targetUnit.address_unit) };

  // 이미 그룹의 시작 집이었다면 현재 그룹에 속한 세대 수를 기본 선택값으로 제안
  const defaultCount =
    startEntry && startEntry.block.group !== null && startEntry.indexInBlock === 0
      ? startEntry.block.items.length
      : 1;

  const [groupTitle, setGroupTitle] = useState(initialGroup);
  const [firstLabel, setFirstLabel] = useState(initialLabel);
  const [includeCount, setIncludeCount] = useState(defaultCount);

  // 시작 집부터 최대 30집까지 선택 목록에 표시
  const candidateEntries = startIdx >= 0 ? flatItems.slice(startIdx, startIdx + 30) : [];

  return (
    <div className="modal-back" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "88vh", overflowY: "auto" }}
      >
        <h3>📁 기존 집들을 새 그룹으로 묶기</h3>
        <div className="muted" style={{ marginBottom: 10 }}>
          <b>{targetUnit.seq_no}번 집</b>부터 시작하는 새 건물/동 그룹을 만듭니다.
        </div>

        <div className="field">
          <label>1. 그룹(건물/동) 제목</label>
          <input
            type="text"
            value={groupTitle}
            autoFocus
            onChange={(e) => setGroupTitle(e.target.value)}
            placeholder="예: 노은서로 65, 노은서로 27 안쪽입구, 101동"
          />
        </div>

        <div className="field">
          <label>2. 첫 집({targetUnit.seq_no}번)의 호수/표시 이름</label>
          <input
            type="text"
            value={firstLabel}
            onChange={(e) => setFirstLabel(e.target.value)}
            placeholder="예: 201, 1층 순대국"
          />
        </div>

        {candidateEntries.length > 1 && (
          <div className="field">
            <label>
              3. 이 그룹에 함께 묶을 아래 집 선택 (총 {includeCount}집 선택됨:{" "}
              {targetUnit.seq_no}번 ~ {candidateEntries[includeCount - 1]?.item.unit.seq_no}번)
            </label>
            <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>
              묶을 마지막 집까지 체크해 주세요. 체크하지 않은 다음 집은 자동으로 그룹에서 분리됩니다.
            </div>
            <div
              style={{
                maxHeight: 210,
                overflowY: "auto",
                border: "1px solid var(--c-border)",
                borderRadius: 8,
                padding: 6,
                background: "#f8fafc",
              }}
            >
              {candidateEntries.map((entry, idx) => {
                const u = entry.item.unit;
                const checked = idx < includeCount;
                const isFirst = idx === 0;
                const displayLabel = isFirst
                  ? firstLabel || entry.item.label
                  : stripRedundantGroupPrefix(entry.item.label, groupTitle);

                return (
                  <label
                    key={u.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: checked ? "#eff6ff" : "transparent",
                      fontWeight: checked ? 700 : 400,
                      cursor: isFirst ? "default" : "pointer",
                      marginBottom: 2,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isFirst}
                      onChange={() => {
                        if (isFirst) return;
                        if (checked && idx === includeCount - 1) {
                          setIncludeCount(idx);
                        } else {
                          setIncludeCount(idx + 1);
                        }
                      }}
                    />
                    <span style={{ minWidth: 38, color: "#1e40af", fontWeight: 700 }}>
                      #{u.seq_no}
                    </span>
                    <span style={{ flex: 1, fontSize: 14 }}>
                      {displayLabel}
                      {entry.block.group && (
                        <span style={{ marginLeft: 6, fontSize: 12, color: "#64748b" }}>
                          (현재: {entry.block.group})
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <button
          className="btn-primary"
          disabled={busy || groupTitle.trim() === "" || firstLabel.trim() === ""}
          onClick={() =>
            onSave({
              startUnitId: targetUnit.id,
              groupTitle: groupTitle.trim(),
              firstUnitLabel: firstLabel.trim(),
              includeCount,
            })
          }
        >
          📁 {includeCount}집을 「{groupTitle.trim() || "새 그룹"}」으로 묶기
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

/** 방식 B: 새로운 건물 그룹과 여러 세대를 한 번에 추가하는 모달 */
function AddGroupModal({
  initialAfterSeq,
  totalUnits,
  selectedUnit,
  busy,
  onCancel,
  onSave,
}: {
  initialAfterSeq: number;
  totalUnits: number;
  selectedUnit: TerritoryUnit | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (params: { afterSeq: number; groupTitle: string; unitLines: string[] }) => void;
}) {
  const [afterSeq, setAfterSeq] = useState(initialAfterSeq);
  const [groupTitle, setGroupTitle] = useState("");
  const [rawUnits, setRawUnits] = useState("");

  const parsedLines = useMemo(
    () =>
      rawUnits
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    [rawUnits]
  );

  return (
    <div className="modal-back" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "88vh", overflowY: "auto" }}
      >
        <h3>+ 📁 새 그룹(건물) 일괄 추가</h3>
        <div className="muted" style={{ marginBottom: 10 }}>
          새 건물(동) 제목과 소속된 여러 세대(호수/상호)를 한 번에 추가합니다.
        </div>

        <div className="field">
          <label>1. 추가할 위치</label>
          <select
            value={afterSeq}
            onChange={(e) => setAfterSeq(Number(e.target.value))}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--c-border)",
              fontSize: "var(--fs-base)",
            }}
          >
            <option value={0}>맨 위에 추가 (1번부터)</option>
            {selectedUnit && selectedUnit.seq_no < totalUnits && (
              <option value={selectedUnit.seq_no}>
                선택한 {selectedUnit.seq_no}번 집 바로 아래에 끼워넣기
              </option>
            )}
            {initialAfterSeq > 0 &&
              initialAfterSeq < totalUnits &&
              (!selectedUnit || selectedUnit.seq_no !== initialAfterSeq) && (
                <option value={initialAfterSeq}>
                  {initialAfterSeq}번 집 바로 아래에 끼워넣기
                </option>
              )}
            {totalUnits > 0 && (
              <option value={totalUnits}>
                맨 아래(끝)에 추가 ({totalUnits + 1}번부터)
              </option>
            )}
          </select>
        </div>

        <div className="field">
          <label>2. 그룹(건물/동) 제목</label>
          <input
            type="text"
            value={groupTitle}
            autoFocus
            onChange={(e) => setGroupTitle(e.target.value)}
            placeholder="예: 노은서로 65, 101동, 상가동"
          />
        </div>

        <div className="field">
          <label>
            3. 세대(호수/상호) 목록 — 한 줄에 한 집씩 입력 ({parsedLines.length}집)
          </label>
          <textarea
            value={rawUnits}
            rows={6}
            onChange={(e) => setRawUnits(e.target.value)}
            placeholder={"예:\n301\n202\n201\n1층 상가"}
            style={{
              width: "100%",
              fontFamily: "inherit",
              fontSize: "var(--fs-base)",
              padding: "10px 12px",
              border: "1px solid var(--c-border)",
              borderRadius: 10,
            }}
          />
        </div>

        <button
          className="btn-primary"
          disabled={busy || groupTitle.trim() === "" || parsedLines.length === 0}
          onClick={() =>
            onSave({
              afterSeq,
              groupTitle: groupTitle.trim(),
              unitLines: parsedLines,
            })
          }
        >
          + 📁 「{groupTitle.trim() || "새 그룹"}」 ({parsedLines.length}집) 추가
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

/** 그룹 제목 수정 모달 */
function GroupTitleModal({
  initialTitle,
  unitCount,
  busy,
  onCancel,
  onSave,
}: {
  initialTitle: string;
  unitCount: number;
  busy: boolean;
  onCancel: () => void;
  onSave: (newTitle: string) => void;
}) {
  const [value, setValue] = useState(initialTitle);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>✏️ 그룹(건물/동) 제목 수정</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          현재 그룹 소속: {unitCount}집
        </div>
        <div className="field">
          <label>그룹 제목</label>
          <input
            type="text"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            placeholder="예: 노은서로 65"
          />
        </div>
        <button
          className="btn-primary"
          disabled={busy || value.trim() === ""}
          onClick={() => onSave(value.trim())}
        >
          {busy ? "저장 중..." : "저장"}
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

/** 그룹 전체 해제 모달 */
function DissolveGroupModal({
  block,
  busy,
  onCancel,
  onConfirm,
}: {
  block: GroupBlock;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (keepGroupPrefix: boolean) => void;
}) {
  const sampleLabel = stripAdminMarkers(block.items[0]?.label ?? "101").trim();
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>🔓 「{block.group}」 그룹 전체 해제</h3>
        <div className="muted" style={{ marginBottom: 12 }}>
          이 그룹에 묶여 있는 <b>{block.items.length}집</b>을 모두 개별 1줄 주소로 풀어냅니다.
          어떤 형태로 풀까요?
        </div>

        <button
          className="btn-primary"
          disabled={busy}
          style={{ marginBottom: 8 }}
          onClick={() => onConfirm(true)}
        >
          1. 그룹 이름을 괄호로 남겨서 풀기 (권장)
          <div style={{ fontSize: 12, fontWeight: 400, marginTop: 2, opacity: 0.9 }}>
            예: ({block.group}) {sampleLabel}
          </div>
        </button>

        <button
          className="btn-line"
          disabled={busy}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderColor: "#f59e0b",
            color: "#b45309",
            fontWeight: 700,
          }}
          onClick={() => onConfirm(false)}
        >
          2. 그룹 이름을 빼고 호수/상호만 남기기
          <div style={{ fontSize: 12, fontWeight: 400, marginTop: 2 }}>
            예: {sampleLabel}
          </div>
        </button>

        <button className="choice-btn" style={{ marginTop: 10 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

function CardNameModal({
  cardNo,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  cardNo: string | number;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{cardNo}번 카드 이름(제목) 수정</h3>
        <div className="field">
          <label>구역카드 이름</label>
          <input
            type="text"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            placeholder="예: 노은로367번길 108(송림5맞은편)"
          />
        </div>
        <button
          className="btn-primary"
          disabled={busy || value.trim() === ""}
          onClick={() => onSave(value.trim())}
        >
          저장
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

function StartLinkModal({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (url: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>구역 시작점 링크 수정</h3>
        <div className="muted" style={{ marginBottom: 6 }}>
          카카오맵 링크(kko.to ...)를 붙여넣으세요. 비우고 저장하면 링크가 삭제됩니다.
        </div>
        <div className="field">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://kko.to/..."
          />
        </div>
        <button className="btn-primary" disabled={busy} onClick={() => onSave(value)}>
          저장
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

function AddressModal({
  title,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  title: string;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (addr: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="field">
          <label>번지 및 호수</label>
          <textarea
            value={value}
            rows={3}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            style={{
              width: "100%",
              fontFamily: "inherit",
              fontSize: "var(--fs-base)",
              padding: "10px 12px",
              border: "1px solid var(--c-border)",
              borderRadius: 10,
            }}
          />
        </div>
        <button
          className="btn-primary"
          disabled={busy || value.trim() === ""}
          onClick={() => onSave(value.trim())}
        >
          {busy ? "저장 중..." : "저장"}
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
