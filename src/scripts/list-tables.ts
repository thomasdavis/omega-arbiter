/**
 * Script to list all tables in the Postgres database
 * Run with: npx tsx src/scripts/list-tables.ts
 */

import 'dotenv/config';
import { initializeDb, getTables, closeDb } from '../db/index.js';

async function main() {
  console.log('Connecting to database...');

  const initialized = await initializeDb();

  if (!initialized) {
    console.log('Database not configured or connection failed');
    process.exit(1);
  }

  console.log('\n📊 Tables in the Postgres database:\n');

  const tables = await getTables();

  if (tables.length === 0) {
    console.log('No tables found in the public schema.');
  } else {
    console.log('| Table Name | Type |');
    console.log('|------------|------|');
    for (const table of tables) {
      console.log(`| ${table.table_name} | ${table.table_type} |`);
    }
    console.log(`\nTotal: ${tables.length} table(s)`);
  }

  await closeDb();
}

main().catch(console.error);
