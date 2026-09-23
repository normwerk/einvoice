/**
 * Serialization plan types (ADR-004: "the serialization plan is data, not
 * code"). A plan node describes one CII element/attribute and where its
 * value comes from in the model — nothing here is XML-library-specific.
 *
 * `from` is always a property name resolved against the *current* data
 * context, which starts at the `Invoice` root and narrows every time an
 * `element` node with `from` descends into a nested object, or a `repeat`
 * node iterates an array.
 */

export interface QName {
  readonly prefix: string;
  readonly local: string;
}

export type ValueFormat = "text" | "amount" | "date-cii" | "literal";

export interface AttributeNode {
  readonly name: string;
  /** Read from the current context, OR: */
  readonly from?: string;
  /** ...a fixed value, e.g. unitCode's constant, or the currencyID literal. */
  readonly literal?: string;
  /** When true and `from` resolves to a fixed string, use that string as-is (no lookup elsewhere). */
  readonly fromCurrencyCode?: boolean;
}

export interface ElementNode {
  readonly kind: "element";
  readonly name: QName;
  /**
   * If set, descend into `context[from]` for this element's children and
   * attributes; if that value is undefined, the whole element (and its
   * subtree) is skipped. If unset, the element always renders (its CII
   * type is mandatory even when every child is optional — e.g.
   * ApplicableHeaderTradeDelivery) using the *same* context as the parent.
   */
  readonly from?: string;
  /**
   * If set, the element (and its subtree) is rendered only when `when` resolves to a present value in this
   * element's own context (after `from`, if any) — without descending into it. For an optional container
   * whose children need sibling fields of the gating one (URIUniversalCommunication reads
   * `electronicAddressScheme` next to `electronicAddress`): without it such a container rendered as an empty
   * `<…/>` whenever its data was absent, which BR-57/BR-62/BR-63 reject.
   */
  readonly when?: string;
  readonly attributes?: readonly AttributeNode[];
  readonly children?: readonly PlanNode[];
}

export interface ValueNode {
  readonly kind: "value";
  readonly name: QName;
  /** Read from the current context. If undefined, this node is skipped (optional field). */
  readonly from?: string;
  /** A constant instead of a model value (e.g. TypeCode "VAT"). */
  readonly literal?: string;
  readonly format?: ValueFormat;
  readonly attributes?: readonly AttributeNode[];
  /** BT/BG number, for `docs/mapping-reference.md` generation (T-020 continuation) and error messages. */
  readonly bt?: string;
}

export interface RepeatNode {
  readonly kind: "repeat";
  readonly name: QName;
  /** Path to the array in the current context. */
  readonly from: string;
  readonly children: readonly PlanNode[];
  readonly attributes?: readonly AttributeNode[];
  /** Emit only the first item — see plan.ts's note on InvoiceReferencedDocument (CII caps it at 1). */
  readonly firstOnly?: boolean;
}

export type PlanNode = ElementNode | ValueNode | RepeatNode;
