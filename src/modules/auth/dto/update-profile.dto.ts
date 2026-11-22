import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'URL pública S3 de la foto de perfil' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatarUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '0991234567', description: 'Celular de 10 dígitos (09XXXXXXXX). Vacío lo borra.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  telefono?: string;

  @ApiPropertyOptional({ example: '1723456789', description: 'Cédula de 10 dígitos. Vacío la borra.' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cedula?: string;
}
