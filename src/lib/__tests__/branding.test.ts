import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BRAND_DESCRIPTION,
  DEFAULT_BRAND_NAME,
  DEFAULT_BRAND_TAGLINE,
  DEFAULT_FAVICON_URL,
  DEFAULT_LOGO_URL,
  LEGACY_DEFAULT_BOT_NAME,
  brandInitials,
  getDefaultBotName,
  isLegacyBotName,
  isLegacyBrandName,
  resolveBotDisplayName,
  resolveBrandConfig,
} from "../branding";

test("resolves the ConectaFlow fallback contract without configuration", () => {
  assert.deepEqual(resolveBrandConfig(), {
    name: DEFAULT_BRAND_NAME,
    tagline: DEFAULT_BRAND_TAGLINE,
    description: DEFAULT_BRAND_DESCRIPTION,
    logoUrl: DEFAULT_LOGO_URL,
    faviconUrl: DEFAULT_FAVICON_URL,
    initials: "C",
    logoFallback: "C",
  });
});

test("uses SystemConfig for name and assets and environment for copy", () => {
  const result = resolveBrandConfig({
    systemConfig: {
      appName: "  Atendimento Pro  ",
      logoUrl: "/uploads/brand.svg",
      faviconUrl: "https://cdn.example.test/brand.ico",
    },
    environment: {
      APP_TAGLINE: "  Conversas que avançam.  ",
      APP_DESCRIPTION: "  Uma operação mais simples para sua equipe.  ",
    },
  });

  assert.deepEqual(result, {
    name: "Atendimento Pro",
    tagline: "Conversas que avançam.",
    description: "Uma operação mais simples para sua equipe.",
    logoUrl: "/uploads/brand.svg",
    faviconUrl: "https://cdn.example.test/brand.ico",
    initials: "AP",
    logoFallback: "AP",
  });
});

test("falls back safely for blank copy, legacy app name, and unsafe assets", () => {
  const result = resolveBrandConfig({
    systemConfig: {
      appName: " WA-AKG ",
      logoUrl: "javascript:alert(1)",
      faviconUrl: "//untrusted.example.test/favicon.ico",
    },
    environment: { APP_TAGLINE: "   ", APP_DESCRIPTION: "" },
  });

  assert.equal(result.name, DEFAULT_BRAND_NAME);
  assert.equal(result.tagline, DEFAULT_BRAND_TAGLINE);
  assert.equal(result.description, DEFAULT_BRAND_DESCRIPTION);
  assert.equal(result.logoUrl, DEFAULT_LOGO_URL);
  assert.equal(result.faviconUrl, DEFAULT_FAVICON_URL);
  assert.equal(isLegacyBrandName("wa-akg"), true);
  assert.equal(isLegacyBrandName("ConectaFlow"), false);
});

test("generates initials from up to two words and uses a stable fallback", () => {
  assert.equal(brandInitials("Conecta Flow"), "CF");
  assert.equal(brandInitials(" Atendimento Pro "), "AP");
  assert.equal(brandInitials("   "), "C");
  assert.equal(brandInitials("ConectaFlow"), "C");
});

test("translates only the old implicit bot default", () => {
  assert.equal(getDefaultBotName(), "ConectaFlow Bot");
  assert.equal(getDefaultBotName("Atendimento Pro"), "Atendimento Pro Bot");
  assert.equal(resolveBotDisplayName(null), "ConectaFlow Bot");
  assert.equal(resolveBotDisplayName("  "), "ConectaFlow Bot");
  assert.equal(resolveBotDisplayName(LEGACY_DEFAULT_BOT_NAME, "Atendimento Pro"), "Atendimento Pro Bot");
  assert.equal(resolveBotDisplayName("Meu Bot", "Atendimento Pro"), "Meu Bot");
  assert.equal(isLegacyBotName("wa-akg bot"), true);
  assert.equal(isLegacyBotName("Meu Bot"), false);
});
