import { Controller, Param, Post, Req, Res } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { RefundWebhookService } from "./refund-webhook.service";

// Public — no session guard. Provider authenticity is established
// exclusively via each provider's own signature verification inside
// verifyAndParseWebhook, never via a session/cookie. Never logs the
// raw body or signature headers; the response never echoes the
// payload back.
@Controller("webhooks/refunds")
export class RefundWebhookController {
  constructor(private readonly webhookService: RefundWebhookService) {}

  @Post(":provider")
  async handle(@Param("provider") provider: string, @Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    const rawBody = req.rawBody ?? Buffer.from("");
    const headers = req.headers as unknown as Record<string, string | string[] | undefined>;
    const result = await this.webhookService.handleWebhook(provider, rawBody, headers);
    res.status(200).json(result);
  }
}
