import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hashIngestSecret,
  isTrustedAuthCallback,
  timingSafeEqualHex,
  verifyPlaybackToken
} from "@/lib/streams";

/**
 * MediaMTX → 이 엔드포인트로 모든 publish/read 시도 인증 콜백.
 *
 * MediaMTX `authMethod: http` payload (간략):
 *   { user, password, ip, action: "publish"|"read", path, protocol, query, ... }
 *
 * 안전선:
 * - publish (ingest): 반드시 stream.status === ACTIVE 그리고 ingestSecret 일치. PENDING/PAUSED/REVOKED 모두 거부.
 * - read   (playback): 반드시 단명 HMAC 토큰 검증. streamKey 매칭. 만료/위조 모두 거부.
 * - Audit log에 모든 결정 기록.
 */

type MtxAuthPayload = {
  user?: string;
  password?: string;
  ip?: string;
  action?: "publish" | "read" | string;
  path?: string;
  protocol?: string;
  query?: string;
};

function deny(reason: string, status = 401, extra?: Record<string, unknown>) {
  // mediamtx는 200 외 응답을 거부로 처리한다.
  return NextResponse.json({ error: reason, ...extra }, { status });
}

async function audit(action: string, streamId: string | null, metadata: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({
      data: {
        adminEmail: "system:mediamtx",
        action,
        targetType: "Stream",
        targetId: streamId,
        metadata: metadata as Prisma.InputJsonValue
      }
    });
  } catch {
    /* never block on audit failure */
  }
}

export async function POST(request: Request) {
  // mediamtx 컨테이너에서만 호출 가능해야 함.
  const remote =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "";
  const sourceHost = request.headers.get("host") || "";
  // 도커 내부 호스트네임 기반 신뢰. 실제 운영에서는 HMAC 헤더로 강화 권장.
  if (!isTrustedAuthCallback(sourceHost) && !isTrustedAuthCallback(remote)) {
    await audit("stream_auth_callback_untrusted_source", null, { remote, sourceHost });
    return deny("Untrusted source", 403);
  }

  let body: MtxAuthPayload;
  try {
    body = (await request.json()) as MtxAuthPayload;
  } catch {
    return deny("Invalid payload", 400);
  }

  const path = (body.path || "").replace(/^\/+/, "");
  const action = body.action;

  if (!path) return deny("Missing path");

  // path == streamKey
  const stream = await prisma.stream.findUnique({ where: { streamKey: path } });
  if (!stream) {
    await audit("stream_auth_unknown_path", null, { path, action });
    return deny("Unknown stream");
  }

  if (action === "publish") {
    // ingest: ingestSecret이 password 또는 query 의 secret 파라미터로 들어옴.
    const candidateSecret =
      body.password ||
      new URLSearchParams(body.query || "").get("secret") ||
      "";

    if (!candidateSecret) {
      await audit("stream_publish_denied_missing_secret", stream.id, { path });
      return deny("Missing ingest secret");
    }

    if (!timingSafeEqualHex(hashIngestSecret(candidateSecret), stream.ingestSecretHash)) {
      await audit("stream_publish_denied_bad_secret", stream.id, { path });
      return deny("Invalid ingest secret");
    }

    if (stream.status !== "ACTIVE") {
      await audit("stream_publish_denied_inactive", stream.id, {
        path,
        status: stream.status,
        consentAcceptedAt: stream.consentAcceptedAt
      });
      return deny(`Stream is ${stream.status}, ingest blocked.`);
    }

    if (!stream.consentAcceptedAt) {
      await audit("stream_publish_denied_no_consent", stream.id, { path });
      return deny("Consent missing");
    }

    // 마지막 ingest 시각/세션 기록
    await prisma.stream.update({
      where: { id: stream.id },
      data: { lastSeenAt: new Date() }
    });
    // 새 세션 row를 매번 만들면 폭주하므로, 마지막 세션이 5분 이내면 재사용 패턴은 추후 정책으로.
    // 여기서는 단순 기록.
    await prisma.streamSession.create({
      data: {
        streamId: stream.id,
        remoteIp: body.ip || null,
        agentVersion: null,
        agentHostname: null
      }
    });
    await audit("stream_publish_allowed", stream.id, { path, ip: body.ip });
    return NextResponse.json({ ok: true });
  }

  if (action === "read") {
    // playback: query string에 token=<hmac> 필수
    const token = new URLSearchParams(body.query || "").get("token") || "";
    if (!token) {
      await audit("stream_read_denied_missing_token", stream.id, { path });
      return deny("Missing playback token");
    }
    const payload = verifyPlaybackToken(token);
    if (!payload) {
      await audit("stream_read_denied_invalid_token", stream.id, { path });
      return deny("Invalid or expired token");
    }
    if (payload.k !== stream.streamKey) {
      await audit("stream_read_denied_token_mismatch", stream.id, { path });
      return deny("Token does not match stream");
    }
    if (stream.status === "REVOKED") {
      await audit("stream_read_denied_revoked", stream.id, { path });
      return deny("Stream revoked");
    }
    await audit("stream_read_allowed", stream.id, { path, viewer: payload.u });
    return NextResponse.json({ ok: true });
  }

  await audit("stream_auth_unknown_action", stream.id, { action, path });
  return deny(`Unknown action: ${action}`);
}
