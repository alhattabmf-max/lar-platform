import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsPositive, IsUUID, ValidateNested } from "class-validator";
import type {
  CreateCheckoutAllocationRequest,
  CreateCheckoutSessionRequest,
} from "@platform/types";

/**
 * The validated form of `CreateCheckoutSessionRequest`.
 *
 * The decorators are the runtime check; the `implements` clause is the
 * compile-time one. Together they mean a field cannot be renamed, dropped or
 * retyped on either side without the other failing — which is what was missing
 * while this shape was declared here and in the web app with nothing binding
 * them.
 *
 * The decorators stay the source of runtime truth: a shared interface cannot
 * express "a positive integer" or "a UUID", and those are exactly the
 * constraints that stop a malformed purchase reaching the pricing code.
 */
class AllocationItemDto implements CreateCheckoutAllocationRequest {
  @IsUUID()
  companyLocationId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateCheckoutSessionDto implements CreateCheckoutSessionRequest {
  @IsUUID()
  opportunityId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations!: AllocationItemDto[];
}
