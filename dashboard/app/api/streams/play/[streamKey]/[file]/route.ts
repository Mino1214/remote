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
    // 매니페스트 안의 상대 세그먼트 경로에 동일 token을 자동 부착해 클라이언트가 추가 호출 시 인증 통과.
    const text = await fs.readFile(filePath, "utf8");
    const rewritten = text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        // 절대 URL은 그대로, 상대 경로(.ts/.m4s)에만 토큰 추가
        if (/^https?:\/\//i.test(trimmed)) return line;
        if (trimmed.includes("?")) return line; // 이미 쿼리 있으면 안 건드림
        return `${trimmed}?token=${encodeURIComponent(token)}`;
      })
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
      "Cache-Control": "public, max-age=31536000, immutable",
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
