/**
 * P-68 (M-040): Medusa plugins known to issue invoices of their own. Next to this plugin, each order gets two
 * invoices for one supply — the buyer holds two documents, and VAT is owed on each (§14c UStG) — so the module
 * warns at startup when one is registered. A warning, not a refusal: the other plugin may be installed for
 * something else, with its own invoices turned off.
 */
export const OTHER_INVOICE_PLUGINS: readonly string[] = ["@webbers/invoices-medusa"];

/** The part of Medusa's `configModule` read here — structural, as the loaded config's shape varies by release. */
export interface InvoicePluginConfig {
  readonly plugins?: readonly unknown[];
  readonly modules?: unknown;
}

function resolveOf(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null && "resolve" in entry) {
    const resolve = (entry as { readonly resolve: unknown }).resolve;
    return typeof resolve === "string" ? resolve : undefined;
  }
  return undefined;
}

function belongsTo(resolve: string, plugin: string): boolean {
  return resolve === plugin || resolve.startsWith(`${plugin}/`);
}

/**
 * The known invoice plugins in a Medusa configuration: listed under `plugins`, or registered as a module —
 * Medusa merges each plugin's modules into `configModule.modules` by a path inside the plugin
 * (`mergePluginModules`, `@medusajs/utils`).
 */
export function otherInvoicePlugins(config: InvoicePluginConfig | undefined): string[] {
  const modules = config?.modules;
  const moduleEntries = Array.isArray(modules)
    ? modules
    : typeof modules === "object" && modules !== null
      ? Object.values(modules)
      : [];
  const resolves = [...(config?.plugins ?? []), ...moduleEntries]
    .map(resolveOf)
    .filter((resolve): resolve is string => resolve !== undefined);
  return OTHER_INVOICE_PLUGINS.filter((plugin) =>
    resolves.some((resolve) => belongsTo(resolve, plugin)),
  );
}
