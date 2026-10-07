/**
 * T-214: a dry-run report written by hand to show the format — not a run. The orders are the end-to-end
 * scenarios' (`e2e/src/scenarios/`, `order_s01` is S1's), each with the outcome its scenario asserts for the
 * plugin. Two orders are made up to show what the scenarios never produce: `order_illustrative_invalid`, an
 * invoice the validators reject, and `order_illustrative_tool_error`, a run that failed. The validator verdicts
 * are illustrative too; no validator ran for this file. `example-report.json` and `example-report.md` are
 * written from it by `markdown.test.ts`.
 */
import type { Assessment, DocumentValidation, DryRunReport, Finding, Outcome } from "../report.js";

const ERRORS = "https://normwerk.dev/einvoice/docs/errors";

const valid: DocumentValidation = {
  status: "ran",
  verdicts: [
    { tool: "kosit", result: "valid", rules: [] },
    { tool: "mustang", result: "valid", rules: [] },
  ],
};

function invoice(orderId: string, fulfillmentId: string, outcome: Outcome): Assessment {
  return { document: { type: "invoice", orderId, fulfillmentId }, outcome };
}

function issued(profile = "EN16931"): Outcome {
  return { class: "would-issue", profile, validation: valid };
}

function refused(refusal: Finding): Outcome {
  return { class: "would-refuse", refusal };
}

function noticed(notice: Finding): Outcome {
  return { class: "would-issue-with-notice", profile: "EN16931", notice, validation: valid };
}

const creditNotesNotAssessed: Outcome = {
  class: "not-assessed",
  limitation: "CREDIT_NOTES_NOT_ASSESSED",
};

function refund(orderId: string, refundId: string): Assessment {
  return {
    document: { type: "credit-note", orderId, trigger: "refund", refundId },
    outcome: creditNotesNotAssessed,
  };
}

const VAT_OVERCHARGED: Finding = {
  code: "VAT_OVERCHARGED",
  reason:
    "Prices without VAT: the invoice states less VAT than Medusa charged — typically a business buyer in " +
    "another EU member state, invoiced at 0 % — and the buyer paid the difference on top.",
  docsUrl: `${ERRORS}#vat-overcharged`,
};

export const exampleReport: DryRunReport = {
  schemaVersion: 1,
  header: {
    startedAt: "2026-10-07T12:00:00Z",
    plugin: { name: "@normwerk/einvoice-medusa", version: "0.1.0" },
    platform: { name: "Medusa", version: "2.21.2" },
    nodeVersion: "22.12.0",
    core: [
      { name: "@normwerk/einvoice-commerce", version: "0.1.0" },
      { name: "@normwerk/einvoice-cii", version: "0.1.0" },
      { name: "@normwerk/einvoice-model", version: "0.1.0" },
    ],
    rulesSha256: "e29a5da1d7450f8d2946f22431bc90310a833e2e4fe3a78d4aca3961dd7937a1",
    scope: {
      selection: { kind: "period", from: "2026-09-01", to: "2026-09-30" },
      orders: 26,
      fulfillments: 30,
      skipped: { alreadyInvoiced: 0, canceled: 1 },
      vatIdChecks: { distinct: 3, confirmed: 2, notConfirmed: 0, unavailable: 1 },
    },
  },
  preflight: [
    {
      check: "platform-version",
      status: "pass",
      installed: "2.21.2",
      supported: "2.12–2.15, 2.18 or a later 2.x",
    },
    { check: "migrations", status: "pass", pending: [] },
    { check: "plugin-options", status: "pass", invalid: [] },
    { check: "tax-rates", status: "pass", withoutVat: [] },
    { check: "other-invoice-plugins", status: "warn", plugins: ["@webbers/invoices-medusa"] },
    { check: "file-storage", status: "pass", provider: "@medusajs/medusa/file-local" },
    { check: "vat-id-verifier", status: "pass", configured: true },
  ],
  validation: {
    status: "ran",
    tools: [
      {
        name: "kosit-validator",
        version: "1.6.3",
        sha256: "799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9",
      },
      {
        name: "xrechnung-validator-configuration",
        version: "XRechnung 3.0.2, release v2026-08-31",
        sha256: "2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8",
      },
      {
        name: "mustang-cli",
        version: "2.26.0",
        sha256: "42d7868cb68264874a7b8cab4c3587b03b23ccc7cd72373da917f66758bb9736",
      },
    ],
  },
  assessments: [
    invoice("order_s01", "ful_s01", issued()),
    invoice("order_s02", "ful_s02", issued()),
    invoice("order_s04", "ful_s04", issued()),
    refund("order_s04", "ref_s04"),
    invoice("order_s05", "ful_s05", issued()),
    refund("order_s05", "ref_s05"),
    invoice("order_s06", "ful_s06", issued()),
    {
      document: { type: "credit-note", orderId: "order_s06", trigger: "order-canceled" },
      outcome: creditNotesNotAssessed,
    },
    invoice("order_s07", "ful_s07", issued()),
    invoice("order_s08", "ful_s08", issued()),
    invoice("order_s09", "ful_s09", issued()),
    invoice("order_s10", "ful_s10", issued()),
    invoice("order_s11", "ful_s11", issued("XRECHNUNG")),
    invoice("order_s12", "ful_s12", noticed(VAT_OVERCHARGED)),
    refund("order_s12", "ref_s12"),
    invoice(
      "order_s13",
      "ful_s13",
      refused({
        code: "INVOICE_VAT_ABOVE_CHARGED",
        reason:
          "The invoice would state more VAT than Medusa charged, and so a higher total than the buyer " +
          "paid — VAT stated on an invoice is owed (§14c UStG).",
        docsUrl: `${ERRORS}#invoice-vat-above-charged`,
      }),
    ),
    invoice(
      "order_s14",
      "ful_s14",
      refused({
        code: "VAT_ID_UNVERIFIED",
        reason:
          "An intra-EU supply (category K) needs the buyer's VAT-ID confirmed valid — a positive VIES " +
          "check — or a declared manual confirmation (regime override `intra-eu-confirmed`).",
        docsUrl: `${ERRORS}#vat-id-unverified`,
      }),
    ),
    invoice(
      "order_s15",
      "ful_s15",
      noticed({ ...VAT_OVERCHARGED, cause: "shipping-split-across-rates" }),
    ),
    invoice(
      "order_s16",
      "ful_s16",
      noticed({
        code: "VAT_DIFFERS_FROM_MEDUSA",
        reason:
          "Prices including VAT: the buyer paid the invoice total, but Medusa counts a different VAT than " +
          "the invoice.",
        docsUrl: `${ERRORS}#vat-differs-from-medusa`,
      }),
    ),
    invoice(
      "order_s17",
      "ful_s17",
      refused({
        code: "UNSUPPORTED_BUYER_COUNTRY_CLEARANCE",
        reason:
          "The buyer's country — Italy or Poland — runs a mandatory clearance platform with its own " +
          "national XML; no EN 16931 document can be submitted through it.",
        docsUrl: `${ERRORS}#unsupported-buyer-country-clearance`,
        country: "IT",
      }),
    ),
    invoice("order_s18", "ful_s18_1", issued()),
    invoice("order_s18", "ful_s18_2", issued()),
    invoice("order_s18b", "ful_s18b_2", issued()),
    invoice(
      "order_s20",
      "ful_s20",
      refused({
        code: "NO_VAT_CHARGED",
        reason: "No line and no shipping of a domestic order carries VAT: the shop charged none.",
        docsUrl: `${ERRORS}#no-vat-charged`,
      }),
    ),
    invoice("order_s21", "ful_s21", issued()),
    invoice("order_s22_exchange", "ful_s22_exchange_1", issued()),
    invoice(
      "order_s22_exchange",
      "ful_s22_exchange_2",
      refused({
        code: "SHIPMENT_OF_EXCHANGE",
        reason: "A fulfillment ships the new item of an exchange.",
        docsUrl: `${ERRORS}#shipment-of-exchange`,
      }),
    ),
    refund("order_s22_exchange", "ref_s22_exchange"),
    invoice("order_s22_claim", "ful_s22_claim_1", issued()),
    invoice(
      "order_s22_claim",
      "ful_s22_claim_2",
      refused({
        code: "SHIPMENT_OF_CLAIM_REPLACEMENT",
        reason: "A fulfillment ships a replacement from a claim.",
        docsUrl: `${ERRORS}#shipment-of-claim-replacement`,
      }),
    ),
    invoice("order_s22_edit", "ful_s22_edit", {
      class: "not-assessed",
      limitation: "ORDER_EDITED_AFTER_SHIPMENT",
    }),
    invoice("order_s23", "ful_s23", issued()),
    invoice("order_illustrative_invalid", "ful_illustrative_invalid", {
      class: "would-issue",
      profile: "EN16931",
      validation: {
        status: "ran",
        verdicts: [
          { tool: "kosit", result: "invalid", rules: ["BR-CO-15"] },
          { tool: "mustang", result: "invalid", rules: ["BR-CO-15"] },
        ],
      },
    }),
    invoice("order_illustrative_tool_error", "ful_illustrative_tool_error", {
      class: "tool-error",
      error: {
        stage: "plan",
        code: "INTERNAL_ERROR",
        errorClass: "TypeError",
        stack: [
          {
            function: "mapOrderToCommerceInvoiceInput",
            at: "@normwerk/einvoice-medusa/.medusa/server/src/mapping/order-to-commerce-invoice-input.js:412:31",
          },
          {
            function: "prepare",
            at: "@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:268:19",
          },
          {
            function: "planInvoiceForFulfillment",
            at: "@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:316:16",
          },
          { outside: 4 },
        ],
        fingerprint: "3f9a0c1d2e4b",
      },
    }),
  ],
  runLimitations: ["SHOP_PDF_NOT_ASSESSED"],
};
