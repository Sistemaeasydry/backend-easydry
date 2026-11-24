import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CambiarPasswordDto {
  @ApiProperty({ description: 'Contraseña actual' })
  @IsString()
  @IsNotEmpty({ message: 'Escribe tu contraseña actual' })
  @MaxLength(128)
  passwordActual: string;

  @ApiProperty({ description: 'Nueva contraseña (mín. 8 caracteres)' })
  @IsString()
  @IsNotEmpty({ message: 'Escribe la nueva contraseña' })
  @MaxLength(128)
  passwordNueva: string;

  @ApiPropertyOptional({ description: 'Repetición de la nueva contraseña: si se envía, debe ser igual' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  passwordConfirmacion?: string;
}
