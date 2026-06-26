import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import type { AgentSpaceState, LedgerItem, MessageAttachment, WorkspaceMessage } from "@agent-space/domain/workspace";
import { getDataDirPath } from "./database.ts";
import { POSTGRES_SCHEMA_VERSION, POSTGRES_TABLE_NAMES, getPostgresSchemaStatements, type PostgresTableName } from "./postgres-schema.ts";
import { redactPostgresDatabaseUrl, resolvePostgresDatabaseUrl, type PostgresConnectionInput } from "./postgres-config.ts";

type DatabaseSync = import("node:sqlite").DatabaseSync;

type JsonColumnName =
  | "human_member_names_json"
  | "employee_names_json"
  | "traits_json"
  | "labels_json"
  | "profile_json"
  | "state_json"
  | "metadata_json"
  | "config_json"
  | "encrypted_credentials_json"
  | "capabilities_json"
  | "scopes_json"
  | "permissions_json"
  | "input_json"
  | "payload_json"
  | "request_json"
  | "result_json"
  | "registry_json"
  | "command_plan_json"
  | "options_json"
  | "snapshot_json"
  | "audit_data_json"
  | "data_json"
  | "source_event_ids_json";

interface TableMigrationPlan {
  tableName: Exclude<PostgresTableName, "app_metadata" | "attachment" | "audit_log">;
  sourceTableName?: string;
  conflictColumns: string[];
  jsonColumns?: JsonColumnName[];
  optionalWhenMissing?: boolean;
  orderBy?: string;
}

export type { PostgresConnectionInput } from "./postgres-config.ts";

export interface PostgresStatus {
  engine: "postgres";
  databaseUrl: string;
  schemaVersion: string;
  tables: Array<{ tableName: PostgresTableName; rowCount: number }>;
}

export interface MigrationTableReport {
  tableName: string;
  sourceCount: number;
  insertedCount: number;
  skippedCount: number;
}

export interface SqliteToPostgresMigrationReport {
  sourceSqlitePath: string;
  targetDatabaseUrl?: string;
  sourceSchemaVersion: string;
  targetSchemaVersion: string;
  dryRun: boolean;
  reset: boolean;
  startedAt: string;
  finishedAt: string;
  warnings: string[];
  tables: MigrationTableReport[];
}

export interface SqliteToPostgresMigrationInput extends PostgresConnectionInput {
  sqlitePath?: string;
  dryRun?: boolean;
  reset?: boolean;
}

export interface PostgresToPostgresMigrationInput {
  sourceDatabaseUrl: string;
  targetDatabaseUrl: string;
  dryRun?: boolean;
  reset?: boolean;
}

export interface PostgresToPostgresMigrationReport {
  sourceDatabaseUrl: string;
  targetDatabaseUrl: string;
  dryRun: boolean;
  reset: boolean;
  startedAt: string;
  finishedAt: string;
  tables: Array<{
    tableName: string;
    sourceCount: number;
    insertedCount: number;
    skippedCount: number;
  }>;
}

type MigrationRow = Record<string, unknown>;

interface TableMigrationSnapshot {
  tableName: string;
  conflictColumns: string[];
  jsonColumns: JsonColumnName[];
  rows: MigrationRow[];
}

interface LegacyWorkspaceRow {
  id: string;
  state_json: string | AgentSpaceState;
  created_at: string;
  updated_at: string;
}

interface DerivedAttachmentRow extends MigrationRow {
  workspace_id: string;
  id: string;
}

interface DerivedAuditLogRow extends MigrationRow {
  id: string;
}

const TABLE_MIGRATION_PLANS: TableMigrationPlan[] = [
  { tableName: "workspace", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "users", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "auth_identity", conflictColumns: ["id"], jsonColumns: ["profile_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "session", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "workspace_membership", conflictColumns: ["id"], orderBy: "joined_at ASC, id ASC" },
  { tableName: "workspace_invitation", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "google_oauth_credential", conflictColumns: ["workspace_id", "user_id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_google_workspace_delegation", conflictColumns: ["workspace_id", "employee_name", "user_id"], orderBy: "created_at ASC, id ASC" },
  {
    tableName: "external_integration",
    conflictColumns: ["id"],
    jsonColumns: ["encrypted_credentials_json", "config_json", "capabilities_json", "scopes_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_user_binding",
    conflictColumns: ["id"],
    jsonColumns: ["metadata_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_channel_binding",
    conflictColumns: ["id"],
    jsonColumns: ["metadata_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_resource_binding",
    conflictColumns: ["id"],
    jsonColumns: ["permissions_json", "metadata_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_message_mapping",
    conflictColumns: ["id"],
    jsonColumns: ["metadata_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_message_outbox",
    conflictColumns: ["id"],
    jsonColumns: ["payload_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_data_operation_run",
    conflictColumns: ["id"],
    jsonColumns: ["request_json", "result_json"],
    optionalWhenMissing: true,
    orderBy: "created_at ASC, id ASC",
  },
  {
    tableName: "external_integration_event",
    conflictColumns: ["id"],
    jsonColumns: ["payload_json"],
    optionalWhenMissing: true,
    orderBy: "received_at ASC, id ASC",
  },
  {
    tableName: "workspace_snapshot",
    sourceTableName: "legacy_workspace",
    conflictColumns: ["id"],
    jsonColumns: ["state_json"],
    orderBy: "created_at ASC, id ASC",
  },
  { tableName: "workspace_channel", conflictColumns: ["id"], jsonColumns: ["human_member_names_json", "employee_names_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "channel_participant", conflictColumns: ["workspace_id", "channel_name", "user_id"], orderBy: "joined_at ASC, id ASC" },
  { tableName: "channel_access_request", conflictColumns: ["id"], orderBy: "requested_at ASC, id ASC" },
  { tableName: "channel_invitation", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "workspace_employee", conflictColumns: ["workspace_id", "name"], jsonColumns: ["traits_json"], orderBy: "created_at ASC, workspace_id ASC, name ASC" },
  { tableName: "agent_fork_invitation", conflictColumns: ["id"], jsonColumns: ["options_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_fork_snapshot", conflictColumns: ["id"], jsonColumns: ["snapshot_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "workspace_task", conflictColumns: ["id"], jsonColumns: ["labels_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "daemon_connection", conflictColumns: ["id"], jsonColumns: ["metadata_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "daemon_api_token", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_runtime", conflictColumns: ["id"], jsonColumns: ["metadata_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "workspace_runtime_display_name", conflictColumns: ["workspace_id", "runtime_id"], orderBy: "created_at ASC, workspace_id ASC, runtime_id ASC" },
  { tableName: "workspace_runtime_grant", conflictColumns: ["workspace_id", "runtime_id", "user_id", "permission"], orderBy: "created_at ASC, id ASC" },
  { tableName: "document_agent_access", conflictColumns: ["workspace_id", "document_id", "subject_type", "subject_id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "document_permission_request", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_access_request", conflictColumns: ["id"], jsonColumns: ["audit_data_json"], optionalWhenMissing: true, orderBy: "created_at ASC, id ASC" },
  { tableName: "workspace_notification", conflictColumns: ["id"], jsonColumns: ["metadata_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "employee_runtime_binding", conflictColumns: ["workspace_id", "employee_name"], orderBy: "created_at ASC, workspace_id ASC, employee_name ASC" },
  { tableName: "runtime_app_catalog_item", conflictColumns: ["source", "name"], jsonColumns: ["registry_json"], orderBy: "synced_at ASC, source ASC, name ASC" },
  { tableName: "runtime_installed_app", conflictColumns: ["id"], jsonColumns: ["metadata_json"], orderBy: "updated_at ASC, id ASC" },
  { tableName: "runtime_app_operation", conflictColumns: ["id"], jsonColumns: ["command_plan_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "skill", conflictColumns: ["id"], jsonColumns: ["config_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "skill_file", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "runtime_app_skill_binding", conflictColumns: ["workspace_id", "runtime_app_id", "skill_id"], orderBy: "created_at ASC, workspace_id ASC, runtime_app_id ASC, skill_id ASC" },
  { tableName: "skill_import_event", conflictColumns: ["id"], jsonColumns: ["metadata_json"], orderBy: "imported_at ASC, id ASC" },
  { tableName: "agent_skill", conflictColumns: ["workspace_id", "employee_name", "skill_id"], orderBy: "created_at ASC, workspace_id ASC, employee_name ASC, skill_id ASC" },
  { tableName: "knowledge_page_assignment_policy", conflictColumns: ["workspace_id", "knowledge_page_id"], orderBy: "updated_at ASC, workspace_id ASC, knowledge_page_id ASC" },
  { tableName: "agent_knowledge_page", conflictColumns: ["workspace_id", "employee_name", "knowledge_page_id"], orderBy: "created_at ASC, workspace_id ASC, employee_name ASC, knowledge_page_id ASC" },
  { tableName: "agent_router_session", conflictColumns: ["id"], optionalWhenMissing: true, orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_router_provider_session", conflictColumns: ["id"], jsonColumns: ["metadata_json"], optionalWhenMissing: true, orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_task_queue", conflictColumns: ["id"], jsonColumns: ["input_json", "result_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_task_attempt", conflictColumns: ["id"], jsonColumns: ["metadata_json"], optionalWhenMissing: true, orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_router_event", conflictColumns: ["id"], jsonColumns: ["data_json"], optionalWhenMissing: true, orderBy: "created_at ASC, id ASC" },
  { tableName: "agent_router_context_snapshot", conflictColumns: ["id"], jsonColumns: ["source_event_ids_json"], optionalWhenMissing: true, orderBy: "created_at ASC, id ASC" },
  { tableName: "task_execution_event", conflictColumns: ["id"], jsonColumns: ["data_json"], orderBy: "created_at ASC, id ASC" },
  { tableName: "task_message", conflictColumns: ["id"], jsonColumns: ["input_json"], orderBy: "created_at ASC, task_id ASC, seq ASC" },
  { tableName: "model_pricing", conflictColumns: ["model_id"], orderBy: "model_id ASC" },
  { tableName: "token_usage", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
  { tableName: "budget", conflictColumns: ["id"], orderBy: "created_at ASC, id ASC" },
];

export { redactPostgresDatabaseUrl, resolvePostgresDatabaseUrl };

export async function ensurePostgresSchema(input?: PostgresConnectionInput): Promise<PostgresStatus> {
  const databaseUrl = resolvePostgresDatabaseUrl(input);
  const client = createPostgresClient(databaseUrl);

  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of getPostgresSchemaStatements()) {
      await client.query(statement);
    }
    await client.query("COMMIT");
    return await readPostgresStatusWithClient(client, databaseUrl);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export async function getPostgresStatus(input?: PostgresConnectionInput): Promise<PostgresStatus> {
  const databaseUrl = resolvePostgresDatabaseUrl(input);
  const client = createPostgresClient(databaseUrl);
  await client.connect();
  try {
    return await readPostgresStatusWithClient(client, databaseUrl);
  } finally {
    await client.end();
  }
}

export async function migrateSqliteToPostgres(
  input?: SqliteToPostgresMigrationInput,
): Promise<SqliteToPostgresMigrationReport> {
  const startedAt = new Date().toISOString();
  const sqlitePath = input?.sqlitePath?.trim() || getDefaultSqliteMigrationPath();
  const dryRun = input?.dryRun === true;
  const reset = input?.reset === true;

  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite source database does not exist: ${sqlitePath}`);
  }

  const sourceDb = await openSqliteDatabase(sqlitePath);
  try {
    const snapshot = collectSqliteMigrationSnapshotSync(sourceDb, startedAt);
    const report: SqliteToPostgresMigrationReport = {
      sourceSqlitePath: sqlitePath,
      targetDatabaseUrl: input?.databaseUrl ? redactPostgresDatabaseUrl(input.databaseUrl) : undefined,
      sourceSchemaVersion: readSqliteSchemaVersionSync(sourceDb),
      targetSchemaVersion: POSTGRES_SCHEMA_VERSION,
      dryRun,
      reset,
      startedAt,
      finishedAt: startedAt,
      warnings: [...snapshot.warnings],
      tables: snapshot.tables.map((table) => ({
        tableName: table.tableName,
        sourceCount: table.rows.length,
        insertedCount: 0,
        skippedCount: table.rows.length,
      })),
    };

    if (dryRun && !input?.databaseUrl && !(input?.env?.AGENT_SPACE_PG_URL || input?.env?.DATABASE_URL)) {
      report.finishedAt = new Date().toISOString();
      return report;
    }

    const databaseUrl = resolvePostgresDatabaseUrl(input);
    report.targetDatabaseUrl = redactPostgresDatabaseUrl(databaseUrl);
    const client = createPostgresClient(databaseUrl);
    await client.connect();
    try {
      await client.query("BEGIN");
      for (const statement of getPostgresSchemaStatements()) {
        await client.query(statement);
      }
      if (reset) {
        await truncatePostgresTables(client);
        await client.query(
          `INSERT INTO app_metadata (key, value)
           VALUES ('schema_version', $1)
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [POSTGRES_SCHEMA_VERSION],
        );
      }

      if (!dryRun) {
        for (const [index, table] of snapshot.tables.entries()) {
          const insertedCount = await migrateTableRows(client, table);
          report.tables[index] = {
            tableName: table.tableName,
            sourceCount: table.rows.length,
            insertedCount,
            skippedCount: Math.max(table.rows.length - insertedCount, 0),
          };
        }

        await client.query(
          `INSERT INTO app_metadata (key, value)
           VALUES ('migrated_from_sqlite_at', $1)
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [new Date().toISOString()],
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }

    report.finishedAt = new Date().toISOString();
    if (dryRun) {
      report.tables = report.tables.map((table) => ({
        ...table,
        insertedCount: table.sourceCount,
        skippedCount: 0,
      }));
    }
    return report;
  } finally {
    sourceDb.close();
  }
}

export async function migratePostgresToPostgres(
  input: PostgresToPostgresMigrationInput,
): Promise<PostgresToPostgresMigrationReport> {
  const startedAt = new Date().toISOString();
  const sourceDatabaseUrl = input.sourceDatabaseUrl.trim();
  const targetDatabaseUrl = input.targetDatabaseUrl.trim();
  if (!sourceDatabaseUrl) {
    throw new Error("Missing source PostgreSQL database URL.");
  }
  if (!targetDatabaseUrl) {
    throw new Error("Missing target PostgreSQL database URL.");
  }
  if (sourceDatabaseUrl === targetDatabaseUrl) {
    throw new Error("Source and target PostgreSQL database URLs must be different.");
  }

  const sourceClient = createPostgresClient(sourceDatabaseUrl);
  const targetClient = createPostgresClient(targetDatabaseUrl);
  await sourceClient.connect();
  await targetClient.connect();
  try {
    const snapshot = await collectPostgresMigrationSnapshot(sourceClient);
    const report: PostgresToPostgresMigrationReport = {
      sourceDatabaseUrl: redactPostgresDatabaseUrl(sourceDatabaseUrl),
      targetDatabaseUrl: redactPostgresDatabaseUrl(targetDatabaseUrl),
      dryRun: input.dryRun === true,
      reset: input.reset === true,
      startedAt,
      finishedAt: startedAt,
      tables: snapshot.map((table) => ({
        tableName: table.tableName,
        sourceCount: table.rows.length,
        insertedCount: input.dryRun ? table.rows.length : 0,
        skippedCount: input.dryRun ? 0 : table.rows.length,
      })),
    };

    if (input.dryRun) {
      report.finishedAt = new Date().toISOString();
      return report;
    }

    await targetClient.query("BEGIN");
    try {
      for (const statement of getPostgresSchemaStatements()) {
        await targetClient.query(statement);
      }
      if (input.reset) {
        await truncatePostgresTables(targetClient);
        await targetClient.query(
          `INSERT INTO app_metadata (key, value)
           VALUES ('schema_version', $1)
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [POSTGRES_SCHEMA_VERSION],
        );
      }
      for (const [index, table] of snapshot.entries()) {
        const insertedCount = await migrateTableRows(targetClient, table);
        report.tables[index] = {
          tableName: table.tableName,
          sourceCount: table.rows.length,
          insertedCount,
          skippedCount: Math.max(table.rows.length - insertedCount, 0),
        };
      }
      await targetClient.query(
        `INSERT INTO app_metadata (key, value)
         VALUES ('migrated_from_postgres_at', $1)
         ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
        [new Date().toISOString()],
      );
      await targetClient.query("COMMIT");
    } catch (error) {
      await targetClient.query("ROLLBACK");
      throw error;
    }

    report.finishedAt = new Date().toISOString();
    return report;
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

export function collectSqliteMigrationSnapshotSync(
  sourceDb: DatabaseSync,
  fallbackTimestamp = new Date().toISOString(),
): {
  tables: TableMigrationSnapshot[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const tables: TableMigrationSnapshot[] = TABLE_MIGRATION_PLANS.map((plan) => ({
    tableName: plan.tableName,
    conflictColumns: [...plan.conflictColumns],
    jsonColumns: [...(plan.jsonColumns ?? [])],
    rows: readSqliteTableRowsSync(sourceDb, plan, warnings),
  }));

  const workspaceSnapshots = tables.find((table) => table.tableName === "workspace_snapshot")?.rows as LegacyWorkspaceRow[] | undefined;
  const derivedAttachments = workspaceSnapshots
    ? extractAttachmentRowsFromLegacyWorkspaces(workspaceSnapshots, warnings, fallbackTimestamp)
    : [];
  const derivedAuditLogs = workspaceSnapshots
    ? extractAuditLogRowsFromLegacyWorkspaces(workspaceSnapshots, warnings, fallbackTimestamp)
    : [];

  tables.push({
    tableName: "attachment",
    conflictColumns: ["workspace_id", "id"],
    jsonColumns: [],
    rows: derivedAttachments,
  });
  tables.push({
    tableName: "audit_log",
    conflictColumns: ["id"],
    jsonColumns: ["data_json"],
    rows: derivedAuditLogs,
  });

  return { tables, warnings };
}

export function renderPostgresCutoverPlan(): string {
  return [
    "# PostgreSQL Cutover Plan",
    "",
    "1. Prepare the target database",
    "   - Start PostgreSQL locally or in test using deploy/postgres/docker-compose.yml",
    "   - Run `npm run db:pg:init -- --database-url <postgres-url>`",
    "",
    "2. Rehearse migration in dry-run mode",
    "   - Run `npm run db:pg:migrate -- --dry-run --sqlite-path <sqlite-path> --database-url <postgres-url> --json`",
    "   - Confirm source counts and derived attachment / audit_log counts look correct",
    "",
    "3. Rehearse a full import into a disposable target",
    "   - Run `npm run db:pg:migrate -- --reset --sqlite-path <sqlite-path> --database-url <postgres-url> --json`",
    "   - Run `npm run db:pg:status -- --database-url <postgres-url> --json`",
    "",
    "4. Production cutover window",
    "   - Freeze writes to the SQLite-backed app",
    "   - Snapshot `data/agent-space.sqlite` and `data/workspaces/`",
    "   - Run the PostgreSQL migration with `--reset` against the production target",
    "   - Verify row counts and critical paths: login, workspace access, tasks, skills, attachments",
    "",
    "5. Rollback",
    "   - If verification fails, keep PostgreSQL frozen",
    "   - Restore the SQLite snapshot and revert traffic to the SQLite-backed deployment",
    "   - Investigate with the JSON migration report before the next rehearsal",
  ].join("\n");
}

function createPostgresClient(databaseUrl: string): Client {
  return new Client({
    connectionString: databaseUrl,
    ssl: shouldUsePostgresSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
}

async function readPostgresStatusWithClient(client: Client, databaseUrl: string): Promise<PostgresStatus> {
  const appMetadataExists = await client.query<{ exists: string | null }>(
    `SELECT to_regclass('public.app_metadata') AS exists`,
  );
  const hasSchema = Boolean(appMetadataExists.rows[0]?.exists);
  if (!hasSchema) {
    return {
      engine: "postgres",
      databaseUrl: redactPostgresDatabaseUrl(databaseUrl),
      schemaVersion: "uninitialized",
      tables: POSTGRES_TABLE_NAMES.map((tableName) => ({ tableName, rowCount: 0 })),
    };
  }

  const schemaVersionResult = await client.query<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = 'schema_version' LIMIT 1",
  );
  const tables: Array<{ tableName: PostgresTableName; rowCount: number }> = [];
  for (const tableName of POSTGRES_TABLE_NAMES) {
    const countResult = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${tableName}`);
    tables.push({
      tableName,
      rowCount: Number(countResult.rows[0]?.count ?? "0"),
    });
  }

  return {
    engine: "postgres",
    databaseUrl: redactPostgresDatabaseUrl(databaseUrl),
    schemaVersion: schemaVersionResult.rows[0]?.value ?? "unknown",
    tables,
  };
}

function shouldUsePostgresSsl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const sslMode = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
    return sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full";
  } catch {
    return false;
  }
}

async function truncatePostgresTables(client: Client): Promise<void> {
  await client.query(`TRUNCATE TABLE ${[...POSTGRES_TABLE_NAMES].reverse().join(", ")} CASCADE`);
}

async function migrateTableRows(client: Client, table: TableMigrationSnapshot): Promise<number> {
  let insertedCount = 0;
  for (const row of table.rows) {
    if (Object.keys(row).length === 0) {
      continue;
    }

    const columns = Object.keys(row);
    const values = columns.map((column) => normalizePostgresValue(column as JsonColumnName | string, row[column]));
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const updateColumns = columns.filter((column) => !table.conflictColumns.includes(column));
    const queryText =
      updateColumns.length > 0
        ? `INSERT INTO ${table.tableName} (${columns.join(", ")})
           VALUES (${placeholders})
           ON CONFLICT (${table.conflictColumns.join(", ")}) DO UPDATE SET
           ${updateColumns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`
        : `INSERT INTO ${table.tableName} (${columns.join(", ")})
           VALUES (${placeholders})
           ON CONFLICT (${table.conflictColumns.join(", ")}) DO NOTHING`;

    await client.query(queryText, values);
    insertedCount += 1;
  }
  return insertedCount;
}

function readSqliteTableRowsSync(
  sourceDb: DatabaseSync,
  plan: TableMigrationPlan,
  warnings: string[],
): MigrationRow[] {
  const sourceTableName = plan.sourceTableName ?? plan.tableName;
  if (!sqliteTableExists(sourceDb, sourceTableName)) {
    if (!plan.optionalWhenMissing) {
      warnings.push(`SQLite source table "${sourceTableName}" does not exist and was skipped.`);
    }
    return [];
  }

  const rows = sourceDb.prepare(
    `SELECT * FROM ${sourceTableName}${plan.orderBy ? ` ORDER BY ${plan.orderBy}` : ""}`,
  ).all() as MigrationRow[];

  return rows.map((row) => normalizeSqliteRow(row, plan.jsonColumns ?? []));
}

async function collectPostgresMigrationSnapshot(client: Client): Promise<TableMigrationSnapshot[]> {
  const tables: TableMigrationSnapshot[] = [];
  for (const tableName of POSTGRES_TABLE_NAMES) {
    if (tableName === "app_metadata") {
      tables.push({
        tableName,
        conflictColumns: ["key"],
        jsonColumns: [],
        rows: await readPostgresTableRows(client, tableName),
      });
      continue;
    }
    if (tableName === "attachment") {
      tables.push({
        tableName,
        conflictColumns: ["workspace_id", "id"],
        jsonColumns: [],
        rows: await readPostgresTableRows(client, tableName),
      });
      continue;
    }
    if (tableName === "audit_log") {
      tables.push({
        tableName,
        conflictColumns: ["id"],
        jsonColumns: ["data_json"],
        rows: await readPostgresTableRows(client, tableName),
      });
      continue;
    }

    const plan = TABLE_MIGRATION_PLANS.find((candidate) => candidate.tableName === tableName);
    if (!plan) {
      continue;
    }
    tables.push({
      tableName,
      conflictColumns: [...plan.conflictColumns],
      jsonColumns: [...(plan.jsonColumns ?? [])],
      rows: await readPostgresTableRows(client, tableName),
    });
  }
  return tables;
}

async function readPostgresTableRows(client: Client, tableName: PostgresTableName): Promise<MigrationRow[]> {
  const result = await client.query(`SELECT * FROM ${tableName}`);
  return result.rows.map((row) => {
    const next: MigrationRow = {};
    for (const [key, value] of Object.entries(row)) {
      next[camelToSnakeCase(key)] = value instanceof Date ? value.toISOString() : value;
    }
    return next;
  });
}

function camelToSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function sqliteTableExists(sourceDb: DatabaseSync, tableName: string): boolean {
  const row = sourceDb.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function normalizeSqliteRow(row: MigrationRow, jsonColumns: JsonColumnName[]): MigrationRow {
  const next: MigrationRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) {
      continue;
    }

    if (jsonColumns.includes(key as JsonColumnName)) {
      next[key] = parseJsonLikeValue(value);
      continue;
    }

    next[key] = value;
  }
  return next;
}

function parseJsonLikeValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return trimmed;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return value;
}

function normalizePostgresValue(_column: string, value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return value;
}

function extractAttachmentRowsFromLegacyWorkspaces(
  workspaces: LegacyWorkspaceRow[],
  warnings: string[],
  fallbackTimestamp: string,
): DerivedAttachmentRow[] {
  const rows: DerivedAttachmentRow[] = [];

  for (const workspace of workspaces) {
    const state = readLegacyWorkspaceStateJson(workspace, warnings);
    if (!state) {
      continue;
    }

    for (const [messageIndex, message] of state.messages.entries()) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.deletedAt) {
          continue;
        }
        rows.push(buildAttachmentRow(workspace, message, attachment, messageIndex, fallbackTimestamp));
      }
    }
  }

  return rows;
}

function extractAuditLogRowsFromLegacyWorkspaces(
  workspaces: LegacyWorkspaceRow[],
  warnings: string[],
  fallbackTimestamp: string,
): DerivedAuditLogRow[] {
  const rows: DerivedAuditLogRow[] = [];

  for (const workspace of workspaces) {
    const state = readLegacyWorkspaceStateJson(workspace, warnings);
    if (!state) {
      continue;
    }

    for (const [index, entry] of state.ledger.entries()) {
      rows.push({
        id: `audit-${workspace.id}-${index + 1}`,
        workspace_id: workspace.id,
        title: entry.title,
        note: entry.note,
        code: entry.code ?? null,
        data_json: entry.data ?? {},
        source: "workspace_snapshot_ledger",
        source_index: index,
        created_at: workspace.updated_at || workspace.created_at || fallbackTimestamp,
      });
    }
  }

  return rows;
}

function buildAttachmentRow(
  workspace: LegacyWorkspaceRow,
  message: WorkspaceMessage,
  attachment: MessageAttachment,
  messageIndex: number,
  fallbackTimestamp: string,
): DerivedAttachmentRow {
  return {
    workspace_id: workspace.id,
    id: attachment.id,
    message_id: message.id,
    channel_name: message.channel ?? null,
    speaker: message.speaker,
    role: message.role,
    file_name: attachment.fileName,
    media_type: attachment.mediaType,
    kind: attachment.kind,
    size_bytes: attachment.sizeBytes,
    stored_path: attachment.storedPath,
    storage_provider: attachment.storageProvider ?? "local",
    storage_bucket: attachment.storageBucket ?? null,
    storage_region: attachment.storageRegion ?? null,
    storage_endpoint: attachment.storageEndpoint ?? null,
    storage_key: attachment.storageKey ?? null,
    storage_url: attachment.storageUrl ?? null,
    sha256: attachment.sha256 ?? null,
    source_message_time: message.time,
    source_message_index: messageIndex,
    source_summary: message.summary,
    created_at: workspace.updated_at || workspace.created_at || fallbackTimestamp,
  };
}

function readLegacyWorkspaceStateJson(
  workspace: LegacyWorkspaceRow,
  warnings: string[],
): AgentSpaceState | null {
  if (workspace.state_json && typeof workspace.state_json === "object") {
    return workspace.state_json as AgentSpaceState;
  }

  try {
    return JSON.parse(workspace.state_json) as AgentSpaceState;
  } catch (error) {
    warnings.push(
      `Could not parse migrated workspace snapshot JSON for workspace "${workspace.id}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function readSqliteSchemaVersionSync(sourceDb: DatabaseSync): string {
  if (!sqliteTableExists(sourceDb, "app_metadata")) {
    return "unknown";
  }

  const row = sourceDb.prepare(
    "SELECT value FROM app_metadata WHERE key = 'schema_version' LIMIT 1",
  ).get() as { value?: string } | undefined;
  return row?.value ?? "unknown";
}

async function openSqliteDatabase(sqlitePath: string): Promise<DatabaseSync> {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(sqlitePath);
}

export function getDefaultSqliteMigrationPath(): string {
  return join(getDataDirPath(), "agent-space.sqlite");
}
