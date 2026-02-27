import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateThesisDto {
  @IsString()
  @MinLength(5)
  @MaxLength(180)
  title!: string;

  @IsString()
  @MinLength(40)
  @MaxLength(30000)
  abstract!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  supervisor_query?: string;

  @IsOptional()
  @IsUUID('4')
  supervisor_id?: string;
}
