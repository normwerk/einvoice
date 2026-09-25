import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// Only this package needs its own vitest config: `.medusa/server` is `medusa plugin:build`'s compiled-CJS
// output, the equivalent of `dist/` elsewhere in this repo — vitest's default discovery would otherwise
// also pick up its transpiled `*.test.js` copies and fail to run them as CommonJS.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/.medusa/**"],
    coverage: {
      exclude: [
        ...coverageConfigDefaults.exclude,
        // These are exercised by `docs/manual-testing.md`'s procedures, not vitest — not a gap, a
        // different, deliberate testing strategy for a different kind of code:
        //  - API routes: one-line wrappers around the module service (`req.scope.resolve` +
        //    `service.<method>()`), covered by the doc's Store/Admin API checks.
        "src/api/**/route.ts",
        //  - Admin widget: React UI, covered by the doc's manual visual check.
        "src/admin/widgets/**",
        "src/admin/i18n/**",
        //  - Route middleware wiring: a plain object literal passed to Medusa's own `defineMiddlewares`
        //    (which method/matcher gets which auth middleware) — no branches or logic of its own to
        //    exercise; `einvoice-http.ts`'s `customerOwnsOrder` (what the middleware's own auth check
        //    doesn't cover — per-order ownership) is real logic and stays in scope, tested in
        //    `einvoice-http.test.ts`.
        "src/api/middlewares.ts",
        //  - The order link (P-71): one `defineLink` call Medusa reads at boot — declarative, exercised by
        //    the end-to-end suite's S19, which reads an order's documents through it.
        "src/links/**",
        //  - MikroORM schema migrations: generated/declarative, not logic to unit-test.
        "src/modules/einvoice/migrations/**",
        //  - Type/interface-only file (T-117's tax-matrix harness) — no runtime statements to hit; v8
        //    reports a type-only file as 0% covered, which is a reporting artifact, not a real gap.
        "src/tax-matrix/types.ts",
      ],
      thresholds: {
        // Real, current floor for the code this config leaves in scope (`storage.ts`, `api/einvoice-http.ts`,
        // `mapping/**`, `modules/einvoice/**` minus migrations, `subscribers/**`,
        // `tax-matrix/**` minus the type-only file above) — not an aspirational number; today's actuals are
        // ~88/83/95/88 (stmts/branch/funcs/lines), this sits a few points under each as a real floor, not a
        // ceiling to stop at.
        // `modules/einvoice/service.ts`'s own two DB-transaction-backed methods (`allocateNextNumber`,
        // `recordDocumentIfAbsent`'s `UniqueConstraintViolationException` path) stay under-covered at the
        // unit level for the same reason routes/migrations do — they need a real Postgres transaction,
        // which is `docs/e2e.md`'s job (T-078), not vitest's.
        statements: 80,
        lines: 80,
        functions: 85,
        branches: 75,
      },
    },
  },
});
