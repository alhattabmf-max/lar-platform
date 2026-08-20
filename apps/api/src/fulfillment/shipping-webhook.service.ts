import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import { ShippingProviderRegistry } from "./providers/shipping-provider.registry";
import type { VerifiedCarrierEventPayload } from "./providers/shipping-provider.interface";
import { OrderAllocationService } from "./order-allocation.service";

const MAX_RETRY = 3;
const IDEMPOTENCY_TTL_HOURS = 24;

interface CarrierWebhookOutcome {
  processingOutcome: "RECORDED" | "DELIVERED" | "IGNORED_ALREADY_DELIVERED" | "IGNORED_OUT_OF_ORDER";
}

@Injectable()
export class ShippingWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ShippingProviderRegistry,
    private readonly orderAllocations: OrderAllocationService
  ) {}

  async handleWebhook(carrierParam: string, rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<CarrierWebhookOutcome> {
    const provider = this.registry.get(carrierParam);
    if (!provider) throw new NotFoundException("Unknown carrier");

    const parsed = provider.verifyAndParseWebhook(rawBody, headers);
    if (!parsed) throw new UnauthorizedException("Invalid webhook signature");

    if (parsed.carrierCode !== carrierParam || parsed.carrierCode !== provider.carrierCode) {
      throw new UnauthorizedException("Carrier mismatch between URL, provider, and payload");
    }

    const scope = `SHIPPING_WEBHOOK:${parsed.carrierCode}`;
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

    throw new BusinessException(409, ERROR_CODES.CONFLICT, "Could not process shipping webhook under concurrent load");
  }

  private async processEventTx(tx: Prisma.TransactionClient, parsed: VerifiedCarrierEventPayload): Promise<CarrierWebhookOutcome> {
    const allocation = await tx.orderAllocation.findUnique({ where: { id: parsed.orderAllocationReference } });
    if (!allocation) {
      throw new BusinessException(404, ERROR_CODES.VALIDATION_FAILED, "No matching order allocation for this webhook");
    }
    const tracking = await tx.shipmentTracking.findUnique({ where: { orderAllocationId: allocation.id } });
    if (!tracking) {
      // An event referencing an allocation that was never shipped
      // cannot be recorded (CarrierTrackingEvent requires a
      // ShipmentTracking FK) — reject outright as out of order.
      throw new BusinessException(409, ERROR_CODES.VALIDATION_FAILED, "This allocation has no shipment tracking yet");
    }

    if (parsed.eventType !== "DELIVERED") {
      const outcome = parsed.eventType === "DELIVERY_FAILED" || parsed.eventType === "EXCEPTION" ? "RECORDED" : "RECORDED";
      const result = await this.insertEvent(tx, tracking.id, parsed, outcome);
      if (parsed.eventType === "DELIVERY_FAILED" || parsed.eventType === "EXCEPTION") {
        await tx.outboxEvent.create({
          data: {
            eventType: "CARRIER_DELIVERY_ALERT",
            payload: { orderAllocationId: allocation.id, eventType: parsed.eventType } as Prisma.InputJsonValue,
          },
        });
      }
      return result;
    }

    if (allocation.status === "DELIVERED") {
      return this.insertEvent(tx, tracking.id, parsed, "IGNORED_ALREADY_DELIVERED");
    }
    if (allocation.status !== "SHIPPED") {
      return this.insertEvent(tx, tracking.id, parsed, "IGNORED_OUT_OF_ORDER");
    }

    const carrierEvent = await tx.carrierTrackingEvent.create({
      data: {
        shipmentTrackingId: tracking.id,
        carrierCode: parsed.carrierCode,
        carrierEventId: parsed.carrierEventId,
        eventType: parsed.eventType,
        eventOccurredAt: parsed.eventOccurredAt,
        processingOutcome: "DELIVERED",
        payloadHash: parsed.payloadHash,
        payloadMetadataRedacted: {},
      },
    });

    const result = await this.orderAllocations.confirmDeliveryTx(
      tx,
      allocation.id,
      parsed.eventOccurredAt,
      "CARRIER_WEBHOOK",
      { carrierTrackingEventId: carrierEvent.id },
      { requestId: `shipping-webhook-${parsed.carrierEventId}` }
    );
    if (!result.claimed) {
      return { processingOutcome: "IGNORED_ALREADY_DELIVERED" };
    }

    return { processingOutcome: "DELIVERED" };
  }

  private async insertEvent(
    tx: Prisma.TransactionClient,
    shipmentTrackingId: string,
    parsed: VerifiedCarrierEventPayload,
    outcome: CarrierWebhookOutcome["processingOutcome"]
  ): Promise<CarrierWebhookOutcome> {
    await tx.carrierTrackingEvent.create({
      data: {
        shipmentTrackingId,
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
