/**
 * Hand-written, like `validate.ts`. T-077: the base of every error the packages raise for a caller to act
 * on — a stable `code` to branch on and to show, and `docsUrl`, where the code is explained. The message is
 * for the developer reading a log and may change between releases; the code does not.
 */

/** The published error reference: one anchor per code. */
export const ERROR_REFERENCE_URL = "https://normwerk.dev/einvoice/docs/errors";

/** Where `code` is explained: its anchor on the error reference, in lower case with hyphens. */
export function errorDocsUrl(code: string): string {
  return `${ERROR_REFERENCE_URL}#${code.toLowerCase().replaceAll("_", "-")}`;
}

export class EinvoiceError<Code extends string = string> extends Error {
  readonly docsUrl: string;

  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message);
    this.name = "EinvoiceError";
    this.docsUrl = errorDocsUrl(code);
  }
}
