# de-special-chars

DE → DE B2B, deliberately stressing XML escaping: the invoice number, buyer name, and item name all contain
characters that must be escaped in XML text content (`&`, `<`, `>`, `"`) plus non-ASCII text (umlauts, em
dash, fraction, degree-adjacent symbols).

- **What this exercises:** `serialize.ts`'s `escapeText`/`escapeAttr` — a wrong or missing escape here
  produces either invalid XML (unescaped `<`/`&`) or, worse, XML that parses but silently corrupts the
  content. This is exactly the class of bug that only shows up with real adversarial input, not the plain
  ASCII text every other fixture uses.
- **Levels:** L1+L2 verified against the real KoSIT validator (`pnpm conformance:fixtures`) — this also
  confirms the escaped output is well-formed enough for KoSIT's own XML parser, not just our own tests.
