import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidDateOnly } from './date';

/**
 * class-validator decorator that accepts only real `YYYY-MM-DD` calendar dates,
 * rejecting values such as `2026-02-31` that the format regex would allow.
 */
export function IsDateOnly(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && isValidDateOnly(value);
        },
        defaultMessage(): string {
          return '$property must be a valid YYYY-MM-DD date';
        },
      },
    });
  };
}
