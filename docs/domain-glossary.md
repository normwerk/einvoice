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
  real KoSIT Validator 1.6.3 run (spike C, T-044).
- **The KoSIT Validator writes its report next to the input file**, not to stdout
  (`<input>-report.xml` and `.html`, same directory) — a read-only mount of the input directory makes the
  validator fail to write the report, not just skip it silently.
- **Both the KoSIT Validator and Mustang exit non-zero for a _rejected_ document**, not only for a tool
  crash — treat "process exited with an error" and "document is invalid" as the same signal, but still
  parse the emitted report/JSON rather than trusting the exit code alone (a crash produces no report).
- **veraPDF's JSON output nests `validationSummary` under `report.batchSummary`**, not at the top level of
  `report` — easy to miswire when parsing the CLI's `--format json` output.
- **A summarized fetch of a BT reference page can simply be wrong, even when the page itself is real.**
  While building `einvoice-model` (T-011), a summarized read of a Peppol postal-address page claimed
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
  XSD alone. Found by running our own serializer output through the real KoSIT validator (T-020).
- **CII caps "Preceding Invoice reference" (BG-3) at one occurrence**, even though the EN 16931 semantic
  model phrases the rule as "**Each** Preceding Invoice reference (BG-3) shall contain..." implying it can
  repeat. `HeaderTradeSettlementType`'s `InvoiceReferencedDocument` element has no
  `maxOccurs="unbounded"` in the CII D16B XSD — a genuine binding limitation of the CII syntax, not
  something the UBL binding necessarily shares. A credit note referencing multiple prior invoices needs a
  different mechanism (out of scope for v0.1's single-reference credit-note scenario).
- **The XRechnung CII profile requires far more than the base EN 16931 rule set** (T-021): a seller contact
  with name, phone, and email (BG-6/BT-41/42/43); seller **and** buyer city/postcode, not just country
  (BT-37/38/52/53); payment instructions (BG-16) on every invoice, not just ones with a bank transfer;
  seller and buyer electronic addresses with an EAS scheme (BT-34/49, `@schemeID` from the CEF EAS code
  list, `BR-CL-25`); and a business process type (BT-23) — this last one and the electronic-address checks
  (`PEPPOL-EN16931-R001/R010/R020`) come from rules KoSIT bundles into the "EN16931 (CII)" Schematron step
  itself, not the XRechnung-specific layer, so they fire even outside the DE profile once validated through
  KoSIT's tooling. None of this is discoverable from the base ConnectingEurope EUPL-1.2 Schematron alone —
  found by serializing real fixtures and reading the KoSIT rejection.
- **`BR-AE-02` (reverse charge) needs identification on _both_ parties**, not just the seller: the seller's
  VAT-ID or tax registration **and** the buyer's VAT-ID or legal registration identifier. Easy to miss
  because `BR-S-02`-style rules for other categories only ever check the seller.
- **An allowance/charge's base amount can't be set without a percentage.** `PEPPOL-EN16931-R042`:
  "Allowance/charge percentage MUST be provided when allowance/charge base amount is provided" — CII's
  `TradeAllowanceChargeType` puts `CalculationPercent` right before `BasisAmount` in its sequence, and
  supplying one without the other is rejected. `einvoice-model` doesn't model the percentage yet
  (BT-94/101/138/143), so fixtures with a discount/charge (T-022) simply omit `baseAmount` rather than
  half-model the pair — `baseAmount` was informational, not required by any base BR-\* rule.

## Medusa v2 (`einvoice-medusa`, T-070/T-071, W10)

Per plan-v0.1 §4.6's own warning, none of the following is taken from documentation by memory — every item
was read directly from a real, freshly-created `create-medusa-app@latest --plugin`/full app (v2.19.0/2.21.0
at the time) or a real installed `@medusajs/*` package's compiled source.

- **The real fulfillment-created event is `order.fulfillment_created`** (`OrderWorkflowEvents.FULFILLMENT_CREATED`,
  `@medusajs/utils/dist/core-flows/events.js`), payload `{ order_id, fulfillment_id, no_notification }`.
  Matches plan-v0.1's own expectation exactly. There is no separate "shipment created" event at the order
  level for this purpose (that name, `FulfillmentWorkflowEvents.SHIPMENT_CREATED` = `"shipment.created"`, is
  a different, lower-level fulfillment-module event, not what a subscriber wanting "an order got a
  fulfillment" should use).
- **There is no `order.refund_created` event.** A refund is a payment-module concept in Medusa v2:
  `PaymentEvents.REFUNDED` = `"payment.refunded"`, payload **only** `{ id }` — the _payment's_ id, not the
  order's. A subscriber must resolve the order from the payment id itself (e.g. via a remote query
  following the payment↔order module link) before it can build a `CommerceInvoiceInput` for a credit note
  — T-071's own design has to account for this, it cannot assume an `order_id` arrives with the event the
  way `order.fulfillment_created` provides one.
- **A custom Medusa module's service constructor receives `(container, options)`**, `options` being
  exactly what `medusa-config.ts`'s `plugins: [{ resolve, options }]` declared for that plugin. Verified
  against a real compiled module provider (`@medusajs/notification-local@2.19.0`'s
  `LocalNotificationService`, `constructor({ logger }, options)`), not the (accurate but non-concrete)
  prose in the plugin scaffold's own `src/modules/README.md`.
- **A real, currently-published Medusa v2 plugin matching plan-v0.1's own named integration target**
  exists and was inspected directly: `@webbers/invoices-medusa@1.0.6` (npm, MIT). It defines its own
  `invoice` module (`INVOICE_MODULE = "invoice"`) with a data model carrying `display_id` (autoincrement —
  the human-readable invoice number plan-v0.1 wants T-072 to read), `resource_id`, `type`
  (`"debit" | "credit" | "void"`), `pdf_url` (nullable), `parent_invoice` (self-referential, links a credit
  invoice to what it corrects). It links its own `invoice` module to `order` via a `defineLink` (isList,
  table `invoice_order`) — one order can have many invoices (original + corrections). Its own
  `fulfillment-created-invoice` subscriber listens to the same `order.fulfillment_created` event and
  guards idempotency by querying that link for an existing invoice before creating one.
- **`@webbers/invoices-medusa`'s own `createInvoiceWorkflow` defines no `createHook()`** — Medusa v2
  workflows can expose named extension points for other plugins to hook into, but this one doesn't, so
  there is no clean "Webbers finished creating its invoice" signal to subscribe to instead of the raw
  platform event. **Open question for T-072, not resolved here**: whether a second subscriber on the same
  `order.fulfillment_created` event (querying Webbers' own `invoice_order` link, retrying briefly if not
  yet present) is safe against subscriber-ordering/timing, or whether some other mechanism is needed —
  genuinely unverified, flagged rather than guessed.
- **`create-medusa-app@latest` (current, v2.21.0) scaffolds a Turborepo-style monorepo by default**
  (`apps/backend/`, a root `turbo.json`/`pnpm-workspace.yaml`), not the single-root layout older
  tutorials/screenshots show — `medusa-config.ts` lives at `apps/backend/medusa-config.ts`, not the repo
  root. Matters for T-075's quickstart doc: a "put this in `medusa-config.ts`" instruction needs that path
  spelled out or a new developer will look in the wrong place.
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
  to T-076 ("Публикация в npm"), not previously an explicit finding.

### T-071 (subscribers, idempotency, W10)

- **A CommonJS-mode Medusa plugin cannot statically `import` a value from one of this repo's own ESM
  packages** (`@normwerk/einvoice-commerce`/`@normwerk/einvoice-cii`, both `"type": "module"` with no
  `require` export condition) — that compiles to a `require()` that throws `ERR_REQUIRE_ESM` at runtime.
  This is a _different_ problem from the one T-070's `resolution-mode: "import"` fixed: that attribute only
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
  or tax-exclusive per line, not fixed store-wide. `CommerceLine.netPrice` is always ex-tax
  (`buildInvoice` computes tax itself from `TaxContext`), so a tax-inclusive Medusa line needs the rate
  backed out of `unit_price` before mapping — skipping this would double an already-included tax on top of
  `buildInvoice`'s own calculation for any merchant with tax-inclusive pricing turned on (Medusa's default
  for storefronts in several regions), not a rare edge case.
- **Race-safe per-series counters in real Medusa module services don't use `SELECT` then `UPDATE` from
  application code** — `display_id` (Medusa's own order-numbering field) is a native Postgres `SERIAL`
  column (`model.autoincrement()`, confirmed in `@medusajs/order`'s compiled model + migration), and the
  one real first-party precedent for an _application-level_ concurrency-sensitive counter,
  `@medusajs/promotion`'s `registerUsage` (compiled source), takes an explicit `SELECT ... FOR UPDATE`
  row lock inside a transaction (needed there because it also enforces a budget/usage-limit check, not a
  pure increment). This plugin's own `EinvoiceCounter` (T-071) needs no limit check, so a single atomic
  `INSERT ... ON CONFLICT (series) DO UPDATE SET value = value + 1 RETURNING value` is the simpler, still
  fully race-safe mechanism for that narrower case — reached via `@InjectTransactionManager()` +
  `@MedusaContext()` (the same real decorator pair `@medusajs/order`'s own module service methods use
  throughout, confirmed by name in its compiled source) to get a transaction-bound knex instance
  (`transactionManager.getTransactionContext() ?? transactionManager.getKnex()`).
- **A real MikroORM unique-constraint violation is detectable by `error.name === "UniqueConstraintViolationException"`**
  without adding `@mikro-orm/core` as a new dependency — confirmed from its compiled `exceptions.js`:
  every exception in that file's hierarchy sets `this.name = this.constructor.name` in a shared
  `DriverException` base constructor. This plugin's own idempotency guard (`EinvoiceDocument`'s
  `(type, idempotency_key)` unique index) relies on catching exactly this, duck-typed, rather than a
  "check, then insert" that would race under concurrent duplicate event delivery.
- **Medusa's local event bus (the default, no Redis configured) never retries a subscriber that throws** —
  confirmed from `@medusajs/event-bus-local@2.19.0`'s compiled source: it wraps every subscriber call in a
  try/catch that only logs the error, nothing more. The Redis event bus _can_ retry (BullMQ `attempts`),
  but its own default job options set `attempts: 1` — so even with Redis configured, a genuine automatic
  retry only happens if whoever emits the event explicitly opts in with a higher `attempts` value. This
  matters for T-071's idempotency design: a "redelivered" `order.fulfillment_created`/`payment.refunded` in
  practice means a manual replay, not an automatic retry storm — informed how strict the idempotency check
  needs to be (checked up front, before allocating a document number, to keep `SequentialNumberer`'s
  gap-free guarantee under the realistic case) versus how strict it only needs to be as a backstop (the
  database-level unique constraint, for the truly-concurrent case the local event bus can't even produce).
- **`payment.refunded`'s payload-only-carries-`{id}` gap (flagged unresolved in T-070's own entry above)
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
  and reading its actual SQL error (T-071).
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
  - **BT-10 (buyer reference) is mandatory on every invoice, not just a B2G one (BR-DE-15)** — conflicts
    with `selectProfile`'s own heuristic ("presence of `buyerReference` signals a B2G buyer"), since always
    supplying one would make every order resolve to `XRECHNUNG` regardless of `defaultProfile`. Resolved by
    keeping two distinct values: the _raw_ B2G signal (`resolveB2gBuyerReference`, only a real
    `customer.metadata.buyer_reference`/Leitweg-ID) is what `selectProfile` is called with; the _mapped_
    `CommerceInvoiceInput.references.buyerReference` always gets a value — the order's own `display_id`
    when there's no real B2G reference — to satisfy BR-DE-15 without corrupting profile selection.
  - **BG-16 (payment instructions) is mandatory on every invoice (BR-DE-1)** — merchant-level bank details
    (which account the buyer should pay into), the same kind of static config as `seller` itself, not
    derivable from an order. Added as a new required `EinvoiceModuleOptions.payment` field
    (`{ means, iban?, terms? }`); `service.ts`'s `assertValidOptions` refuses to construct the module
    without it, the same way it already refused a seller missing `vatIdentifier`.
    All three were found by actually running the plugin's own output through the real KoSIT Validator inside
    this task's e2e proof (not anticipated from reading `build-invoice.ts` or the base Schematron alone) —
    each fix was verified by re-running the same validator until it returned `ACCEPTABLE`, not just by making
    the error message go away.
