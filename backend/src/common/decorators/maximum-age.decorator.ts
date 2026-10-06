import { ValidationOptions, registerDecorator } from 'class-validator';

/** Rejects dates of birth that would make a person older than maxAge. */
export function IsNotOlderThan(maxAge: number, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotOlderThan',
      target: object.constructor,
      propertyName,
      constraints: [maxAge],
      options,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null || value === '') return true;
          if (typeof value !== 'string') return false;
          const dob = new Date(value);
          if (Number.isNaN(dob.getTime())) return true;
          const today = new Date();
          const cutoff = new Date(
            today.getFullYear() - maxAge,
            today.getMonth(),
            today.getDate(),
            23,
            59,
            59,
            999,
          );
          return dob.getTime() >= cutoff.getTime();
        },
        defaultMessage: () => `${propertyName} must not make the person older than ${maxAge} years`,
      },
    });
  };
}
