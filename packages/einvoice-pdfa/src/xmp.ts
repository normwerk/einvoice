/**
 * T-030: hand-built XMP metadata packet for a PDF/A-3b Factur-X/ZUGFeRD
 * document. No XMP library dependency (mirrors einvoice-cii's own
 * hand-written serializer, ADR-004) — the structure is small, fixed, and
 * fully derived from real sources rather than a general-purpose templating
 * need.
 *
 * Three `rdf:Description` blocks, matching the real structure
 * ZUGFeRD/mustangproject's own writer produces (XMPSchemaZugferd.java +
 * XMPSchemaPDFAExtensions.java, see profiles.ts's header for the pinned
 * source):
 *   1. pdfaid: (PDF/A identification) + dc: (Dublin Core — format, title)
 *   2. pdfaExtension:schemas — the ISO 19005-3 Annex E declaration that a
 *      custom (fx:) schema exists, WITHOUT which veraPDF rejects the file
 *      under clause 6.6.2.3 even when every fx: property value is
 *      otherwise fine (the exact pitfall Spike B found, HOW-WE-GOT-HERE.md
 *      D-20).
 *   3. the actual fx: properties (DocumentType/DocumentFileName/Version/
 *      ConformanceLevel) that Mustang's PDFValidator.java checks for.
 */
import type { ZugferdProfile } from "./profiles.js";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One entry in the pdfaExtension:schemas/property Seq — verbatim descriptions from XMPSchemaPDFAExtensions.java's invoice branch. */
const EXTENSION_PROPERTIES: readonly { name: string; description: string }[] = [
  { name: "DocumentFileName", description: "name of the embedded XML invoice file" },
  { name: "DocumentType", description: "INVOICE" },
  { name: "Version", description: "The actual version of the ZUGFeRD XML schema" },
  { name: "ConformanceLevel", description: "The selected ZUGFeRD profile completeness" },
];

// The XMP Packet Wrapper spec requires a literal U+FEFF (BOM) inside the
// "begin" attribute value, not just as a file-leading byte order mark —
// written as an escape rather than a literal character so it doesn't read
// as accidental irregular whitespace in the source.
const XPACKET_BOM = "\ufeff";

export interface XmpOptions {
  readonly profile: ZugferdProfile;
  /** dc:title (BT-1 invoice number is a reasonable default; optional). */
  readonly title?: string;
}

export function buildXmpPacket(options: XmpOptions): string {
  const { profile, title } = options;
  const extensionPropertyItems = EXTENSION_PROPERTIES.map(
    (p) =>
      `<rdf:li rdf:parseType="Resource">` +
      `<pdfaProperty:name>${p.name}</pdfaProperty:name>` +
      `<pdfaProperty:valueType>Text</pdfaProperty:valueType>` +
      `<pdfaProperty:category>external</pdfaProperty:category>` +
      `<pdfaProperty:description>${escapeXml(p.description)}</pdfaProperty:description>` +
      `</rdf:li>`,
  ).join("");

  const titleBlock = title
    ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>`
    : "";

  const rdf =
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    // Block 1: PDF/A identification + Dublin Core.
    `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<pdfaid:part>3</pdfaid:part>` +
    `<pdfaid:conformance>B</pdfaid:conformance>` +
    `<dc:format>application/pdf</dc:format>` +
    titleBlock +
    `</rdf:Description>` +
    // Block 2: PDF/A Extension Schema declaration for the custom fx: namespace.
    `<rdf:Description rdf:about="" ` +
    `xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" ` +
    `xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" ` +
    `xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">` +
    `<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">` +
    `<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>` +
    `<pdfaSchema:namespaceURI>${escapeXml(profile.xmpNamespaceUri)}</pdfaSchema:namespaceURI>` +
    `<pdfaSchema:prefix>${profile.xmpPrefix}</pdfaSchema:prefix>` +
    `<pdfaSchema:property><rdf:Seq>${extensionPropertyItems}</rdf:Seq></pdfaSchema:property>` +
    `</rdf:li></rdf:Bag></pdfaExtension:schemas>` +
    `</rdf:Description>` +
    // Block 3: the actual fx: properties.
    `<rdf:Description rdf:about="" xmlns:${profile.xmpPrefix}="${escapeXml(profile.xmpNamespaceUri)}">` +
    `<${profile.xmpPrefix}:DocumentType>INVOICE</${profile.xmpPrefix}:DocumentType>` +
    `<${profile.xmpPrefix}:DocumentFileName>${escapeXml(profile.attachmentFilename)}</${profile.xmpPrefix}:DocumentFileName>` +
    `<${profile.xmpPrefix}:Version>${escapeXml(profile.xmpVersion)}</${profile.xmpPrefix}:Version>` +
    `<${profile.xmpPrefix}:ConformanceLevel>${escapeXml(profile.xmpConformanceLevel)}</${profile.xmpPrefix}:ConformanceLevel>` +
    `</rdf:Description>` +
    `</rdf:RDF>`;

  // The XMP Packet Wrapper spec requires a literal U+FEFF (BOM) inside the
  // "begin" attribute value, not just as a file-leading byte order mark —
  // written as an escape so it doesn't read as accidental irregular
  // whitespace in the source.
  return (
    `<?xpacket begin="${XPACKET_BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">${rdf}</x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}
