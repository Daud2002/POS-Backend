import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderSequenceDay1792768639894 implements MigrationInterface {
  name = 'AddOrderSequenceDay1792768639894';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" ADD "orderSequenceDay" date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "orderSequenceDay"`);
  }
}
