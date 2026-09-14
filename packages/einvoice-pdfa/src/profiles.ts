/**
 * T-030: ZUGFeRD/Factur-X profile configuration — the two profiles
 * plan-v0.1 §4.3/W8 names explicitly ("ZUGFeRD 2.3 EN 16931", "ZUGFeRD
 * XRECHNUNG").
 *
 * Every value below is real, not guessed — read directly from
 * ZUGFeRD/mustangproject (Apache-2.0, the same tool already used as our own
 * Docker conformance validator, T-040) at the pinned commit recorded in
 * artifacts/MANIFEST.json (id: mustangproject-zugferd-xmp-writer):
 *   - XMPSchemaZugferd.java / ZUGFeRDExporterFromA3.java: the fx:/zf:
 *     namespace URN and prefix ("Factur-X is now set by default since ZF
 *     2.1" — isFacturX=true is the modern default even for ZUGFeRD-branded
 *     profiles, so both of ours use the fx: namespace, not the legacy zf:
 *     one), and the per-profile attachment filename (getFilenameForVersion:
 *     XRECHNUNG gets "xrechnung.xml", not "factur-x.xml" — a real,
 *     non-obvious detail that would have been wrong to assume).
 *   - Profile.java's getXMPName(): "EN16931" -> XMP "EN 16931" (with a
 *     space), "XRECHNUNG" -> XMP "XRECHNUNG" (unchanged) — both appear
 *     verbatim in PDFValidator.java's own accepted-value list, so this is
 *     what the real validator we already run (Mustang, T-040) checks for.
 *   - Profiles.java's URN table: XRECHNUNG's guideline URN is exactly
 *     "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"
 *     — the same string our fixtures already use as specificationIdentifier
 *     (BT-24), confirmed independently rather than assumed to match.
 */

export type ZugferdProfileName = "EN16931" | "XRECHNUNG";

export interface ZugferdProfile {
  readonly name: ZugferdProfileName;
  /** XMP fx: namespace URN (same for both — "Factur-X" branding is the modern default since ZF 2.1). */
  readonly xmpNamespaceUri: string;
  readonly xmpPrefix: "fx";
  /** Accepted by Mustang's PDFValidator (verbatim from Profile.java's getXMPName()). */
  readonly xmpConformanceLevel: string;
  /**
   * fx:Version. Mustang's own real default when isFacturX=true (our case
   * for both profiles) is "1.0" — the Factur-X spec's own version number,
   * not the ZUGFeRD generation number — regardless of ZUGFeRD branding.
   * We deviate for XRECHNUNG to "3.0" (also in Mustang's accepted-value
   * list) since it more usefully matches the actual XRechnung 3.0.2 CIUS
   * we implement; this is a documented judgment call, not the tool's own
   * default, unlike everything else in this table.
   */
  readonly xmpVersion: string;
  /** DocumentFileName / the actual attached filename (ZUGFeRDExporterFromA3.getFilenameForVersion). */
  readonly attachmentFilename: string;
}

export const ZUGFERD_PROFILES: Record<ZugferdProfileName, ZugferdProfile> = {
  EN16931: {
    name: "EN16931",
    xmpNamespaceUri: "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#",
    xmpPrefix: "fx",
    xmpConformanceLevel: "EN 16931",
    xmpVersion: "1.0",
    attachmentFilename: "factur-x.xml",
  },
  XRECHNUNG: {
    name: "XRECHNUNG",
    xmpNamespaceUri: "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#",
    xmpPrefix: "fx",
    xmpConformanceLevel: "XRECHNUNG",
    xmpVersion: "3.0",
    attachmentFilename: "xrechnung.xml",
  },
};
