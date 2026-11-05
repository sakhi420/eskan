import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidTimezone } from '../date/business-date';

/**
 * class-validator decorator that accepts only valid IANA timezone names
 * (e.g. `Asia/Kabul`). A value such as `"INVALID_ZONE"` would be persisted and
 * later cause `Intl.DateTimeFormat` to throw, so it is rejected at the DTO
 * boundary as a 422 validation error.
 */
export function IsTimeZone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isTimeZone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && value.length > 0 && value.length <= 64 && isValidTimezone(value);
        },
        defaultMessage(): string {
          return '$property must be a valid IANA timezone (e.g. Asia/Kabul)';
        },
      },
    });
  };
}