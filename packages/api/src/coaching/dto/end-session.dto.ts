import { IsUUID } from 'class-validator';

export class EndSessionDto {
  @IsUUID()
  session_id!: string;
}
