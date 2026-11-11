import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTips1794377571594 implements MigrationInterface {
  name = 'AddTips1794377571594';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" ADD "tipsCashEnabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "stores" ADD "tipsCardEnabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "stores" ADD "tipsOnlineEnabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "stores" ADD "tipsPaidFromCash" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "tipAmount" numeric(10,2) NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "tipMethod" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" ADD "cashTips" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" ADD "cardTips" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" ADD "onlineTips" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" ADD "tipsFromDrawer" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" ADD "tipBreakdown" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "cashier_shifts" DROP COLUMN "tipBreakdown"`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" DROP COLUMN "tipsFromDrawer"`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" DROP COLUMN "onlineTips"`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" DROP COLUMN "cardTips"`);
    await queryRunner.query(`ALTER TABLE "cashier_shifts" DROP COLUMN "cashTips"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "tipMethod"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "tipAmount"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "tipsPaidFromCash"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "tipsOnlineEnabled"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "tipsCardEnabled"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "tipsCashEnabled"`);
  }
}
