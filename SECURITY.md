# Security policy

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Report it privately, either way:

- on GitHub, with **Report a vulnerability** under the repository's security tab — GitHub's
  [instructions](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability);
- by email to **hello@normwerk.dev**.

Include the affected package and version, the Medusa version where it matters, and the steps that show the
problem. Use synthetic data only: never send a real invoice, customer data or credentials.

We answer within three business days. We do not promise a date for the fix, and there is no bug bounty. Once
a fix is released, the vulnerability is described in a GitHub security advisory; say whether you want to be
credited there.

## Supported versions

Security fixes go into the latest minor release line of 0.x only. An older line is not patched: upgrade to
the latest release.

| Version                   | Security fixes |
| ------------------------- | -------------- |
| Latest 0.x minor line     | Yes            |
| Earlier minor lines       | No             |
| Not yet released (`main`) | Yes            |

## What counts

A vulnerability lets someone read, change or forge something they should not — for example, a customer
downloading another customer's invoice through the Store API, or order data that alters the structure of
the generated XML. A wrong VAT category or a rejected invoice is a bug, not a vulnerability: open an issue
for it.
