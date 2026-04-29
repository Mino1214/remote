import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { issuePlaybackToken } from "@/lib/streams";
import { writeAuditLog } from "@/lib/audit";

/**
 * GET /api/streams/{id}/playback-token
 *
 * 로그인한 관리자만 호출. 단명 HMAC 토큰을 발급해 dashboard 내부 HLS 경로의
 * query string에 끼워준다 (`/api/streams/play/{streamKey}/index.m3u8?token=...`).
 *
 * 안전선:
 * - 토큰에 viewer 이메일이 들어가 audit log로 누가 봤는지 추적 가능.
 * - 토큰은 streamKey/만료/사용자에 묶여 위조/재사용 불가.
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

    // 같은 dashboard origin에서 서빙하므로 상대 경로로 충분.
    const hlsUrl = `/api/streams/play/${stream.streamKey}/index.m3u8?token=${encodeURIComponent(token)}`;

    return NextResponse.json({
      data: {
        streamKey: stream.streamKey,
        token,
        exp,
        hlsUrl,
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
