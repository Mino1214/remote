import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireServerSession } from "@/lib/session";
import { isValidTokenFormat } from "@/lib/provision-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 사전 빌드된 generic exe(`StreamMonitor-Setup.exe`)를 스트리밍한다.
 * - 토큰 평문은 exe **내부**에 박지 않는다 (모든 사용자가 같은 exe).
 * - 토큰은 다운로드 시 `Content-Disposition` 의 파일명에만 박힌다:
 *     StreamMonitor-Setup-<token>.exe
 * - 사용자가 그 이름 그대로 더블클릭하면, Inno Setup [Code] 섹션이
 *   자기 자신({srcexe})의 파일명에서 토큰을 추출해 oneclick-install-and-verify.ps1 에 넘긴다.
 *
 * exe 파일은 dashboard/public/agent/StreamMonitor-Setup.exe 에 둔다 (없으면 503).
 */

const INSTALLER_FILE = "StreamMonitor-Setup.exe";

function resolveInstallerPath(): string {
  // Vercel/Docker 환경에서도 동작하도록 process.cwd() 기준 경로.
  return path.resolve(process.cwd(), "public", "agent", INSTALLER_FILE);
}

export async function GET(request: Request) {
  try {
    await requireServerSession();

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    // 토큰은 옵션. 들어왔는데 형식이 깨진 경우만 거부.
    if (token && !isValidTokenFormat(token)) {
      return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
    }

    const filePath = resolveInstallerPath();
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        {
          error: "Installer not built yet",
          detail: `Place generic exe at ${filePath}. See client-fork/streaming-agent/build-installer.ps1`
        },
        { status: 503 }
      );
    }

    const stat = fs.statSync(filePath);
    const downloadName = token
      ? `StreamMonitor-Setup-${token}.exe`
      : "StreamMonitor-Setup.exe";

    // Stream the file. Next.js 14 RouteHandler에서는 ReadableStream을 직접 Response로 줄 수 있음.
    const nodeStream = fs.createReadStream(filePath);
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk) => {
          controller.enqueue(chunk instanceof Buffer ? new Uint8Array(chunk) : chunk);
        });
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      }
    });

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "Content-Length": String(stat.size),
        // RFC 5987 filename* 로 토큰에 들어갈 수 있는 base64url 문자(_, -)도 안전하게 노출.
        "Content-Disposition": `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[agent/installer GET] failed", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
