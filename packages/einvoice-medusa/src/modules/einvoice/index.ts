import { Module } from "@medusajs/framework/utils";
import EinvoiceModuleService from "./service.js";

export const EINVOICE_MODULE = "einvoice";

export default Module(EINVOICE_MODULE, {
  service: EinvoiceModuleService,
});
