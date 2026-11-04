import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExpenseSubcategories1793768945652 implements MigrationInterface {
  name = 'AddExpenseSubcategories1793768945652';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "expense_subcategories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "storeId" uuid NOT NULL, "categoryId" uuid NOT NULL, "name" character varying(255) NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ca46fb998e36d83a8a8f164c6d9" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_e45b3fe8a3e16a1a2dc0754675" ON "expense_subcategories" ("storeId", "categoryId") `);
    await queryRunner.query(`ALTER TABLE "expenses" ADD "subcategoryId" uuid`);
    await queryRunner.query(`ALTER TABLE "expense_subcategories" ADD CONSTRAINT "FK_8e8f8567c2f79616eb9d2a77662" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "expense_subcategories" ADD CONSTRAINT "FK_df788da9f8f5121b4a1eb77c00d" FOREIGN KEY ("categoryId") REFERENCES "expense_categories"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    await queryRunner.query(`ALTER TABLE "expenses" ADD CONSTRAINT "FK_b6ee7d2bc11bc7a1421179a340e" FOREIGN KEY ("subcategoryId") REFERENCES "expense_subcategories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "expenses" DROP CONSTRAINT "FK_b6ee7d2bc11bc7a1421179a340e"`);
    await queryRunner.query(`ALTER TABLE "expense_subcategories" DROP CONSTRAINT "FK_df788da9f8f5121b4a1eb77c00d"`);
    await queryRunner.query(`ALTER TABLE "expense_subcategories" DROP CONSTRAINT "FK_8e8f8567c2f79616eb9d2a77662"`);
    await queryRunner.query(`ALTER TABLE "expenses" DROP COLUMN "subcategoryId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e45b3fe8a3e16a1a2dc0754675"`);
    await queryRunner.query(`DROP TABLE "expense_subcategories"`);
  }
}
