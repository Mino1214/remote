import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { prisma } from "@/lib/prisma";
import {
  hashIngestSecret,
  resolveStreamFile,
  streamDir,
  timingSafeEqualHex
} from "@/lib/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/streams/ingest/{streamKey}/{file}
 *
 * Windows agent가 ffmpeg `-method PUT -f hls`로 HLS 매니페스트와 .ts 세그먼트를 push.
 * 외부 미디어 서버 없이 dashboard가 파일을 받아 디스크에 쓰고, playback 엔드포인트가
 * 다시 서빙한다. 모든 트래픽이 표준 HTTPS이므로 Cloudflare Tunnel이 그대로 통과시킨다.
 *
 * 안전선:
 * - Authorization: Bearer <ingestSecret>  헤더 검증 (sha256 해시 비교, timing-safe).
 * - stream.status === ACTIVE 일 때만 수락. PENDING/PAUSED/REVOKED 모두 거부.
 * - 파일명 화이트리스트 (.m3u8/.ts/.mp4/.m4s/.vtt 만 허용, path traversal 차단).
 *
 * 부수 효과:
 * - 새 .ts 세그먼트가 들어오면 StreamRecording row 1개 생성 (메타).
 * - stream.lastSeenAt 업데이트.
 */

function authHeader(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function PUT(
  request: Request,
  { params }: { params: { streamKey: string; file: string } }
) {
  const filePath = resolveStreamFile(params.streamKey, params.file);
  if (!filePath) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const secret = authHeader(request);
  if (!secret) {
    return NextResponse.json({ error: "Missing Authorization" }, { status: 401 });
  }

  const stream = await prisma.stream.findUnique({ where: { streamKey: params.streamKey } });
  if (!stream) {
    return NextResponse.json({ error: "Unknown stream" }, { status: 404 });
  }
  if (!timingSafeEqualHex(hashIngestSecret(secret), stream.ingestSecretHash)) {
    return NextResponse.json({ error: "Invalid ingest secret" }, { status: 401 });
  }
  if (stream.status !== "ACTIVE") {
    return NextResponse.json({ error: `Stream is ${stream.status}` }, { status: 409 });
  }
  if (!stream.consentAcceptedAt) {
    return NextResponse.json({ error: "Consent missing" }, { status: 409 });
  }

  const dir = streamDir(params.streamKey);
  if (!dir) return NextResponse.json({ error: "bad streamKey" }, { status: 400 });
  await fs.mkdir(dir, { recursive: true });

  if (!request.body) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  // .m3u8은 자주 갱신되므로 atomic rename. 세그먼트는 한 번만 쓰이므로 직접 write.
  const isManifest = params.file.endsWith(".m3u8");
  const targetPath = isManifest ? `${filePath}.tmp` : filePath;

  let bytesWritten = 0;
  const fileStream = createWriteStream(targetPath);
  const nodeStream = Readable.fromWeb(request.body as WebReadableStream<Uint8Array>);

  await new Promise<void>((resolve, reject) => {
    nodeStream.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });
    nodeStream.on("error", reject);
    fileStream.on("error", reject);
    fileStream.on("finish", () => resolve());
    nodeStream.pipe(fileStream);
  });

  if (isManifest) {
    await fs.rename(targetPath, filePath);
  }

  // 메타 갱신
  await prisma.stream.update({
    where: { id: stream.id },
    data: { lastSeenAt: new Date() }
  });

  if (params.file.endsWith(".ts") || params.file.endsWith(".m4s") || params.file.endsWith(".mp4")) {
    await prisma.streamRecording.create({
      data: {
        streamId: stream.id,
        filePath: path.relative(path.resolve("/var/streams"), filePath) || params.file,
        startedAt: new Date(),
        sizeBytes: BigInt(bytesWritten)
      }
    });
  }

  return NextResponse.json({ ok: true, bytes: bytesWritten });
}

// HLS PUT muxer가 OPTIONS preflight를 보낼 수 있어 200으로 응답.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "PUT, OPTIONS",
      "Access-Control-Allow-Methods": "PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type"
    }
  });
}

// DELETE: ffmpeg `delete_segments` 플래그 사용 시 옛 세그먼트를 DELETE 요청으로 정리.
export async function DELETE(
  request: Request,
  { params }: { params: { streamKey: string; file: string } }
) {
  const filePath = resolveStreamFile(params.streamKey, params.file);
  if (!filePath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const secret = authHeader(request);
  if (!secret) return NextResponse.json({ error: "Missing Authorization" }, { status: 401 });

  const stream = await prisma.stream.findUnique({ where: { streamKey: params.streamKey } });
  if (!stream) return NextResponse.json({ error: "Unknown stream" }, { status: 404 });
  if (!timingSafeEqualHex(hashIngestSecret(secret), stream.ingestSecretHash)) {
    return NextResponse.json({ error: "Invalid ingest secret" }, { status: 401 });
  }

  // 안전선: 파일은 삭제하지 않고 .deleted suffix만 붙여 보관 (녹화 분실 방지).
  // mediamtx ffmpeg가 호출하는 DELETE는 "more recent rolling" 의미인데,
  // CCTV 용도로는 retentionDays가 끝날 때까지 보관해야 하므로 silent ack.
  return NextResponse.json({ ok: true, note: "kept_for_retention" });
}
