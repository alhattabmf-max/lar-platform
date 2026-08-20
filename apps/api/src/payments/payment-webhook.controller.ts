import { Controller, Post, Req, Res } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { PaymentWebhookService } from "./payment-webhook.service";

@Controller("webhooks/payments")
export class PaymentWebhookController {
  constructor(private readonly webhookService: PaymentWebhookService) {}

  @Post(":provider")
  async handle(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const rawBody = req.rawBody ?? Buffer.from("");
    const headers = req.headers as unknown as Record<string, string | string[] | undefined>;
    const result = await this.webhookService.handleWebhook(rawBody, headers);
    res.status(200).json(result);
  }
}
