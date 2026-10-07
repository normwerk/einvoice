import { describe, expect, it } from "vitest";
import { stackFramesOf, toolErrorOf } from "./tool-error.js";

describe("stackFramesOf (T-214)", () => {
  it("keeps the frames in @normwerk packages from the package's name on, and counts the others", () => {
    const stack = [
      "    at prepare (/srv/shop/node_modules/.pnpm/@normwerk+einvoice-medusa@0.1.0/node_modules/@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:268:19)",
      "    at async planInvoiceForFulfillment (file:///Users/someone/shop/node_modules/@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:316:16)",
      "    at Query.graph (/srv/shop/node_modules/@medusajs/framework/dist/query.js:10:5)",
      "    at node:internal/process/task_queues:105:5",
      "    at /home/dev/einvoice/packages/einvoice-commerce/dist/build-invoice.js:42:7",
    ].join("\n");

    expect(stackFramesOf(stack)).toEqual([
      {
        function: "prepare",
        at: "@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:268:19",
      },
      {
        function: "planInvoiceForFulfillment",
        at: "@normwerk/einvoice-medusa/.medusa/server/src/invoices/issue-invoice.js:316:16",
      },
      { outside: 2 },
      { function: "<anonymous>", at: "@normwerk/einvoice-commerce/dist/build-invoice.js:42:7" },
    ]);
  });
});

describe("toolErrorOf (T-214)", () => {
  it("leaves the message out, however many lines it runs to and whatever they look like", () => {
    const error = new TypeError(
      "VAT-ID DE123456789 of Buyer GmbH\n    at Beispielstraße (/x/packages/einvoice-medusa/src/a.ts:1:1)",
    );

    const toolError = toolErrorOf(error, "plan");

    expect(toolError).toMatchObject({
      stage: "plan",
      code: "INTERNAL_ERROR",
      errorClass: "TypeError",
    });
    expect(JSON.stringify(toolError)).not.toMatch(/DE123456789|Buyer GmbH|Beispielstraße/);
  });

  it("keeps a coded error's code, and gives one defect one fingerprint", () => {
    const thrown = () =>
      Object.assign(new Error("first"), { code: "INVALID_PAID_AMOUNT", docsUrl: "x" });
    // The same path through the code twice: the same frames, line for line.
    const [one, other] = [1, 2].map(() => toolErrorOf(thrown(), "serialize"));
    if (one === undefined || other === undefined) throw new Error("two errors expected");

    expect(one.code).toBe("INVALID_PAID_AMOUNT");
    expect(one.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(other.fingerprint).toBe(one.fingerprint);
  });
});
