import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { resolveStreamFile, verifyPlaybackToken } from "@/lib/streams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/streams/play/{streamKey}/{file}?token=<HMAC>
 *
 * 브라우저(HLS.js)가 호출. 단명 HMAC 토큰 검증 → ts/m3u8 파일 서빙.
 * 토큰 단명이라 1회 발급으로 한 번의 시청 세션 동안만 유효.
 *
 * 안전선:
 * - REVOKED 스트림은 재생 거부 (영구 차단).
 * - 파일명 화이트리스트로 path traversal 차단.
 * - 모든 시청 시도가 audit log 가능하도록 viewer email 토큰에 박아둠.
 */

const MIME: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt"
};

function playbackUriForManifestUri(streamKey: string, uri: string, token: string): string {
  let fileName = uri.trim();
  try {
    const parsed = new URL(uri, "http://streammonitor.local");
    fileName = parsed.pathname.split("/").pop() || "";
  } catch {
    fileName = uri.split("?")[0].split("/").pop() || "";
  }

  if (!resolveStreamFile(streamKey, fileName)) return uri;
  return `/api/streams/play/${streamKey}/${encodeURIComponent(fileName)}?token=${encodeURIComponent(token)}`;
}

function rewriteManifestLine(streamKey: string, line: string, token: string): string {
  const trimmed = line.trim();
  if (!trimmed) return line;

  if (trimmed.startsWith("#EXT-X-MAP:")) {
    return line.replace(/URI="([^"]+)"/, (_match, uri: string) => {
      return `URI="${playbackUriForManifestUri(streamKey, uri, token)}"`;
    });
  }

  if (trimmed.startsWith("#")) return line;

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  return `${leadingWhitespace}${playbackUriForManifestUri(streamKey, trimmed, token)}`;
}

export async function GET(
  request: Request,
  { params }: { params: { streamKey: string; file: string } }
) {
  const filePath = resolveStreamFile(params.streamKey, params.file);
  if (!filePath) return NextResponse.json({ error: "Invalid path" }, { status: 400 });

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const payload = verifyPlaybackToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  if (payload.k !== params.streamKey) {
    return NextResponse.json({ error: "Token does not match stream" }, { status: 403 });
  }

  const stream = await prisma.stream.findUnique({ where: { streamKey: params.streamKey } });
  if (!stream) return NextResponse.json({ error: "Unknown stream" }, { status: 404 });
  if (stream.status === "REVOKED") {
    return NextResponse.json({ error: "Stream revoked" }, { status: 410 });
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not yet available" }, { status: 404 });
  }
  if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 404 });

  const ext = "." + (params.file.split(".").pop() || "");
  const mime = MIME[ext.toLowerCase()] || "application/octet-stream";

  // .m3u8: 짧고 자주 갱신 → no-cache. 세그먼트는 immutable로 캐시.
  const isManifest = params.file.endsWith(".m3u8");

  if (isManifest) {
    // 매니페스트 안의 init/segment URI에 동일 token을 자동 부착해 클라이언트가 추가 호출 시 인증 통과.
    // ffmpeg HTTP PUT 설정에 따라 상대 경로가 아니라 ingest 절대 URL이 들어올 수 있으므로
    // EXT-X-MAP URI와 media segment line 모두 playback 엔드포인트로 강제 변환한다.
    const text = await fs.readFile(filePath, "utf8");
    const rewritten = text
      .split("\n")
      .map((line) => rewriteManifestLine(params.streamKey, line, token))
      .join("\n");
    return new NextResponse(rewritten, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  const nodeStream = createReadStream(filePath);
  const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      // 라이브 추종 시 stale segment 캐시를 줄이기 위해 세그먼트도 no-cache로 서빙.
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "GET, OPTIONS",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
