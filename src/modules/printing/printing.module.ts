import { Module } from '@nestjs/common';
import { PrintingController } from './printing.controller';
import { QzSigningService } from './qz-signing.service';

/**
 * Server-side half of silent QZ Tray printing. No database: the key pair
 * comes from the environment and nothing about a print job is stored.
 */
@Module({
  controllers: [PrintingController],
  providers: [QzSigningService],
})
export class PrintingModule {}
