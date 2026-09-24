# Domain glossary

Project-specific EN 16931 / XRechnung conventions and pitfalls that are easy to miss and not obvious from
reading the spec alone. See `AGENTS.md` §2 for how this file is used. Back to [`docs/README.md`](README.md).

- **The XRechnung customization ID is a compound URN**, not just a version number:
  `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0`. It names both the EN 16931
  compliance level and the specific CIUS. Every scenario in the KoSIT validator configuration matches
  documents by this exact string (`s:match` in `scenarios.xml`) — get it wrong and the validator silently
  runs the _wrong_ scenario (or none) instead of failing loudly.
- **A KoSIT Schematron message's `level` does not map to pass/fail.** `BR-DE-TMP-32` (missing delivery
  date / invoicing period) is emitted at `level="information"` on an otherwise fully compliant invoice — the
  top-level `rep:report/@valid` attribute (or the top-level `summary/@status` in Mustang's report) is the
  actual verdict; counting "any message present" as failure produces false negatives. Verified against a
  real KoSIT Validator 1.6.3 run.
- **The KoSIT Validator writes its report next to the input file**, not to stdout
  (`<input>-report.xml` and `.html`, same directory) — a read-only mount of the input directory makes the
  validator fail to write the report, not just skip it silently.
- **Both the KoSIT Validator and Mustang exit non-zero for a _rejected_ document**, not only for a tool
  crash — treat "process exited with an error" and "document is invalid" as the same signal, but still
  parse the emitted report/JSON rather than trusting the exit code alone (a crash produces no report).
- **veraPDF's JSON output nests `validationSummary` under `report.batchSummary`**, not at the top level of
  `report` — easy to miswire when parsing the CLI's `--format json` output.
- **A summarized fetch of a BT reference page can simply be wrong, even when the page itself is real.**
  While building `einvoice-model`, a summarized read of a Peppol postal-address page claimed
  BT-40 = "Seller country subdivision" and BT-41 = "Seller country code" — both wrong. Our own vendored
  Schematron directly asserts BR-09: "The Seller postal address (BG-5) shall contain a Seller country code
  (BT-40)", and a raw (non-summarized) fetch of the same Peppol page confirmed BT-41 = "Seller contact
  point". Treat a _summarized_ answer about a specific BT/BG number as a lead to verify via direct quote
  (grep the vendored artifact, or read the raw fetched text yourself), never as the citation itself —
  `tools/codegen/model/generate.mjs`'s artifact cross-check exists specifically to catch this class of
  error before it reaches generated code.
- **`currencyID` may only be set on `ram:TaxTotalAmount`, never on any other `ram:*Amount` element**, under
  the XRechnung CII profile (`CII-DT-031`, in `XRechnung-CII-validation.xsl`, KoSIT/Apache-2.0) — base
  UN/CEFACT CII allows it everywhere, so this is an XRechnung-specific tightening, not obvious from the CII
  XSD alone. Found by running our own serializer output through the real KoSIT validator.
- **CII caps "Preceding Invoice reference" (BG-3) at one occurrence**, even though the EN 16931 semantic
  model phrases the rule as "**Each** Preceding Invoice reference (BG-3) shall contain..." implying it can
  repeat. `HeaderTradeSettlementType`'s `InvoiceReferencedDocument` element has no
  `maxOccurs="unbounded"` in the CII D16B XSD — a genuine binding limitation of the CII syntax, not
  something the UBL binding necessarily shares. A credit note referencing multiple prior invoices needs a
  different mechanism (out of scope for v0.1's single-reference credit-note scenario).
- **The XRechnung CII profile requires far more than the base EN 16931 rule set**: a seller contact
  with name, phone, and email (BG-6/BT-41/42/43); seller **and** buyer city/postcode, not just country
  (BT-37/38/52/53); payment instructions (BG-16) on every invoice, not just ones with a bank transfer;
  seller and buyer electronic addresses with an EAS scheme (BT-34/49, `@schemeID` from the CEF EAS code
  list, `BR-CL-25`); and a business process type (BT-23) — this last one and the electronic-address checks
  (`PEPPOL-EN16931-R001/R010/R020`) come from rules KoSIT bundles into the "EN16931 (CII)" Schematron step
  itself, not the XRechnung-specific layer, so they fire even outside the DE profile once validated through
  KoSIT's tooling. None of this is discoverable from the base ConnectingEurope EUPL-1.2 Schematron alone —
  found by serializing real fixtures and reading the KoSIT rejection. A buyer without an electronic address
  fails `PEPPOL-EN16931-R010` even once the empty `URIUniversalCommunication` is gone (checked with KoSIT on
  2026-09-23), so `buildInvoice` refuses both parties without one (`MissingElectronicAddressError`) — the
  Medusa adapter's source is the order's email.
- **`BR-AE-02` (reverse charge) needs identification on _both_ parties**, not just the seller: the seller's
  VAT-ID or tax registration **and** the buyer's VAT-ID or legal registration identifier. Easy to miss
  because `BR-S-02`-style rules for other categories only ever check the seller.
- **`BR-IC-02` (intra-EU supply, category K) has the exact same both-parties trap as `BR-AE-02` above**, not
  just the seller's VAT-ID: seller **and** buyer VAT-ID, `flag="fatal"` (verbatim-verified against the
  vendored Schematron). `buildInvoice` guards it together with the neighbouring `BR-IC-11`/`BR-IC-12`
  (delivery date/country): a K-category document without the buyer's VAT-ID is refused
  (`MissingBuyerVatIdError`), not just one without a positive VIES check.
- **`BR-DE-16` (seller VAT/tax identifier) is fatal; `BR-DE-17` (allowed XRechnung document-type codes) and
  `BR-DE-26` (`BT-25` preceding-invoice reference recommended on a corrected invoice, type 384) are only
  `flag="warning"`** — don't "fix" a warning-only rule as if it were a rejection. This also means KoSIT's own
  top-level `valid` attribute is not the business verdict here: a document can be `valid="false"` from a
  `BR-DE-26` warning alone while `<rep:assessment><rep:accept>` still accepts it — see `kosit-report.ts`'s
  `accepted` field rather than reading `valid` alone for these two rules specifically.
- **An allowance/charge's base amount can't be set without a percentage.** `PEPPOL-EN16931-R042`:
  "Allowance/charge percentage MUST be provided when allowance/charge base amount is provided" — CII's
  `TradeAllowanceChargeType` puts `CalculationPercent` right before `BasisAmount` in its sequence, and
  supplying one without the other is rejected. `einvoice-model` carries both (`baseAmount` and
  `calculationPercent`: BT-93/94 for a document allowance, BT-100/101 for a charge, BT-137/138 and
  BT-142/143 on a line); set both or neither — the `de-document-discount` fixture sets both.
- **"Gutschrift" ≠ credit note.** In UStG terms it is a self-billed invoice (389). Use
  "Rechnungskorrektur" for 381 in anything a human reads; keep code 381 in XML.
- **`BR-CO-17` and `BR-S-09` accept a group VAT that is off by less than 1.** Their Schematron tests compare
  BT-117 with round(BT-116 × rate) within ±1 (a whole currency unit, not a cent). That is what lets an
  invoice for prices including VAT state the VAT taken out of the gross total, which differs from taxable ×
  rate by a cent for about one gross total in six — confirmed against KoSIT with the
  `commerce-gross-prices` fixture (4.97 on 26.13 at 19%, where taxable × rate gives 4.96).
- **No validator asks for a street, and German law does.** EN 16931 leaves every address line optional
  (BT-35/36 seller, BT-50/51 buyer, BT-75/76 deliver-to) and the XRechnung rules require only city and post
  code (BR-DE-3/4/8/9), so a street-less invoice is KoSIT-green — while §14 Abs. 4 Satz 1 Nr. 1 UStG needs
  the full address of both parties (and §33 UStDV still the seller's on a small-amount invoice). In CII the
  lines are `ram:LineOne`/`ram:LineTwo`, between `ram:PostcodeCode` and `ram:CityName` in
  `TradeAddressType`'s sequence. No rule in the vendored Schematron names BT-35/36/50/51/75/76; their names
  were taken from `@e-invoice-eu/core`'s schema and confirmed on each element's docs.peppol.eu page.

## Medusa v2 (`einvoice-medusa`)

None of the following is taken from documentation by memory — every item was read directly from a real,
freshly-created `create-medusa-app@latest --plugin`/full app (v2.19.0/2.21.0 at the time) or a real
installed `@medusajs/*` package's compiled source.

- **The real fulfillment-created event is `order.fulfillment_created`** (`OrderWorkflowEvents.FULFILLMENT_CREATED`,
  `@medusajs/utils/dist/core-flows/events.js`), payload `{ order_id, fulfillment_id, no_notification }`.
  There is no separate "shipment created" event at the order level for this purpose (that name,
  `FulfillmentWorkflowEvents.SHIPMENT_CREATED` = `"shipment.created"`, is a different, lower-level
  fulfillment-module event, not what a subscriber wanting "an order got a fulfillment" should use).
- **There is no `order.refund_created` event.** A refund is a payment-module concept in Medusa v2:
  `PaymentEvents.REFUNDED` = `"payment.refunded"`, payload **only** `{ id }` — the _payment's_ id, not the
  order's. A subscriber must resolve the order from the payment id itself (e.g. via a remote query
  following the payment↔order module link) before it can build a `CommerceInvoiceInput` for a credit note
  — the refund subscriber's design has to account for this, it cannot assume an `order_id` arrives with
  the event the way `order.fulfillment_created` provides one.
- **A custom Medusa module's service constructor receives `(container, options)`**, `options` being
  exactly what `medusa-config.ts`'s `plugins: [{ resolve, options }]` declared for that plugin. Verified
  against a real compiled module provider (`@medusajs/notification-local@2.19.0`'s
  `LocalNotificationService`, `constructor({ logger }, options)`), not the (accurate but non-concrete)
  prose in the plugin scaffold's own `src/modules/README.md`.
- **A real, currently-published Medusa v2 invoicing plugin, the one this adapter integrates with,**
  exists and was inspected directly: `@webbers/invoices-medusa@1.0.6` (npm, MIT). It defines its own
  `invoice` module (`INVOICE_MODULE = "invoice"`) with a data model carrying `display_id` (autoincrement —
  the human-readable invoice number the Webbers integration reads), `resource_id`, `type`
  (`"debit" | "credit" | "void"`), `pdf_url` (nullable), `parent_invoice` (self-referential, links a credit
  invoice to what it corrects). It links its own `invoice` module to `order` via a `defineLink` (isList,
  table `invoice_order`) — one order can have many invoices (original + corrections). Its own
  `fulfillment-created-invoice` subscriber listens to the same `order.fulfillment_created` event and
  guards idempotency by querying that link for an existing invoice before creating one.
- **`@webbers/invoices-medusa`'s own `createInvoiceWorkflow` defines no `createHook()`** — Medusa v2
  workflows can expose named extension points for other plugins to hook into, but this one doesn't, so
  there is no clean "Webbers finished creating its invoice" signal to subscribe to instead of the raw
  platform event. **Open question for the Webbers integration, not resolved here**: whether a second
  subscriber on the same `order.fulfillment_created` event (querying Webbers' own `invoice_order` link,
  retrying briefly if not yet present) is safe against subscriber-ordering/timing, or whether some other
  mechanism is needed — genuinely unverified, flagged rather than guessed.
- **`create-medusa-app@latest` (current, v2.21.0) scaffolds a Turborepo-style monorepo by default**
  (`apps/backend/`, a root `turbo.json`/`pnpm-workspace.yaml`), not the single-root layout older
  tutorials/screenshots show — `medusa-config.ts` lives at `apps/backend/medusa-config.ts`, not the repo
  root. Matters for the [Medusa quickstart](quickstart-medusa.md): a "put this in `medusa-config.ts`"
  instruction needs that path spelled out or a new developer will look in the wrong place.
- **A Medusa v2 plugin package needs its own, self-contained `tsconfig.json`**, not extending a shared base
  the way every other package in this monorepo does: `target: "ES2021"`, `module`/`moduleResolution:
"Node16"`, `emitDecoratorMetadata`/`experimentalDecorators: true`, no `"type": "module"` in
  `package.json` (both the official scaffold and `@webbers/invoices-medusa` agree on this — plugins are
  CommonJS at the TS-compile level). A type-only import from one of this repo's own ESM packages
  (`@normwerk/einvoice-commerce`) into the plugin therefore needs an explicit
  `with { "resolution-mode": "import" }` (TS 5.3+) — a real, load-bearing consequence of the CJS/ESM
  boundary between this package and the rest of the monorepo, not a style choice.
- **`medusa plugin:build` actually type-checks** (not merely transpiles via SWC) — confirmed by
  deliberately introducing a type error and observing a real `TS2322` failure with exit code 1, not a
  silent pass. Its own build succeeding is real evidence, not merely "no crash."
- **Installing a private, unpublished `@normwerk/*` package chain into another Medusa app for local
  development needs every package in the chain yalc-published**, not just the plugin itself — a plugin's
  own compiled `package.json` (from `medusa plugin:build`) cannot carry pnpm's `workspace:*` protocol
  (`yalc publish` silently falls back to `"*"` for it), so a consuming app's package manager will try to
  fetch that dependency from the real npm registry and 404. This is not just a yalc quirk: it means
  `@normwerk/einvoice-model` and `@normwerk/einvoice-commerce` must themselves be published to npm before
  `@normwerk/einvoice-medusa` can be a normally-installable plugin for anyone outside this repo — relevant
  to publishing on npm, not previously an explicit finding.
- **Cancelling an order refunds its captured payments without a `payment.refunded` event.**
  `cancelOrderWorkflow` refunds through `refundCapturedPaymentsWorkflow`, which emits nothing a refund
  subscriber hears; the only signal is `order.canceled` (`OrderWorkflowEvents.CANCELED`, payload `{ id }`,
  the order's id). A credit note for a cancelled, already-invoiced order therefore needs its own
  `order.canceled` subscriber — a refund subscriber alone silently leaves the invoice uncorrected.
- **Medusa refuses to cancel an order that still has an active fulfillment.** Each fulfillment is cancelled
  first (`POST /admin/orders/:id/fulfillments/:fulfillment_id/cancel`), then the order. An order invoiced on
  `order.fulfillment_created` is always in that state, so cancelling one is a two-step operation.
- **A refund's amount is `payment.refunds[].amount`, gross.** A partial refund is credited as one
  VAT-inclusive line (`priceInclVat`) over that sum, so the credit note totals exactly the refund.
  Converting it to a net amount first cannot always work: at 2-decimal precision about one gross sum in six
  has no net whose VAT adds back to it (0.03 at 19%).
- **Tax-inclusive prices in Medusa are per price preference, not per product.** The region and the
  currency each get a price preference when the region is created (`POST /admin/price-preferences` for the
  region then fails with "already exists"; update it instead). On a tax-inclusive line `unit_price` and
  `discount_total` include tax and `discount_subtotal` does not; a tax-inclusive shipping method's `total`
  is what was charged.
- **A guest checkout's customer record has no name.** Medusa creates it from the email alone — no
  `first_name`, `last_name` or `company_name`; the buyer's name lives only on the order's billing and
  shipping addresses. Reading names from `order.customer` alone names every guest after their email.
- **An order of services ships nothing and is still fulfilled.** A product with no shipping profile whose
  variant has `manage_inventory: false` gets `requires_shipping: false` lines; a cart of only such lines
  completes without a shipping method, and `POST /admin/orders/:id/fulfillments` accepts it without a
  `shipping_option_id` and emits `order.fulfillment_created` (verified on 2.21.0). Such an order is invoiced
  when the merchant fulfills it, not before.
- **A tax region without a default rate charges no VAT, silently.** `createTaxRegionsWorkflow` accepts a
  country with `provider_id` only; the system tax provider then charges 0 on every order shipped there.
  The e2e stand's own seed had exactly that until an invoice total was compared with `order.total`.

### Subscribers and idempotency

- **A CommonJS-mode Medusa plugin cannot statically `import` a value from one of this repo's own ESM
  packages** (`@normwerk/einvoice-commerce`/`@normwerk/einvoice-cii`, both `"type": "module"` with no
  `require` export condition) — that compiles to a `require()` that throws `ERR_REQUIRE_ESM` at runtime.
  This is a _different_ problem from the one `resolution-mode: "import"` (above) fixed: that attribute only
  ever changes how TypeScript resolves _types_, never how Node resolves a _value_ at runtime. The real,
  necessary fix for a subscriber that needs to actually _call_ `buildInvoice`/`selectProfile`/
  `SequentialNumberer`/`serializeCii` is a dynamic `import()` inside the (already-async) subscriber
  function body — TypeScript compiles a dynamic `import()` expression to a real ES dynamic import even
  under CommonJS output, which is the sanctioned interop path. Pure type-only usage elsewhere in the plugin
  (`service.ts`, `numbering-store.ts`, the `mapping/` module) still uses the static
  `resolution-mode: "import"` form — the two techniques solve different halves of the same CJS/ESM
  boundary and neither substitutes for the other.
- **A Medusa v2 order line item's own DML model (`OrderLineItem`) has no `quantity` field at all** —
  confirmed directly from `@medusajs/order@2.19.0`'s compiled model source. Quantity lives on a separate,
  linked `OrderItem` row, reached in a `query.graph` fields array as `items.detail` (the exact path real
  admin routes use, `api/admin/orders/query-config.js`'s `defaultAdminRetrieveOrderFields`). Naively
  reading `item.quantity` off a queried order line compiles and often "looks right" in a quick manual
  check (a wrongly-defaulted `1` for a single-item cart is easy to miss) — this is exactly the kind of
  "obviously simple" platform field this project's own rule (`docs/domain-glossary.md`'s own earlier BT-40/
  BT-41 entry) says to verify rather than assume, applied here to platform schema instead of an EN 16931 BT.
- **`OrderLineItem.is_tax_inclusive` is a real, per-line boolean** — a store's prices can be tax-inclusive
  or tax-exclusive per line, not fixed store-wide. A tax-inclusive line is mapped to
  `CommerceLine.priceInclVat`, never to `netPrice` — treating the gross price as net would add tax on top
  of tax already included, and backing the rate out line by line rounds each line on its own, so the
  invoice can total a cent less than was charged.
- **Race-safe per-series counters in real Medusa module services don't use `SELECT` then `UPDATE` from
  application code** — `display_id` (Medusa's own order-numbering field) is a native Postgres `SERIAL`
  column (`model.autoincrement()`, confirmed in `@medusajs/order`'s compiled model + migration), and the
  one real first-party precedent for an _application-level_ concurrency-sensitive counter,
  `@medusajs/promotion`'s `registerUsage` (compiled source), takes an explicit `SELECT ... FOR UPDATE`
  row lock inside a transaction (needed there because it also enforces a budget/usage-limit check, not a
  pure increment). This plugin's own `EinvoiceCounter` needs no limit check, so a single atomic
  `INSERT ... ON CONFLICT (series) DO UPDATE SET value = value + 1 RETURNING value` is the simpler, still
  fully race-safe mechanism for that narrower case — reached via `@InjectTransactionManager()` +
  `@MedusaContext()` (the same real decorator pair `@medusajs/order`'s own module service methods use
  throughout, confirmed by name in its compiled source) to get a transaction-bound knex instance
  (`transactionManager.getTransactionContext() ?? transactionManager.getKnex()`).
- **A unique-constraint violation does not reach a module service as MikroORM's own exception.** Medusa's
  repository layer (`@medusajs/utils`, `dal/mikro-orm/db-error-mapper.js`) catches MikroORM's
  `UniqueConstraintViolationException` (or Postgres code `23505`) and rethrows a `MedusaError` of type
  `invalid_data` with the message "… already exists." — its `name` is plain `"Error"`. Corrected
  2026-09-23: this entry used to say the violation is detectable by `error.name`, and the idempotency guard
  relied on that, so its lost-race branch never ran. `EinvoiceModuleService.recordDocumentIfAbsent` now
  re-reads the `(type, idempotency_key)` key after any failed insert instead: a document there means another
  delivery won the race; none means a real failure, rethrown unchanged.
- **Medusa's local event bus (the default, no Redis configured) never retries a subscriber that throws** —
  confirmed from `@medusajs/event-bus-local@2.19.0`'s compiled source: it wraps every subscriber call in a
  try/catch that only logs the error, nothing more. The Redis event bus _can_ retry (BullMQ `attempts`),
  but its own default job options set `attempts: 1` — so even with Redis configured, a genuine automatic
  retry only happens if whoever emits the event explicitly opts in with a higher `attempts` value. This
  matters for the subscribers' idempotency design: a "redelivered"
  `order.fulfillment_created`/`payment.refunded` in practice means a manual replay, not an automatic retry
  storm — informed how strict the idempotency check needs to be (checked up front, before allocating a
  document number, so a redelivery does not burn one in the realistic case) versus how
  strict it only needs to be as a backstop (the database-level unique constraint, for the truly-concurrent
  case the local event bus can't even produce).
- **`payment.refunded`'s payload-only-carries-`{id}` gap (flagged unresolved in the refund entry above)
  needs two `query.graph` calls, not one, and the working filter shape is a nested object, not a dotted
  string.** A `query.graph({ entity: "order", filters: { "payment_collections.payments.id": paymentId } })`
  — the same dot-notation path `@medusajs/core-flows`' `refundCapturedPaymentsWorkflow` reads in its own
  `fields` array — looks like the natural filter equivalent, but a real e2e run (Docker Postgres) produced
  an actual Postgres error: `missing FROM-clause entry for table "payments"`. The reason: `payment_collections
.payments` is a **two-hop path across a module link** (order↔payment_collection is a real `defineLink`;
  payment_collection→payment is a plain FK inside the payment module alone) — `query.graph`'s filter
  resolution only builds a SQL join for a path present in `fields` _within one module's own schema_, it does
  not reach across a module link that way, even though the _identical_ path works fine as a `fields` entry
  (reading, not filtering, apparently takes a different resolution path). The real, working fix: (1) query
  `payment` for its own `payment_collection_id` (no link — a plain field), then (2) query `order` filtered by
  the _nested-object_ form `{ payment_collections: { id: paymentCollectionId } }` — one hop, and a nested
  object rather than a dotted string. This nested-object shape is what actually resolves a cross-module link
  filter. Neither of these two facts (two-hop paths need two queries; a cross-module link filter needs the
  nested-object form) is visible from reading `@medusajs/core-flows`' own source, which never filters by a
  linked field at all in any bundled workflow — found only by running the real query against a real instance
  and reading its actual SQL error.
- **The admin API's own `"*relation"` wildcard-prefix field syntax (`api/admin/orders/query-config.js`)
  silently returns nothing when passed directly to `query.graph()` from a subscriber** — no error, the
  relation is just absent from the result, easy to mistake for "this order really has no customer/address"
  rather than a syntax problem. Confirmed against a real running instance: `fields: ["*customer",
"*shipping_address", "*items"]` returned only the top-level scalar fields; the explicit `relation.field`
  dot-notation form (`"customer.email"`, `"items.detail.quantity"`, …) returns the real data. The admin
  route's own resolution of `"*relation"` must go through a different layer (its own field-config
  expansion) that a direct `query.graph()` call from a subscriber doesn't get — this repo's first attempt at
  `ORDER_QUERY_FIELDS` copied the admin route's own convention and had to be corrected once run for real.
- **`buildInvoice`'s XML output always targets the full XRechnung 3.0 CIUS, regardless of which profile
  `selectProfile` resolves** (`EN16931` vs `XRECHNUNG` is only about which ZUGFeRD/PDF-embedding profile
  string to use — `profile.ts`'s own doc comment already said this, but its practical consequence wasn't
  obvious until a real KoSIT run showed it): every invoice/credit-note this plugin builds is validated
  against the _same_ Schematron rule set either way, including three fields nothing in `buildInvoice` itself
  enforces (it just passes each through unchanged if given):
  - **BT-34/BT-49 (seller/buyer electronic address) need a scheme identifier (BR-62/BR-63)** — real KoSIT
    rejection on a mapping that left both unset. `service.ts`'s `assertValidOptions` now requires
    `seller.electronicAddress`/`electronicAddressScheme`; the mapping (`mapOrderToCommerceInvoiceInput`)
    fills the buyer's from the order's own email with EAS scheme `"EM"` — the same convention every fixture
    in this repo already used for a plain email address.
  - **BT-10 (buyer reference) is mandatory on every invoice, not just a B2G one (BR-DE-15)** — so its
    presence, or its shape, can never be the B2G signal. The first fix kept a separate "raw" reference for
    `selectProfile`; that still read a Leitweg-ID out of the shape of free text, and an ordinary reference
    such as `2024-01` has the same shape (refused for failing the check digits, or routed to XRechnung when
    they happened to add up). A Leitweg-ID is now its own declared field, `references.leitwegId`, from
    `customer.metadata.leitweg_id`; `buyerReference` is always free text — `customer.metadata.buyer_reference`
    or the order's `display_id`.
  - **BG-16 (payment instructions) is mandatory on every invoice (BR-DE-1)** — merchant-level bank details
    (which account the buyer should pay into), the same kind of static config as `seller` itself, not
    derivable from an order. Added as a new required `EinvoiceModuleOptions.payment` field
    (`{ means, iban?, terms? }`); `service.ts`'s `assertValidOptions` refuses to construct the module
    without it, the same way it already refused a seller missing `vatIdentifier`.
    All three were found by actually running the plugin's own output through the real KoSIT Validator inside
    the plugin's e2e proof (not anticipated from reading `build-invoice.ts` or the base Schematron alone) —
    each fix was verified by re-running the same validator until it returned `ACCEPTABLE`, not just by making
    the error message go away.

### `@webbers/invoices-medusa` integration

- **`@webbers/invoices-medusa@1.0.6`'s own `package.json` declares two more broken export subpaths**, the
  same class of gap first found for `"./links"` (that file simply doesn't exist in the published tarball):
  `"./workflows"` (`.medusa/server/src/workflows/index.js`) is ALSO missing — only the
  individual workflow files (`create-invoice.js`, `create-credit-invoice.js`, …) exist, no barrel. The
  wildcard `"./*"` subpath still resolves a direct file path (`@webbers/invoices-medusa/workflows/create-invoice`,
  `@webbers/invoices-medusa/links/invoice-order`) — confirmed by actually hitting `Cannot find module
'.../workflows/index.js'` on a real running instance when importing the documented `"./workflows"` path,
  not assumed from reading the export map alone.
- **Dynamically `import()`-ing another CommonJS package (not an ESM one) from this plugin double-wraps the
  default export** — a genuinely different case from this plugin's own established "dynamic-import an
  ESM-only package from CJS" pattern (needed because the _target_ is ESM-only). Here, both
  this plugin and `@webbers/invoices-medusa` are CommonJS; going through Node's ESM `import()` loader to
  reach a CJS module still triggers CJS/ESM interop, which sets the synthetic namespace's `.default` to the
  _whole_ `module.exports` object (`{ __esModule: true, default: <real value> }`), not to
  `module.exports.default` directly — so the real value ends up at `mod.default.default`, not `mod.default`.
  Confirmed empirically with a temporary debug route logging the actual awaited value during the Webbers
  e2e run (it printed `{ default: { entryPoint: "invoice_order", ... } }`), not assumed from Node's
  interop documentation. Real, load-bearing consequence: `waitForWebbersInvoice`'s own link-loading code
  unwraps one extra level, defensively falling back to the un-nested shape too (`integrations/webbers.ts`).
- **Medusa's local event bus really does start every subscriber of the same event without waiting for any
  of them** (flagged above as the reason no ordering guarantee exists between this plugin's own subscriber
  and `@webbers/invoices-medusa`'s; the Webbers integration is where it was actually exercised for real) —
  confirmed by observing both subscribers' log lines interleave (`Processing order.fulfillment_created
which has 2 subscribers`) and by the poll/wait mechanism (`waitForWebbersInvoice`) genuinely being
  necessary rather than decorative: a plain, un-delayed read of their `invoice_order` link immediately after
  the event fires reliably finds nothing yet.
- **`@webbers/invoices-medusa@1.0.6`'s own `createInvoiceWorkflow` has a real, reproducible bug**: PDF
  generation (`core/classes/pdf-generator/templates/invoice-content.ts`) threw `Cannot read properties of
undefined (reading 'toString')` on every real order the e2e harness threw at it (a plain
  `create-medusa-app` default-seeded product, DE billing/shipping address, no discounts) — their own
  workflow's compensation logic then marks the invoice `type: "void"` (a real, documented behavior: "Voided
  invoices … preserve their sequence number to avoid gaps", their own README) and soft-deletes the
  `invoice_order` link row. Root-caused (not merely observed) by invoking their `createInvoiceWorkflow`
  directly from a debug route and reading the full stack trace their own subscriber's `catch` block
  discards (it only logs `error.message`): the throw site is `invoice.display_id.toString()`, where
  `invoice = order.invoices.find(i => i.type === "debit")` from _their own_ `query.graph` call using a
  `"invoices.*"` wildcard field — the same class of wildcard-field gap the subscriber section above
  independently found (a `"*relation"`-style field silently failing to hydrate outside certain calling
  contexts). This is an external, confirmed defect in their published package, not caused by anything in
  this plugin — `waitForWebbersInvoice`'s own timeout-and-throw behavior (`WebbersInvoiceNotFoundError`) is
  the _correct_, honest reaction to it (refuse to allocate a number of this plugin's own rather than assume
  their workflow succeeded). Proven for real regardless: a debit/credit invoice row and `invoice_order` link
  were inserted directly (matching their exact real, migrated schema) with a real PDF uploaded through the
  real File Module, and this plugin's own subscriber picked both up correctly within its poll window, reused
  the real `display_id` as its own document number, and embedded its XML into the real downloaded PDF — the
  part of the acceptance criterion actually owned by this plugin, proven against their real schema and File
  Module semantics, with their own workflow's bug clearly separated out as an external, reported limitation
  rather than something this plugin's own code either caused or silently worked around.
- **`pdf_url` on their `Invoice` model is a File Module file id, not a URL** (confirmed directly from their
  compiled `upload-invoice-pdf-step.js`: `invoiceModule.updateInvoices({ id, pdf_url: file.id })`) —
  `fileModuleService.retrieveFile(id)` returns `{ id, url }`, where `url` is itself a presigned download URL
  that still needs a real `fetch()` to get bytes (`fetchWebbersPdfBytes`, `integrations/webbers.ts`).
- **A PDF produced by `pdfmake` with only the built-in standard fonts (their own `pdf-generator/index.js`:
  `pdfmake.addFonts({ Helvetica: { normal: "Helvetica", … } })`, never a real embedded font file) is not
  PDF/A-3-eligible** — real veraPDF output on a PDF embedded via `embedInvoiceInPdfA3` using exactly this
  kind of base PDF: `"The font program is not embedded" … "compliant": false` (ISO 19005-3:2012
  §6.2.11.4.1). This is not a new gap the Webbers integration introduces — `embedInvoiceInPdfA3`'s own doc
  comment already scopes this out: it does not attempt to fix a PDF that isn't already PDF/A-eligible, and
  that repair step (re-embedding the fonts with Ghostscript) is a documented follow-up, not implemented. But
  it means, concretely, that `@webbers/invoices-medusa`'s own _default_ configuration (no custom embedded
  font supplied via its `header`/`footer`/`addressInfo` options) produces PDFs this plugin's
  Webbers-integration mode cannot turn into a genuinely valid PDF/A-3 hybrid without that
  still-unimplemented repair step — real, useful context for documenting this integration mode's actual
  limits, rather than a silent assumption that "if their PDF exists, embedding it always yields a
  compliant PDF/A-3."
- **`@webbers/invoices-medusa`'s own module requires configuration** (`addressInfo.companyName/address/
cocNumber/vatNumber/iban/email`, all mandatory per its own README) — registering it as a bare string
  plugin entry (`plugins: ["@webbers/invoices-medusa"]`, no `options`) fails module loading outright
  (`Invalid options: {"addressInfo":["Invalid input: expected object, received undefined"]}`), confirmed by
  hitting this for real before supplying the options their README documents.

### Standalone mode's own PDF source

- **`options.standalone.basePdf(invoice)` is called with the already-_built_ `Invoice`
  (`@normwerk/einvoice-model`), not the raw Medusa order** — a deliberate design choice, not the only
  possible one: it means a real implementation can render exactly the BT-1 number/BT-22x totals/BG-23 VAT
  breakdown the XML will actually carry (the same object `serializeCii` itself serializes), rather than
  re-deriving them from the order independently and risking the PDF and XML disagreeing. The cost is that
  the hook necessarily runs _after_ numbering is resolved and `buildInvoice` has already run — both
  subscribers call it in that order, mirrored from Webbers mode's own PDF-after-numbering sequencing, not a
  new sequencing invented for standalone mode.
- **`@normwerk/einvoice-pdfa`'s own `renderInvoicePdf` was test-only until standalone mode needed it**
  — no `exports` entry beyond `"."`, and `index.ts` never re-exported it, so nothing outside the package's
  own test suite could reach it. Re-exported (`index.ts`) because it is the one concrete, real
  `standalone.basePdf` implementation this plugin's own e2e proof needed, and — genuinely, not just for the
  test — it is exactly what a merchant with no PDF renderer of their own would reach for: a real,
  font-embedded, PDF/A-eligible base PDF, for free, instead of nothing.
- **The standalone e2e proof needed a real `npm install` in the host app after `yalc add`, not `yalc add`
  alone** — a yalc-linked package's _own_ `dependencies` (here, `@normwerk/einvoice-pdfa`'s real dependency
  on `pdf-lib`/`@pdf-lib/fontkit`) are not copied into the host app's `node_modules` by `yalc add` itself;
  the dev server crashed with a real `ERR_MODULE_NOT_FOUND` for `pdf-lib` (imported from inside
  `@normwerk/einvoice-pdfa/dist/index.js`) until a plain `npm install` in the host app's root resolved the
  linked package's own dependency tree — the same class of "yalc surfaces a packaging gap a normal npm
  install wouldn't" finding already logged above, this time in the harness itself rather than in a
  third-party package.
- **`create-medusa-app@2.19.0` now scaffolds a turborepo-style monorepo** (`apps/backend`, root
  `package.json` with a `workspaces` field), not a flat single-app directory the way the earlier harnesses
  were — confirmed by actually running it fresh for the standalone e2e run, not assumed unchanged from
  before. Functionally inert for this plugin (Node module resolution still finds a yalc-linked package
  hoisted to the workspace root's `node_modules` from `apps/backend`), but real, since a future e2e run
  should expect this layout rather than be surprised by it.
- **The same already-documented `embedInvoiceInPdfA3` limitation (non-embedded-font base PDF isn't
  PDF/A-eligible without the unimplemented Ghostscript repair step, first hit for real against Webbers' own
  default PDF) reproduces identically for a standalone-supplied PDF** — proven, not assumed, by configuring
  `standalone.basePdf` to return a plain `pdf-lib` page using `StandardFonts.Helvetica` (no embedded font)
  and observing a real veraPDF `FAIL … 6.2.11.4.1-1` on the result, the same rule class the Webbers PDF
  hit. This confirms the gap is a property of `embedInvoiceInPdfA3` itself, not something specific to
  Webbers' PDF generator — relevant for documenting this option's actual limits.
- **Two partial refunds on the same payment, through the standalone path, produced two distinct credit
  notes** (`GS-2026-0001`/`GS-2026-0002`, keyed by `ref_...` id) — a direct re-exercise of the per-refund
  idempotency fix made to `credit-note-on-payment-refunded.ts` during the Webbers integration, confirming
  that fix holds after standalone mode restructured the same subscriber, not just under Webbers mode.
- **Full real e2e proof, both document types, both PDF outcomes**: a `create-medusa-app@2.19.0` instance
  (Docker Postgres) with `@normwerk/einvoice-medusa` configured with no `integration` at all and
  `standalone.basePdf` set to `renderInvoicePdf` — a real order → fulfillment produced an invoice
  (`RE-2026-0003`) with a real embedded PDF/A-3, and two partial refunds on its payment each produced their
  own credit note (`GS-2026-0001`/`GS-2026-0002`) with their own embedded PDF/A-3; **all four documents'
  XML passed the real KoSIT Validator ("Validation successful!", the same pre-known informational
  BR-DE-TMP-32 message) and both distinct PDFs (one invoice, one credit note) passed real veraPDF
  `--flavour 3b`.** Separately, `standalone.basePdf` omitted entirely still produced a pure-XML document
  (`pdf: NULL` in `einvoice_document`) — the subscribers' original standalone behavior, unchanged.

### File Module storage, admin widget, Store API

- **`IFileModuleService.createFiles`'s real signature** (`@medusajs/types`, confirmed against the actually
  installed `2.19.0` type declarations, not guessed): `{ filename, mimeType, content: <base64 string>,
access?: "public" | "private" }`, defaulting to `"private"` when `access` is omitted — the same default
  Webbers' own upload step already relied on (their PDF was readable via `retrieveFile` despite never
  setting `access` explicitly). `getAsBuffer`/`getDownloadStream` exist too but only `@since 2.8.0` — this
  plugin's own peerDependencies claim `>=2.4.0`, so file read-back still goes through the older,
  always-available `retrieveFile` + `fetch` two-step (already established in `fetchWebbersPdfBytes`, now
  shared as `storage.ts`'s own `fetchFileBytes`) rather than the newer method.
- **`create-medusa-app@2.19.0`'s scaffolded local File Module provider names a file id as
  `private-<epoch-ms>-<filename>`** and serves it from `apps/backend/static/` — confirmed by generating a
  real document and finding the exact file on disk with that name, not assumed from the module's own
  interface (which only promises an opaque `id: string`).
- **`medusa db:generate <module-name>` (not `plugin:db:generate`) is the real command for regenerating a
  plugin's own module migration from inside a full host app** that already has the plugin installed —
  running `plugin:db:generate` directly inside the plugin package's own directory (outside any host app)
  fails with a real `Cannot find module './service.js'` (the package's own Node16-module-resolution TypeScript
  source assumes a build/host context this bare invocation doesn't provide). The already-established
  workflow (generate inside a real scratch app, copy the output file back into the plugin's
  own `src/.../migrations/`) is the one that actually works, not a shortcut run from the package itself.
- **A second migration for an already-existing table is silently useless, again** — the same root cause
  already hit during the Webbers integration (a `create table if not exists` migration for a table an
  earlier migration already created is a real no-op, so new columns never actually land). Adding
  `xml_file_id`/`pdf_file_id` and dropping `xml`/`pdf` hit the identical class of problem for the same
  reason and used the same fix: delete the old migration file entirely, commit the freshly generated one as
  the sole baseline (pre-release, no real deployment history to preserve — the same justification as
  before, not a new one).
- **Medusa's own real, compiled `GET /store/orders/:id` (`@medusajs/medusa@2.19.0`) has no ownership check
  at all** — its source literally reads `// TODO: Do we want to apply some sort of authentication here?`,
  confirmed by reading the compiled route file directly, not assumed from documentation. This plugin's own
  store e-invoice routes do not copy that gap: `authenticate("customer", ["session", "bearer"])` (the same
  middleware, same auth-type combination, Medusa's own core uses for every other customer-owned-order
  action, `/store/orders/:id/transfer/*`) plus an explicit `customer_id` match, confirmed for real: no
  token → `401`; a different, real registered customer → `404`; the actual owning customer → `200` with the
  correct file, KoSIT-valid.
- **`DetailWidgetProps<HttpTypes.AdminOrder>` (`@medusajs/types`) is the real, documented prop type for an
  order-detail-zone admin widget** — confirmed directly in the package's own `.d.ts` doc comment/example,
  not inferred from a third-party plugin's compiled output alone (though `@webbers/invoices-medusa`'s own
  real, published widget, inspected directly, independently confirms the `{ data: order }` shape and the
  adjacent `order.details.side.before` zone).
- **A plain same-origin `fetch(url, { credentials: "include" })` from an admin widget authenticates via the
  dashboard's own session cookie**, without needing `@medusajs/js-sdk`'s configured client the way
  Webbers' own widget does it — confirmed by actually clicking a download link in a real logged-in admin
  session and observing a real `200 OK` on `GET /admin/orders/:id/einvoice/:documentId/xml` in the browser's
  own network log, not assumed from the two approaches being "probably equivalent".
- **No `defineLink` was added between `order` and `EinvoiceDocument`**, despite `@webbers/invoices-medusa`'s
  own real `invoice_order` link being the obvious analogy — a deliberate scope decision, not an
  oversight: `EinvoiceDocument.order_id` (a plain field since the subscribers were first built) already
  answers every query this
  plugin needs, and Webbers needs a link only because their own `Invoice` model carries no order-identifying
  field at all (confirmed by reading it directly — no redundant mechanism to choose between, unlike here).

### npm publish preparation

- **`pnpm pack`/`pnpm publish` rewrite a `workspace:*` dependency to the real resolved version; a plain
  `npm pack`/`npm publish` does not** — confirmed empirically (not assumed from either tool's docs) by
  actually packing `@normwerk/einvoice-cii` both ways and inspecting the packed `package.json`: `npm pack`
  left `"@normwerk/einvoice-model": "workspace:*"` completely unresolved (a broken dependency spec for
  anyone installing the published tarball), while `pnpm pack` correctly wrote the real version. Real,
  load-bearing consequence: publishing any of these packages for real must go through `pnpm publish`/
  `pnpm -r publish` (or `changeset publish`, which shells out to the package manager pnpm itself is
  configured for here), never a bare `npm publish` run from inside a package directory.
- **An npm `files` array entry can be a negation glob (`"!dist/**/*.test.js"`)**, and `npm pack`/`npm
publish` honor it — confirmed empirically, not assumed from partial/ambiguous docs. This is what's needed
  at all: every one of this monorepo's `tsc`-built packages compiles its own `*.test.ts` files into `dist/`
  right alongside real source (no test/non-test distinction in `tsconfig.json`'s own `include`), so a plain
  `files: ["dist"]` publishes test code in every tarball unless something excludes it.
- **The same negation pattern does _not_ work for `pnpm pack` on `einvoice-medusa`'s own `.medusa/server/`
  output** — a real, confirmed inconsistency between `npm`'s and `pnpm`'s own `files`-array negation
  handling for that specific nested, dot-prefixed directory shape (root cause not chased further, since a
  robust workaround existed). Fixed by not depending on `files` negation for this at all: a `prepack`
  lifecycle script (`tools/publish/strip-test-output.mjs`, a plain recursive walk-and-delete, no new
  dependency) physically removes compiled `*.test.*` output from the build directory before every pack/
  publish, regardless of which tool does the packing — confirmed working for all five packages via `pnpm
pack`, including the one case the negation pattern alone didn't cover.
- **The `repository` URL committed on `@normwerk/einvoice-medusa` since the plugin was scaffolded
  (`https://github.com/eInvoice`, no `directory`) was a real, confirmed 404 at the time** — the GitHub repo
  didn't exist yet, unrelated to its casing (caught by actually fetching it during publish preparation, not
  treating it as a plausible placeholder — the project's own "verify URLs before committing" rule catching
  a gap from _before_ it was consistently applied). **A change on 2026-09-15 then "corrected" the casing to
  lowercase `github.com/normwerk/einvoice`** — based on `git remote -v` echoing back whatever casing was
  typed into `git remote add`, not GitHub's own canonical casing, which that command has no way to reveal on
  its own.
  **Settled 2026-09-16, empirically:** a real `git push` to the lowercase remote succeeded but GitHub
  replied with `remote: This repository moved. Please use the new location:
git@github.com:Normwerk/eInvoice.git` — GitHub's own redirect response is the actual source of truth here,
  not a guess either way. So at that moment canonical was `github.com/Normwerk/eInvoice` (capital N, capital
  I): the _original_ casing, and the 2026-09-15 "fix" was itself the bug. **Then superseded the same day by
  a founder decision: one register for the name everywhere, all lowercase** — not a correction of the
  finding above but a rename on top of it. Two of the four spellings can't be capitalised at all (npm
  package names, the `normwerk.dev` domain), and Docker image names forbid uppercase, so `ghcr.io/Normwerk/…`
  would not have built once validator images are pushed there. The organisation and repository were
  to be renamed to `normwerk/einvoice`; GitHub treats those slugs case-insensitively, so the rename only
  changes display — old links, clones and redirects keep working and the old name is not released. **Half
  done as of the rename push (commit `14eb492`, 2026-09-16):** GitHub answered that push with `remote: This
repository moved. Please use the new location: git@github.com:Normwerk/einvoice.git` — the _repository_
  is lowercase `einvoice` now, the _organisation_ was still `Normwerk`. By 2026-09-23 the organisation was
  renamed too: GitHub's API returns its canonical login as `normwerk`, so every committed
  `normwerk/einvoice` URL is now the exact canonical spelling. **Second half of the lesson, learned the
  same way:** `git ls-remote` is silent about redirects too — it returned refs against the lowercase remote
  with no `moved` line, which reads exactly like confirmation and is not. Only a push says. Still not a
  public API fetch,
  since the repository is currently private (a plain `GET /repos/normwerk/einvoice` still 404s — GitHub's
  API can't distinguish "private" from "doesn't exist" for an unauthenticated caller). Making it public is a
  deliberate, separate action on release day. **Lesson, stated plainly:** `git remote -v` tells you what
  string a human typed and `git ls-remote` succeeds through a redirect without mentioning it — neither one
  reveals GitHub's own canonical casing. Only a real push (and reading its response) or the GitHub API/UI
  settle that question.
- **Medusa's own real plugin-catalog listing keywords, confirmed against a live `registry.npmjs.org` search
  for currently-published packages** (not just the docs' own prose): `medusa-v2` and
  `medusa-plugin-integration` are the two required keywords; a third, category-specific one is also real
  and in active use — `medusa-plugin-other` for a third-party integration that doesn't fit their other
  categories (analytics/auth/cms/notification/payment/search/shipping), confirmed present alongside the
  other two on several real, currently-listed npm packages (e.g. `@jytextiles/medusa-plugin-etsy-sync`,
  `@alphabite/medusa-wishlist`). `einvoice-medusa`'s own `keywords` already had the first two (copied from
  the official plugin scaffold) but was missing the third until publish preparation added it.
- **The Medusa integrations page has no known, documented per-package icon field** — `medusajs.com/
integrations` itself states the list "is curated from npm," and its own visible icons (Stripe, Mailchimp,
  etc.) are plausibly curated/assigned by Medusa's own team for well-known brands, not something a
  `package.json` field controls. Real, honest finding: a package icon as a publish-metadata deliverable
  does not correspond to any confirmed real mechanism — not invented here, flagged instead.

### `regimeOverride`/`supplyType` wired through the adapter

- **`OrderLineItem.requires_shipping` is a real, first-class boolean on `@medusajs/order`'s own line-item
  model** — confirmed directly against `node_modules/@medusajs/order/dist/types/line-item.d.ts` (the
  compiled package this monorepo actually depends on, not documentation or assumption), the same tier as
  `is_tax_inclusive`/`unit_price` (already documented in the subscriber section above), not a wildcard
  relation path that section already warns `query.graph` can silently drop. This is the one signal
  `mapOrderToCommerceInvoiceInput` derives `supplyType` from (`false` → a service line): a production-grade
  verification would still confirm it against a real running instance the way `ORDER_QUERY_FIELDS` was
  checked above, but the type-level check is strong enough evidence for a first-class model column, not a
  computed/admin-only field, to build on without that heavier step.
- **A Medusa tax line's `rate` is a fact to pass on, never to interpret in the adapter.** The adapter once
  snapped it to the nearer of Germany's 19% and 7%, so a line Medusa taxed at 0% (a tax region without a
  default rate) became a 7% line on the invoice. It now passes the summed rate on as
  `CommerceLine.chargedVatRate`, and `resolveLineRate` in `einvoice-commerce` decides: 19 or 7 on a
  domestic line, exactly the declared `ossRateOverride` on an OSS line, refusal otherwise.
- **Below Medusa 2.19 the plugin's order query comes back incomplete, without an error.** Run through the
  end-to-end suite (`EINVOICE_E2E_MEDUSA_VERSION`, 2026-09-24): on 2.18.0 the shipping amounts and the order
  `total` are missing, so the invoice leaves out shipping and the total check has nothing to compare with —
  no warning either; on 2.16.0 and 2.17.2 the order lines also arrive without `tax_lines`; on 2.12.6
  `query.graph` cannot filter orders by `payment_collections.payments.id` at all, so a refund finds no
  order. 2.19.0, 2.20.1, 2.21.0 and 2.21.1 pass everything. npm enforces the `^2.19.0` peer range; a
  package manager that only warns on peers does not.
