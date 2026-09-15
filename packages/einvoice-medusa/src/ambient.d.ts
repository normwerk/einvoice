/**
 * `@webbers/invoices-medusa` ships no type declarations at all for its own deep, non-exports-mapped
 * subpaths (`integrations/webbers.ts`'s own doc comment on the real, confirmed packaging gaps in their
 * `1.0.6` release) — `noImplicitAny` (part of `strict`) would otherwise refuse the dynamic `import()` of
 * this path outright, before the real type-narrowing `as` cast at that call site ever runs. This ambient
 * declaration only tells TypeScript the module exists; `webbers.ts` still does its own real shape-checking
 * (`"entryPoint" in mod.default`) at runtime rather than trusting this to be accurate.
 */
declare module "@webbers/invoices-medusa/links/invoice-order";
