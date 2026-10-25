import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerEmailPerStore1792768692431 implements MigrationInterface {
  name = 'CustomerEmailPerStore1792768692431';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "UQ_8536b8b85c06969f84f0c098b03"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_customers_store_email" ON "customers" ("storeId", "email") WHERE "email" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_customers_store_email"`);
    await queryRunner.query(`ALTER TABLE "customers" ADD CONSTRAINT "UQ_8536b8b85c06969f84f0c098b03" UNIQUE ("email")`);
  }
}
