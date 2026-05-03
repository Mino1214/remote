import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { generateStreamCredentials, getDefaultRetentionDays, getDefaultWatermark } from "@/lib/streams";
import { consumeProvisionToken, validateProvisionToken } from "@/lib/provision-tokens";

const schema = z.object({
  deviceId: z.string().min(1),
  provisionToken: z.string().min(1),
  displayName: z.string().max(120).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  watermarkText: z.string().max(120).optional(),
  ownerEmail: z.string().email().optional()
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());

    const validation = await validateProvisionToken(body.provisionToken);
    if (!validation.ok) {
      const status = validation.reason === "format" ? 400 : 401;
      return NextResponse.json(
        { error: "Invalid provisioning token", detail: validation.reason },
        { status }
      );
    }

    // DB 토큰인 경우 race-safe consume 먼저. env fallback이면 consume 단계 스킵.
    if (validation.via === "db" && validation.tokenId) {
      const consumed = await consumeProvisionToken({
        tokenId: validation.tokenId,
        deviceId: body.deviceId
      });
      if (!consumed.ok) {
        return NextResponse.json(
          { error: "Token already used (race lost)" },
          { status: 409 }
        );
      }
    }

    await prisma.deviceMeta.upsert({
      where: { rustdeskId: body.deviceId },
      update: {
        alias: body.displayName ?? undefined,
        ownerEmail: body.ownerEmail ?? undefined
      },
      create: {
        rustdeskId: body.deviceId,
        alias: body.displayName,
        ownerEmail: body.ownerEmail
      }
    });

    const { streamKey, ingestSecret, ingestSecretHash } = generateStreamCredentials();
    const stream = await prisma.stream.create({
      data: {
        deviceId: body.deviceId,
        streamKey,
        ingestSecretHash,
        displayName: body.displayName,
        watermarkText: body.watermarkText || getDefaultWatermark(),
        retentionDays: body.retentionDays ?? getDefaultRetentionDays(),
        status: "PENDING"
      }
    });

    await writeAuditLog({
      adminEmail: "agent-provisioner",
      action: "agent_provisioned_stream_pending_consent",
      targetType: "Stream",
      targetId: stream.id,
      metadata: {
        deviceId: body.deviceId,
        streamKey,
        tokenSource: validation.via,
        tokenId: validation.tokenId ?? null
      }
    });

    const dashboardBase = process.env.STREAM_PUBLIC_BASE || new URL(request.url).origin;
    return NextResponse.json({
      data: {
        streamId: stream.id,
        streamKey: stream.streamKey,
        ingestSecret,
        dashboardBase,
        status: stream.status,
        notice: "Provision 완료. 클라이언트 사용자 동의 후 ACTIVE로 전환됩니다."
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[agent/provision] failed", error);
    return NextResponse.json({ error: "Failed", detail: message }, { status: 500 });
  }
}
