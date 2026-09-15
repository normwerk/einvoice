import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCommerceInvoiceInput } from "./validate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "../fixtures");

const validInput = {
  schemaVersion: 1,
  document: { kind: "invoice", number: "RE-1", issueDate: "2026-09-14", currency: "EUR" },
  seller: {
    name: "Musterfirma GmbH",
    countryCode: "DE",
    city: "Berlin",
    postCode: "10115",
    vatIdentifier: "DE123456789",
    contact: { name: "Rechnungsstelle", telephone: "+493012345678", email: "re@example.com" },
  },
  buyer: { name: "Kunde", countryCode: "DE", city: "Hamburg", postCode: "20095" },
  lines: [{ quantity: "1", unitCode: "C62", netPrice: "100.00", itemName: "Widget" }],
  taxContext: {
    sellerCountry: "DE",
    sellerVatId: "DE123456789",
    buyerCountry: "DE",
    buyerIsBusiness: true,
    ossRegistered: false,
    supplyType: "goods",
  },
};

describe("validateCommerceInvoiceInput", () => {
  it("accepts a well-formed CommerceInvoiceInput", () => {
    const result = validateCommerceInvoiceInput(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a wrong schemaVersion", () => {
    const result = validateCommerceInvoiceInput({ ...validInput, schemaVersion: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a payload missing a required field (no lines at all)", () => {
    const withoutLines: Record<string, unknown> = { ...validInput };
    delete withoutLines["lines"];
    const result = validateCommerceInvoiceInput(withoutLines);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("lines"))).toBe(true);
  });

  it("rejects an unknown top-level property (additionalProperties: false)", () => {
    const result = validateCommerceInvoiceInput({ ...validInput, notAField: true });
    expect(result.valid).toBe(false);
  });

  it("rejects a RegimeOverride 'exempt' variant missing its mandatory reasonText (BR-E-10)", () => {
    const result = validateCommerceInvoiceInput({
      ...validInput,
      taxContext: { ...validInput.taxContext, regimeOverride: { kind: "exempt" } },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a RegimeOverride 'zero-rated' variant with no reasonText/reasonCode (BR-Z-10)", () => {
    const result = validateCommerceInvoiceInput({
      ...validInput,
      taxContext: { ...validInput.taxContext, regimeOverride: { kind: "zero-rated" } },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a non-object payload without throwing", () => {
    expect(validateCommerceInvoiceInput("not an object").valid).toBe(false);
    expect(validateCommerceInvoiceInput(null).valid).toBe(false);
    expect(validateCommerceInvoiceInput(undefined).valid).toBe(false);
  });

  // Drift check: every real commerce fixture this repo carries must validate structurally — if the
  // generated schema ever fell out of sync with types.ts (or a fixture used a field the type no longer
  // has), this is the fast (no Docker/KoSIT) test that catches it.
  const fixtureIds = readdirSync(FIXTURES_DIR).filter((name) =>
    existsSync(resolve(FIXTURES_DIR, name, "input.json")),
  );
  it("found at least one commerce fixture to check", () => {
    expect(fixtureIds.length).toBeGreaterThan(0);
  });
  for (const id of fixtureIds) {
    it(`fixture ${id}/input.json validates structurally`, () => {
      const input = JSON.parse(readFileSync(resolve(FIXTURES_DIR, id, "input.json"), "utf-8"));
      const result = validateCommerceInvoiceInput(input);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});
