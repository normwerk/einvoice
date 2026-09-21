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
        ...(vatIdVerifier ? { vatIdVerifier } : {}),
        ...(fixedNow ? { now: () => new Date(fixedNow) } : {}),
      },
    },
  ],
});
