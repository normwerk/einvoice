import { describe, expect, it } from "vitest";
import { MedusaError } from "@medusajs/framework/utils";
import EinvoiceModuleService, { InvalidEinvoiceModuleOptionsError } from "./service.js";

const VALID_SELLER = {
  name: "Musterfirma GmbH",
  countryCode: "DE" as const,
  addressLine1: "Musterstraße 1",
  city: "Berlin",
  postCode: "10115",
  vatIdentifier: "DE123456789",
  electronicAddress: "invoicing@musterfirma.example",
  electronicAddressScheme: "EM" as const,
  contact: {
    name: "Rechnungsstelle",
    telephone: "+49 30 1234567",
    email: "invoicing@musterfirma.example",
  },
};

const VALID_PAYMENT = { means: "58" as const, iban: "DE89370400440532013000" };

// `MedusaService(...)`'s generated base constructor only reads `container.baseRepository` at construction
// time (per-model repositories, e.g. for `createEinvoiceDocuments`, are resolved lazily inside each CRUD
// method itself, not eagerly here) — a minimal fake is enough for these constructor-validation tests,
// none of which call a method that touches the database.
const FAKE_CONTAINER = { baseRepository: { transaction: async () => undefined } };

describe("EinvoiceModuleService", () => {
  it("holds validated options unchanged", () => {
    const options = {
      seller: VALID_SELLER,
      payment: VALID_PAYMENT,
      defaultProfile: "EN16931" as const,
    };
    const service = new EinvoiceModuleService(FAKE_CONTAINER, options);
    expect(service.options).toBe(options);
  });

  it("accepts options without defaultProfile (selectProfile has its own default)", () => {
    const service = new EinvoiceModuleService(FAKE_CONTAINER, {
      seller: VALID_SELLER,
      payment: VALID_PAYMENT,
    });
    expect(service.options.defaultProfile).toBeUndefined();
  });

  it("rejects a missing seller", () => {
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: undefined as never,
          payment: VALID_PAYMENT,
        }),
    ).toThrow(InvalidEinvoiceModuleOptionsError);
  });

  it("rejects a seller with an empty name", () => {
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: { ...VALID_SELLER, name: "" },
          payment: VALID_PAYMENT,
        }),
    ).toThrow(InvalidEinvoiceModuleOptionsError);
  });

  it("rejects a seller without contact at startup — BR-DE-2 would otherwise refuse every order (P-55)", () => {
    for (const contact of [undefined, { name: "", telephone: "+49 30 1", email: "a@b.example" }]) {
      expect(
        () =>
          new EinvoiceModuleService(FAKE_CONTAINER, {
            seller: { ...VALID_SELLER, contact: contact as never },
            payment: VALID_PAYMENT,
          }),
      ).toThrow(InvalidEinvoiceModuleOptionsError);
    }
  });

  it("rejects a seller without a street at startup — §14 Abs. 4 Nr. 1 UStG needs the seller's full address (P-60)", () => {
    for (const addressLine1 of [undefined, " "]) {
      expect(
        () =>
          new EinvoiceModuleService(FAKE_CONTAINER, {
            seller: { ...VALID_SELLER, addressLine1 },
            payment: VALID_PAYMENT,
          }),
      ).toThrow(InvalidEinvoiceModuleOptionsError);
    }
  });

  it("rejects a seller missing vatIdentifier, even though CommerceParty leaves it optional for a buyer", () => {
    const sellerWithoutVatId: Record<string, unknown> = { ...VALID_SELLER };
    delete sellerWithoutVatId["vatIdentifier"];
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: sellerWithoutVatId as typeof VALID_SELLER,
          payment: VALID_PAYMENT,
        }),
    ).toThrow(/vatIdentifier/);
  });

  it("rejects a seller missing electronicAddress/electronicAddressScheme (BR-62, found by a real KoSIT rejection)", () => {
    const sellerWithoutAddress: Record<string, unknown> = { ...VALID_SELLER };
    delete sellerWithoutAddress["electronicAddress"];
    delete sellerWithoutAddress["electronicAddressScheme"];
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: sellerWithoutAddress as typeof VALID_SELLER,
          payment: VALID_PAYMENT,
        }),
    ).toThrow(/electronicAddress/);
  });

  it("rejects options missing payment.means (BR-DE-1, found by a real KoSIT rejection)", () => {
    expect(
      () =>
        new EinvoiceModuleService(FAKE_CONTAINER, {
          seller: VALID_SELLER,
          payment: undefined as never,
        }),
    ).toThrow(/payment/);
  });

  // T-073: `standalone.basePdf` is a plain merchant-supplied hook, not something this constructor
  // validates (unlike `seller`/`payment`, there's no KoSIT rule an *absent* hook could ever fail) — this
  // only confirms accepting it doesn't trip `assertValidOptions` and that it's held unchanged, the same
  // way the very first test above confirms for the options object as a whole.
  it("accepts options.standalone.basePdf and holds it unchanged", () => {
    const basePdf = async () => new Uint8Array([1, 2, 3]);
    const service = new EinvoiceModuleService(FAKE_CONTAINER, {
      seller: VALID_SELLER,
      payment: VALID_PAYMENT,
      standalone: { basePdf },
    });
    expect(service.options.standalone?.basePdf).toBe(basePdf);
  });
});

describe("EinvoiceModuleService.recordDocumentIfAbsent (P-49)", () => {
  const INPUT = {
    type: "invoice" as const,
    orderId: "order_01",
    idempotencyKey: "ful_01",
    documentNumber: "RE-2026-0001",
    xmlFileId: "file_xml",
    pdfFileId: null,
  };

  function serviceWith(
    create: () => Promise<unknown>,
    list: () => Promise<unknown[]>,
  ): EinvoiceModuleService {
    const service = new EinvoiceModuleService(FAKE_CONTAINER, {
      seller: VALID_SELLER,
      payment: VALID_PAYMENT,
    });
    Object.assign(service, { createEinvoiceDocuments: create, listEinvoiceDocuments: list });
    return service;
  }

  it("reports a lost race as created: false — for the MedusaError Medusa's own repository turns a unique violation into, not only a raw MikroORM exception", async () => {
    // What `@medusajs/utils`' dbErrorMapper really throws for a UNIQUE violation: type invalid_data,
    // name "Error" — the shape an earlier `error.name` check never matched.
    const mapped = new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Einvoice document with type: invoice, idempotency_key: ful_01, already exists.",
    );
    const winner = { id: "doc_winner" };
    const service = serviceWith(
      async () => {
        throw mapped;
      },
      async () => [winner],
    );
    await expect(service.recordDocumentIfAbsent(INPUT)).resolves.toEqual({
      document: winner,
      created: false,
    });
  });

  it("rethrows the original error when no document exists for the key — the insert failed for another reason", async () => {
    const failure = new Error("connection reset");
    const service = serviceWith(
      async () => {
        throw failure;
      },
      async () => [],
    );
    await expect(service.recordDocumentIfAbsent(INPUT)).rejects.toBe(failure);
  });
});
