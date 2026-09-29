import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { S12, ustgXml } from "./test-ustg-xml.mjs";
import { extractNorms, sha256 } from "./ustg.mjs";
import { recordedHashes } from "./watch-ustg.mjs";

const WATCH = resolve(dirname(fileURLToPath(import.meta.url)), "watch-ustg.mjs");

/** A stand for one run: the XML, a sources file recording the unchanged text's hashes, and a fake `gh` that
 * logs every call and finds no open issue. */
function stand(xml) {
  const dir = mkdtempSync(join(tmpdir(), "watch-ustg-test-"));
  const norms = extractNorms(ustgXml());
  writeFileSync(join(dir, "ustg.xml"), xml);
  writeFileSync(
    join(dir, "sources.md"),
    `- \`§ 12\` text SHA-256: \`${sha256(norms.get("§ 12"))}\`\n- \`§ 28\` text SHA-256: \`${sha256(norms.get("§ 28"))}\`\n`,
  );
  const gh = join(dir, "gh");
  const log = join(dir, "gh.log");
  writeFileSync(
    gh,
    `#!/usr/bin/env node\nconst fs = require("node:fs");\n` +
      `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n` +
      `if (process.argv[2] === "issue" && process.argv[3] === "create") {\n` +
      `  const body = process.argv[process.argv.indexOf("--body-file") + 1];\n` +
      `  fs.appendFileSync(${JSON.stringify(log)}, fs.readFileSync(body, "utf-8") + "\\n");\n` +
      `}\n` +
      `if (process.argv[3] === "list") process.stdout.write("[]");\n`,
  );
  chmodSync(gh, 0o755);
  const run = () =>
    execFileSync(
      process.execPath,
      [WATCH, "--xml", join(dir, "ustg.xml"), "--sources", join(dir, "sources.md"), "--gh", gh],
      { encoding: "utf-8" },
    );
  return { run, calls: () => (existsSync(log) ? readFileSync(log, "utf-8") : "") };
}

test("recordedHashes: reads each paragraph's hash as docs/sources.md records it", () => {
  const hashes = recordedHashes(
    readFileSync(resolve(dirname(WATCH), "../../docs/sources.md"), "utf-8"),
  );
  assert.deepEqual([...hashes.keys()], ["§ 12", "§ 28"]);
});

test("unchanged: one line, and no call to GitHub", () => {
  const { run, calls } = stand(ustgXml());
  assert.match(run(), /§ 12 and § 28 unchanged/);
  assert.equal(calls(), "");
});

test("§ 12 changed: opens an issue naming it, with the quotes that no longer hold and the new text", () => {
  const { run, calls } = stand(ustgXml(S12.replace("19 Prozent", "20 Prozent")));
  run();
  const log = calls();
  assert.match(log, /\["issue","list"/);
  assert.match(
    log,
    /\["issue","create","--title","UStG § 12 changed \([0-9a-f]{12}\) — check Germany's VAT rate table"/,
  );
  assert.match(log, /§ 12 Abs\. 1 UStG — quote not found word for word/);
  assert.match(log, /20 Prozent der Bemessungsgrundlage/);
  assert.doesNotMatch(log, /§ 28:/);
});
