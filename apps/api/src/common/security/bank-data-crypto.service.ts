import { Inject, Injectable } from "@nestjs/common";
import type { Env } from "@platform/config";
import { APP_ENV } from "../../config/app-config.module";
import { encryptEnvelope, decryptEnvelope, type KeyRing } from "./crypto-envelope.util";

/**
 * Current active key version. Rotating the key later means: add the
 * new key under a new version here (e.g. "v2"), point ACTIVE_VERSION
 * at it, and keep "v1" in the KeyRing so existing rows still decrypt.
 * No schema change, no backfill required at rotation time.
 */
const ACTIVE_VERSION = "v1";

@Injectable()
export class BankDataCryptoService {
  private readonly keyRing: KeyRing;

  constructor(@Inject(APP_ENV) env: Env) {
    this.keyRing = { v1: env.BANK_DATA_ENCRYPTION_KEY };
  }

  encrypt(plaintext: string): string {
    return encryptEnvelope(plaintext, this.keyRing, ACTIVE_VERSION);
  }

  decrypt(payload: string): string {
    return decryptEnvelope(payload, this.keyRing);
  }

  /** Fingerprint keying uses the same configured key, domain-separated inside iban.util.ts. */
  get fingerprintKeyMaterial(): string {
    return this.keyRing[ACTIVE_VERSION];
  }
}
