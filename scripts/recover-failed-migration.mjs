// Runs before `prisma migrate deploy` in the build.
//
// A migration that fails on Postgres is rolled back as a whole (it runs as one
// transaction), but Prisma still records it as failed and then refuses every
// later deploy until someone runs `prisma migrate resolve --rolled-back`
// against production by hand. This does that step, for the migrations listed
// below only, so a fixed migration can simply be deployed again.
//
// Only list a migration here once its SQL has been fixed and made safe to
// re-run. Anything not listed is left alone, and deploy will stop as usual.
import { execFileSync } from "node:child_process";
import pg from "pg";

const RETRYABLE = [
  // Failed in production on a duplicate slug (several companies shared a
  // name and an id prefix). Fixed and made idempotent; see its migration.sql.
  "20260925060000_businesses",
];

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[recover-migrations] No DATABASE_URL; nothing to check.");
  process.exit(0);
}

const client = new pg.Client({ connectionString: url });
let failed = [];
try {
  await client.connect();
  const { rows } = await client.query(
    `SELECT migration_name FROM _prisma_migrations
     WHERE finished_at IS NULL AND rolled_back_at IS NULL AND migration_name = ANY($1)`,
    [RETRYABLE]
  );
  failed = rows.map((r) => r.migration_name);
} catch (e) {
  // A brand-new database has no _prisma_migrations table yet: nothing failed.
  console.log(`[recover-migrations] Skipped: ${e.message}`);
} finally {
  await client.end().catch(() => {});
}

for (const name of failed) {
  console.log(`[recover-migrations] ${name} is recorded as failed; marking it rolled back so it can run again.`);
  execFileSync("npx", ["prisma", "migrate", "resolve", "--rolled-back", name], { stdio: "inherit", shell: process.platform === "win32" });
}
if (!failed.length) console.log("[recover-migrations] No failed migrations to recover.");
