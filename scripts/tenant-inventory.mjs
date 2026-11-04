/**
 * Read-only inventory before a tenant migration. Run:
 *   node --env-file=.env scripts/tenant-inventory.mjs
 *
 * Outputs aggregate counts only. No records, credentials or identifiers are
 * emitted, and no database writes or schema changes are executed.
 */
import { PrismaClient } from "@prisma/client";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const prisma = new PrismaClient({ log: [] });
const models = [
  "user", "session", "sessionAccess", "contact", "message", "group",
  "story", "label", "chatLabel", "authState", "autoReply",
  "scheduledMessage", "webhook", "webhookLog", "inboundEvent",
  "processingResult", "broadcastLog", "broadcastRecipient",
  "outboundMessageOperation", "oAuthClient", "oAuthAuthorizationRequest",
  "oAuthAuthorizationCode", "oAuthAccessToken", "oAuthRefreshToken",
  "oAuthGrant", "oAuthGrantSessionCapability", "whatsAppSessionLease",
  "whatsAppSendThrottle", "notification",
];

const queryIssues = [];
const issueCode = (error) => typeof error?.code === "string" && /^P[0-9]{4}$/.test(error.code)
  ? error.code : "QUERY_ERROR";
const countSql = async (statement) => {
  try {
    const rows = await prisma.$queryRawUnsafe(statement);
    return Number(rows[0]?.quantity ?? 0);
  } catch (error) {
    queryIssues.push({
      name: /FROM\s+([A-Za-z]+)/i.exec(statement)?.[1] ?? "sqlAggregate",
      code: issueCode(error),
    });
    return null;
  }
};

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_MISSING");
  }

  const counts = {};
  for (const name of models) {
    if (typeof prisma[name]?.count !== "function") {
      throw new Error("PRISMA_MODEL_MISSING");
    }
    try {
      counts[name] = await prisma[name].count();
    } catch (error) {
      counts[name] = null;
      queryIssues.push({ name, code: issueCode(error) });
    }
  }

  const anomalies = {
    // These checks are aggregates; they never retrieve session credentials.
    authStatesWithoutSession: await countSql(
      "SELECT COUNT(*) AS quantity FROM AuthState a LEFT JOIN Session s ON s.sessionId = a.sessionId WHERE s.id IS NULL"
    ),
    sendLeasesWithoutSession: await countSql(
      "SELECT COUNT(*) AS quantity FROM WhatsAppSessionLease l LEFT JOIN Session s ON s.sessionId = l.sessionId WHERE s.id IS NULL"
    ),
    throttlesWithoutSession: await countSql(
      "SELECT COUNT(*) AS quantity FROM WhatsAppSendThrottle t LEFT JOIN Session s ON s.sessionId = t.sessionId WHERE s.id IS NULL"
    ),
    outboundOperationsWithoutSession: await countSql(
      "SELECT COUNT(*) AS quantity FROM OutboundMessageOperation o LEFT JOIN Session s ON s.id = o.sessionDbId WHERE s.id IS NULL"
    ),
    legacySharesToNonOwners: await countSql(
      "SELECT COUNT(*) AS quantity FROM SessionAccess a INNER JOIN Session s ON s.id = a.sessionId WHERE a.userId <> s.userId"
    ),
  };

  const accountsWithLegacyApiKeys = await prisma.user.count({
    where: { OR: [{ apiKey: { not: null } }, { apiKeyHash: { not: null } }] },
  });
  const sessionsWithoutOwners = await countSql(
    "SELECT COUNT(*) AS quantity FROM Session s LEFT JOIN User u ON u.id = s.userId WHERE u.id IS NULL",
  );

  const mediaPaths = [join(process.cwd(), "data", "media"), join(process.cwd(), "public", "media")];
  const media = {};
  for (const path of mediaPaths) {
    const label = path.includes("public") ? "publicMediaTopLevel" : "dataMediaTopLevel";
    try {
      media[label] = (await readdir(path, { withFileTypes: true })).length;
    } catch (error) {
      if (error?.code === "ENOENT") media[label] = 0;
      else media[label] = null;
    }
  }

  const result = {
    status: queryIssues.length ? "PARTIAL" : "READ_ONLY_INVENTORY",
    createdAt: new Date().toISOString(),
    counts,
    accountsWithLegacyApiKeys,
    sessionsWithoutOwners,
    anomalies,
    queryIssues,
    media,
    warnings: [
      "No tenantId backfill or data modification was attempted.",
      "Legacy session grants are counted, not converted to tenant sharing.",
      "Logical joins and media ownership require a later verified migration.",
    ],
  };
  console.log(JSON.stringify(result, null, 2));
  if (queryIssues.length > 0) process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  // Never print the raw driver error: it may embed connection details.
  console.error(JSON.stringify({
    status: "BLOCKED",
    code: error?.message === "DATABASE_URL_MISSING" ? "DATABASE_URL_MISSING"
      : error?.message === "PRISMA_MODEL_MISSING" ? "PRISMA_MODEL_MISSING"
      : "INVENTORY_QUERY_FAILED",
  }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
