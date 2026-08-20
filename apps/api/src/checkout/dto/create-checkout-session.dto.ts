import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsPositive, IsUUID, ValidateNested } from "class-validator";

class AllocationItemDto {
  @IsUUID()
  companyLocationId!: string;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class CreateCheckoutSessionDto {
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
