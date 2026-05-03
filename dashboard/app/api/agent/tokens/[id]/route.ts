import { NextResponse } from "next/server";
import { z } from "zod";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { revokeProvisionToken } from "@/lib/provision-tokens";

const revokeSchema = z.object({
  reason: z.string().max(200).optional()
});

// 관리자가 미사용 토큰을 즉시 무효화. 이미 USED인 토큰은 영향 없음.
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireServerSession();
    const body = revokeSchema.parse(await request.json().catch(() => ({})));
    const ok = await revokeProvisionToken({
      tokenId: params.id,
      reason: body.reason ?? "revoked_via_dashboard"
    });
    if (!ok) {
      return NextResponse.json({ error: "Token already used or revoked" }, { status: 409 });
    }
    await writeAuditLog({
      adminEmail: session.user?.email ?? "unknown",
      action: "provision_token_revoked",
      targetType: "ProvisionToken",
      targetId: params.id,
      metadata: { reason: body.reason ?? "revoked_via_dashboard" }
    });
    return NextResponse.json({ data: { id: params.id, revoked: true } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    console.error("[agent/tokens DELETE] failed", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
