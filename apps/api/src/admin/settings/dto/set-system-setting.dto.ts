import { Allow } from "class-validator";

/**
 * The generic admin settings endpoint accepts any JSON-serializable
 * value here — actual type/shape validation happens in
 * SETTINGS_REGISTRY (see settings-registry.ts), not in this DTO,
 * because different registered settings have different value shapes
 * (boolean, enum string, ...). @Allow() is required so the global
 * ValidationPipe's whitelist doesn't strip/reject this intentionally
 * untyped field.
 */
export class SetSystemSettingDto {
  @Allow()
  value!: unknown;
}
