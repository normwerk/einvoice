import { loadEnv, defineConfig } from "@medusajs/framework/utils";
import { MapVatIdVerifier } from "@normwerk/einvoice-commerce";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

// T-078: the one VAT-ID the stand's S2 scenario ever checks — scripted here and read by the harness's own
// seed step (e2e/src/seed) from the same env var, so the two sides can't drift apart (plan-e2e.md §4.1: a
// real VIES call is never made from a test).
const validVatId = process.env.EINVOICE_E2E_VALID_VAT_ID;
const vatIdVerifier = validVatId
  ? new MapVatIdVerifier(new Map([[validVatId, "valid"]]))
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

module.exports = defineConfig({
  // T-078: the stand only ever drives Admin/Store HTTP APIs (plan-e2e.md's own "через Admin/Store HTTP API,
  // не через внутренние воркфлоу и не через UI") — the dashboard itself is never opened. `medusa start`
  // otherwise refuses to boot without a prebuilt admin bundle ("Could not find index.html in the admin
  // build directory", a real error hit running this for real); disabling it skips that requirement
  // entirely rather than adding a `medusa build` step this stand has no other use for.
  admin: { disable: true },
  projectConfig: {
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
          countryCode: "DE",
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
        payment: {
          means: "58",
          iban: "DE89370400440532013000",
        },
        // T-078: S1 is the plan's own designated PDF/A-3b scenario (plan-e2e.md §4) — the rest stay
        // XML-only so the suite doesn't double every scenario's runtime for a path S1 already exercises.
        standalone: {
          basePdf: async (invoice) => {
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
