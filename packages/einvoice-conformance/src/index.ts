/**
 * `@normwerk/einvoice-conformance`: the `pnpm conformance ...` CLI that drives the Docker-based validators
 * (`cli.ts`), and the dry-run report — its schema (`dry-run/report.ts`) and its Markdown (`dry-run/markdown.ts`).
 */
export const PACKAGE_NAME = "@normwerk/einvoice-conformance";

export * from "./dry-run/report.js";
export { renderDryRunMarkdown, toolErrorReportUrl } from "./dry-run/markdown.js";
