import { useEffect, useMemo, useState } from "react";
import {
  fetchCardProgress,
  fetchIncompleteNotes,
  fetchTodayFieldServiceConductor,
} from "../api";
import { getCardSummaries } from "../lists";
import type {
  CardProgress,
  CardSummary,
  CardIncompleteNote,
  FieldServiceConductor,
} from "../types";
import { FIELD_MEETING_LABELS } from "../extractCartConductors";
import {
  displayNo,
  isCommercialCard,
  isCardRoundDone,
  getCardActiveRound,
  getCardMaxDoneRound,
  roundPublisher,
  roundVisited,
} from "../types";
import CardDetail from "./CardDetail";
import { friendlyError } from "../errors";
import { isAuthTokenError, tryRecoverSession } from "../supabase";
import { hapticTap } from "../haptics";

const DAY_NAMES_KO: Record<number, string> = {
  1: "월요일",
  2: "화요일",
  3: "수요일",
  4: "목요일",
  5: "금요일",
  6: "토요일",
  7: "일요일",
};

export default function PublisherScreen() {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, CardProgress>>(new Map());
  const [incompleteNotes, setIncompleteNotes] = useState<Map<string, CardIncompleteNote>>(new Map());
  const [todayFieldService, setTodayFieldService] = useState<FieldServiceConductor | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selected, setSelected] = useState<CardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 뒤로가기(아이폰 쓸어넘기기 포함)를 누르면 카드 상세에서 목록으로 돌아감
  useEffect(() => {
    function onPop() {
      setSelected(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function openCard(c: CardSummary) {
    hapticTap();
    setSelected(c);
    window.history.pushState({ cardOpen: true }, "");
  }

  function closeCard() {
    if (window.history.state && window.history.state.cardOpen) {
      window.history.back();
    } else {
      setSelected(null);
    }
  }

  useEffect(() => {
    async function load(retried = false) {
      try {
        const now = new Date();
        const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
          2,
          "0"
        )}-${String(now.getDate()).padStart(2, "0")}`;
        const [cs, pr, inc, todayFs] = await Promise.all([
          getCardSummaries(),
          fetchCardProgress(),
          fetchIncompleteNotes(),
          fetchTodayFieldServiceConductor(todayYmd),
        ]);
        setCards(cs);
        setProgressMap(new Map(pr.map((p) => [p.card_id, p])));
        setTodayFieldService(todayFs);

        const incMap = new Map<string, CardIncompleteNote>();
        for (const note of inc) {
          incMap.set(`${note.card_id}-${note.round_no}`, note);
          incMap.set(note.card_id, note);
        }
        setIncompleteNotes(incMap);
        setError("");
      } catch (e) {
        if (!retried && isAuthTokenError(e)) {
          const recovered = await tryRecoverSession();
          if (recovered) {
            return load(true);
          }
        }
        setError(friendlyError(e));
      }
      setLoading(false);
    }
    load();
  }, []);

  const {
    round1Cards,
    round2Cards,
    commercialCards,
    completedRegular,
    completedComm,
    searchCards,
  } = useMemo(() => {
    const q = query.trim();
    if (q) {
      const searched = cards.filter(
        (c) => (c.legacy_number !== null && String(c.legacy_number).includes(q)) || c.name.includes(q)
      );
      return {
        round1Cards: [],
        round2Cards: [],
        commercialCards: [],
        completedRegular: [],
        completedComm: [],
        searchCards: searched,
      };
    }

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const today = `${y}-${m}-${d}`;

    function isCardActive(c: CardSummary, targetRound: number): boolean {
      const incKey = `${c.id}-${targetRound}`;
      if (incompleteNotes.has(incKey)) return true;

      const pg = progressMap.get(c.id);
      if (!pg) return true;

      const pub = roundPublisher(pg, targetRound);
      const visitedCount = roundVisited(pg, targetRound);

      // 배정 안 된 카드는 방문 안 한(0집) 상태일 때만 표시 (추천 카드)
      if (!pub) return visitedCount === 0;

      // 배정된 카드의 경우: 방문 전이거나 오늘 방문한 기록이 있으면 표시
      if (visitedCount === 0) return true;
      return pg.last_visited_date === today;
    }

    function sortActiveCards(list: CardSummary[], targetRound: number) {
      return [...list].sort((a, b) => {
        const incA = incompleteNotes.has(`${a.id}-${targetRound}`);
        const incB = incompleteNotes.has(`${b.id}-${targetRound}`);
        if (incA && !incB) return -1;
        if (!incA && incB) return 1;

        const pgA = progressMap.get(a.id);
        const pgB = progressMap.get(b.id);
        const pubA = pgA ? roundPublisher(pgA, targetRound) : null;
        const pubB = pgB ? roundPublisher(pgB, targetRound) : null;
        if (pubA && !pubB) return -1;
        if (!pubA && pubB) return 1;
        return 0; // 번호순 유지
      });
    }

    const activeR1: CardSummary[] = [];
    const activeR2: CardSummary[] = [];
    const activeComm: CardSummary[] = [];
    const doneReg: CardSummary[] = [];
    const doneComm: CardSummary[] = [];

    for (const c of cards) {
      const isComm = isCommercialCard(c);
      const pg = progressMap.get(c.id);

      if (isComm) {
        const isDone = pg ? isCardRoundDone(pg, 1, incompleteNotes.get(`${c.id}-1`)) : false;
        if (isDone) {
          doneComm.push(c);
        } else {
          // 아직 방문 안 한 상가 카드 (또는 오늘 방문 중/미완료)
          if (isCardActive(c, 1)) activeComm.push(c);
        }
        continue;
      }

      // 일반 구역카드
      const activeRound = pg ? getCardActiveRound(pg, incompleteNotes) : 1;
      const isR1Done = pg ? isCardRoundDone(pg, 1, incompleteNotes.get(`${c.id}-1`)) : false;

      if (activeRound === 1) {
        if (isCardActive(c, 1)) {
          activeR1.push(c);
        } else if (isR1Done) {
          doneReg.push(c);
        }
      } else {
        // 2차 구역: 인도자가 2차로 배정했거나, 1차가 완전히 끝났을 때만 2차 목록에 표시
        const hasR2Assignment = pg && roundPublisher(pg, 2) !== null;
        if (hasR2Assignment || activeR1.length === 0) {
          if (isCardActive(c, 2)) activeR2.push(c);
          else doneReg.push(c);
        } else {
          // 1차가 아직 남아있는데 1차만 끝난 카드는 '완료 카드'로 분류 (기본 목록에서 숨김)
          doneReg.push(c);
        }
      }
    }

    return {
      round1Cards: sortActiveCards(activeR1, 1),
      round2Cards: sortActiveCards(activeR2, 2),
      commercialCards: activeComm,
      completedRegular: doneReg,
      completedComm: doneComm,
      searchCards: null,
    };
  }, [cards, query, progressMap, incompleteNotes]);

  if (selected) {
    return <CardDetail key={selected.id} card={selected} onBack={closeCard} />;
  }

  if (loading) return <div className="loading">카드 목록을 불러오는 중...</div>;

  function renderCardItem(c: CardSummary, targetRound: number, isCommercial = false) {
    const pg = progressMap.get(c.id);
    const pub = pg ? roundPublisher(pg, targetRound) : null;
    const incNote = incompleteNotes.get(`${c.id}-${targetRound}`) ?? incompleteNotes.get(c.id);
    const visited = pg ? roundVisited(pg, targetRound) : 0;
    const isDone = pg ? isCardRoundDone(pg, targetRound, incNote) : false;
    const maxDone = pg ? getCardMaxDoneRound(pg, incompleteNotes) : 0;
    const doneRound = maxDone > 0 ? maxDone : targetRound;

    return (
      <button key={`${c.id}-${targetRound}`} className="card-item" onClick={() => openCard(c)}>
        <span className="card-no">{displayNo(c)}</span>
        <span className="name">
          {c.name}
          {pub && <div className="unit-meta">배정: {pub}</div>}
          {incNote && (
            <div className="unit-meta" style={{ color: "#e65100", fontWeight: "bold" }}>
              🚨 미완료: {incNote.note}
            </div>
          )}
        </span>
        {isDone ? (
          <span className="done-badge">
            {isCommercial ? `상가 · ${doneRound}회 완료` : `${doneRound}회 방문완료`}
          </span>
        ) : isCommercial ? (
          <span className="caution-badge soft" style={{ background: "#475569" }}>
            상가 · {c.total_units}집
          </span>
        ) : targetRound >= 2 ? (
          <span className="round-badge-2">
            {targetRound}차 {visited > 0 ? `(${visited}집)` : "대기"}
          </span>
        ) : (
          <span className="units">{c.total_units}집</span>
        )}
      </button>
    );
  }

  const totalActiveCount = round1Cards.length + round2Cards.length;
  const totalCompletedCount = completedRegular.length + completedComm.length;

  const todayMeta = useMemo(() => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const jsDay = now.getDay();
    const dow = jsDay === 0 ? 7 : jsDay; // 1=월..7=일
    return {
      month,
      day,
      dow,
      dayName: DAY_NAMES_KO[dow] ?? "",
      defaultMeetingLabel: FIELD_MEETING_LABELS[dow] ?? "",
    };
  }, []);

  function renderTodayFieldServiceBanner() {
    const { month, day, dow, dayName, defaultMeetingLabel } = todayMeta;
    const dateHeader = `${month}월 ${day}일 (${dayName})`;

    // 월요일 또는 '봉사 없음'으로 지정된 날
    if (dow === 1 || todayFieldService?.special_type === "none") {
      return (
        <div
          className="card-box"
          style={{
            padding: "12px 14px",
            marginBottom: 14,
            background: "var(--c-surface)",
            borderColor: "var(--c-border)",
          }}
        >
          <div style={{ fontSize: "var(--fs-small)", fontWeight: 700, color: "var(--c-muted)" }}>
            📅 오늘의 봉사 마련 · {dateHeader}
          </div>
          <div style={{ marginTop: 4, fontSize: "var(--fs-base)", fontWeight: 600 }}>
            오늘의 회중 봉사 마련이 없습니다.
          </div>
        </div>
      );
    }

    // 집단봉사 날 (인도자 이름 미표시)
    if (todayFieldService?.special_type === "group_service") {
      const meetingLabel = todayFieldService.meeting_label || defaultMeetingLabel;
      return (
        <div
          className="card-box"
          style={{
            padding: "12px 14px",
            marginBottom: 14,
            background: "#fffbeb",
            borderColor: "#f59e0b",
          }}
        >
          <div style={{ fontSize: "var(--fs-small)", fontWeight: 700, color: "#b45309" }}>
            📅 오늘의 호별봉사 · {dateHeader}
          </div>
          {meetingLabel && (
            <div style={{ marginTop: 4, fontSize: "var(--fs-small)", color: "var(--c-text)" }}>
              ⏰ {meetingLabel}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: "var(--fs-base)", fontWeight: 700, color: "#92400e" }}>
            👥 오늘은 집단봉사입니다.
          </div>
        </div>
      );
    }

    // 특별모임 등 기타 특별 행사
    if (todayFieldService?.special_type === "special_event") {
      const eventName = todayFieldService.special_label || "특별 행사";
      return (
        <div
          className="card-box"
          style={{
            padding: "12px 14px",
            marginBottom: 14,
            background: "#eff6ff",
            borderColor: "#3b82f6",
          }}
        >
          <div style={{ fontSize: "var(--fs-small)", fontWeight: 700, color: "#1d4ed8" }}>
            📅 오늘의 봉사 마련 · {dateHeader}
          </div>
          <div style={{ marginTop: 4, fontSize: "var(--fs-base)", fontWeight: 700, color: "#1e40af" }}>
            📢 {eventName}
          </div>
        </div>
      );
    }

    // 일반 호별봉사 날 (화~일)
    const meetingLabel = todayFieldService?.meeting_label || defaultMeetingLabel;
    const conductorName = todayFieldService?.conductor_name?.trim() || "";
    return (
      <div
        className="card-box"
        style={{
          padding: "12px 14px",
          marginBottom: 14,
          background: "#f0fdf4",
          borderColor: "#86efac",
        }}
      >
        <div style={{ fontSize: "var(--fs-small)", fontWeight: 700, color: "#15803d" }}>
          📅 오늘의 호별봉사 · {dateHeader}
        </div>
        <div style={{ marginTop: 4, fontSize: "var(--fs-base)", fontWeight: 700, color: "var(--c-text)" }}>
          ⏰ {meetingLabel}
        </div>
        <div style={{ marginTop: 4, fontSize: "var(--fs-base)", fontWeight: 700, color: "#0f766e" }}>
          {conductorName ? (
            <>👤 인도자: {conductorName} 형제</>
          ) : (
            <span className="muted" style={{ fontWeight: 500, fontSize: "var(--fs-small)" }}>
              👤 인도자 정보 미등록
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {renderTodayFieldServiceBanner()}
      <div className="field">
        <label>구역카드 찾기</label>
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
      {error && <div className="error-msg">{error}</div>}

      <div className="muted" style={{ marginBottom: 8 }}>
        {searchCards !== null
          ? `검색 결과 ${searchCards.length}개`
          : round1Cards.length > 0
            ? `1차 방문할 카드 ${round1Cards.length}개 ${round2Cards.length > 0 ? `· 2차 ${round2Cards.length}개` : ""}`
            : `2차 방문 구역 (${round2Cards.length}개 카드)`}
      </div>

      {/* 1) 검색 중일 때: 모든 매칭 카드(완료 여부 뱃지 포함) 표시 */}
      {searchCards !== null && (
        <div>
          {searchCards.map((c) => {
            const isComm = isCommercialCard(c);
            const pg = progressMap.get(c.id);
            const ar = pg ? getCardActiveRound(pg, incompleteNotes) : 1;
            const maxDone = pg ? getCardMaxDoneRound(pg, incompleteNotes) : 0;
            const hasActiveNext =
              pg &&
              (roundPublisher(pg, ar) !== null ||
                roundVisited(pg, ar) > 0 ||
                incompleteNotes.has(`${c.id}-${ar}`));
            const displayRound = maxDone > 0 && !hasActiveNext ? maxDone : ar;
            return renderCardItem(c, displayRound, isComm);
          })}
        </div>
      )}

      {/* 2) 평상시: 미방문 활성 카드만 표시 (완료 카드는 숨김) */}
      {searchCards === null && (
        <div>
          {/* 1차 진행 카드 */}
          {(showAll ? round1Cards : round1Cards.slice(0, 50)).map((c) => renderCardItem(c, 1, false))}

          {/* 2차 순환 카드 */}
          {round2Cards.length > 0 && (
            <div>
              {round1Cards.length > 0 && (
                <div className="round-divider">
                  🔄 2차 방문 구역 (1차 완료된 카드 · 1번부터)
                </div>
              )}
              {(showAll ? round2Cards : round2Cards.slice(0, 50)).map((c) => renderCardItem(c, 2, false))}
            </div>
          )}

          {!showAll && totalActiveCount > 50 && (
            <button
              className="btn-line"
              style={{ width: "100%", margin: "10px 0" }}
              onClick={() => setShowAll(true)}
            >
              일반 구역 전체보기
            </button>
          )}

          {/* 3) 501~519번 상가 구역카드 (방문이 완료된 카드는 숨기고 미방문 카드만 표시) */}
          {commercialCards.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="commercial-divider">
                <span>🏬 상가 구역 (501번~519번)</span>
                <span className="count-badge">{commercialCards.length}개 남음</span>
              </div>
              {commercialCards.map((c) => renderCardItem(c, 1, true))}
            </div>
          )}

          {/* 4) 완료된 카드는 기본 숨김 처리되며, 원할 때만 펼쳐볼 수 있도록 토글 제공 */}
          {totalCompletedCount > 0 && (
            <div style={{ marginTop: 24, borderTop: "1px dashed var(--c-border)", paddingTop: 12 }}>
              <button
                className="btn-line"
                style={{
                  width: "100%",
                  color: "var(--c-muted)",
                  borderColor: "var(--c-border)",
                  fontSize: "var(--fs-small)",
                }}
                onClick={() => setShowCompleted(!showCompleted)}
              >
                {showCompleted
                  ? "▲ 방문 완료된 카드 숨기기"
                  : `▼ 방문 완료된 카드 보기 (총 ${totalCompletedCount}개 완료)`}
              </button>
              {showCompleted && (
                <div style={{ marginTop: 10 }}>
                  {completedRegular.map((c) => {
                    const pg = progressMap.get(c.id);
                    const doneRound = pg ? Math.max(1, getCardMaxDoneRound(pg, incompleteNotes)) : 1;
                    return renderCardItem(c, doneRound, false);
                  })}
                  {completedComm.map((c) => {
                    const pg = progressMap.get(c.id);
                    const doneRound = pg ? Math.max(1, getCardMaxDoneRound(pg, incompleteNotes)) : 1;
                    return renderCardItem(c, doneRound, true);
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
