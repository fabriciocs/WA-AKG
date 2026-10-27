import test from "node:test";
import assert from "node:assert/strict";
import { clientBasePath, normalizeBasePath, requestBasePath, requestPublicOrigin, withBasePath, withoutBasePath } from "../base-path";

test("normalizes the reverse-proxy prefix and applies it exactly once", () => {
  assert.equal(normalizeBasePath("/wa-akg/"), "/wa-akg");
  assert.equal(requestBasePath(new Headers({ "x-forwarded-prefix": "/wa-akg/" })), "/wa-akg");
  assert.equal(withBasePath("/dashboard/sessions?tab=all", "/wa-akg"), "/wa-akg/dashboard/sessions?tab=all");
  assert.equal(withBasePath("/wa-akg/dashboard", "/wa-akg"), "/wa-akg/dashboard");
  assert.equal(withBasePath("/dashboard", ""), "/dashboard");
  assert.equal(normalizeBasePath("/../outside"), "");
});

test("uses forwarded public scheme and host for redirects behind the proxy", () => {
  const headers = new Headers({
    "x-forwarded-host": "gauntlet-fruit-discount.ngrok-free.dev",
    "x-forwarded-proto": "https",
  });
  assert.equal(requestPublicOrigin(headers, "http://127.0.0.1:43000"), "https://gauntlet-fruit-discount.ngrok-free.dev");
  assert.equal(requestPublicOrigin(new Headers(), "http://localhost:43000"), "http://localhost:43000");
});

test("strips only the configured prefix while preserving the route", () => {
  assert.equal(withoutBasePath("/wa-akg/dashboard/chat/123", "/wa-akg"), "/dashboard/chat/123");
  assert.equal(withoutBasePath("/wa-akg", "/wa-akg"), "/");
  assert.equal(withoutBasePath("/dashboard", "/wa-akg"), "/dashboard");
});

test("reads the runtime prefix rendered on the document", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { dataset: { basePath: "/wa-akg/" } } },
  });
  try {
    assert.equal(clientBasePath(), "/wa-akg");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "document", descriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
