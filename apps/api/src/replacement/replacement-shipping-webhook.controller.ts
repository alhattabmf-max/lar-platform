import { Controller, Param, Post, Req, Res } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { ReplacementShippingWebhookService } from "./replacement-shipping-webhook.service";

@Controller("webhooks/replacement-shipping")
export class ReplacementShippingWebhookController {
  constructor(private readonly webhookService: ReplacementShippingWebhookService) {}

  @Post(":carrier")
  async handle(@Param("carrier") carrier: string, @Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const rawBody = req.rawBody ?? Buffer.from("");
    const headers = req.headers as unknown as Record<string, string | string[] | undefined>;
    const result = await this.webhookService.handleWebhook(carrier, rawBody, headers);
    res.status(200).json(result);
  }
}
