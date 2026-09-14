/**
 * T-071: the platform adapter `@normwerk/einvoice-commerce`'s own `numbering.ts` doc comment describes —
 * "a platform adapter backs it with its own database transaction" — backed by `EinvoiceModuleService`'s
 * real, atomic `allocateNextNumber` (`service.ts`). Pairs with `SequentialNumberer`
 * (`@normwerk/einvoice-commerce`) to produce `RE-2026-0001`/`GS-2026-0001`-style numbers; subscribers
 * (T-071) construct `new SequentialNumberer(new ModuleNumberingStore(einvoiceModuleService))`.
 */
import type { NumberingStore } from "@normwerk/einvoice-commerce" with {
  "resolution-mode": "import",
};
import type EinvoiceModuleService from "./service.js";

export class ModuleNumberingStore implements NumberingStore {
  constructor(private readonly service: EinvoiceModuleService) {}

  allocateNext(series: string): Promise<number> {
    return this.service.allocateNextNumber(series);
  }
}
