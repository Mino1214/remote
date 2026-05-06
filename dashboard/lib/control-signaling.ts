import crypto from "node:crypto";

export type ControlSession = {
  id: string;
  streamId: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  viewerOfferSdp: string | null;
  agentAnswerSdp: string | null;
  viewerCandidates: string[];
  agentCandidates: string[];
  lastViewerSeenAt: number | null;
  lastAgentSeenAt: number | null;
  events: Array<{ seq: number; payload: string }>;
  nextSeq: number;
};

const SESSION_TTL_MS = 2 * 60 * 1000;

type Store = Map<string, ControlSession>;

function getStore(): Store {
  const g = globalThis as typeof globalThis & { __streamControlSessions?: Store };
  if (!g.__streamControlSessions) {
    g.__streamControlSessions = new Map<string, ControlSession>();
  }
  return g.__streamControlSessions;
}

function cleanupExpired() {
  const now = Date.now();
  const store = getStore();
  for (const [id, session] of store.entries()) {
    if (session.expiresAt <= now) {
      store.delete(id);
    }
  }
}

export function createControlSession(streamId: string, createdBy: string): ControlSession {
  cleanupExpired();
  const store = getStore();
  // 동일 stream의 이전 제어 세션은 새 세션 생성 시 즉시 정리한다.
  // (팝업 재진입 후에도 에이전트가 최신 세션으로 빠르게 전환되도록 보장)
  for (const [existingId, existing] of store.entries()) {
    if (existing.streamId === streamId) {
      store.delete(existingId);
    }
  }
  const id = `ctl_${crypto.randomBytes(10).toString("hex")}`;
  const now = Date.now();
  const session: ControlSession = {
    id,
    streamId,
    createdBy,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    viewerOfferSdp: null,
    agentAnswerSdp: null,
    viewerCandidates: [],
    agentCandidates: [],
    lastViewerSeenAt: null,
    lastAgentSeenAt: null,
    events: [],
    nextSeq: 1
  };
  store.set(id, session);
  return session;
}

export function getLatestControlSessionForStream(streamId: string): ControlSession | null {
  cleanupExpired();
  let latest: ControlSession | null = null;
  for (const session of getStore().values()) {
    if (session.streamId !== streamId) continue;
    if (!latest || session.createdAt > latest.createdAt) {
      latest = session;
    }
  }
  return latest;
}

export function pushControlEvent(session: ControlSession, payload: string) {
  session.events.push({ seq: session.nextSeq, payload });
  session.nextSeq += 1;
  // 메모리 보호: 최근 500개만 유지
  if (session.events.length > 500) {
    session.events.splice(0, session.events.length - 500);
  }
}

export function getControlEventsSince(session: ControlSession, afterSeq: number) {
  return session.events.filter((e) => e.seq > afterSeq);
}

export function getControlSession(sessionId: string): ControlSession | null {
  cleanupExpired();
  const session = getStore().get(sessionId);
  if (!session) return null;
  return session;
}

export function touchViewer(session: ControlSession) {
  session.lastViewerSeenAt = Date.now();
}

export function touchAgent(session: ControlSession) {
  session.lastAgentSeenAt = Date.now();
}

