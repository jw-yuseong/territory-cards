// 명단/주의사항/카드 목록은 자주 바뀌지 않으므로 세션 동안 캐시해서 재사용
import {
  fetchCardSummaries,
  fetchCautionTypes,
  fetchConductors,
  fetchPublishers,
} from "./api";
import type { CardSummary, CautionType, Conductor, Publisher } from "./types";

let conductorsCache: Conductor[] | null = null;
let publishersCache: Publisher[] | null = null;
let cautionsCache: CautionType[] | null = null;
let cardsCache: CardSummary[] | null = null;

export async function getConductors(): Promise<Conductor[]> {
  if (!conductorsCache) conductorsCache = await fetchConductors();
  return conductorsCache;
}

export async function getPublishers(): Promise<Publisher[]> {
  if (!publishersCache) publishersCache = await fetchPublishers();
  return publishersCache;
}

export async function getCautionTypes(): Promise<CautionType[]> {
  if (!cautionsCache) cautionsCache = await fetchCautionTypes();
  return cautionsCache;
}

export async function getCardSummaries(): Promise<CardSummary[]> {
  if (!cardsCache) cardsCache = await fetchCardSummaries();
  return cardsCache;
}
