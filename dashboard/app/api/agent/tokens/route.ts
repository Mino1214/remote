import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { issueProvisionToken, listProvisionTokens } from "@/lib/provision-tokens";

const createSchema = z.object({
  intendedAlias: z.string().max(120).optional().nullable(),
  intendedOwner: z.string().email().optional().nullable()
});

export async function GET(request: Request) {
  try {
    await requireServerSession();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const tokens = await listProvisionTokens({
      status: status === "ACTIVE" || status === "USED" || status === "REVOKED" ? status : undefined,
      take: 200
    });
    return NextResponse.json({ data: tokens });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[agent/tokens GET] failed", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireServerSession();
    const body = createSchema.parse(await request.json().catch(() => ({})));

    const issued = await issueProvisionToken({
      createdByEmail: session.user?.email ?? "unknown",
      intendedAlias: body.intendedAlias ?? null,
      intendedOwner: body.intendedOwner ?? null
    });

    await writeAuditLog({
      adminEmail: session.user?.email ?? "unknown",
      action: "provision_token_issued",
      targetType: "ProvisionToken",
      targetId: issued.id,
      metadata: {
        tokenPrefix: issued.tokenPrefix,
        intendedAlias: body.intendedAlias ?? null,
        intendedOwner: body.intendedOwner ?? null
      }
    });

    // 평문 토큰은 이 응답에서 단 한 번만 노출. 다운로드 URL도 같이 알려줌.
    const installerUrl = `/api/agent/installer?token=${encodeURIComponent(issued.token)}`;
    return NextResponse.json({
      data: {
        id: issued.id,
        token: issued.token,
        tokenPrefix: issued.tokenPrefix,
        installerUrl,
        notice:
          "토큰 평문은 이 응답에서만 표시됩니다. 다운로드 링크를 즉시 사용하거나 안전한 곳에 보관하세요."
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    console.error("[agent/tokens POST] failed", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
