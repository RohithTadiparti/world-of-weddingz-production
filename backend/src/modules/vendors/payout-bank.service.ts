import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

export interface PayoutBankDetails {
  ifsc: string;
  bankName: string;
  branch: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
}

interface RazorpayIfscResponse {
  IFSC?: string;
  BANK?: string;
  BRANCH?: string;
  ADDRESS?: string;
  CITY?: string;
  STATE?: string;
  CENTRE?: string;
  CONTACT?: string;
}

@Injectable()
export class PayoutBankService {
  constructor(private readonly config: AppConfigService) {}

  listSupportedBanks(query?: string): string[] {
    const normalizedQuery = query?.trim().toLowerCase();
    return this.config.payout.supportedBanks.filter(
      (bank) => !normalizedQuery || bank.toLowerCase().includes(normalizedQuery),
    );
  }

  async lookupIfsc(rawIfsc: string, bankName?: string): Promise<PayoutBankDetails> {
    const ifsc = rawIfsc.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      throw new BadRequestException('Enter a valid IFSC code.');
    }

    let response: Response;
    try {
      response = await fetch(`${this.config.payout.ifscLookupBaseUrl.replace(/\/$/, '')}/${ifsc}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new ServiceUnavailableException('IFSC verification is temporarily unavailable.');
    }

    if (!response.ok) {
      throw new BadRequestException('Invalid IFSC code.');
    }

    // A 200 with a body that is not JSON (a captive portal, a proxy error page)
    // says nothing about the code, so it is the lookup being unavailable, not
    // a server fault.
    let value: RazorpayIfscResponse;
    try {
      value = (await response.json()) as RazorpayIfscResponse;
    } catch {
      throw new ServiceUnavailableException('IFSC verification is temporarily unavailable.');
    }
    if (!value || typeof value !== 'object' || !value.BANK || value.IFSC?.toUpperCase() !== ifsc) {
      throw new BadRequestException('Invalid IFSC code.');
    }

    if (bankName && bankName.trim().toLowerCase() !== value.BANK.trim().toLowerCase()) {
      throw new BadRequestException('Bank name does not match the IFSC code.');
    }

    const configuredBanks = this.config.payout.supportedBanks;
    if (configuredBanks.length > 0 && !configuredBanks.some((bank) => bank.toLowerCase() === value.BANK!.trim().toLowerCase())) {
      throw new BadRequestException('This bank is not supported for payouts.');
    }

    return {
      ifsc,
      bankName: value.BANK.trim(),
      branch: value.BRANCH?.trim() || '',
      address: value.ADDRESS?.trim() || '',
      city: (value.CITY || value.CENTRE || '').trim(),
      state: value.STATE?.trim() || '',
      pinCode: this.extractPinCode(value.ADDRESS),
    };
  }

  private extractPinCode(address?: string): string {
    return address?.match(/\b\d{6}\b/)?.[0] || '';
  }
}