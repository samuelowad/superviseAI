import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  session_id!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  content!: string;
}
