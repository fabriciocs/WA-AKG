// Set production mode before importing Next.js or the WA-AKG server modules.
process.env.NODE_ENV = "production";

await import("../src/server/index.ts");
