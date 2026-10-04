import type { Answers, FieldSpec } from '@/shared/dynamic-form';

/** The catalog rows and the vendor's own services, as the API returns them. */

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

export interface Definition {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  allowedPricingModels: string[];
  availabilityModel: string;
  packagesAllowed: boolean;
}

export interface Offering {
  id: string;
  name: string;
  description: string | null;
  pricingModel: string;
  price: string | null;
  currency: string;
  unitLabel: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  isPackage: boolean;
  inclusions: string[];
  active: boolean;
}

export interface VendorService {
  id: string;
  definitionId: string;
  displayName: string | null;
  description: string | null;
  attributes: Answers;
  active: boolean;
  /** The server's own answer about whether a client can book this yet. */
  bookable: boolean;
  /** Its category is no longer one the business lists, so it is off sale. */
  outsideSelectedCategories?: boolean;
  definition: Definition | null;
  category: Category | null;
  serviceForm: FieldSpec[];
  bookingForm: FieldSpec[];
  offerings: Offering[];
}
