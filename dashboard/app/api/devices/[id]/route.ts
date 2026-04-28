import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({
  alias: z.string().max(120).optional().nullable(),
  ownerEmail: z.string().email().optional().nullable(),
  blocked: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional().nullable()
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireServerSession();
    const body = bodySchema.parse(await request.json());

    const updated = await prisma.deviceMeta.upsert({
      where: { rustdeskId: params.id },
      update: body,
      create: {
        rustdeskId: params.id,
        alias: body.alias ?? undefined,
        ownerEmail: body.ownerEmail ?? undefined,
        blocked: body.blocked ?? false,
        tags: body.tags ?? [],
        notes: body.notes ?? undefined
      }
    });

    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "device_meta_updated",
      targetType: "DeviceMeta",
      targetId: params.id,
      metadata: body
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Invalid payload or update failure" }, { status: 400 });
  }
}
