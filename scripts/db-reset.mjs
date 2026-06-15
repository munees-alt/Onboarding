// DANGER: drops and recreates the public schema (wipes all public tables).
// auth/storage schemas are untouched. Guarded by CONFIRM_RESET=yes.
// Run: CONFIRM_RESET=yes node --env-file=.env.local scripts/db-reset.mjs
import pg from "pg";

if (process.env.CONFIRM_RESET !== "yes") {
  console.error("Refusing to reset. Set CONFIRM_RESET=yes to proceed.");
  process.exit(1);
}

const c = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
console.log("Connected. Resetting public schema...");

await c.query(`
  drop schema if exists public cascade;
  create schema public;
  grant usage on schema public to postgres, anon, authenticated, service_role;
  grant all on schema public to postgres, service_role;
  alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
`);

console.log("✓ public schema reset.");
await c.end();
