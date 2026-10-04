import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { maskAccountNumber, sealField } from '../../common/util/field-cipher';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Vendor } from './entities/vendor.entity';
import {
  PayoutBankAccount,
  PayoutBankStatus,
  PayoutOwnerType,
} from './entities/payout-bank-account.entity';
import { PayoutAccountDto, PayoutBankAccountDto } from './dto/vendor.dto';
import { PayoutBankService } from './payout-bank.service';

/**
 * Where a provider's payout setup stands, as the server sees it.
 *
 * - `not_set_up`: nothing to pay into; earnings are held as owed.
 * - `pending_verification`: bank details were submitted and are waiting for a
 *   gateway linked account. Money is still held until then.
 * - `active`: a gateway linked account exists and payouts go to it.
 */
export type PayoutSetupStatus = 'not_set_up' | 'pending_verification' | 'active';

export interface PayoutAccountView {
  payoutAccountId: string | null;
  status: PayoutSetupStatus;
  bankAccount: {
    accountHolderName: string;
    bankName: string;
    accountType: string;
    /** Only ever the last four digits. */
    accountNumberMasked: string;
    ifsc: string;
    branch: string;
    status: PayoutBankStatus;
    submittedAt: Date;
  } | null;
}

/** The listing a payout account hangs off: a vendor business or a planner profile. */
interface PayoutOwner {
  type: PayoutOwnerType;
  id: string;
  payoutAccountId: string | null;
  save(accountId: string | null): Promise<void>;
}

/**
 * A provider's payout account: the gateway linked account id escrow pays out
 * to, and the bank details submitted to get one.
 *
 * Bank details never reach a log or an audit entry from here, and the account
 * number is sealed before it is stored. Every read returns it masked.
 */
@Injectable()
export class PayoutAccountsService {
  constructor(
    @InjectRepository(PayoutBankAccount)
    private readonly accounts: Repository<PayoutBankAccount>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    private readonly banks: PayoutBankService,
    private readonly cfg: AppConfigService,
  ) {}

  async getForVendor(ownerUserId: string, vendorId: string): Promise<PayoutAccountView> {
    return this.view(await this.vendorOwner(ownerUserId, vendorId));
  }

  async setForVendor(
    ownerUserId: string,
    vendorId: string,
    dto: PayoutAccountDto,
  ): Promise<PayoutAccountView> {
    return this.apply(await this.vendorOwner(ownerUserId, vendorId), dto);
  }

  async getForPlanner(ownerUserId: string): Promise<PayoutAccountView> {
    return this.view(await this.plannerOwner(ownerUserId));
  }

  async setForPlanner(ownerUserId: string, dto: PayoutAccountDto): Promise<PayoutAccountView> {
    return this.apply(await this.plannerOwner(ownerUserId), dto);
  }

  /**
   * Applies one save from the payout form.
   *
   * - Bank details are re-checked against the IFSC directory, sealed and
   *   stored as waiting for verification.
   * - A linked account id, when given, becomes where payouts go, and marks any
   *   submitted bank details as linked.
   * - An empty id with no bank details clears both: how a provider whose
   *   account has closed stops payouts going somewhere that will bounce.
   */
  private async apply(owner: PayoutOwner, dto: PayoutAccountDto): Promise<PayoutAccountView> {
    const accountId = dto.payoutAccountId?.trim();

    if (!dto.bankAccount && accountId === '') {
      await owner.save(null);
      await this.accounts.delete({ ownerType: owner.type, ownerId: owner.id });
      return this.view({ ...owner, payoutAccountId: null });
    }

    if (dto.bankAccount) {
      await this.storeBankAccount(owner, dto.bankAccount, Boolean(accountId));
    }

    if (accountId) {
      await owner.save(accountId);
      await this.accounts.update(
        { ownerType: owner.type, ownerId: owner.id },
        { status: PayoutBankStatus.LINKED },
      );
      return this.view({ ...owner, payoutAccountId: accountId });
    }
    return this.view(owner);
  }

  private async storeBankAccount(
    owner: PayoutOwner,
    bank: PayoutBankAccountDto,
    linked: boolean,
  ): Promise<void> {
    // The client's own lookup is a convenience; this is the check that counts.
    const branch = await this.banks.lookupIfsc(bank.ifsc, bank.bankName);
    const sealed = sealField(bank.accountNumber, this.sealingKey());

    const existing = await this.accounts.findOne({
      where: { ownerType: owner.type, ownerId: owner.id },
    });
    const row = existing ?? this.accounts.create({ ownerType: owner.type, ownerId: owner.id });
    Object.assign(row, {
      accountHolderName: bank.accountHolderName,
      bankName: branch.bankName,
      accountType: bank.accountType,
      accountNumberSealed: sealed,
      accountLast4: bank.accountNumber.slice(-4),
      ifsc: branch.ifsc,
      branch: branch.branch,
      status: linked ? PayoutBankStatus.LINKED : PayoutBankStatus.PENDING_VERIFICATION,
    });
    await this.accounts.save(row);
  }

  /**
   * The key account numbers are sealed under.
   *
   * Production has to name one. Anywhere else a key derived from the JWT
   * secret keeps a local stack working without another setting.
   */
  private sealingKey(): string {
    const configured = this.cfg.payout.detailsKey;
    if (configured) return configured;
    if (this.cfg.isProduction) {
      throw new ServiceUnavailableException(
        'Bank details cannot be saved right now. Please try again later.',
      );
    }
    return `payout-details:${this.cfg.auth.jwtSecret}`;
  }

  private async view(owner: PayoutOwner): Promise<PayoutAccountView> {
    const bank = await this.accounts.findOne({
      where: { ownerType: owner.type, ownerId: owner.id },
    });
    const status: PayoutSetupStatus =
      bank?.status === PayoutBankStatus.PENDING_VERIFICATION
        ? 'pending_verification'
        : owner.payoutAccountId
          ? 'active'
          : 'not_set_up';
    return {
      payoutAccountId: owner.payoutAccountId,
      status,
      bankAccount: bank
        ? {
            accountHolderName: bank.accountHolderName,
            bankName: bank.bankName,
            accountType: bank.accountType,
            accountNumberMasked: maskAccountNumber(bank.accountLast4),
            ifsc: bank.ifsc,
            branch: bank.branch,
            status: bank.status,
            submittedAt: bank.updatedAt,
          }
        : null,
    };
  }

  private async vendorOwner(ownerUserId: string, vendorId: string): Promise<PayoutOwner> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('This listing does not belong to you');
    }
    return {
      type: 'vendor',
      id: vendor.id,
      payoutAccountId: vendor.payoutAccountId,
      save: async (accountId) => {
        await this.vendors.update(vendor.id, { payoutAccountId: accountId });
      },
    };
  }

  private async plannerOwner(ownerUserId: string): Promise<PayoutOwner> {
    const planner = await this.planners.findOne({ where: { ownerUserId } });
    if (!planner) throw new NotFoundException('You have not created a planner listing yet');
    return {
      type: 'planner',
      id: planner.id,
      payoutAccountId: planner.payoutAccountId,
      save: async (accountId) => {
        await this.planners.update(planner.id, { payoutAccountId: accountId });
      },
    };
  }
}
