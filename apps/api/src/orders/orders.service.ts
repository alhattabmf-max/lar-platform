import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

const SELECT = {
  id: true,
  status: true,
  totalAmount: true,
  supplierPayableAmount: true,
  paidAt: true,
  createdAt: true,
  opportunityId: true,
  traderCompanyId: true,
  supplierCompanyId: true,
  allocations: {
    select: { id: true, status: true, expectedPreparationDays: true, preparationDueAt: true, checkoutLocationAllocationId: true },
  },
} as const;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForTrader(traderCompanyId: string) {
    return this.prisma.masterOrder.findMany({ where: { traderCompanyId }, select: SELECT, orderBy: { createdAt: "desc" } });
  }

  async getForTrader(id: string, traderCompanyId: string) {
    const order = await this.prisma.masterOrder.findFirst({ where: { id, traderCompanyId }, select: SELECT });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async listForSupplier(supplierCompanyId: string) {
    return this.prisma.masterOrder.findMany({ where: { supplierCompanyId }, select: SELECT, orderBy: { createdAt: "desc" } });
  }

  async getForSupplier(id: string, supplierCompanyId: string) {
    const order = await this.prisma.masterOrder.findFirst({ where: { id, supplierCompanyId }, select: SELECT });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }

  async listForAdmin() {
    return this.prisma.masterOrder.findMany({ select: SELECT, orderBy: { createdAt: "desc" }, take: 200 });
  }

  async getForAdmin(id: string) {
    const order = await this.prisma.masterOrder.findUnique({ where: { id }, select: SELECT });
    if (!order) throw new NotFoundException("Order not found");
    return order;
  }
}
