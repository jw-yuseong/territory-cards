import { useEffect, useMemo, useState } from "react";
import {
  adminDeleteUnit,
  adminInsertUnit,
  adminUpdateUnitAddress,
  fetchUnits,
  fetchVisits,
  setUnitNote,
} from "../api";
import { invalidateCardsCache } from "../lists";
import { buildGroups } from "../groups";
import type { CardSummary, TerritoryUnit } from "../types";
import { displayNo } from "../types";

type ModalState =
  | { mode: "edit"; unit: TerritoryUnit }
  | { mode: "add"; afterSeq: number };

export default function UnitEditor({
  card,
  onBack,
}: {
  card: CardSummary;
  onBack: () => void;
}) {
  const [units, setUnits] = useState<TerritoryUnit[]>([]);
  const [visitCountByUnit, setVisitCountByUnit] = useState<Map<string, number>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
        // 처음 열 때만 동(그룹)을 모두 접어둠 (편집 중 새로고침에는 유지)
        setCollapsed(
          new Set(
            buildGroups(u)
              .filter((b) => b.group !== null)
              .map((b) => b.key)
          )
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selected) ?? null,
    [units, selected]
  );

  const blocks = useMemo(() => buildGroups(units), [units]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function run(op: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await op();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  async function doDelete(unit: TerritoryUnit) {
    const visits = visitCountByUnit.get(unit.id) ?? 0;
    let warn =
      visits > 0
        ? `\n⚠ 이 집에는 방문 기록 ${visits}건이 있습니다. 함께 삭제됩니다.`
        : "";
    // 동 제목이 저장된 집을 지우면 아래 집들의 동 표시가 사라짐 -> 경고
    const block = blocks.find((b) => b.items.some((it) => it.unit.id === unit.id));
    const item = block?.items.find((it) => it.unit.id === unit.id);
    if (item?.definesGroup && block && block.items.length > 1) {
      warn += `\n⚠ 이 집에는 동 제목(${block.group})이 저장되어 있습니다. 삭제하면 아래 ${
        block.items.length - 1
      }집의 동 표시가 사라지니, 삭제 후 다음 집 주소에 동 제목을 넣어 주세요.`;
    }
    if (
      !window.confirm(
        `${unit.seq_no}번 "${unit.address_unit}" 집을 삭제할까요?\n뒤 집들의 번호가 하나씩 당겨집니다.${warn}`
      )
    )
      return;
    setSelected(null);
    await run(() => adminDeleteUnit(unit.id));
  }

  if (loading) return <div className="loading">집 목록을 불러오는 중...</div>;

  return (
    <div>
      <button className="btn-line" onClick={onBack}>
        ← 관리자 카드 목록으로
      </button>

      <h2 className="section-title">
        {displayNo(card)}번 {card.name} — 집 편집
      </h2>
      <div className="notice">
        집을 누르면 수정·삭제·추가 버튼이 나타납니다. 번호는 자동으로 다시
        매겨집니다. 총 {units.length}집.
      </div>
      {error && <div className="error-msg">{error}</div>}

      <button
        className="btn-line"
        style={{ width: "100%", marginBottom: 8 }}
        disabled={busy}
        onClick={() => setModal({ mode: "add", afterSeq: 0 })}
      >
        + 맨 위에 집 추가
      </button>

      {blocks.map((b) => {
        const isCollapsed = collapsed.has(b.key);
        return (
          <div key={b.key}>
            {b.group && (
              <button className="group-header" onClick={() => toggleGroup(b.key)}>
                <span>{isCollapsed ? "▶" : "▼"}</span>
                <span>{b.group}</span>
                <span className="gh-count">{b.items.length}집</span>
              </button>
            )}
            {!isCollapsed &&
              b.items.map(({ unit: u, label, group, definesGroup }) => {
                const isSel = selected === u.id;
                const visits = visitCountByUnit.get(u.id) ?? 0;
                return (
                  <div key={u.id}>
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
                            <div className="unit-meta">📌 동 제목이 이 집 주소에 저장됨</div>
                          )}
                          {visits > 0 && <div className="unit-meta">방문 기록 {visits}건</div>}
                          {u.note && <div className="unit-meta">📝 {u.note}</div>}
                        </span>
                      </button>
                    </div>
            {isSel && selectedUnit && (
              <div className="row" style={{ margin: "0 0 8px 0", flexWrap: "wrap" }}>
                <button
                  className="btn-line"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => setModal({ mode: "edit", unit: selectedUnit })}
                >
                  주소 수정
                </button>
                <button
                  className="btn-line"
                  style={{ flex: 1, color: "var(--c-danger)", borderColor: "var(--c-danger)" }}
                  disabled={busy}
                  onClick={() => doDelete(selectedUnit)}
                >
                  삭제
                </button>
                <button
                  className="btn-line"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => setModal({ mode: "add", afterSeq: selectedUnit.seq_no })}
                >
                  아래에 추가
                </button>
                {selectedUnit.note && (
                  <button
                    className="btn-line"
                    style={{ flexBasis: "100%", color: "var(--c-ok)", borderColor: "var(--c-ok)" }}
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`메모를 삭제(반영 완료)할까요?\n"${selectedUnit.note}"`)) return;
                      setSelected(null);
                      await run(() => setUnitNote(selectedUnit.id, null));
                    }}
                  >
                    메모 반영 완료 (삭제)
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
        <button
          className="btn-line"
          style={{ width: "100%", marginTop: 4 }}
          disabled={busy}
          onClick={() => setModal({ mode: "add", afterSeq: units[units.length - 1].seq_no })}
        >
          + 맨 아래에 집 추가
        </button>
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
          initial={modal.mode === "edit" ? modal.unit.address_unit : ""}
          busy={busy}
          onCancel={() => setModal(null)}
          onSave={async (addr) => {
            const m = modal;
            setModal(null);
            setSelected(null);
            if (m.mode === "edit") {
              await run(() => adminUpdateUnitAddress(m.unit.id, addr));
            } else {
              await run(() => adminInsertUnit(card.id, m.afterSeq, addr));
            }
          }}
        />
      )}
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
          저장
        </button>
        <button className="choice-btn" style={{ marginTop: 8 }} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
