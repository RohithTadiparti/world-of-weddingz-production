import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PayoutAccountsService } from './payout-accounts.service';
import { PayoutBankAccount, PayoutBankStatus } from './entities/payout-bank-account.entity';
import { PayoutBankAccountDto } from './dto/vendor.dto';
import { openField } from '../../common/util/field-cipher';

const KEY = 'test-payout-details-key-of-at-least-32-chars';

const bank: PayoutBankAccountDto = {
  accountHolderName: 'Asha Rao',
  bankName: 'HDFC Bank',
  accountType: 'savings',
  accountNumber: '123456789012',
  ifsc: 'HDFC0001234',
};

/**
 * The payout form's bank details: what is stored, what comes back, and what
 * the status says.
 */
describe('PayoutAccountsService', () => {
  let stored: (PayoutBankAccount & { accountNumberSealed: string }) | null;
  let vendorAccountId: string | null;
  let production: boolean;
  let detailsKey: string;

  const accounts = {
    findOne: jest.fn(async () => stored),
    create: jest.fn((x: Partial<PayoutBankAccount>) => ({ ...x }) as PayoutBankAccount),
    save: jest.fn(async (x: PayoutBankAccount & { accountNumberSealed: string }) => {
      stored = { ...x, updatedAt: new Date('2026-09-01T00:00:00Z') };
      return stored;
    }),
    update: jest.fn(async (_where: unknown, changes: Partial<PayoutBankAccount>) => {
      if (stored) stored = { ...stored, ...changes };
    }),
    delete: jest.fn(async () => {
      stored = null;
    }),
  };
  const vendors = {
    findOne: jest.fn(async () => ({ id: 'v1', ownerUserId: 'owner', payoutAccountId: vendorAccountId })),
    update: jest.fn(async (_id: string, changes: { payoutAccountId: string | null }) => {
      vendorAccountId = changes.payoutAccountId;
    }),
  };
  const banks = {
    lookupIfsc: jest.fn(async (ifsc: string) => ({
      ifsc,
      bankName: 'HDFC Bank',
      branch: 'Koramangala',
      address: '',
      city: '',
      state: '',
      pinCode: '',
    })),
  };
  const cfg = {
    get payout() {
      return { detailsKey };
    },
    get isProduction() {
      return production;
    },
    auth: { jwtSecret: 'jwt-secret' },
  };
  const service = new PayoutAccountsService(
    accounts as never,
    vendors as never,
    {} as never,
    banks as never,
    cfg as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    stored = null;
    vendorAccountId = null;
    production = false;
    detailsKey = KEY;
  });

  it('reports nothing set up before anything is submitted', async () => {
    const view = await service.getForVendor('owner', 'v1');
    expect(view).toEqual({ payoutAccountId: null, status: 'not_set_up', bankAccount: null });
  });

  it('stores submitted bank details sealed, checks the IFSC again, and shows them masked as pending', async () => {
    const view = await service.setForVendor('owner', 'v1', { bankAccount: bank });

    expect(banks.lookupIfsc).toHaveBeenCalledWith('HDFC0001234', 'HDFC Bank');
    expect(stored!.accountNumberSealed).not.toContain('123456789012');
    expect(openField(stored!.accountNumberSealed, KEY)).toBe('123456789012');
    expect(view.status).toBe('pending_verification');
    expect(view.bankAccount).toMatchObject({
      accountNumberMasked: 'XXXX9012',
      ifsc: 'HDFC0001234',
      branch: 'Koramangala',
      status: PayoutBankStatus.PENDING_VERIFICATION,
    });
    expect(JSON.stringify(view)).not.toContain('123456789012');
  });

  it('keeps accepting a linked account id on its own, as older clients send it', async () => {
    const view = await service.setForVendor('owner', 'v1', { payoutAccountId: 'acc_ABC123' });
    expect(vendorAccountId).toBe('acc_ABC123');
    expect(view.status).toBe('active');
  });

  it('marks submitted details as linked once a gateway account id arrives', async () => {
    await service.setForVendor('owner', 'v1', { bankAccount: bank });
    const view = await service.setForVendor('owner', 'v1', { payoutAccountId: 'acc_ABC123' });
    expect(view.status).toBe('active');
    expect(view.bankAccount?.status).toBe(PayoutBankStatus.LINKED);
  });

  it('clears both the account id and the bank details', async () => {
    vendorAccountId = 'acc_ABC123';
    await service.setForVendor('owner', 'v1', { bankAccount: bank });
    const view = await service.setForVendor('owner', 'v1', { payoutAccountId: '' });
    expect(vendorAccountId).toBeNull();
    expect(stored).toBeNull();
    expect(view.status).toBe('not_set_up');
  });

  it('refuses bank details in production when no sealing key is configured', async () => {
    production = true;
    detailsKey = '';
    await expect(service.setForVendor('owner', 'v1', { bankAccount: bank })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(accounts.save).not.toHaveBeenCalled();
  });

  it('refuses a business that is not the caller’s', async () => {
    await expect(service.getForVendor('someone-else', 'v1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
