import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountType, UserRole } from '../../../common/enums';
import { LoginDto, RegisterDto } from './auth.dto';

const vendor = {
  email: 'lotus.decor@gmail.com',
  password: 'StrongPass1',
  accountType: AccountType.VENDOR,
  displayName: 'Rakesh Rao',
  phone: '9876543210',
};

async function errorsFor(cls: new () => object, body: object) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('RegisterDto username', () => {
  it('is not required to register a vendor', async () => {
    expect(await errorsFor(RegisterDto, vendor)).toEqual([]);
  });

  it('is still checked when a vendor gives one', async () => {
    expect(await errorsFor(RegisterDto, { ...vendor, username: 'lotus_decor' })).toEqual([]);
    expect(await errorsFor(RegisterDto, { ...vendor, username: 'x' })).toEqual(['username']);
  });

  it('stays optional for the other personas, as before', async () => {
    expect(
      await errorsFor(RegisterDto, {
        ...vendor,
        accountType: AccountType.INDIVIDUAL,
        role: UserRole.BRIDE,
      }),
    ).toEqual([]);
  });
});

describe('LoginDto without a username', () => {
  it('signs in by email or mobile number', async () => {
    expect(await errorsFor(LoginDto, { email: vendor.email, password: 'x' })).toEqual([]);
    expect(await errorsFor(LoginDto, { email: '9876543210', password: 'x' })).toEqual([]);
  });
});
