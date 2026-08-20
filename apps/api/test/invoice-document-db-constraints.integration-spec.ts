import { PrismaClient } from "@prisma/client";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import type { PrismaService } from "../src/database/prisma.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { AuditService } from "../src/audit/audit.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { seedPaymentFixture, paymentFixturePrisma } from "./fixtures/payment.fixture";

const prisma = paymentFixturePrisma;

async function captureViaWebhook(provider: MockPaymentProvider, p: PrismaService, merchantReference: string, providerReference: string, amount: number) {
  const audit = new AuditService(p);
  const webhookService = new PaymentWebhookService(p, new CommissionTaxPolicyService(p, audit), provider);
  const { rawBody, headers } = provider.buildSignedWebhook({
    merchantReference,
    providerReference,
    providerEventId: `evt-${merchantReference}-${Date.now()}`,
    eventType: "SUCCESS",
    providerCapturedAt: new Date(),
    providerCapturedAmount: amount,
  });
  return webhookService.handleWebhook(rawBody, headers);
}

async function seedOnePaidOrder(prefix: string): Promise<string> {
  const fixture = await seedPaymentFixture({ traderCrPrefix: prefix });
  const provider = new MockPaymentProvider();
  const result = await captureViaWebhook(provider, prisma as unknown as PrismaService, fixture.paymentAttemptId, `prov-ref-${fixture.paymentAttemptId}`, fixture.grandTotalAmount);
  if (result.processingOutcome !== "ORDER_CREATED") throw new Error(`unexpected capture outcome: ${result.processingOutcome}`);
  const order = await prisma.masterOrder.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
  return order.id;
}

async function seedTwoMasterOrderIds(): Promise<{ orderA: string; orderB: string }> {
  const [orderA, orderB] = await Promise.all([seedOnePaidOrder("INVDBCONSTA"), seedOnePaidOrder("INVDBCONSTB")]);
  return { orderA, orderB };
}

const validProductSnapshot = () => ({
  documentPurpose: "NOT_A_TAX_INVOICE",
  subtotalExclTax: "86.96",
  taxAmount: "13.04",
  totalInclTax: "100.00",
  shipping: "0.00",
  currency: "SAR",
});

const validCommissionSnapshot = () => ({
  documentPurpose: "NOT_A_TAX_INVOICE",
  commissionExclTax: "4.35",
  commissionTax: "0.22",
  totalInclTax: "4.57",
  currency: "SAR",
});

describe("InvoiceDocument — direct DB constraint tests (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("product draft WITHOUT totalInclTax is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = validProductSnapshot() as Record<string, unknown>;
    delete snap.totalInclTax;
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a key present with JSON null is rejected (the exact NULL-passes bug being closed)", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = { ...validProductSnapshot(), totalInclTax: null };
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a non-numeric value for a required key is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = { ...validProductSnapshot(), totalInclTax: "not-a-number" };
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a float-formatted (non-canonical, e.g. 3 decimals) value is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = { ...validProductSnapshot(), totalInclTax: "100.001" };
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("amount different from the snapshot's totalInclTax is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = validProductSnapshot();
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 99, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a product draft with a NON-ZERO shipping amount is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = { ...validProductSnapshot(), shipping: "5.00" };
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a commission draft WITHOUT the tax breakdown (commissionTax) is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const snap = validCommissionSnapshot() as Record<string, unknown>;
    delete snap.commissionTax;
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_COMMISSION_DRAFT", masterOrderId: orderA, amount: 4.57, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: snap as InputJsonValue },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("an adjustment WITHOUT relatedInvoiceDocumentId is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    await expect(
      prisma.invoiceDocument.create({
        data: { documentType: "INTERNAL_ADJUSTMENT_DRAFT", masterOrderId: orderA, amount: 10, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: { documentPurpose: "NOT_A_TAX_INVOICE" } },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a NON-adjustment document WITH a relatedInvoiceDocumentId is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const original = await prisma.invoiceDocument.create({
      data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: validProductSnapshot() },
    });
    await expect(
      prisma.invoiceDocument.create({
        data: {
          documentType: "INTERNAL_PRODUCT_DRAFT",
          masterOrderId: orderA,
          relatedInvoiceDocumentId: original.id,
          amount: 100,
          internalDocumentReference: `T-${crypto.randomUUID()}`,
          snapshotData: validProductSnapshot(),
        },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("an adjustment referencing a related draft from a DIFFERENT MasterOrder is rejected", async () => {
    const { orderA, orderB } = await seedTwoMasterOrderIds();
    const originalOnA = await prisma.invoiceDocument.create({
      data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: validProductSnapshot() },
    });
    await expect(
      prisma.invoiceDocument.create({
        data: {
          documentType: "INTERNAL_ADJUSTMENT_DRAFT",
          masterOrderId: orderB,
          relatedInvoiceDocumentId: originalOnA.id,
          amount: 10,
          internalDocumentReference: `T-${crypto.randomUUID()}`,
          snapshotData: { documentPurpose: "NOT_A_TAX_INVOICE" },
        },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("a document referencing ITSELF (self-reference) is rejected", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const id = crypto.randomUUID();
    await expect(
      prisma.$executeRaw`
        INSERT INTO invoice_documents (id, document_type, master_order_id, related_invoice_document_id, amount, internal_document_reference, snapshot_data)
        VALUES (${id}::uuid, 'INTERNAL_ADJUSTMENT_DRAFT', ${orderA}::uuid, ${id}::uuid, 10, ${`T-self-${id}`}, '{"documentPurpose":"NOT_A_TAX_INVOICE"}'::jsonb)
      `
    ).rejects.toThrow();
  }, 15_000);

  it("DB: any UPDATE or DELETE on an invoice_documents row is rejected — fully immutable", async () => {
    const { orderA } = await seedTwoMasterOrderIds();
    const doc = await prisma.invoiceDocument.create({
      data: { documentType: "INTERNAL_PRODUCT_DRAFT", masterOrderId: orderA, amount: 100, internalDocumentReference: `T-${crypto.randomUUID()}`, snapshotData: validProductSnapshot() },
    });
    await expect(prisma.$executeRaw`UPDATE invoice_documents SET amount = 1 WHERE id = ${doc.id}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM invoice_documents WHERE id = ${doc.id}::uuid`).rejects.toThrow();
  }, 15_000);
});
