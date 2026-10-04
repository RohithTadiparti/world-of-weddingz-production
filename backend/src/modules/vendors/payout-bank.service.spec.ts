import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PayoutBankService } from './payout-bank.service';

describe('PayoutBankService IFSC lookup', () => {
  const service = new PayoutBankService({
    payout: { supportedBanks: [], ifscLookupBaseUrl: 'https://ifsc.example' },
  } as never);
  const realFetch = global.fetch;

  const respond = (init: { ok: boolean; json: () => Promise<unknown> }) => {
    global.fetch = jest.fn(async () => init as unknown as Response) as typeof fetch;
  };

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('resolves a known code to its bank and branch', async () => {
    respond({
      ok: true,
      json: async () => ({ IFSC: 'HDFC0001234', BANK: 'HDFC Bank', BRANCH: 'Koramangala', ADDRESS: 'Bengaluru 560034' }),
    });
    await expect(service.lookupIfsc('hdfc0001234')).resolves.toMatchObject({
      ifsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
      pinCode: '560034',
    });
  });

  it('reports a 200 with a body that is not JSON as the lookup being unavailable', async () => {
    respond({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    await expect(service.lookupIfsc('HDFC0001234')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects a malformed code without calling out', async () => {
    global.fetch = jest.fn() as typeof fetch;
    await expect(service.lookupIfsc('NOT-A-CODE')).rejects.toBeInstanceOf(BadRequestException);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
