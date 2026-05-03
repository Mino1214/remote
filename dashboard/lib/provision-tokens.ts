import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Provision token (1-time use) helpers.
 *
 * 안전선:
 * - DB에는 평문 토큰을 저장하지 않는다 (tokenHash = SHA-256만 보관).
 * - 발급 시 평문은 단 한 번 caller에 반환된 뒤 사라진다 (관리자가 그 자리에서 다운로드 트리거).
 * - 검증은 timingSafeEqual + DB 단일 조회 (해시 매칭).
 * - 사용 성공 시 즉시 status=USED로 마킹하여 재사용 차단 (race-safe transaction).
 * - 환경 변수 STREAM_AGENT_PROVISION_TOKEN이 설정돼 있으면 그 값도 backward-compat으로 통과시킨다
 *   (구버전 클라이언트가 갑자기 죽지 않도록).
 */

const TOKEN_BYTES = 24; // 192-bit. base64url 인코딩 시 32자.
const TOKEN_PREFIX = "tk_";

export type IssuedToken = {
  id: string;
  token: string; // 평문. 발급 직후 1회만 노출.
  tokenPrefix: string;
};

function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/** 토큰 평문 형식 검증 (base64url 32자, 접두사 tk_). 외부 입력 검증용. */
export function isValidTokenFormat(plaintext: string): boolean {
  if (!plaintext || plaintext.length > 256) return false;
  if (!plaintext.startsWith(TOKEN_PREFIX)) return false;
  const body = plaintext.slice(TOKEN_PREFIX.length);
  return /^[A-Za-z0-9_-]{16,128}$/.test(body);
}

/** 새 provision 토큰을 발급. 평문은 반환값에만 들어가고 DB엔 해시만 저장. */
export async function issueProvisionToken(input: {
  createdByEmail: string;
  intendedAlias?: string | null;
  intendedOwner?: string | null;
}): Promise<IssuedToken> {
  // 충돌 가능성 거의 0이지만, 실패 시 한 번만 재시도.
  for (let attempt = 0; attempt < 2; attempt++) {
    const plaintext = `${TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
    const tokenHash = hashToken(plaintext);
    const tokenPrefix = plaintext.slice(0, 11); // tk_ + 8자

    try {
      const created = await prisma.provisionToken.create({
        data: {
          tokenHash,
          tokenPrefix,
          createdByEmail: input.createdByEmail,
          intendedAlias: input.intendedAlias ?? undefined,
          intendedOwner: input.intendedOwner ?? undefined
        }
      });
      return { id: created.id, token: plaintext, tokenPrefix };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P2002" && attempt === 0) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to issue provision token (hash collision)");
}

export type TokenValidationResult =
  | { ok: true; tokenId: string | null; via: "db" | "env" }
  | { ok: false; reason: "format" | "unknown" | "used" | "revoked" };

/** 평문 토큰을 검증. ACTIVE 상태인 토큰만 통과. 호출자가 이후 markTokenUsed를 트랜잭션으로 호출. */
export async function validateProvisionToken(plaintext: string): Promise<TokenValidationResult> {
  if (!plaintext) return { ok: false, reason: "format" };

  // 환경 변수 fallback (구버전 호환). DB 토큰이 정답이면 그게 우선.
  const envToken = process.env.STREAM_AGENT_PROVISION_TOKEN;

  // 형식이 tk_ 로 시작하면 DB 토큰. 그 외엔 env 토큰만 허용.
  if (plaintext.startsWith(TOKEN_PREFIX)) {
    if (!isValidTokenFormat(plaintext)) return { ok: false, reason: "format" };
    const tokenHash = hashToken(plaintext);
    const row = await prisma.provisionToken.findUnique({ where: { tokenHash } });
    if (!row) return { ok: false, reason: "unknown" };
    if (row.status === "USED") return { ok: false, reason: "used" };
    if (row.status === "REVOKED") return { ok: false, reason: "revoked" };
    return { ok: true, tokenId: row.id, via: "db" };
  }

  if (envToken && envToken.length > 0) {
    const a = hashToken(plaintext);
    const b = hashToken(envToken);
    if (timingSafeEqualHex(a, b)) {
      return { ok: true, tokenId: null, via: "env" };
    }
  }

  return { ok: false, reason: "unknown" };
}

/** 검증 통과 후 호출. 트랜잭션으로 ACTIVE → USED 전이가 단 1번만 성공하도록 한다. */
export async function consumeProvisionToken(input: {
  tokenId: string;
  deviceId: string;
}): Promise<{ ok: true } | { ok: false; reason: "race_lost" }> {
  const result = await prisma.provisionToken.updateMany({
    where: { id: input.tokenId, status: "ACTIVE" },
    data: {
      status: "USED",
      usedAt: new Date(),
      usedByDeviceId: input.deviceId
    }
  });
  if (result.count === 1) return { ok: true };
  return { ok: false, reason: "race_lost" };
}

export async function revokeProvisionToken(input: {
  tokenId: string;
  reason: string;
}): Promise<boolean> {
  const result = await prisma.provisionToken.updateMany({
    where: { id: input.tokenId, status: "ACTIVE" },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedReason: input.reason
    }
  });
  return result.count === 1;
}

/** 관리자 콘솔용 — 평문은 절대 반환하지 않는다. */
export type AdminTokenView = {
  id: string;
  tokenPrefix: string;
  status: string;
  createdByEmail: string;
  intendedAlias: string | null;
  intendedOwner: string | null;
  usedAt: string | null;
  usedByDeviceId: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
};

export async function listProvisionTokens(filter?: {
  status?: "ACTIVE" | "USED" | "REVOKED";
  take?: number;
}): Promise<AdminTokenView[]> {
  const where: Prisma.ProvisionTokenWhereInput = {};
  if (filter?.status) where.status = filter.status;
  const rows = await prisma.provisionToken.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(filter?.take ?? 100, 500)
  });
  return rows.map((r) => ({
    id: r.id,
    tokenPrefix: r.tokenPrefix,
    status: r.status,
    createdByEmail: r.createdByEmail,
    intendedAlias: r.intendedAlias,
    intendedOwner: r.intendedOwner,
    usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    usedByDeviceId: r.usedByDeviceId,
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
    revokedReason: r.revokedReason,
    createdAt: r.createdAt.toISOString()
  }));
}
