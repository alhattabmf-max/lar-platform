import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { ShippingProviderRegistry } from "../fulfillment/providers/shipping-provider.registry";
import type { VerifiedCarrierEventPayload } from "../fulfillment/providers/shipping-provider.interface";
import { ReplacementObligationService } from "./replacement-obligation.service";

const MAX_RETRY = 3;
const IDEMPOTENCY_TTL_HOURS = 24;

interface CarrierWebhookOutcome {
  processingOutcome: "RECORDED" | "DELIVERED" | "IGNORED_ALREADY_DELIVERED" | "IGNORED_OUT_OF_ORDER";
}

@Injectable()
export class ReplacementShippingWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ShippingProviderRegistry,
    private readonly replacementObligations: ReplacementObligationService
  ) {}

  async handleWebhook(carrierParam: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<CarrierWebhookOutcome> {
    const provider = this.registry.get(carrierParam);
    if (!provider) throw new NotFoundException("Unknown carrier");

    const parsed = provider.verifyAndParseWebhook(rawBody, headers);
    if (!parsed) throw new UnauthorizedException("Invalid webhook signature");

    if (parsed.carrierCode !== carrierParam || parsed.carrierCode !== provider.carrierCode) {
      throw new UnauthorizedException("Carrier mismatch between URL, provider, and payload");
    }

    const scope = `REPLACEMENT_SHIPPING_WEBHOOK:${parsed.carrierCode}`;
    const key = parsed.carrierEventId;

    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at, updated_at)
          VALUES (${scope}, ${key}, ${parsed.payloadHash}, 'IN_PROGRESS', now() + interval '${Prisma.raw(String(IDEMPOTENCY_TTL_HOURS))} hours', now())
          ON CONFLICT (scope, key) DO NOTHING
          RETURNING id
        `;

        if (claimed.length > 0) {
          const result = await this.processEventTx(tx, parsed);
          await tx.$executeRaw`
            UPDATE idempotency_keys SET status = 'COMPLETED', response_snapshot = ${JSON.stringify(result)}::jsonb, updated_at = now()
            WHERE scope = ${scope} AND key = ${key}
          `;
          return { kind: "created" as const, result };
        }

        const existing = await tx.$queryRaw<
          { status: string; request_hash: string; response_snapshot: unknown }[]
        >`SELECT status, request_hash, response_snapshot FROM idempotency_keys WHERE scope = ${scope} AND key = ${key} FOR UPDATE`;

        if (existing.length === 0) return { kind: "retry" as const };
        const row = existing[0];
        if (row.status !== "COMPLETED") return { kind: "retry" as const };
        if (row.request_hash !== parsed.payloadHash) {
          throw new UnauthorizedException("Carrier event id reused with a different payload");
        }
        return { kind: "existing" as const, result: row.response_snapshot as CarrierWebhookOutcome };
      });

      if (outcome.kind !== "retry") return outcome.result;
    }

    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process replacement shipping webhook under concurrent load");
  }

  private async processEventTx(tx: Prisma.TransactionClient, parsed: VerifiedCarrierEventPayload): Promise<CarrierWebhookOutcome> {
    // For replacement webhooks, orderAllocationReference carries the
    // replacementObligationId.
    const obligation = await tx.replacementObligation.findUnique({ where: { id: parsed.orderAllocationReference } });
    if (!obligation) {
      throw new BusinessException(404, ERROR_CODES.VALIDATION_FAILED, "No matching replacement obligation for this webhook");
    }
    const tracking = await tx.replacementShipmentTracking.findUnique({ where: { replacementObligationId: obligation.id } });
    if (!tracking) {
      throw new BusinessException(409, ERROR_CODES.VALIDATION_FAILED, "This replacement has no shipment tracking yet");
    }

    if (parsed.eventType !== "DELIVERED") {
      const result = await this.insertEvent(tx, tracking.id, parsed, "RECORDED");
      if (parsed.eventType === "DELIVERY_FAILED" || parsed.eventType === "EXCEPTION") {
        await tx.outboxEvent.create({
          data: {
            eventType: "REPLACEMENT_CARRIER_DELIVERY_ALERT",
            payload: { replacementObligationId: obligation.id, eventType: parsed.eventType } as Prisma.InputJsonValue,
          },
        });
      }
      return result;
    }

    if (obligation.status === "DELIVERED") {
      return this.insertEvent(tx, tracking.id, parsed, "IGNORED_ALREADY_DELIVERED");
    }
    if (obligation.status !== "SHIPPED") {
      return this.insertEvent(tx, tracking.id, parsed, "IGNORED_OUT_OF_ORDER");
    }

    const carrierEvent = await tx.replacementCarrierTrackingEvent.create({
      data: {
        replacementShipmentTrackingId: tracking.id,
        carrierCode: parsed.carrierCode,
        carrierEventId: parsed.carrierEventId,
        eventType: parsed.eventType,
        eventOccurredAt: parsed.eventOccurredAt,
        processingOutcome: "DELIVERED",
        payloadHash: parsed.payloadHash,
        payloadMetadataRedacted: {},
      },
    });

    const result = await this.replacementObligations.confirmDeliveryTx(
      tx,
      obligation.id,
      parsed.eventOccurredAt,
      "CARRIER_WEBHOOK",
      { replacementCarrierTrackingEventId: carrierEvent.id },
      { requestId: `replacement-shipping-webhook-${parsed.carrierEventId}` }
    );
    if (!result.claimed) {
      return { processingOutcome: "IGNORED_ALREADY_DELIVERED" };
    }

    return { processingOutcome: "DELIVERED" };
  }

  private async insertEvent(
    tx: Prisma.TransactionClient,
    replacementShipmentTrackingId: string,
    parsed: VerifiedCarrierEventPayload,
    outcome: CarrierWebhookOutcome["processingOutcome"]
  ): Promise<CarrierWebhookOutcome> {
    await tx.replacementCarrierTrackingEvent.create({
      data: {
        replacementShipmentTrackingId,
        carrierCode: parsed.carrierCode,
        carrierEventId: parsed.carrierEventId,
        eventType: parsed.eventType,
        eventOccurredAt: parsed.eventOccurredAt,
        processingOutcome: outcome,
        payloadHash: parsed.payloadHash,
        payloadMetadataRedacted: {},
      },
    });
    return { processingOutcome: outcome };
  }
}
