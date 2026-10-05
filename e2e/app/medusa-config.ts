import { loadEnv, defineConfig } from "@medusajs/framework/utils";
import { MapVatIdVerifier } from "@normwerk/einvoice-commerce";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

// T-078: the one VAT-ID the stand's S2 scenario ever checks — scripted here and read by the harness's own
// seed step (e2e/src/seed) from the same env var, so the two sides can't drift apart (plan-e2e.md §4.1: a
// real VIES call is never made from a test).
const validVatId = process.env.EINVOICE_E2E_VALID_VAT_ID;
// P-66: a VAT-ID whose VIES check is unavailable — S14's refused invoice, retried once the merchant
// confirmed the number another way.
const unavailableVatId = process.env.EINVOICE_E2E_UNAVAILABLE_VAT_ID;
const vatIdVerifier = validVatId
  ? new MapVatIdVerifier(
      new Map<string, "valid" | "unavailable">([
        [validVatId, "valid"],
        ...(unavailableVatId ? [[unavailableVatId, "unavailable"] as const] : []),
      ]),
    )
  : undefined;

// T-078 (plan-e2e.md §5 rule 5): a real Medusa event has no other way to pin down "today" — this is what
// keeps a scenario's own invoice date reproducible instead of "whatever day the stand happened to run."
// Unset in normal (non-e2e) use, which keeps the plugin's own default (`() => new Date()`).
const fixedNow = process.env.EINVOICE_E2E_NOW;

// T-078: `@medusajs/file-local`'s own default `backend_url` is hard-coded to `http://localhost:9000/static`
// (its own source, `@medusajs/file-local/dist/services/local-file.js`) regardless of what port this app
// actually listens on — a real run confirmed it: every upload succeeds, but reading a file back
// (`fetchFileBytes`, the download routes this suite relies on) fails with `ECONNREFUSED` because the
// stored URL points at a port nothing is listening on. `PORT` is deliberately not 9000 here (plan-e2e.md
// §3.4, the same watcher-doesn't-free-9000 annoyance `docs/manual-testing.md` already records), so this
// has to be corrected explicitly rather than relying on the provider's own default.
const port = process.env.PORT ?? "9500";

// T-210: `EINVOICE_E2E_ADMIN=1` serves the dashboard, for checking the plugin's admin widgets by hand on the
// orders the scenarios leave behind (docs/manual-testing.md). The image then runs `medusa build` before
// `medusa start` (docker/medusa/Dockerfile).
const withAdmin = process.env.EINVOICE_E2E_ADMIN === "1";

module.exports = defineConfig({
  // T-078: the stand only ever drives Admin/Store HTTP APIs (plan-e2e.md's own "через Admin/Store HTTP API,
  // не через внутренние воркфлоу и не через UI") — the dashboard itself is never opened. `medusa start`
  // otherwise refuses to boot without a prebuilt admin bundle ("Could not find index.html in the admin
  // build directory", a real error hit running this for real); disabling it skips that requirement
  // entirely rather than adding a `medusa build` step this stand has no other use for — unless asked for
  // (T-210, above).
  admin: { disable: !withAdmin },
  projectConfig: {
    // T-210: the dashboard is served over plain HTTP, and a secure session cookie is never sent back.
    ...(withAdmin ? { cookieOptions: { secure: false } } : {}),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules: [
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-local",
            id: "local",
            options: { backend_url: `http://localhost:${port}/static` },
          },
        ],
      },
    },
  ],
  plugins: [
    {
      resolve: "@normwerk/einvoice-medusa",
      options: {
        seller: {
          name: "Normwerk Test GmbH",
          // `incomplete-config.test.ts` sets EINVOICE_E2E_SELLER_COUNTRY in a one-off container to confirm
          // the plugin refuses to start with a seller outside Germany. Unset in every other run.
          countryCode: (process.env.EINVOICE_E2E_SELLER_COUNTRY ?? "DE") as "DE",
          addressLine1: "Teststraße 1",
          city: "Berlin",
          postCode: "10115",
          vatIdentifier: "DE123456789",
          electronicAddress: "invoicing@einvoice-e2e.example",
          electronicAddressScheme: "EM",
          contact: {
            name: "Accounting",
            telephone: "+49 30 1234567",
            email: "invoicing@einvoice-e2e.example",
          },
        },
        // T-078: `incomplete-config.test.ts` boots a one-off container with this env var set to confirm
        // the plugin's own `assertValidOptions` (packages/einvoice-medusa) still refuses to start without
        // it — real, existing behavior (`InvalidEinvoiceModuleOptionsError`), not something this stand
        // adds. Unset in every other run, which is every other scenario.
        ...(process.env.EINVOICE_E2E_OMIT_PAYMENT
          ? {}
          : {
              payment: {
                means: "58",
                iban: "DE89370400440532013000",
              },
            }),
        // T-078: S1 is the plan's own designated PDF/A-3b scenario (plan-e2e.md §4) — the rest stay
        // XML-only so the suite doesn't double every scenario's runtime for a path S1 already exercises.
        standalone: {
          basePdf: async (invoice) => {
            // T-033 (S23): a buyer of this name gets a PDF with a font referenced by name only — Helvetica,
            // not embedded — the way many PDF generators render by default. It cannot become PDF/A.
            if (invoice.buyer.name === "Standardschrift GmbH") {
              const { PDFDocument, StandardFonts } = await import("pdf-lib");
              const doc = await PDFDocument.create();
              doc.addPage().drawText(`Rechnung ${invoice.number}`, {
                font: await doc.embedFont(StandardFonts.Helvetica),
              });
              return doc.save();
            }
            const { renderInvoicePdf } = await import("@normwerk/einvoice-pdfa");
            return renderInvoicePdf(invoice);
          },
        },
        ...(vatIdVerifier ? { vatIdVerifier } : {}),
        ...(fixedNow ? { now: () => new Date(fixedNow) } : {}),
      },
    },
  ],
});
