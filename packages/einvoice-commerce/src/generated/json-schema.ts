/**
 * GENERATED FILE — do not hand-edit (AGENTS.md §9).
 *
 * Generator: tools/codegen/commerce/generate-json-schema.mjs
 * Source: packages/einvoice-commerce/src/types.ts's `CommerceInvoiceInput`
 * (ADR-003, docs/adr/003-commerce-invoice-input.md) via ts-json-schema-generator
 * — read directly from the TypeScript AST, not a hand-duplicated definition.
 * To change: edit types.ts, then re-run `pnpm codegen:commerce` from the repo root.
 */
export const commerceInvoiceInputJsonSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$comment": "GENERATED — see tools/codegen/commerce/generate-json-schema.mjs",
  "$id": "https://normwerk.dev/schema/einvoice-commerce/commerce-invoice-input.json",
  "title": "CommerceInvoiceInput (ADR-003)",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "$ref": "#/definitions/CommerceInvoiceInputSchemaVersion"
    },
    "document": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "invoice",
            "credit-note"
          ]
        },
        "number": {
          "type": "string"
        },
        "issueDate": {
          "$ref": "#/definitions/IsoDate"
        },
        "currency": {
          "$ref": "#/definitions/CurrencyCode"
        },
        "correctedInvoice": {
          "type": "object",
          "properties": {
            "number": {
              "type": "string"
            },
            "issueDate": {
              "$ref": "#/definitions/IsoDate"
            }
          },
          "required": [
            "number",
            "issueDate"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "kind",
        "issueDate",
        "currency"
      ],
      "additionalProperties": false
    },
    "seller": {
      "$ref": "#/definitions/CommerceParty"
    },
    "buyer": {
      "$ref": "#/definitions/CommerceParty"
    },
    "lines": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/CommerceLine"
      }
    },
    "shipping": {
      "$ref": "#/definitions/CommerceCharge"
    },
    "discounts": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/CommerceCharge"
      }
    },
    "payment": {
      "type": "object",
      "properties": {
        "means": {
          "$ref": "#/definitions/PaymentMeansCode"
        },
        "terms": {
          "type": "string"
        },
        "iban": {
          "type": "string"
        }
      },
      "required": [
        "means"
      ],
      "additionalProperties": false
    },
    "references": {
      "type": "object",
      "properties": {
        "buyerReference": {
          "type": "string"
        },
        "orderReference": {
          "type": "string"
        },
        "contractReference": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "delivery": {
      "type": "object",
      "properties": {
        "actualDeliveryDate": {
          "$ref": "#/definitions/IsoDate"
        },
        "deliverToCountryCode": {
          "$ref": "#/definitions/CountryCode"
        },
        "deliverToCity": {
          "type": "string"
        },
        "deliverToPostCode": {
          "type": "string"
        }
      },
      "additionalProperties": false
    },
    "taxContext": {
      "$ref": "#/definitions/TaxContext"
    },
    "customs": {
      "type": "object",
      "properties": {
        "incoterm": {
          "type": "string"
        },
        "sellerEori": {
          "type": "string"
        },
        "buyerEori": {
          "type": "string"
        },
        "iossNumber": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "schemaVersion",
    "document",
    "seller",
    "buyer",
    "lines",
    "taxContext"
  ],
  "additionalProperties": false,
  "definitions": {
    "CommerceInvoiceInputSchemaVersion": {
      "type": "number",
      "const": 1
    },
    "IsoDate": {
      "type": "string"
    },
    "CurrencyCode": {
      "type": "string",
      "enum": [
        "AED",
        "AFN",
        "ALL",
        "AMD",
        "AOA",
        "ARS",
        "AUD",
        "AWG",
        "AZN",
        "BAM",
        "BBD",
        "BDT",
        "BHD",
        "BIF",
        "BMD",
        "BND",
        "BOB",
        "BOV",
        "BRL",
        "BSD",
        "BTN",
        "BWP",
        "BYN",
        "BZD",
        "CAD",
        "CDF",
        "CHE",
        "CHF",
        "CHW",
        "CLF",
        "CLP",
        "CNH",
        "CNY",
        "COP",
        "COU",
        "CRC",
        "CUP",
        "CVE",
        "CZK",
        "DJF",
        "DKK",
        "DOP",
        "DZD",
        "EGP",
        "ERN",
        "ETB",
        "EUR",
        "FJD",
        "FKP",
        "GBP",
        "GEL",
        "GHS",
        "GIP",
        "GMD",
        "GNF",
        "GTQ",
        "GYD",
        "HKD",
        "HNL",
        "HTG",
        "HUF",
        "IDR",
        "ILS",
        "INR",
        "IQD",
        "IRR",
        "ISK",
        "JMD",
        "JOD",
        "JPY",
        "KES",
        "KGS",
        "KHR",
        "KMF",
        "KPW",
        "KRW",
        "KWD",
        "KYD",
        "KZT",
        "LAK",
        "LBP",
        "LKR",
        "LRD",
        "LSL",
        "LYD",
        "MAD",
        "MDL",
        "MGA",
        "MKD",
        "MMK",
        "MNT",
        "MOP",
        "MRU",
        "MUR",
        "MVR",
        "MWK",
        "MXN",
        "MXV",
        "MYR",
        "MZN",
        "NAD",
        "NGN",
        "NIO",
        "NOK",
        "NPR",
        "NZD",
        "OMR",
        "PAB",
        "PEN",
        "PGK",
        "PHP",
        "PKR",
        "PLN",
        "PYG",
        "QAR",
        "RON",
        "RSD",
        "RUB",
        "RWF",
        "SAR",
        "SBD",
        "SCR",
        "SDG",
        "SEK",
        "SGD",
        "SHP",
        "SLE",
        "SOS",
        "SRD",
        "SSP",
        "STD",
        "SVC",
        "SYP",
        "SZL",
        "THB",
        "TJS",
        "TMT",
        "TND",
        "TOP",
        "TRY",
        "TTD",
        "TWD",
        "TZS",
        "UAH",
        "UGX",
        "USD",
        "USN",
        "UYI",
        "UYU",
        "UYW",
        "UZS",
        "VES",
        "VED",
        "VND",
        "VUV",
        "WST",
        "XAF",
        "XAG",
        "XAU",
        "XBA",
        "XBB",
        "XBC",
        "XBD",
        "XCD",
        "XCG",
        "XDR",
        "XOF",
        "XPD",
        "XPF",
        "XPT",
        "XSU",
        "XTS",
        "XUA",
        "XXX",
        "YER",
        "ZAR",
        "ZMW",
        "ZWG"
      ]
    },
    "CommerceParty": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "countryCode": {
          "$ref": "#/definitions/CountryCode"
        },
        "city": {
          "type": "string"
        },
        "postCode": {
          "type": "string"
        },
        "vatIdentifier": {
          "type": "string"
        },
        "legalRegistrationIdentifier": {
          "type": "string"
        },
        "electronicAddress": {
          "type": "string"
        },
        "electronicAddressScheme": {
          "$ref": "#/definitions/EasCode"
        },
        "contact": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "telephone": {
              "type": "string"
            },
            "email": {
              "type": "string"
            }
          },
          "required": [
            "name",
            "telephone",
            "email"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "name",
        "countryCode",
        "city",
        "postCode"
      ],
      "additionalProperties": false
    },
    "CountryCode": {
      "type": "string",
      "enum": [
        "1A",
        "AD",
        "AE",
        "AF",
        "AG",
        "AI",
        "AL",
        "AM",
        "AN",
        "AO",
        "AQ",
        "AR",
        "AS",
        "AT",
        "AU",
        "AW",
        "AX",
        "AZ",
        "BA",
        "BB",
        "BD",
        "BE",
        "BF",
        "BG",
        "BH",
        "BI",
        "BL",
        "BJ",
        "BM",
        "BN",
        "BO",
        "BQ",
        "BR",
        "BS",
        "BT",
        "BV",
        "BW",
        "BY",
        "BZ",
        "CA",
        "CC",
        "CD",
        "CF",
        "CG",
        "CH",
        "CI",
        "CK",
        "CL",
        "CM",
        "CN",
        "CO",
        "CR",
        "CU",
        "CV",
        "CW",
        "CX",
        "CY",
        "CZ",
        "DE",
        "DJ",
        "DK",
        "DM",
        "DO",
        "DZ",
        "EC",
        "EE",
        "EG",
        "EH",
        "ER",
        "ES",
        "ET",
        "FI",
        "FJ",
        "FK",
        "FM",
        "FO",
        "FR",
        "GA",
        "GB",
        "GD",
        "GE",
        "GF",
        "GG",
        "GH",
        "GI",
        "GL",
        "GM",
        "GN",
        "GP",
        "GQ",
        "GR",
        "GS",
        "GT",
        "GU",
        "GW",
        "GY",
        "HK",
        "HM",
        "HN",
        "HR",
        "HT",
        "HU",
        "ID",
        "IE",
        "IL",
        "IM",
        "IN",
        "IO",
        "IQ",
        "IR",
        "IS",
        "IT",
        "JE",
        "JM",
        "JO",
        "JP",
        "KE",
        "KG",
        "KH",
        "KI",
        "KM",
        "KN",
        "KP",
        "KR",
        "KW",
        "KY",
        "KZ",
        "LA",
        "LB",
        "LC",
        "LI",
        "LK",
        "LR",
        "LS",
        "LT",
        "LU",
        "LV",
        "LY",
        "MA",
        "MC",
        "MD",
        "ME",
        "MF",
        "MG",
        "MH",
        "MK",
        "ML",
        "MM",
        "MN",
        "MO",
        "MP",
        "MQ",
        "MR",
        "MS",
        "MT",
        "MU",
        "MV",
        "MW",
        "MX",
        "MY",
        "MZ",
        "NA",
        "NC",
        "NE",
        "NF",
        "NG",
        "NI",
        "NL",
        "NO",
        "NP",
        "NR",
        "NU",
        "NZ",
        "OM",
        "PA",
        "PE",
        "PF",
        "PG",
        "PH",
        "PK",
        "PL",
        "PM",
        "PN",
        "PR",
        "PS",
        "PT",
        "PW",
        "PY",
        "QA",
        "RE",
        "RO",
        "RS",
        "RU",
        "RW",
        "SA",
        "SB",
        "SC",
        "SD",
        "SE",
        "SG",
        "SH",
        "SI",
        "SJ",
        "SK",
        "SL",
        "SM",
        "SN",
        "SO",
        "SR",
        "ST",
        "SV",
        "SX",
        "SY",
        "SZ",
        "TC",
        "TD",
        "TF",
        "TG",
        "TH",
        "TJ",
        "TK",
        "TL",
        "TM",
        "TN",
        "TO",
        "TR",
        "TT",
        "TV",
        "TW",
        "TZ",
        "UA",
        "UG",
        "UM",
        "US",
        "UY",
        "UZ",
        "VA",
        "VC",
        "VE",
        "VG",
        "VI",
        "VN",
        "VU",
        "WF",
        "WS",
        "XI",
        "YE",
        "YT",
        "ZA",
        "ZM",
        "ZW"
      ]
    },
    "EasCode": {
      "type": "string",
      "enum": [
        "0002",
        "0007",
        "0009",
        "0037",
        "0060",
        "0088",
        "0096",
        "0097",
        "0106",
        "0130",
        "0135",
        "0142",
        "0147",
        "0151",
        "0154",
        "0158",
        "0170",
        "0177",
        "0183",
        "0184",
        "0188",
        "0190",
        "0191",
        "0192",
        "0193",
        "0194",
        "0195",
        "0196",
        "0198",
        "0199",
        "0200",
        "0201",
        "0202",
        "0203",
        "0204",
        "0205",
        "0208",
        "0209",
        "0210",
        "0211",
        "0212",
        "0213",
        "0215",
        "0216",
        "0217",
        "0218",
        "0219",
        "0220",
        "0221",
        "0225",
        "0230",
        "0235",
        "0240",
        "0244",
        "0242",
        "0245",
        "0246",
        "0248",
        "9910",
        "9913",
        "9914",
        "9915",
        "9918",
        "9919",
        "9920",
        "9922",
        "9923",
        "9924",
        "9925",
        "9926",
        "9927",
        "9928",
        "9929",
        "9930",
        "9931",
        "9932",
        "9933",
        "9934",
        "9935",
        "9936",
        "9937",
        "9938",
        "9939",
        "9940",
        "9941",
        "9942",
        "9943",
        "9944",
        "9945",
        "9946",
        "9947",
        "9948",
        "9949",
        "9950",
        "9951",
        "9952",
        "9953",
        "9957",
        "9959",
        "AN",
        "AQ",
        "AS",
        "AU",
        "EM"
      ]
    },
    "CommerceLine": {
      "type": "object",
      "properties": {
        "identifier": {
          "type": "string"
        },
        "quantity": {
          "$ref": "#/definitions/Amount"
        },
        "unitCode": {
          "type": "string"
        },
        "netPrice": {
          "$ref": "#/definitions/Amount"
        },
        "itemName": {
          "type": "string"
        },
        "taxRateKind": {
          "type": "string",
          "enum": [
            "standard",
            "reduced"
          ]
        },
        "supplyType": {
          "type": "string",
          "enum": [
            "goods",
            "services"
          ]
        },
        "allowances": {
          "type": "array",
          "items": {
            "$ref": "#/definitions/CommerceLineAllowance"
          }
        },
        "hsCode": {
          "type": "string"
        },
        "originCountry": {
          "$ref": "#/definitions/CountryCode"
        }
      },
      "required": [
        "quantity",
        "unitCode",
        "netPrice",
        "itemName"
      ],
      "additionalProperties": false
    },
    "Amount": {
      "type": "string"
    },
    "CommerceLineAllowance": {
      "type": "object",
      "properties": {
        "amount": {
          "$ref": "#/definitions/Amount"
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "amount",
        "reason"
      ],
      "additionalProperties": false
    },
    "CommerceCharge": {
      "type": "object",
      "properties": {
        "amount": {
          "$ref": "#/definitions/Amount"
        },
        "reason": {
          "type": "string"
        }
      },
      "required": [
        "amount"
      ],
      "additionalProperties": false
    },
    "PaymentMeansCode": {
      "type": "string",
      "enum": [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "13",
        "14",
        "15",
        "16",
        "17",
        "18",
        "19",
        "20",
        "21",
        "22",
        "23",
        "24",
        "25",
        "26",
        "27",
        "28",
        "29",
        "30",
        "31",
        "32",
        "33",
        "34",
        "35",
        "36",
        "37",
        "38",
        "39",
        "40",
        "41",
        "42",
        "43",
        "44",
        "45",
        "46",
        "47",
        "48",
        "49",
        "50",
        "51",
        "52",
        "53",
        "54",
        "55",
        "56",
        "57",
        "58",
        "59",
        "60",
        "61",
        "62",
        "63",
        "64",
        "65",
        "66",
        "67",
        "68",
        "69",
        "70",
        "74",
        "75",
        "76",
        "77",
        "78",
        "91",
        "92",
        "93",
        "94",
        "95",
        "96",
        "97",
        "98",
        "ZZZ"
      ]
    },
    "TaxContext": {
      "type": "object",
      "properties": {
        "sellerCountry": {
          "$ref": "#/definitions/CountryCode"
        },
        "sellerVatId": {
          "type": "string"
        },
        "buyerCountry": {
          "$ref": "#/definitions/CountryCode"
        },
        "buyerVatId": {
          "type": "string"
        },
        "buyerIsBusiness": {
          "type": "boolean"
        },
        "ossRegistered": {
          "type": "boolean"
        },
        "supplyType": {
          "type": "string",
          "enum": [
            "goods",
            "services",
            "mixed"
          ]
        },
        "ossRateOverride": {
          "$ref": "#/definitions/Amount"
        },
        "regimeOverride": {
          "$ref": "#/definitions/RegimeOverride"
        }
      },
      "required": [
        "sellerCountry",
        "sellerVatId",
        "buyerCountry",
        "buyerIsBusiness",
        "ossRegistered",
        "supplyType"
      ],
      "additionalProperties": false
    },
    "RegimeOverride": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "reverse-charge"
            },
            "reasonText": {
              "type": "string"
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "exempt"
            },
            "reasonText": {
              "type": "string"
            },
            "reasonCode": {
              "$ref": "#/definitions/VatexCode"
            }
          },
          "required": [
            "kind",
            "reasonText"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "zero-rated"
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "intra-eu-confirmed"
            },
            "evidenceNote": {
              "type": "string"
            }
          },
          "required": [
            "kind",
            "evidenceNote"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "const": "reverse-charge-cross-border"
            },
            "reasonText": {
              "type": "string"
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        }
      ]
    },
    "VatexCode": {
      "type": "string",
      "enum": [
        "VATEX-EU-79-C",
        "VATEX-EU-132",
        "VATEX-EU-132-1A",
        "VATEX-EU-132-1B",
        "VATEX-EU-132-1C",
        "VATEX-EU-132-1D",
        "VATEX-EU-132-1E",
        "VATEX-EU-132-1F",
        "VATEX-EU-132-1G",
        "VATEX-EU-132-1H",
        "VATEX-EU-132-1I",
        "VATEX-EU-132-1J",
        "VATEX-EU-132-1K",
        "VATEX-EU-132-1L",
        "VATEX-EU-132-1M",
        "VATEX-EU-132-1N",
        "VATEX-EU-132-1O",
        "VATEX-EU-132-1P",
        "VATEX-EU-132-1Q",
        "VATEX-EU-135-1",
        "VATEX-EU-143",
        "VATEX-EU-143-1A",
        "VATEX-EU-143-1B",
        "VATEX-EU-143-1C",
        "VATEX-EU-143-1D",
        "VATEX-EU-143-1E",
        "VATEX-EU-143-1F",
        "VATEX-EU-143-1FA",
        "VATEX-EU-143-1G",
        "VATEX-EU-143-1H",
        "VATEX-EU-143-1I",
        "VATEX-EU-143-1J",
        "VATEX-EU-143-1K",
        "VATEX-EU-143-1L",
        "VATEX-EU-144",
        "VATEX-EU-146-1E",
        "VATEX-EU-159",
        "VATEX-EU-309",
        "VATEX-EU-148",
        "VATEX-EU-148-A",
        "VATEX-EU-148-B",
        "VATEX-EU-148-C",
        "VATEX-EU-148-D",
        "VATEX-EU-148-E",
        "VATEX-EU-148-F",
        "VATEX-EU-148-G",
        "VATEX-EU-151",
        "VATEX-EU-151-1A",
        "VATEX-EU-151-1AA",
        "VATEX-EU-151-1B",
        "VATEX-EU-151-1C",
        "VATEX-EU-151-1D",
        "VATEX-EU-151-1E",
        "VATEX-EU-G",
        "VATEX-EU-O",
        "VATEX-EU-IC",
        "VATEX-EU-AE",
        "VATEX-EU-D",
        "VATEX-EU-F",
        "VATEX-EU-I",
        "VATEX-EU-J",
        "VATEX-FR-FRANCHISE",
        "VATEX-FR-CNWVAT",
        "VATEX-EU-153",
        "VATEX-FR-CGI261-1",
        "VATEX-FR-CGI261-2",
        "VATEX-FR-CGI261-3",
        "VATEX-FR-CGI261-4",
        "VATEX-FR-CGI261-5",
        "VATEX-FR-CGI261-7",
        "VATEX-FR-CGI261-8",
        "VATEX-FR-CGI261A",
        "VATEX-FR-CGI261B",
        "VATEX-FR-CGI261C-1",
        "VATEX-FR-CGI261C-2",
        "VATEX-FR-CGI261C-3",
        "VATEX-FR-CGI261D-1",
        "VATEX-FR-CGI261D-1BIS",
        "VATEX-FR-CGI261D-2",
        "VATEX-FR-CGI261D-3",
        "VATEX-FR-CGI261D-4",
        "VATEX-FR-CGI261E-1",
        "VATEX-FR-CGI261E-2",
        "VATEX-FR-CGI277A",
        "VATEX-FR-CGI275",
        "VATEX-FR-298SEXDECIESA",
        "VATEX-FR-CGI295",
        "VATEX-FR-AE"
      ]
    }
  }
} as const;
