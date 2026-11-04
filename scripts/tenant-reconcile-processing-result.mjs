import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const historicalMigration = "20261031000000_inbound_event_receipts";
const sql = await readFile(
  new URL(`../prisma/migrations/${historicalMigration}/migration.sql`, import.meta.url),
  "utf8",
);
const createResultTable = sql.match(/CREATE TABLE `ProcessingResult` \([\s\S]+?;/)?.[0];
const foreignKeys = [
  ["ProcessingResult", "ProcessingResult_sessionId_fkey", "sessionId", "Session", "id", "CASCADE"],
  ["ProcessingResult", "ProcessingResult_messageId_fkey", "messageId", "Message", "id", "SET NULL"],
  ["InboundEvent", "InboundEvent_resultId_fkey", "resultId", "ProcessingResult", "resultId", "SET NULL"],
];

function databaseName() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.protocol !== "mysql:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)) {
    throw new Error("LOOPBACK_MYSQL_REQUIRED");
  }
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error("DATABASE_NAME_INVALID");
  const [option, ...extra] = process.argv.slice(2);
  if (extra.length || (option && option !== `--apply=${name}`)) {
    throw new Error("EXACT_DATABASE_NAME_REQUIRED");
  }
  return { name, apply: Boolean(option) };
}

async function inspect(prisma) {
  const [journal] = await prisma.$queryRaw`
    SELECT COUNT(*) AS quantity FROM _prisma_migrations
    WHERE migration_name = ${historicalMigration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  if (Number(journal.quantity) !== 1) throw new Error("RECEIPT_MIGRATION_NOT_RECORDED");
  const table = await prisma.$queryRaw`
    SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'processingresult'
  `;
  const keyRows = await prisma.$queryRaw`
    SELECT k.CONSTRAINT_NAME AS name, k.TABLE_NAME AS tableName, k.COLUMN_NAME AS source,
           k.REFERENCED_TABLE_NAME AS target, k.REFERENCED_COLUMN_NAME AS field,
           r.DELETE_RULE AS deletion, r.UPDATE_RULE AS onUpdate,
           k.REFERENCED_TABLE_SCHEMA = DATABASE() AS sameSchema
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME
      AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA = DATABASE() AND LOWER(k.TABLE_NAME) IN ('processingresult', 'inboundevent')
  `;
  const present = table.length > 0;
  if (present) {
    const expected = [...createResultTable.matchAll(/^\s+`([^\x60]+)` /gm)].map((m) => m[1]);
    if (!expected.every((name) => table.some((column) => column.name === name))) {
      throw new Error("PROCESSING_RESULT_UNEXPECTED_COLUMNS");
    }
  } else {
    const [links] = await prisma.$queryRaw`SELECT COUNT(*) AS quantity FROM InboundEvent WHERE resultId IS NOT NULL`;
    if (Number(links.quantity) > 0) throw new Error("RESTORE_PROCESSING_RESULTS_FROM_BACKUP");
  }
  const missingKeys = foreignKeys.filter(([tableName, name, source, target, field, deletion]) => {
    const related = keyRows.filter((key) =>
      key.tableName.toLowerCase() === tableName.toLowerCase() && key.source === source);
    if (!related.length) return true;
    const [key] = related;
    if (related.length !== 1 || key.name !== name || key.target.toLowerCase() !== target.toLowerCase()
      || key.field !== field || key.deletion !== deletion || key.onUpdate !== "CASCADE" || !Number(key.sameSchema)) {
      throw new Error("UNEXPECTED_FOREIGN_KEY");
    }
    return false;
  });
  return { present, missingKeys };
}

let prisma;
try {
  if (!createResultTable) throw new Error("HISTORICAL_SQL_UNEXPECTED");
  const target = databaseName();
  prisma = new PrismaClient();
  const plan = await inspect(prisma);
  if (target.apply) {
    // MySQL DDL implicitly commits. Run during a maintenance window with a verified backup.
    // Keep the operations individually repeatable in case a later ALTER fails.
    if (!plan.present) await prisma.$executeRawUnsafe(createResultTable);
    for (const [table, name, source, targetTable, field, deletion] of plan.missingKeys) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (\`${source}\`) ` +
        `REFERENCES \`${targetTable}\`(\`${field}\`) ON DELETE ${deletion} ON UPDATE CASCADE`,
      );
    }
    const result = await inspect(prisma);
    if (!result.present || result.missingKeys.length) throw new Error("REPAIR_POSTCHECK_FAILED");
  }
  console.log(JSON.stringify({
    status: target.apply ? "RECONCILED" : "READ_ONLY_PLAN",
    database: target.name,
    createTable: !plan.present,
    missingForeignKeys: plan.missingKeys.map(([, name]) => name),
  }));
} catch (error) {
  // Prisma and URL errors can include the connection string. Emit only known safe labels.
  const known = typeof error.message === "string" && /^[A-Z_]+$/.test(error.message);
  console.error(JSON.stringify({ status: "BLOCKED", reason: known ? error.message : error.code ?? "REPAIR_FAILED" }));
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}
