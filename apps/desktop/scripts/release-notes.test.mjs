import { generateKeyPairSync, verify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import {
  ascToken,
  changelogSection,
  plainText,
  releaseNotes,
  WHATS_NEW_LIMIT,
} from "./release-notes.mjs";

const changelog = `# Changelog

## [0.124.1](https://github.com/mariomile/Kore/compare/v0.124.0...v0.124.1) (2026-11-17)


### Bug Fixes

* **mobile:** stop injecting other notes' tasks above today's daily ([#540](https://github.com/mariomile/Kore/issues/540)) ([10e4023](https://github.com/mariomile/Kore/commit/10e4023bc622b22773bf0e575339b0ab9dbabe7c))

## [0.124.0](https://github.com/mariomile/Kore/compare/v0.123.4...v0.124.0) (2026-11-17)

### Features

* **integrations:** give Granola and Readwise their own settings page ([#528](https://github.com/mariomile/Kore/issues/528)) ([124fd89](https://github.com/mariomile/Kore/commit/124fd89a66b9813acabd0392d6aed2666212920e))
`;

test("the changelog fallback keeps only the version and drops links and hashes", () => {
  expect(changelogSection(changelog, "0.124.1")).toBe(
    "Bug Fixes\n\n* stop injecting other notes' tasks above today's daily",
  );
  expect(changelogSection(changelog, "0.124.0")).toBe(
    "Features\n\n* give Granola and Readwise their own settings page",
  );
  expect(changelogSection(changelog, "9.9.9")).toBe("");
});

test("hand-written notes win over the changelog", () => {
  const dir = mkdtempSync(join(tmpdir(), "kore-notes-"));
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  expect(releaseNotes("0.124.1", { dir })).toContain("stop injecting");

  mkdirSync(join(dir, "release-notes"));
  writeFileSync(
    join(dir, "release-notes", "0.124.1.md"),
    "- Sul daily di oggi niente più task di altre note.\n",
  );
  expect(releaseNotes("0.124.1", { dir })).toBe(
    "- Sul daily di oggi niente più task di altre note.",
  );
});

test("TestFlight gets plain text within the length limit", () => {
  expect(
    plainText(
      "## Novità\n\n- **Impostazioni** come `modale` su [Mac](https://x)\n* Altro",
    ),
  ).toBe("Novità\n\n• Impostazioni come modale su Mac\n• Altro");
  const long = plainText(`- ${"a".repeat(WHATS_NEW_LIMIT + 50)}`);
  expect(long.length).toBe(WHATS_NEW_LIMIT);
});

test("the App Store Connect token is an ES256 JWT the key verifies", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const token = ascToken({
    keyId: "KEY123",
    issuerId: "issuer",
    privateKey: pem,
    now: 1_000_000,
  });
  const [header, payload, signature] = token.split(".");
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
    alg: "ES256",
    kid: "KEY123",
    typ: "JWT",
  });
  expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
    iss: "issuer",
    iat: 1000,
    exp: 2200,
    aud: "appstoreconnect-v1",
  });
  const ok = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  expect(ok).toBe(true);
});

test("the release workflows publish these notes", () => {
  const workflows = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    ".github",
    "workflows",
  );
  const dmg = readFileSync(join(workflows, "release-dmg.yml"), "utf8");
  expect(dmg).toContain("release-notes.mjs print");
  expect(dmg.match(/\$\{\{ env\.RELEASE_NOTES \}\}/g)?.length).toBe(2);
  const testflight = readFileSync(join(workflows, "testflight.yml"), "utf8");
  expect(testflight).toContain("release-notes.mjs testflight --build-number=");
});
