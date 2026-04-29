import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { issuePlaybackToken } from "@/lib/streams";
import { writeAuditLog } from "@/lib/audit";

/**
 * GET /api/streams/{id}/playback-token
 *
 * 로그인한 관리자만 호출 가능. 단명 HMAC 토큰을 발급해 HLS URL의 query string에 끼워준다.
 * MediaMTX는 read 시점에 /api/streams/auth 콜백으로 토큰을 검증한다.
 *
 * 안전선:
 * - 토큰에는 viewer 이메일이 포함되어 audit log로 누가 봤는지 추적 가능.
 * - 토큰 자체는 stateless이지만 streamKey/만료/사용자가 모두 HMAC에 묶여있어 위조/재사용 차단.
 */

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireServerSession();

    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (stream.status === "REVOKED") {
      return NextResponse.json({ error: "Stream is revoked" }, { status: 409 });
    }

    const { token, exp } = issuePlaybackToken(stream.streamKey, session.user.email || "unknown");

    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "stream_playback_token_issued",
      targetType: "Stream",
      targetId: stream.id,
      metadata: { exp }
    });

    const hlsBase = process.env.STREAM_PLAYBACK_HLS_BASE || "http://localhost:8888";
    return NextResponse.json({
      data: {
        streamKey: stream.streamKey,
        token,
        exp,
        hlsUrl: `${hlsBase.replace(/\/+$/, "")}/${stream.streamKey}/index.m3u8?token=${encodeURIComponent(token)}`,
        webrtcWhepUrl: `${hlsBase.replace(/8888/, "8889").replace(/\/+$/, "")}/${stream.streamKey}/whep?token=${encodeURIComponent(token)}`,
        watermarkText: stream.watermarkText
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
