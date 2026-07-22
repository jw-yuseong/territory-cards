import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCard,
  fetchMemoUnits,
  insertCardAt,
  resetAllCards,
  resetAllRound,
  resetCard,
  resetCardRound,
  setUnitNote,
} from "../api";
import type { MemoUnit } from "../api";
import { getCardSummaries, invalidateCardsCache } from "../lists";
import { parseCardFile } from "../parseCard";
import type { ParsedCard } from "../parseCard";
import type { CardSummary } from "../types";
import { displayNo } from "../types";
import UnitEditor from "./UnitEditor";
import NameManager from "./NameManager";
import CircuitReport from "./CircuitReport";
import PasswordChange from "./PasswordChange";

export default function AdminScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [memos, setMemos] = useState<MemoUnit[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editCard, setEditCard] = useState<CardSummary | null>(null);
  const [editFocus, setEditFocus] = useState<string | null>(null); // 편집 시 이동할 집 id
  const [resettingAll, setResettingAll] = useState(false);
  const [showAll, setShowAll] = useState(false); // 카드 목록 전체보기
  const [showNames, setShowNames] = useState(false); // 명단 관리 화면
  const [showReport, setShowReport] = useState(false); // 순회 방문 보고서
  const [showPw, setShowPw] = useState(false); // 비밀번호 변경
  const [roundResetCard, setRoundResetCard] = useState<CardSummary | null>(null); // 회차 선택 초기화 대상
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ parsed: ParsedCard; file: File } | null>(null);
  const [insertPos, setInsertPos] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);

  const maxLegacy = cards.reduce((m, c) => Math.max(m, c.legacy_number ?? 0), 0);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ""; // 같은 파일 다시 선택 가능하게
    if (!file) return;
    setError("");
    setMessage("");
    try {
      const parsed = await parseCardFile(file);
      if (parsed.units.length === 0) {
        setError("이 파일에서 집(번지·호수)을 찾지 못했습니다. 형식을 확인해 주세요.");
        return;
      }
      setInsertPos(String(parsed.legacy_number ?? maxLegacy + 1));
      setPreview({ parsed, file });
    } catch (err) {
      setError("엑셀을 읽지 못했습니다: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function doUpload() {
    if (!preview) return;
    const pos = parseInt(insertPos, 10);
    if (!pos || pos < 1) {
      setError("끼워넣을 번호를 올바르게 입력해 주세요.");
      return;
    }
    setUploadBusy(true);
    setError("");
    try {
      await insertCardAt(pos, {
        name: preview.parsed.name,
        source_file: "upload/" + Date.now() + "_" + preview.file.name,
        start_point_url: preview.parsed.start_point_url,
        units: preview.parsed.units,
      });
      invalidateCardsCache();
      setMessage(
        `${pos}번 자리에 '${preview.parsed.name}' 카드가 추가되었습니다 (${preview.parsed.units.length}집). 뒤 카드 번호가 밀렸습니다.`
      );
      setPreview(null);
      loadCards();
    } catch (e) {
      setError("업로드 실패: " + (e instanceof Error ? e.message : String(e)));
    }
    setUploadBusy(false);
  }

  async function doDeleteCard(c: CardSummary) {
    setError("");
    setMessage("");
    const warn =
      c.total_units > 0
        ? `\n집 ${c.total_units}개와 이 카드의 모든 방문 기록·배정이 함께 삭제됩니다.`
        : "";
    if (
      !window.confirm(
        `${displayNo(c)}번 ${c.name} 카드를 삭제할까요?${warn}\n뒤 카드 번호가 앞으로 당겨집니다.`
      )
    )
      return;
    if (!window.confirm("정말 삭제합니까? 되돌릴 수 없습니다.")) return;
    setBusyId(c.id);
    try {
      await deleteCard(c.id);
      invalidateCardsCache();
      setMessage(`${displayNo(c)}번 ${c.name} 카드가 삭제되었습니다.`);
      loadCards();
    } catch (e) {
      setError("삭제 실패: " + (e instanceof Error ? e.message : String(e)));
    }
    setBusyId(null);
  }

  async function doResetAll() {
    setMessage("");
    setError("");
    if (
      !window.confirm(
        "모든 카드를 초기화할까요?\n전체 카드의 1~4회차 방문 기록과 배정이 모두 지워집니다."
      )
    )
      return;
    if (
      !window.confirm(
        "⚠ 정말로 전체를 초기화합니까?\n되돌릴 수 없습니다. 한 번 더 확인해 주세요."
      )
    )
      return;
    setResettingAll(true);
    try {
      await resetAllCards();
      setMessage("모든 카드가 초기화되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setResettingAll(false);
  }

  async function loadCards() {
    try {
      const [cs, ms] = await Promise.all([getCardSummaries(), fetchMemoUnits()]);
      setCards(cs);
      setMemos(ms);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    loadCards();
  }, []);

  async function resolveMemo(m: MemoUnit) {
    if (
      !window.confirm(
        `${m.territory_cards.legacy_number ?? "?"}번 카드 ${m.seq_no}번 집의 메모를 삭제(반영 완료)할까요?\n"${m.note}"`
      )
    )
      return;
    try {
      await setUnitNote(m.id, null);
      setMemos((ms) => ms.filter((x) => x.id !== m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // 뒤로가기(쓸어넘기기)로 편집 화면에서 카드 목록으로 복귀
  useEffect(() => {
    function onPop() {
      setEditCard(null);
      loadCards(); // 편집으로 집수가 바뀌었을 수 있으므로 다시 읽음
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openEditor(c: CardSummary, focusUnitId?: string) {
    setEditCard(c);
    setEditFocus(focusUnitId ?? null);
    window.history.pushState({ editorOpen: true }, "");
  }

  function closeEditor() {
    if (window.history.state && window.history.state.editorOpen) {
      window.history.back();
    } else {
      setEditCard(null);
      loadCards();
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return cards;
    return cards.filter(
      (c) => (c.legacy_number !== null && String(c.legacy_number).includes(q)) || c.name.includes(q)
    );
  }, [cards, query]);

  // 개별 카드: 선택한 회차(또는 전체) 초기화
  async function doResetCard(card: CardSummary, round: number | "all") {
    setMessage("");
    setError("");
    const label = round === "all" ? "전체 회차" : `${round}회차`;
    if (
      !window.confirm(`${displayNo(card)}번 ${card.name} 카드의 ${label} 기록을 삭제할까요?`)
    )
      return;
    setRoundResetCard(null);
    setBusyId(card.id);
    try {
      if (round === "all") await resetCard(card.id);
      else await resetCardRound(card.id, round);
      setMessage(`${displayNo(card)}번 ${card.name} — ${label} 기록이 삭제되었습니다.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("admin") ? "관리자 권한이 필요합니다." : msg);
    }
    setBusyId(null);
  }

  // 전체 카드: 특정 회차 초기화
  async function doResetAllRound(round: number) {
    setMessage("");
    setError("");
    if (!window.confirm(`모든 카드의 ${round}회차 기록(방문·배정)을 삭제할까요?`)) return;
    if (!window.confirm(`⚠ 정말 전체 ${round}회차를 삭제합니까? 되돌릴 수 없습니다.`)) return;
    setResettingAll(true);
    try {
      await resetAllRound(round);
      setMessage(`전체 카드의 ${round}회차 기록이 삭제되었습니다.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setResettingAll(false);
  }

  if (editCard) {
    return <UnitEditor card={editCard} onBack={closeEditor} focusUnitId={editFocus} />;
  }
  if (showNames) {
    return <NameManager onBack={() => setShowNames(false)} />;
  }
  if (showReport) {
    return <CircuitReport onBack={() => setShowReport(false)} />;
  }
  if (showPw) {
    return <PasswordChange onBack={() => setShowPw(false)} />;
  }

  return (
    <div>
      <div className="notice">
        <b>편집</b>: 집 주소 수정, 삭제, 사이에 추가 / <b>초기화</b>: 1~4회차
        방문 기록과 배정 삭제 (집 주소·주의사항은 유지)
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn-line" style={{ flex: 1 }} onClick={() => setShowNames(true)}>
          👥 명단 관리
        </button>
        <button className="btn-line" style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          ⬆ 구역카드 업로드
        </button>
      </div>
      <button
        className="btn-line"
        style={{ width: "100%", marginBottom: 10 }}
        onClick={() => setShowReport(true)}
      >
        🖨 순회 방문용 서류 만들기
      </button>
      <button
        className="btn-line"
        style={{ width: "100%", marginBottom: 10 }}
        onClick={() => setShowPw(true)}
      >
        🔑 계정 비밀번호 변경
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        style={{ display: "none" }}
        onChange={onPickFile}
      />

      <button
        className="btn-danger"
        style={{ width: "100%", marginBottom: 8 }}
        disabled={resettingAll}
        onClick={doResetAll}
      >
        {resettingAll ? "전체 초기화 중..." : "🗑 카드 모두 초기화 (전체 회차)"}
      </button>
      <div className="muted" style={{ marginBottom: 6 }}>회차별 전체 초기화 (그 회차를 모든 카드에서 삭제):</div>
      <div className="row" style={{ marginBottom: 14 }}>
        {[1, 2, 3, 4].map((r) => (
          <button
            key={r}
            className="btn-danger"
            style={{ flex: 1 }}
            disabled={resettingAll}
            onClick={() => doResetAllRound(r)}
          >
            {r}회
          </button>
        ))}
      </div>

      {roundResetCard && (
        <div className="modal-back" onClick={() => setRoundResetCard(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {displayNo(roundResetCard)}번 {roundResetCard.name} — 초기화할 회차
            </h3>
            <div className="muted" style={{ marginBottom: 8 }}>
              선택한 회차의 방문 체크와 배정만 삭제됩니다.
            </div>
            {[1, 2, 3, 4].map((r) => (
              <button
                key={r}
                className="choice-btn danger"
                onClick={() => doResetCard(roundResetCard, r)}
              >
                {r}회차 기록만 삭제
              </button>
            ))}
            <button
              className="choice-btn danger"
              style={{ borderWidth: 2 }}
              onClick={() => doResetCard(roundResetCard, "all")}
            >
              전체 회차 삭제
            </button>
            <button className="choice-btn" style={{ marginTop: 8 }} onClick={() => setRoundResetCard(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-back" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>구역카드 업로드 확인</h3>
            <table className="mini" style={{ width: "100%", fontSize: "var(--fs-small)" }}>
              <tbody>
                <tr><td style={{ padding: 4 }}>파일</td><td style={{ padding: 4 }}>{preview.file.name}</td></tr>
                <tr><td style={{ padding: 4 }}>카드 번호</td><td style={{ padding: 4 }}>{preview.parsed.legacy_number ?? "(없음)"}</td></tr>
                <tr><td style={{ padding: 4 }}>구역명</td><td style={{ padding: 4 }}>{preview.parsed.name}</td></tr>
                <tr><td style={{ padding: 4 }}>집 수</td><td style={{ padding: 4 }}>{preview.parsed.units.length}집</td></tr>
                <tr><td style={{ padding: 4 }}>시작점 링크</td><td style={{ padding: 4 }}>{preview.parsed.start_point_url ? "있음" : "없음"}</td></tr>
              </tbody>
            </table>
            <div className="field">
              <label>끼워넣을 번호 (이 번호부터 뒤 카드가 밀립니다)</label>
              <input
                type="number"
                value={insertPos}
                onChange={(e) => setInsertPos(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="notice" style={{ fontSize: "var(--fs-small)" }}>
              {insertPos}번 자리에 넣으면 기존 {insertPos}번부터 뒤 카드가 한 칸씩 밀립니다.
              <br />처음 집 3개: {preview.parsed.units.slice(0, 3).map((u) => u.replace(/\n/g, " ")).join(" / ")}
            </div>
            <button className="btn-primary" disabled={uploadBusy} onClick={doUpload}>
              {uploadBusy ? "추가 중..." : `${insertPos}번 자리에 추가하기`}
            </button>
            <button className="choice-btn" style={{ marginTop: 8 }} onClick={() => setPreview(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {memos.length > 0 && (
        <>
          <div className="section-title">📝 봉사자 메모 ({memos.length}건)</div>
          {memos.map((m) => {
            const cardSummary = cards.find((c) => c.id === m.card_id);
            return (
              <div key={m.id} className="card-box" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {m.territory_cards.legacy_number ?? "?"}번 {m.territory_cards.name} —{" "}
                  {m.seq_no}. {m.address_unit}
                </div>
                <div style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>📝 {m.note}</div>
                <div className="row">
                  {cardSummary && (
                    <button className="btn-line" style={{ flex: 1 }} onClick={() => openEditor(cardSummary, m.id)}>
                      카드 편집
                    </button>
                  )}
                  <button
                    className="btn-line"
                    style={{ flex: 1, color: "var(--c-ok)", borderColor: "var(--c-ok)" }}
                    onClick={() => resolveMemo(m)}
                  >
                    반영 완료 (메모 삭제)
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
      <div className="field">
        <label>카드 검색</label>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowAll(false);
          }}
          placeholder="카드 번호 또는 구역 이름"
        />
      </div>
      {message && <div className="notice">{message}</div>}
      {error && <div className="error-msg">{error}</div>}
      {(showAll ? filtered : filtered.slice(0, 50)).map((c) => (
        <div key={c.id} className="card-box" style={{ padding: 10 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="card-no">{displayNo(c)}</span>
            <span className="name" style={{ flex: 1 }}>{c.name}</span>
          </div>
          <div className="row">
            <button className="btn-line" style={{ flex: 1 }} onClick={() => openEditor(c)}>
              편집
            </button>
            <button
              className="btn-danger"
              style={{ flex: 1 }}
              disabled={busyId === c.id}
              onClick={() => setRoundResetCard(c)}
            >
              {busyId === c.id ? "..." : "초기화"}
            </button>
            <button
              className="btn-danger"
              style={{ flex: 1, background: "#7a1f1f" }}
              disabled={busyId === c.id}
              onClick={() => doDeleteCard(c)}
            >
              삭제
            </button>
          </div>
        </div>
      ))}
      {!showAll && filtered.length > 50 && (
        <button
          className="btn-line"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => setShowAll(true)}
        >
          전체보기 (나머지 {filtered.length - 50}개)
        </button>
      )}
    </div>
  );
}
