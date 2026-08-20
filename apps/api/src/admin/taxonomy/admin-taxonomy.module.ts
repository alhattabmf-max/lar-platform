import { Module } from "@nestjs/common";
import { AdminTaxonomyController } from "./admin-taxonomy.controller";
import { TaxonomyModule } from "../../taxonomy/taxonomy.module";
import { AdminSessionModule } from "../admin-auth/admin-session.module";

@Module({
  imports: [TaxonomyModule, AdminSessionModule],
  controllers: [AdminTaxonomyController],
})
export class AdminTaxonomyModule {}
