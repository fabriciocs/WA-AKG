import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePrivateMediaReference } from "../private-media";

test("resolves known local media references only inside data/media", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wakg-media-"));
  const mediaRoot = path.join(root, "data", "media");
  fs.mkdirSync(mediaRoot, { recursive: true });
  fs.writeFileSync(path.join(mediaRoot, "session-message.jpg"), "test");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=synthetic-test-value");
  try {
    for (const ref of [
      "/api/media/session-message.jpg",
      "data/media/session-message.jpg",
      "./data/media/session-message.jpg",
      "/data/media/session-message.jpg",
    ]) {
      const result = resolvePrivateMediaReference(ref, root);
      assert.equal(result.kind, "local", ref);
      if (result.kind === "local") {
        assert.equal(result.filename, "session-message.jpg");
        assert.equal(fs.readFileSync(result.filePath, "utf8"), "test");
      }
    }

    for (const ref of [
      "../.env", "./.env", ".env", "/.env",
      "data/media/../../.env",
      "/api/media/..%2F..%2F.env",
      "/api/media/%2e%2e%5c.env",
      "/api/media/%ZZ",
      "C:\\private\\secret.txt",
      "/api/media/session-message.jpg?token=secret",
      "/public/secret.txt",
      "//evil.test/secret.pdf",
      "data/media/missing.jpg",
    ]) {
      assert.deepEqual(resolvePrivateMediaReference(ref, root), { kind: "invalid" }, ref);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("denies symlinked files that escape the private media directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wakg-media-link-"));
  const mediaRoot = path.join(root, "data", "media");
  fs.mkdirSync(mediaRoot, { recursive: true });
  const outside = path.join(root, "outside.jpg");
  const link = path.join(mediaRoot, "linked.jpg");
  fs.writeFileSync(outside, "synthetic");
  try {
    try { fs.symlinkSync(outside, link, "file"); }
    catch { t.skip("Host disallows creation of test symlinks"); return; }
    assert.deepEqual(resolvePrivateMediaReference("data/media/linked.jpg", root), { kind: "invalid" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("external references must be valid credential-free HTTP(S) URLs", () => {
  const secure = resolvePrivateMediaReference("https://cdn.example.test/media.jpg");
  assert.equal(secure.kind, "external");
  const insecure = resolvePrivateMediaReference("http://cdn.example.test/media.jpg");
  assert.equal(insecure.kind, "external");
  assert.deepEqual(resolvePrivateMediaReference("https://user:pass@cdn.example.test/file.jpg"), { kind: "invalid" });
  assert.deepEqual(resolvePrivateMediaReference("file:///C:/private/secret.txt"), { kind: "invalid" });
  assert.deepEqual(resolvePrivateMediaReference("javascript:alert(1)"), { kind: "invalid" });
});
