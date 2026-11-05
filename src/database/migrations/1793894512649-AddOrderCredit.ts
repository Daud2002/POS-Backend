import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderCredit1793894512649 implements MigrationInterface {
  name = 'AddOrderCredit1793894512649';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD "creditedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "creditedById" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_orders_credit_customer" ON "orders" ("storeId", "customerId") WHERE "creditedAt" IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_15b34f60cd914a46915fe45f8ce" FOREIGN KEY ("creditedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_15b34f60cd914a46915fe45f8ce"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_orders_credit_customer"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "creditedById"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "creditedAt"`);
  }
}
