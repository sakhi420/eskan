import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MoneyDto, NonNegativeMoneyDto, MONEY_MAX } from './money.dto';

describe('Money DTOs', () => {
  it('MoneyDto requires a positive int32 amount', async () => {
    const ok = plainToInstance(MoneyDto, { amount: 1, currency: 'AFN' });
    expect(await validate(ok)).toEqual([]);

    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const dto = plainToInstance(MoneyDto, { amount: bad, currency: 'AFN' });
      expect(await validate(dto)).not.toEqual([]);
    }
  });

  it('MoneyDto accepts INT32_MAX and rejects above it', async () => {
    expect(await validate(plainToInstance(MoneyDto, { amount: MONEY_MAX, currency: 'AFN' }))).toEqual([]);
    expect(await validate(plainToInstance(MoneyDto, { amount: MONEY_MAX + 1, currency: 'AFN' }))).not.toEqual([]);
  });

  it('NonNegativeMoneyDto allows zero and rejects negatives / overflow', async () => {
    expect(await validate(plainToInstance(NonNegativeMoneyDto, { amount: 0, currency: 'AFN' }))).toEqual([]);
    expect(await validate(plainToInstance(NonNegativeMoneyDto, { amount: -1, currency: 'AFN' }))).not.toEqual([]);
    expect(await validate(plainToInstance(NonNegativeMoneyDto, { amount: MONEY_MAX + 1, currency: 'AFN' }))).not.toEqual([]);
  });

  it('rejects a non-AFN currency', async () => {
    expect(await validate(plainToInstance(MoneyDto, { amount: 100, currency: 'USD' }))).not.toEqual([]);
  });
});