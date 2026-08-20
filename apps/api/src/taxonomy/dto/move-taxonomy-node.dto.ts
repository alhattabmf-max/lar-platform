import { IsOptional, IsUUID } from "class-validator";

export class MoveTaxonomyNodeDto {
  @IsOptional()
  @IsUUID()
  newParentId?: string;
}
