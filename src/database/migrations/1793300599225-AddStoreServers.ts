import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStoreServers1793300599225 implements MigrationInterface {
  name = 'AddStoreServers1793300599225';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "store_servers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "storeId" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'paired', "credentialHash" character varying(64) NOT NULL, "epoch" integer NOT NULL DEFAULT '0', "hostname" character varying(120), "version" character varying(40), "lanUrls" jsonb NOT NULL DEFAULT '[]', "caSha256" character varying(95), "health" jsonb, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a765a7d70cef60d22046c4af7c7" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX "IDX_store_servers_store" ON "store_servers" ("storeId") `);
    await queryRunner.query(`CREATE TABLE "store_pairing_codes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "storeId" uuid NOT NULL, "codeHash" character varying(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdById" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a37e0ba9d91ed8b269ac083c458" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_store_pairing_codes_hash" ON "store_pairing_codes" ("codeHash") `);
    await queryRunner.query(`ALTER TABLE "stores" ADD "operationMode" character varying(16) NOT NULL DEFAULT 'cloud'`);
    await queryRunner.query(`ALTER TABLE "stores" ADD "writerServerId" uuid`);
    await queryRunner.query(`ALTER TABLE "stores" ADD "writerEpoch" integer NOT NULL DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "writerEpoch"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "writerServerId"`);
    await queryRunner.query(`ALTER TABLE "stores" DROP COLUMN "operationMode"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_store_pairing_codes_hash"`);
    await queryRunner.query(`DROP TABLE "store_pairing_codes"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_store_servers_store"`);
    await queryRunner.query(`DROP TABLE "store_servers"`);
  }
}
