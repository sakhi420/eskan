import {
  ArrayMinSize, IsArray, IsDefined, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MoneyDto } from '../../common/money/money.dto';
import { IsDateOnly } from '../../common/validation/is-date-only.decorator';

/** DepositRequest — receive a deposit (RECEIVED ledger event). */
export class DepositCreateDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsDateOnly()
  receivedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** DepositRefundRequest — refund part/all of the held deposit (cash outflow). */
export class DepositRefundDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** DepositForfeitRequest — forfeit part/all of the held deposit (D-09). */
export class DepositForfeitDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** ReversalRequest — full void of a wrongly recorded financial document (D-02). */
export class ReversalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

/** One deposit-to-charge application line (D-10). */
export class DepositApplicationLine {
  @IsUUID()
  chargeId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;
}

/** DepositApplicationRequest — apply a specific deposit to selected charges at final checkout. */
export class DepositApplicationDto {
  @IsUUID()
  depositTransactionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DepositApplicationLine)
  charges!: DepositApplicationLine[];
}