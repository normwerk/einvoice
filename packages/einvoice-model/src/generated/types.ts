/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/model/generate.mjs
 * Source artifacts (see artifacts/MANIFEST.json for hashes):
 *   - artifacts/cii-d16b/schematron/EN16931-CII-validation-preprocessed.sch (EUPL-1.2)
 *   - artifacts/cii-d16b/schematron/EN16931-CII-codes.sch (EUPL-1.2)
 * To change: edit tools/codegen/model/terms.mjs or the artifact, then
 * re-run `pnpm codegen:model` from the repo root.
 */
import type { Amount, IsoDate } from "./primitives";
import type {
  CountryCode,
  CurrencyCode,
  EasCode,
  InvoiceTypeCode,
  PaymentMeansCode,
  UnitCode,
  VatCategoryCode,
  VatexCode,
} from "./codelists";

/** EN 16931 invoice or credit note, in model form. Amounts are decimal strings (ADR-004) — never a JS number. */
export interface Invoice {
  /** BT-1 Invoice number */
  readonly number: string;
  /** BT-2 Invoice issue date */
  readonly issueDate: IsoDate;
  /** BT-3 Invoice type code */
  readonly typeCode: InvoiceTypeCode;
  /** BT-5 Invoice currency code */
  readonly currencyCode: CurrencyCode;
  /** BT-6 VAT accounting currency code */
  readonly taxCurrencyCode?: CurrencyCode;
  /** BT-7 Value added tax point date */
  readonly taxPointDate?: IsoDate;
  /** BT-8 Value added tax point date code */
  readonly taxPointDateCode?: string;
  /** BT-24 Specification identifier */
  readonly specificationIdentifier: string;
  /** BT-10 Buyer reference (name not independently quoted in our extraction — see terms.mjs) */
  readonly buyerReference?: string;
  /** BG-3 Preceding Invoice reference */
  readonly precedingInvoiceReferences?: readonly PrecedingInvoiceReference[];
  /** BG-4 Seller */
  readonly seller: SellerParty;
  /** BG-11 Seller tax representative party */
  readonly sellerTaxRepresentative?: TaxRepresentativeParty;
  /** BG-7 Buyer (name not independently quoted in our extraction — see terms.mjs) */
  readonly buyer: BuyerParty;
  /** BG-13 Delivery information (name not independently quoted in our extraction — see terms.mjs) */
  readonly delivery?: Delivery;
  /** BG-14 Invoicing period */
  readonly invoicingPeriod?: InvoicingPeriod;
  /** BG-16 Payment instruction */
  readonly paymentInstructions?: PaymentInstructions;
  /** BG-20 Document level allowance */
  readonly documentLevelAllowances?: readonly DocumentLevelAllowance[];
  /** BG-21 Document level charge */
  readonly documentLevelCharges?: readonly DocumentLevelCharge[];
  /** BG-22 Document totals (name not independently quoted in our extraction — see terms.mjs) */
  readonly totals: DocumentTotals;
  /** BG-23 VAT breakdown */
  readonly vatBreakdown: readonly VatBreakdown[];
  /** BG-24 Additional supporting document */
  readonly additionalSupportingDocuments?: readonly AdditionalSupportingDocument[];
  /** BG-25 Invoice line */
  readonly lines: readonly InvoiceLine[];
  /** BT-23 Business process type (name not independently quoted in our extraction — see terms.mjs) */
  readonly businessProcessType?: string;
}

/** BG-24 Additional supporting document */
export interface AdditionalSupportingDocument {
  /** BT-122 Supporting document reference */
  readonly reference: string;
}

/** BG-7 Buyer */
export interface BuyerParty {
  /** BT-44 Buyer name */
  readonly name: string;
  /** BT-47 Buyer legal registration identifier */
  readonly legalRegistrationIdentifier?: string;
  /** BT-48 Buyer VAT identifier */
  readonly vatIdentifier?: string;
  /** BT-55 Buyer country code */
  readonly countryCode: CountryCode;
  /** BT-49 Buyer electronic address (name not independently quoted in our extraction — see terms.mjs) */
  readonly electronicAddress?: string;
  /** BT-49-1 Buyer electronic address scheme identifier (name not independently quoted in our extraction — see terms.mjs) */
  readonly electronicAddressScheme?: EasCode;
  /** BT-52 Buyer city (name not independently quoted in our extraction — see terms.mjs) */
  readonly city: string;
  /** BT-53 Buyer post code (name not independently quoted in our extraction — see terms.mjs) */
  readonly postCode: string;
}

/** BG-13 Delivery information */
export interface Delivery {
  /** BT-72 Actual delivery date */
  readonly actualDeliveryDate?: IsoDate;
  /** BT-80 Deliver to country code */
  readonly deliverToCountryCode?: CountryCode;
  /** BT-77 Deliver to city (name not independently quoted in our extraction — see terms.mjs) */
  readonly deliverToCity?: string;
  /** BT-78 Deliver to post code (name not independently quoted in our extraction — see terms.mjs) */
  readonly deliverToPostCode?: string;
}

/** BG-20 Document level allowance */
export interface DocumentLevelAllowance {
  /** BT-92 Document level allowance amount */
  readonly amount: Amount;
  /** BT-93 Document level allowance base amount */
  readonly baseAmount?: Amount;
  /** BT-94 Document level allowance calculation percent (name not independently quoted in our extraction — see terms.mjs) */
  readonly calculationPercent?: Amount;
  /** BT-95 Document level allowance VAT category code */
  readonly vatCategoryCode: VatCategoryCode;
  /** BT-96 Document level allowance VAT rate */
  readonly vatRate?: Amount;
  /** BT-97 Document level allowance reason */
  readonly reason?: string;
  /** BT-98 Document level allowance reason code */
  readonly reasonCode?: string;
}

/** BG-21 Document level charge */
export interface DocumentLevelCharge {
  /** BT-99 Document level charge amount */
  readonly amount: Amount;
  /** BT-100 Document level charge base amount */
  readonly baseAmount?: Amount;
  /** BT-101 Document level charge calculation percent (name not independently quoted in our extraction — see terms.mjs) */
  readonly calculationPercent?: Amount;
  /** BT-102 Document level charge VAT category code */
  readonly vatCategoryCode: VatCategoryCode;
  /** BT-103 Document level charge VAT rate */
  readonly vatRate?: Amount;
  /** BT-104 Document level charge reason */
  readonly reason?: string;
  /** BT-105 Document level charge reason code */
  readonly reasonCode?: string;
}

/** BG-22 Document totals */
export interface DocumentTotals {
  /** BT-106 Sum of Invoice line net amount */
  readonly sumOfLineNetAmounts: Amount;
  /** BT-107 Sum of allowanced on document level */
  readonly sumOfAllowances?: Amount;
  /** BT-108 Sum of charges on document level */
  readonly sumOfCharges?: Amount;
  /** BT-109 Invoice total amount without VAT */
  readonly totalAmountWithoutVat: Amount;
  /** BT-110 Invoice total VAT amount */
  readonly totalVatAmount?: Amount;
  /** BT-111 Invoice total VAT amount in accounting currency */
  readonly totalVatAmountInAccountingCurrency?: Amount;
  /** BT-112 Invoice total amount with VAT */
  readonly totalAmountWithVat: Amount;
  /** BT-113 Paid amount */
  readonly paidAmount?: Amount;
  /** BT-114 Rounding amount */
  readonly roundingAmount?: Amount;
  /** BT-115 Amount due for payment */
  readonly amountDueForPayment: Amount;
}

/** BG-25 Invoice line */
export interface InvoiceLine {
  /** BT-126 Invoice line identifier */
  readonly identifier: string;
  /** BT-129 Invoiced quantity */
  readonly quantity: Amount;
  /** BT-130 Invoiced quantity unit of measure code */
  readonly unitCode: UnitCode;
  /** BT-131 Invoice line net amount */
  readonly netAmount: Amount;
  /** BT-146 Item net price */
  readonly netPrice: Amount;
  /** BT-153 Item name */
  readonly itemName: string;
  /** BT-158 Item classification identifier */
  readonly hsCode?: string;
  /** BT-159 Item country of origin (name not independently quoted in our extraction — see terms.mjs) */
  readonly originCountry?: CountryCode;
  /** BG-26 Invoice line period */
  readonly invoicingPeriod?: InvoiceLinePeriod;
  /** BG-27 Invoice line allowance */
  readonly allowances?: readonly InvoiceLineAllowance[];
  /** BG-28 Invoice line charge */
  readonly charges?: readonly InvoiceLineCharge[];
  /** BG-30 Line VAT information (name not independently quoted in our extraction — see terms.mjs) */
  readonly vat: LineVat;
  /** BG-32 Item attribute */
  readonly itemAttributes?: readonly ItemAttribute[];
}

/** BG-27 Invoice line allowance */
export interface InvoiceLineAllowance {
  /** BT-136 Invoice line allowance amount */
  readonly amount: Amount;
  /** BT-137 Invoice line allowance base amount */
  readonly baseAmount?: Amount;
  /** BT-138 Invoice line allowance calculation percent (name not independently quoted in our extraction — see terms.mjs) */
  readonly calculationPercent?: Amount;
  /** BT-139 Invoice line allowance reason */
  readonly reason?: string;
  /** BT-140 Invoice line allowance reason code */
  readonly reasonCode?: string;
}

/** BG-28 Invoice line charge */
export interface InvoiceLineCharge {
  /** BT-141 Invoice line charge amount */
  readonly amount: Amount;
  /** BT-142 Invoice line charge base amount */
  readonly baseAmount?: Amount;
  /** BT-143 Invoice line charge calculation percent (name not independently quoted in our extraction — see terms.mjs) */
  readonly calculationPercent?: Amount;
  /** BT-144 Invoice line charge reason */
  readonly reason?: string;
  /** BT-145 Invoice line charge reason code */
  readonly reasonCode?: string;
}

/** BG-26 Invoice line period */
export interface InvoiceLinePeriod {
  /** BT-134 Invoice line period start date */
  readonly startDate?: IsoDate;
  /** BT-135 Invoice line period end date */
  readonly endDate?: IsoDate;
}

/** BG-14 Invoicing period */
export interface InvoicingPeriod {
  /** BT-73 Invoicing period start date */
  readonly startDate?: IsoDate;
  /** BT-74 Invoicing period end date */
  readonly endDate?: IsoDate;
}

/** BG-32 Item attribute */
export interface ItemAttribute {
  /** BT-160 Item attribute name */
  readonly name: string;
  /** BT-161 Item attribute value */
  readonly value: string;
}

/** BG-30 Line VAT information */
export interface LineVat {
  /** BT-151 Invoiced item VAT category code */
  readonly categoryCode: VatCategoryCode;
  /** BT-152 Invoiced item VAT rate */
  readonly rate?: Amount;
}

/** BG-16 Payment instruction */
export interface PaymentInstructions {
  /** BT-81 Payment means type code */
  readonly meansTypeCode?: PaymentMeansCode;
  /** BT-84 Payment account identifier */
  readonly accountIdentifier?: string;
}

/** BG-3 Preceding Invoice reference */
export interface PrecedingInvoiceReference {
  /** BT-25 Preceding Invoice reference */
  readonly invoiceNumber: string;
  /** BT-26 Preceding Invoice issue date (name not independently quoted in our extraction — see terms.mjs) */
  readonly issueDate?: IsoDate;
}

/** BG-6 Seller contact */
export interface SellerContact {
  /** BT-41 Seller contact point (name not independently quoted in our extraction — see terms.mjs) */
  readonly name: string;
  /** BT-42 Seller contact telephone number (name not independently quoted in our extraction — see terms.mjs) */
  readonly telephone: string;
  /** BT-43 Seller contact email address (name not independently quoted in our extraction — see terms.mjs) */
  readonly email: string;
}

/** BG-4 Seller */
export interface SellerParty {
  /** BT-27 Seller name */
  readonly name: string;
  /** BT-29 Seller identifier */
  readonly identifier?: string;
  /** BT-30 Seller legal registration identifier */
  readonly legalRegistrationIdentifier?: string;
  /** BT-31 Seller VAT identifier */
  readonly vatIdentifier?: string;
  /** BT-32 Seller tax registration identifier */
  readonly taxRegistrationIdentifier?: string;
  /** BT-40 Seller country code */
  readonly countryCode: CountryCode;
  /** BT-34 Seller electronic address (name not independently quoted in our extraction — see terms.mjs) */
  readonly electronicAddress?: string;
  /** BT-34-1 Seller electronic address scheme identifier (name not independently quoted in our extraction — see terms.mjs) */
  readonly electronicAddressScheme?: EasCode;
  /** BG-6 Seller contact (name not independently quoted in our extraction — see terms.mjs) */
  readonly contact?: SellerContact;
  /** BT-37 Seller city (name not independently quoted in our extraction — see terms.mjs) */
  readonly city: string;
  /** BT-38 Seller post code (name not independently quoted in our extraction — see terms.mjs) */
  readonly postCode: string;
}

/** BG-11 Seller tax representative party */
export interface TaxRepresentativeParty {
  /** BT-62 Seller tax representative name */
  readonly name: string;
  /** BT-63 Seller tax representative VAT identifier */
  readonly vatIdentifier: string;
  /** BT-69 Tax representative country code */
  readonly countryCode: CountryCode;
}

/** BG-23 VAT breakdown */
export interface VatBreakdown {
  /** BT-116 VAT category taxable amount */
  readonly taxableAmount: Amount;
  /** BT-117 VAT category tax amount */
  readonly taxAmount: Amount;
  /** BT-118 VAT category code */
  readonly categoryCode: VatCategoryCode;
  /** BT-119 VAT category rate */
  readonly rate?: Amount;
  /** BT-120 VAT exemption reason text */
  readonly exemptionReasonText?: string;
  /** BT-121 VAT exemption reason code */
  readonly exemptionReasonCode?: VatexCode;
}

