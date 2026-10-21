import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignQzRequestDto {
  @ApiProperty({
    description:
      'The string qz-tray.js asks to have signed: the SHA-256 hex digest of the call.',
    example: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  request: string;
}
