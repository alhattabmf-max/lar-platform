import { Controller, Param, Post, Req, Res } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { ShippingWebhookService } from "./shipping-webhook.service";

@Controller("webhooks/shipping")
export class ShippingWebhookController {
  constructor(private readonly webhookService: ShippingWebhookService) {}

  @Post(":carrier")
  async handle(@Param("carrier") carrier: string, @Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const rawBody = req.rawBody ?? Buffer.from("");
    const headers = req.headers as unknown as Record<string, string | string[] | undefined>;
    const result = await this.webhookService.handleWebhook(carrier, rawBody, headers);
    res.status(200).json(result);
  }
}
