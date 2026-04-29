import crypto from "node:crypto";

/**
 * Streaming subsystem helpers.
 *
 * 안전선 (이 파일이 보장):
 * - 스트림 등록은 항상 동의 다이얼로그 결과(`consentAcceptedAt`)가 있어야 ACTIVE.
 * - ingest 시크릿은 평문 보관 금지 (ingestSecretHash 컬럼에 sha256 해시).
 * - 재생 토큰은 단명 HMAC. 토큰 자체에 streamKey/만료시각/시청자 이메일 포함.
 * - 모든 ingest/playback 시도는 audit log 작성 가능하도록 단일 진입점 사용.
 */

const PLAYBACK_TOKEN_VERSION = "v1";

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env: ${name}`);
}

export function generateStreamCredentials(): {
  streamKey: string;
  ingestSecret: string;
  ingestSecretHash: string;
} {
  const streamKey = `s_${crypto.randomBytes(8).toString("hex")}`;
  const ingestSecret = crypto.randomBytes(24).toString("base64url");
  const ingestSecretHash = crypto.createHash("sha256").update(ingestSecret).digest("hex");
  return { streamKey, ingestSecret, ingestSecretHash };
}

export function hashIngestSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type PlaybackTokenPayload = {
  v: string;
  k: string; // streamKey
  e: number; // expires unix seconds
  u: string; // viewer email
};

export function issuePlaybackToken(streamKey: string, viewerEmail: string): { token: string; exp: number } {
  const secret = getEnv("STREAM_PLAYBACK_TOKEN_SECRET");
  const ttl = Number(getEnv("STREAM_PLAYBACK_TOKEN_TTL", "600"));
  const exp = Math.floor(Date.now() / 1000) + Math.max(60, ttl);
  const payload: PlaybackTokenPayload = { v: PLAYBACK_TOKEN_VERSION, k: streamKey, e: exp, u: viewerEmail };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${sig}`, exp };
}

export function verifyPlaybackToken(token: string): PlaybackTokenPayload | null {
  const secret = getEnv("STREAM_PLAYBACK_TOKEN_SECRET");
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as PlaybackTokenPayload;
    if (decoded.v !== PLAYBACK_TOKEN_VERSION) return null;
    if (decoded.e < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function isTrustedAuthCallback(remoteHost: string | undefined | null): boolean {
  if (!remoteHost) return false;
  const trusted = (process.env.STREAM_AUTH_TRUSTED_HOSTS || "mediamtx")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return trusted.some((h) => remoteHost === h || remoteHost.startsWith(`${h}:`) || remoteHost.startsWith(`${h}.`));
}

export function getDefaultWatermark(): string {
  return process.env.STREAM_WATERMARK_DEFAULT || "● REC | 관리자 모니터링 활성화";
}

export function getDefaultRetentionDays(): number {
  return Number(process.env.STREAM_RECORDINGS_DEFAULT_RETENTION_DAYS || "7");
}
