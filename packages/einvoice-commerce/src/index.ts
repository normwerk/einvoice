/**
 * `@normwerk/einvoice-commerce` — commerce order/refund → EN 16931 tax
 * semantics (plan-v0.1 §4.4, T-060/T-061/T-063/T-064/T-065, W9).
 * Platform-agnostic: no Medusa or Vendure type in this package
 * (`AGENTS.md` §6).
 */
export type {
  BuildResult,
  BuildWarning,
  CommerceCharge,
  CommerceShipping,
  CommerceInvoiceInput,
  CommerceInvoiceInputSchemaVersion,
  CommerceLine,
  CommerceLineAllowance,
  CommerceParty,
  RegimeOverride,
  TaxContext,
  TaxDecision,
  TaxDecisionScope,
  VatIdEvidence,
  VatIdVerifier,
} from "./types.js";

export {
  buildInvoice,
  DecisionCarriedToInvoiceError,
  InvoicedRateOnInvoiceError,
  InvalidAssembledInvoiceError,
  InvalidCommerceInvoiceInputError,
  DuplicateBuyerReferenceError,
  InvalidLeitwegIdError,
  InvalidPaidAmountError,
  InvalidPriceBasisError,
  LineAllowanceExceedsLineAmountError,
  MissingBuyerIdentifierForReverseChargeError,
  MissingBuyerVatIdError,
  MissingBuyerVatIdForCrossBorderServiceError,
  MissingCorrectedInvoiceReferenceError,
  MissingDeliveryInfoForIntraCommunitySupplyError,
  MissingDocumentNumberError,
  MissingElectronicAddressError,
  MissingSellerAddressError,
  MissingSellerContactError,
  UnsupportedSchemaVersionError,
  type BuildInvoiceOptions,
} from "./build-invoice.js";

export { commerceInvoiceInputJsonSchema } from "./generated/json-schema.js";
export { apportionAmount } from "./decimal.js";
export {
  allocateCreditAcrossRates,
  CreditExceedsInvoiceError,
  type AmountAtRate,
  type CreditAllocationInput,
  type CreditPiece,
  type ReturnToCredit,
} from "./credit-allocation.js";
export {
  validateCommerceInvoiceInput,
  type CommerceInvoiceInputValidationResult,
} from "./validate.js";

export {
  computeLeitwegIdCheckDigits,
  validateLeitwegId,
  type LeitwegIdValidationResult,
} from "./leitweg-id.js";

export {
  DE_REDUCED_RATE,
  DE_STANDARD_RATE,
  EU_MEMBER_STATES,
  MixedSupplyCrossBorderError,
  TaxRuleError,
  decideVatCategory,
  resolveLineRate,
} from "./tax-rules.js";

export { MapVatIdVerifier, StaticVatIdVerifier } from "./vat-id-verifier.js";

export {
  DE_VAT_RATE_PERIODS,
  DE_VAT_RATES_FROM,
  germanVatRatesOn,
  type GermanVatRatePeriod,
  type NormQuote,
} from "./de-vat-rates.js";

export {
  buyerCountrySupport,
  describeSupport,
  specialVatTerritory,
  SUPPORTED_SELLER_COUNTRIES,
  SUPPORTED_SINCE,
  type BuyerCountrySupport,
  type SpecialVatTerritory,
} from "./supported-jurisdictions.js";

export type { CommerceErrorCode, TaxRuleCode } from "./error-codes.js";

export {
  InMemoryNumberingStore,
  SequentialNumberer,
  type InvoiceNumberer,
  type NumberingStore,
} from "./numbering.js";

export {
  selectProfile,
  UnsupportedCountryError,
  type EInvoiceProfileName,
  type SelectProfileOptions,
  type UnsupportedCountryReason,
} from "./profile.js";
