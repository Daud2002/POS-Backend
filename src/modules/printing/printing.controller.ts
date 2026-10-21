import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { QzSigningService } from './qz-signing.service';
import { SignQzRequestDto } from './dto';

/**
 * What the browser needs from the server to print through QZ Tray silently.
 *
 * Both routes require a signed-in user. The certificate itself is public, but
 * the signing route is effectively "print on any of our stations", so it is
 * never exposed anonymously: a page the cashier happens to browse must not be
 * able to get our signature on its own QZ requests.
 */
@ApiTags('Printing')
@ApiBearerAuth()
@Controller('printing/qz')
@UseGuards(JwtAuthGuard)
export class PrintingController {
  constructor(private readonly signing: QzSigningService) {}

  @Get('certificate')
  @ApiOperation({ summary: 'PEM certificate the web app presents to QZ Tray' })
  @ApiResponse({ status: 503, description: 'Signing is not configured on this server' })
  certificate() {
    return { certificate: this.signing.certificate() };
  }

  @Post('sign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign one QZ Tray request (RSA-SHA512, base64)' })
  @ApiResponse({ status: 503, description: 'Signing is not configured on this server' })
  sign(@Body() dto: SignQzRequestDto) {
    return { signature: this.signing.sign(dto.request) };
  }
}
