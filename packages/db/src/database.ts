import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from "node:worker_threads";
import { getPostgresSchemaStatements, POSTGRES_SCHEMA_VERSION } from "./postgres-schema.ts";
import { redactPostgresDatabaseUrl, resolvePostgresDatabaseUrl } from "./postgres-config.ts";

const DATA_DIR = "data";
export const DEFAULT_WORKSPACE_ID = "default";

const WORKER_REQUEST_TIMEOUT_MS = resolveWorkerRequestTimeoutMs();
const WORKER_WAIT_SLICE_MS = 50;
const POSTGRES_SCHEMA_LOCK_TIMEOUT_MS = resolveSchemaLockTimeoutMs();
const POSTGRES_SCHEMA_LOCK_RETRY_MS = 100;
const WORKER_SIGNAL_BUFFER = new SharedArrayBuffer(4);
const WORKER_SIGNAL = new Int32Array(WORKER_SIGNAL_BUFFER);
const POSTGRES_SYNC_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { Client, types } = require(workerData.pgModulePath);
const responseSignal = new Int32Array(workerData.responseSignalBuffer);

types.setTypeParser(types.builtins.JSON, (value) => value);
types.setTypeParser(types.builtins.JSONB, (value) => value);
types.setTypeParser(types.builtins.DATE, (value) => value);
types.setTypeParser(types.builtins.TIMESTAMP, normalizeTimestampValue);
types.setTypeParser(types.builtins.TIMESTAMPTZ, normalizeTimestampValue);
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

let port = null;
let client = null;
let connectedDatabaseUrl = null;

function normalizeTimestampValue(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

parentPort?.on("message", (message) => {
  if (!isPortMessage(message)) {
    return;
  }

  port = message.port;
  port.on("message", (request) => {
    void handleRequest(request);
  });
  port.start();
});

async function handleRequest(message) {
  if (!port || !isWorkerRequest(message)) {
    return;
  }

  const request = message;
  const response = {
    requestId: request.requestId,
    ok: true,
  };

  try {
    if (request.action === "close") {
      await closeClient();
      response.value = { closed: true };
    } else if (request.action === "exec") {
      const db = await ensureClient(request.databaseUrl);
      await db.query(normalizeExecSql(request.sql));
      response.value = { rowCount: 0, rows: [] };
    } else {
      const db = await ensureClient(request.databaseUrl);
      const result = await db.query(request.sql, request.params);
      response.value = {
        rowCount: result.rowCount ?? 0,
        rows: normalizeRows(result.rows),
      };
    }
  } catch (error) {
    response.ok = false;
    response.error = serializeError(error);
  }

  postResponse(response);
}

function postResponse(response) {
  port.postMessage(response);
  Atomics.add(responseSignal, 0, 1);
  Atomics.notify(responseSignal, 0, 1);
}

async function ensureClient(databaseUrl) {
  if (client && connectedDatabaseUrl === databaseUrl) {
    return client;
  }

  await closeClient();
  client = new Client({
    connectionString: databaseUrl,
  });
  await client.connect();
  connectedDatabaseUrl = databaseUrl;
  return client;
}

async function closeClient() {
  if (!client) {
    connectedDatabaseUrl = null;
    return;
  }

  const activeClient = client;
  client = null;
  connectedDatabaseUrl = null;
  await activeClient.end();
}

function normalizeExecSql(sql) {
  const trimmed = sql.trim();
  if (/^BEGIN\\s+IMMEDIATE$/i.test(trimmed)) {
    return "BEGIN";
  }
  return sql;
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function isPortMessage(value) {
  return typeof value === "object" && value !== null && "port" in value;
}

function isWorkerRequest(value) {
  if (typeof value !== "object" || value === null || !("requestId" in value) || !("action" in value)) {
    return false;
  }

  return typeof value.requestId === "string"
    && (value.action === "exec" || value.action === "query" || value.action === "close");
}

const NORMALIZED_ROW_KEY_ALIASES = new Map([
  ["acceptedat", "acceptedAt"],
  ["acceptedagentname", "acceptedAgentName"],
  ["acceptedruntimeid", "acceptedRuntimeId"],
  ["addedby", "addedBy"],
  ["agentid", "agentId"],
  ["auditdatajson", "auditDataJson"],
  ["appname", "appName"],
  ["appsource", "appSource"],
  ["assignmentmode", "assignmentMode"],
  ["avatarurl", "avatarUrl"],
  ["boundat", "boundAt"],
  ["channelname", "channelName"],
  ["channelmemberaccess", "channelMemberAccess"],
  ["claimedat", "claimedAt"],
  ["commandplanjson", "commandPlanJson"],
  ["configjson", "configJson"],
  ["connectedat", "connectedAt"],
  ["conversationkey", "conversationKey"],
  ["createdat", "createdAt"],
  ["createdby", "createdBy"],
  ["createdbyuserid", "createdByUserId"],
  ["datajson", "dataJson"],
  ["daemonconnectionid", "daemonConnectionId"],
  ["daemonkey", "daemonKey"],
  ["deviceinfo", "deviceInfo"],
  ["decidedat", "decidedAt"],
  ["decidedbyuserid", "decidedByUserId"],
  ["decisionnote", "decisionNote"],
  ["devicename", "deviceName"],
  ["displayname", "displayName"],
  ["documentid", "documentId"],
  ["emailverified", "emailVerified"],
  ["employeename", "employeeName"],
  ["employeenamesjson", "employeeNamesJson"],
  ["errorcode", "errorCode"],
  ["errormessage", "errorMessage"],
  ["externalfileid", "externalFileId"],
  ["externalprovider", "externalProvider"],
  ["externalurl", "externalUrl"],
  ["errortext", "errorText"],
  ["entrypoint", "entryPoint"],
  ["expiresat", "expiresAt"],
  ["finishedat", "finishedAt"],
  ["forkinvitationid", "forkInvitationId"],
  ["grantedbyuserid", "grantedByUserId"],
  ["googleemail", "googleEmail"],
  ["googleoauthcredentialid", "googleOAuthCredentialId"],
  ["googlesubject", "googleSubject"],
  ["humanmembercount", "humanMemberCount"],
  ["humanmembernamesjson", "humanMemberNamesJson"],
  ["importmode", "importMode"],
  ["importedat", "importedAt"],
  ["inputjson", "inputJson"],
  ["installcmd", "installCmd"],
  ["installstrategy", "installStrategy"],
  ["installedat", "installedAt"],
  ["installedbyuserid", "installedByUserId"],
  ["invitedby", "invitedBy"],
  ["invitationid", "invitationId"],
  ["ipaddress", "ipAddress"],
  ["issueid", "issueId"],
  ["joinedat", "joinedAt"],
  ["labelsjson", "labelsJson"],
  ["lasterror", "lastError"],
  ["lastheartbeatat", "lastHeartbeatAt"],
  ["lastcheckedat", "lastCheckedAt"],
  ["lastloginat", "lastLoginAt"],
  ["lastseenat", "lastSeenAt"],
  ["lastusedat", "lastUsedAt"],
  ["knowledgepageid", "knowledgePageId"],
  ["approvalid", "approvalId"],
  ["assignedemployeenamesjson", "assignedEmployeeNamesJson"],
  ["baseupdatedat", "baseUpdatedAt"],
  ["contentmarkdown", "contentMarkdown"],
  ["createdknowledgepageid", "createdKnowledgePageId"],
  ["metadatajson", "metadataJson"],
  ["memorysummary", "memorySummary"],
  ["owneruserid", "ownerUserId"],
  ["optionsjson", "optionsJson"],
  ["primaryemail", "primaryEmail"],
  ["profilejson", "profileJson"],
  ["providersubject", "providerSubject"],
  ["providersessionid", "providerSessionId"],
  ["queuedat", "queuedAt"],
  ["readat", "readAt"],
  ["remarkname", "remarkName"],
  ["resultjson", "resultJson"],
  ["requestedbydisplayname", "requestedByDisplayName"],
  ["requestedbyuserid", "requestedByUserId"],
  ["requestedbyagentname", "requestedByAgentName"],
  ["requestedforchannelname", "requestedForChannelName"],
  ["requestedrole", "requestedRole"],
  ["requestedat", "requestedAt"],
  ["requesteruserid", "requesterUserId"],
  ["requesttype", "requestType"],
  ["requirestext", "requiresText"],
  ["resolvedat", "resolvedAt"],
  ["resolvedby", "resolvedBy"],
  ["resolveruserid", "resolverUserId"],
  ["respondedat", "respondedAt"],
  ["respondedby", "respondedBy"],
  ["accesstokenencrypted", "accessTokenEncrypted"],
  ["agentspacemessageid", "agentSpaceMessageId"],
  ["agentspaceresourceid", "agentSpaceResourceId"],
  ["agentspaceresourcetype", "agentSpaceResourceType"],
  ["appid", "appId"],
  ["capabilitiesjson", "capabilitiesJson"],
  ["channelbindingid", "channelBindingId"],
  ["channelname", "channelName"],
  ["configjson", "configJson"],
  ["createdbyuserid", "createdByUserId"],
  ["disabledat", "disabledAt"],
  ["displayname", "displayName"],
  ["encryptedcredentialsjson", "encryptedCredentialsJson"],
  ["errorcode", "errorCode"],
  ["errormessage", "errorMessage"],
  ["eventtype", "eventType"],
  ["externalchatid", "externalChatId"],
  ["externalchatname", "externalChatName"],
  ["externalchattype", "externalChatType"],
  ["externaleventid", "externalEventId"],
  ["externalmessageid", "externalMessageId"],
  ["externalopenid", "externalOpenId"],
  ["externalemail", "externalEmail"],
  ["externalsenderid", "externalSenderId"],
  ["externalthreadid", "externalThreadId"],
  ["externalunionid", "externalUnionId"],
  ["externaluserid", "externalUserId"],
  ["finishedat", "finishedAt"],
  ["integrationid", "integrationId"],
  ["lastattemptat", "lastAttemptAt"],
  ["lasterror", "lastError"],
  ["lasthealthcheckedat", "lastHealthCheckedAt"],
  ["lasthealthstatus", "lastHealthStatus"],
  ["lastmessageat", "lastMessageAt"],
  ["lastseenat", "lastSeenAt"],
  ["lockedat", "lockedAt"],
  ["lockedby", "lockedBy"],
  ["nextattemptat", "nextAttemptAt"],
  ["operationtype", "operationType"],
  ["permissionsjson", "permissionsJson"],
  ["payloadjson", "payloadJson"],
  ["processedat", "processedAt"],
  ["providerresourcetoken", "providerResourceToken"],
  ["providerresourcetype", "providerResourceType"],
  ["providerresourceurl", "providerResourceUrl"],
  ["receivedat", "receivedAt"],
  ["requestjson", "requestJson"],
  ["resourcebindingid", "resourceBindingId"],
  ["scopesjson", "scopesJson"],
  ["sentat", "sentAt"],
  ["syncmode", "syncMode"],
  ["targetexternalchatid", "targetExternalChatId"],
  ["targetexternalthreadid", "targetExternalThreadId"],
  ["tenantkey", "tenantKey"],
  ["transportmode", "transportMode"],
  ["removedat", "removedAt"],
  ["recipientid", "recipientId"],
  ["recipienttype", "recipientType"],
  ["refreshtokenencrypted", "refreshTokenEncrypted"],
  ["registryjson", "registryJson"],
  ["revokedat", "revokedAt"],
  ["runtimeid", "runtimeId"],
  ["runtimeappid", "runtimeAppId"],
  ["runtimename", "runtimeName"],
  ["routersessionid", "routerSessionId"],
  ["runid", "runId"],
  ["sessionid", "sessionId"],
  ["snapshotjson", "snapshotJson"],
  ["skillmd", "skillMd"],
  ["skillid", "skillId"],
  ["skillname", "skillName"],
  ["safestderrtail", "safeStderrTail"],
  ["safestdouttail", "safeStdoutTail"],
  ["sortorder", "sortOrder"],
  ["sourcetype", "sourceType"],
  ["sourceurl", "sourceUrl"],
  ["sourceagentname", "sourceAgentName"],
  ["sourcechannelname", "sourceChannelName"],
  ["sourceeventidsjson", "sourceEventIdsJson"],
  ["sourcetaskid", "sourceTaskId"],
  ["sourcetaskqueueid", "sourceTaskQueueId"],
  ["parentid", "parentId"],
  ["reviewercomment", "reviewerComment"],
  ["subjectid", "subjectId"],
  ["tagsjson", "tagsJson"],
  ["targetknowledgepageid", "targetKnowledgePageId"],
  ["targetchannelname", "targetChannelName"],
  ["targetuserid", "targetUserId"],
  ["subjecttype", "subjectType"],
  ["syncedat", "syncedAt"],
  ["snapshottype", "snapshotType"],
  ["startedat", "startedAt"],
  ["taskid", "taskId"],
  ["taskqueueid", "taskQueueId"],
  ["tokenhash", "tokenHash"],
  ["traitsjson", "traitsJson"],
  ["triggertype", "triggerType"],
  ["updatedat", "updatedAt"],
  ["updatecmd", "updateCmd"],
  ["updatedby", "updatedBy"],
  ["updatedbyuserid", "updatedByUserId"],
  ["uninstallcmd", "uninstallCmd"],
  ["useragent", "userAgent"],
  ["userid", "userId"],
  ["workdir", "workDir"],
  ["workspaceid", "workspaceId"],
  ["actionhref", "actionHref"],
  ["archivedat", "archivedAt"],
  ["actorid", "actorId"],
  ["actortype", "actorType"],
  ["attemptid", "attemptId"],
  ["dedupekey", "dedupeKey"],
  ["handoffsnapshotid", "handoffSnapshotId"],
  ["resourceid", "resourceId"],
  ["resourcetype", "resourceType"],
]);

function normalizeRows(rows) {
  return rows.map((row) => normalizeRow(row));
}

function normalizeRow(row) {
  const normalized = { ...row };
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeRowKey(key);
    if (normalizedKey && !(normalizedKey in normalized)) {
      normalized[normalizedKey] = value;
    }
  }
  return normalized;
}

function normalizeRowKey(key) {
  const alias = NORMALIZED_ROW_KEY_ALIASES.get(key);
  if (alias) {
    return alias;
  }
  return key.includes("_") ? key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()) : undefined;
}
`;

export interface PreparedStatementResult {
  changes: number;
}

export interface PreparedStatementLike {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): PreparedStatementResult;
}

export interface PostgresSyncDatabase {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatementLike;
  close(): void;
}

type WorkerSuccessPayload = {
  rowCount?: number;
  rows?: Array<Record<string, unknown>>;
};

type WorkerResponse = {
  requestId: string;
  ok: boolean;
  value?: WorkerSuccessPayload;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
};

let database: PostgresSyncDatabase | null = null;
let databaseUrl: string | null = null;
let worker: Worker | null = null;
let requestPort: MessagePort | null = null;
let schemaEnsuredForUrl: string | null = null;
let workerFailure: Error | null = null;
let workerGeneration = 0;

export function getDatabase(): PostgresSyncDatabase {
  const nextDatabaseUrl = resolvePostgresDatabaseUrl();
  if (database && databaseUrl === nextDatabaseUrl && isWorkerReady()) {
    return database;
  }

  closeDatabase();
  databaseUrl = nextDatabaseUrl;
  database = createPostgresSyncDatabase(nextDatabaseUrl);
  ensureRuntimeSchema(database);
  return database;
}

function isWorkerReady(): boolean {
  return Boolean(worker && requestPort && !workerFailure);
}

export function getDataDirPath(): string {
  const dirPath = join(resolveRepositoryRoot(), DATA_DIR);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function getWorkspaceDataDirPath(workspaceId = DEFAULT_WORKSPACE_ID): string {
  const dirPath = join(getDataDirPath(), "workspaces", workspaceId);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function getDatabaseConnectionLabel(): string {
  return redactPostgresDatabaseUrl(resolvePostgresDatabaseUrl());
}

export function resetDatabaseForTests(): void {
  closeDatabase();
}

export function withTransaction<T>(db: PostgresSyncDatabase, work: () => T): T {
  db.exec("BEGIN");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function countRows(db: PostgresSyncDatabase, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*)::int AS count FROM ${tableName}`).get() as { count: number } | undefined;
  return typeof row?.count === "number" ? row.count : 0;
}

export function readMetadataValue(db: PostgresSyncDatabase, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function randomLikeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveRepositoryRoot(): string {
  const candidates = [
    process.env.AGENT_SPACE_REPOSITORY_ROOT,
    /*turbopackIgnore: true*/ process.cwd(),
    join(/*turbopackIgnore: true*/ process.cwd(), ".."),
    join(/*turbopackIgnore: true*/ process.cwd(), "..", ".."),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (existsSync(/*turbopackIgnore: true*/ join(resolved, "Target.md"))) {
      return resolved;
    }
  }

  return /*turbopackIgnore: true*/ process.cwd();
}

function ensureRuntimeSchema(db: PostgresSyncDatabase): void {
  const currentUrl = databaseUrl;
  if (!currentUrl || schemaEnsuredForUrl === currentUrl) {
    return;
  }

  let transactionStarted = false;
  acquireRuntimeSchemaLock(db);
  try {
    if (schemaEnsuredForUrl === currentUrl || isRuntimeSchemaCurrent(db)) {
      schemaEnsuredForUrl = currentUrl;
      return;
    }
    db.exec("BEGIN");
    transactionStarted = true;
    for (const statement of getPostgresSchemaStatements()) {
      db.exec(statement);
    }
    db.prepare(
      `INSERT INTO app_metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    ).run("schema_version", POSTGRES_SCHEMA_VERSION);
    seedDefaultWorkspace(db);
    backfillWorkspaceJoinCodes(db);
    db.exec("COMMIT");
    transactionStarted = false;
    schemaEnsuredForUrl = currentUrl;
  } catch (error) {
    if (transactionStarted) {
      db.exec("ROLLBACK");
    }
    throw error;
  } finally {
    db.prepare("SELECT pg_advisory_unlock(?)").get(POSTGRES_SCHEMA_VERSION);
  }
}

interface RuntimeSchemaLockOptions {
  timeoutMs?: number;
  retryMs?: number;
  now?: () => number;
  sleep?: (durationMs: number) => void;
}

export function acquireRuntimeSchemaLockForTests(
  db: Pick<PostgresSyncDatabase, "prepare">,
  options: RuntimeSchemaLockOptions = {},
): { attempts: number } {
  return acquireRuntimeSchemaLock(db, options);
}

function acquireRuntimeSchemaLock(
  db: Pick<PostgresSyncDatabase, "prepare">,
  options: RuntimeSchemaLockOptions = {},
): { attempts: number } {
  const timeoutMs = options.timeoutMs ?? POSTGRES_SCHEMA_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? POSTGRES_SCHEMA_LOCK_RETRY_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const startedAt = now();
  let attempts = 0;

  while (true) {
    attempts += 1;
    const row = db.prepare("SELECT pg_try_advisory_lock(?) AS acquired").get(POSTGRES_SCHEMA_VERSION) as
      | { acquired?: boolean }
      | undefined;
    if (row?.acquired === true) {
      return { attempts };
    }

    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `PostgreSQL schema migration lock is busy after ${timeoutMs}ms. `
        + `Another AgentSpace process may be initializing schema version ${POSTGRES_SCHEMA_VERSION}; `
        + "wait for it to finish or stop the stale process before rerunning the command.",
      );
    }

    sleep(Math.min(retryMs, timeoutMs - elapsedMs));
  }
}

function sleepSync(durationMs: number): void {
  if (durationMs <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function isRuntimeSchemaCurrent(db: PostgresSyncDatabase): boolean {
  const table = db.prepare(
    "SELECT to_regclass('public.app_metadata') AS table_name",
  ).get() as { tableName?: string } | undefined;
  if (table?.tableName !== "app_metadata") {
    return false;
  }
  return readMetadataValue(db, "schema_version") === POSTGRES_SCHEMA_VERSION;
}

function backfillWorkspaceJoinCodes(db: PostgresSyncDatabase): void {
  const rows = db.prepare(
    `SELECT id FROM workspace
     WHERE archived_at IS NULL
       AND (join_code IS NULL OR join_code = '')`,
  ).all() as Array<{ id: string }>;

  for (const row of rows) {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE workspace
       SET join_code = ?, join_code_updated_at = ?, join_code_updated_by = ?, updated_at = ?
       WHERE id = ?`,
    ).run(buildDeterministicJoinCode(row.id), now, "system", now, row.id);
  }
}

function buildDeterministicJoinCode(seed: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    hash = Math.imul(hash ^ index, 16777619);
    code += alphabet[Math.abs(hash) % alphabet.length];
  }
  return code;
}

function seedDefaultWorkspace(db: PostgresSyncDatabase): void {
  const existingWorkspace = db.prepare("SELECT 1 FROM workspace WHERE id = ? LIMIT 1").get(DEFAULT_WORKSPACE_ID);
  if (existingWorkspace) {
    return;
  }

  const now = new Date().toISOString();
  const joinCode = "DEFAULT1";
  db.prepare(
    `INSERT INTO workspace (
       id, slug, name, created_by, created_at, updated_at, archived_at,
       join_code, join_code_updated_at, join_code_updated_by
     )
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID, "Agent Space", "", now, now, joinCode, now, "system");
}

function createPostgresSyncDatabase(currentDatabaseUrl: string): PostgresSyncDatabase {
  ensureWorker();

  return {
    exec(sql: string): void {
      void callWorker({
        action: "exec",
        databaseUrl: currentDatabaseUrl,
        sql,
      });
    },
    prepare(sql: string): PreparedStatementLike {
      const convertedSql = convertSqliteParameters(sql);
      const execute = (params: unknown[]): WorkerSuccessPayload => callWorker({
        action: "query",
        databaseUrl: currentDatabaseUrl,
        sql: convertedSql,
        params,
      });
      return {
        all(...params: unknown[]): Array<Record<string, unknown>> {
          const result = execute(params);
          return result.rows ?? [];
        },
        get(...params: unknown[]): Record<string, unknown> | undefined {
          const result = execute(params);
          return result.rows?.[0];
        },
        run(...params: unknown[]): PreparedStatementResult {
          const result = execute(params);
          return {
            changes: result.rowCount ?? 0,
          };
        },
      };
    },
    close(): void {
      closeDatabase();
    },
  };
}

function closeDatabase(): void {
  database = null;
  databaseUrl = null;
  schemaEnsuredForUrl = null;
  workerFailure = null;
  workerGeneration += 1;

  if (requestPort) {
    try {
      requestPort.postMessage({
        requestId: `close-${Date.now()}`,
        action: "close",
      });
    } catch {
      // Ignore worker shutdown errors during reset/teardown.
    }
    requestPort.close();
    requestPort = null;
  }

  if (worker) {
    void worker.terminate();
    worker = null;
  }
}

function ensureWorker(): void {
  if (isWorkerReady()) {
    return;
  }

  if (requestPort) {
    requestPort.close();
    requestPort = null;
  }
  if (worker) {
    void worker.terminate();
    worker = null;
  }

  const generation = workerGeneration + 1;
  workerGeneration = generation;
  workerFailure = null;
  const nextWorker = new Worker(POSTGRES_SYNC_WORKER_SOURCE, {
    eval: true,
    execArgv: [],
    workerData: {
      pgModulePath: resolvePgModulePath(),
      responseSignalBuffer: WORKER_SIGNAL_BUFFER,
    },
  });
  const channel = new MessageChannel();
  nextWorker.unref();
  channel.port1.unref();
  nextWorker.on("error", (error) => {
    if (workerGeneration === generation) {
      workerFailure = normalizeWorkerFailure(error);
    }
  });
  nextWorker.on("exit", (code) => {
    if (workerGeneration !== generation) {
      return;
    }

    if (requestPort === channel.port1) {
      requestPort.close();
      requestPort = null;
    }
    if (worker === nextWorker) {
      worker = null;
    }
    if (!workerFailure) {
      workerFailure = new Error(`PostgreSQL runtime worker exited unexpectedly with code ${code}.`);
    }
  });
  nextWorker.postMessage({ port: channel.port2 }, [channel.port2]);
  worker = nextWorker;
  requestPort = channel.port1;
  requestPort.start();
}

function callWorker(input: {
  action: "exec" | "query";
  databaseUrl: string;
  sql: string;
  params?: unknown[];
}): WorkerSuccessPayload {
  if (!isWorkerReady()) {
    ensureWorker();
  }

  if (!requestPort) {
    throw new Error("PostgreSQL runtime worker is not initialized.");
  }

  const activeWorker = worker;
  const activePort = requestPort;
  const requestId = createHash("sha1").update(`${Date.now()}:${Math.random()}`).digest("hex");
  const startedAt = Date.now();
  let signalVersion = Atomics.load(WORKER_SIGNAL, 0);
  activeWorker?.ref();
  activePort.ref();

  try {
    activePort.postMessage({
      requestId,
      action: input.action,
      databaseUrl: input.databaseUrl,
      sql: input.sql,
      params: input.params ?? [],
    });

    while (true) {
      if (workerFailure) {
        throw workerFailure;
      }
      if (Date.now() - startedAt > WORKER_REQUEST_TIMEOUT_MS) {
        throw new Error(
          `PostgreSQL runtime worker timed out after ${WORKER_REQUEST_TIMEOUT_MS}ms `
          + `while running ${input.action}: ${formatSqlPreview(input.sql)}.`,
        );
      }

      const message = receiveMessageOnPort(activePort);
      if (!message) {
        const remainingTime = WORKER_REQUEST_TIMEOUT_MS - (Date.now() - startedAt);
        if (remainingTime <= 0) {
          continue;
        }
        Atomics.wait(WORKER_SIGNAL, 0, signalVersion, Math.min(remainingTime, WORKER_WAIT_SLICE_MS));
        signalVersion = Atomics.load(WORKER_SIGNAL, 0);
        continue;
      }

      const response = message.message as WorkerResponse;
      if (response.requestId !== requestId) {
        continue;
      }

      if (!response.ok) {
        throw deserializeWorkerError(response.error);
      }

      return response.value ?? {};
    }
  } finally {
    activePort.unref();
    activeWorker?.unref();
  }
}

function resolvePgModulePath(): string {
  const candidates = [
    join(resolveRepositoryRoot(), "packages", "db", "package.json"),
    resolveLocalDbPackageJsonPath(),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return createRequire(candidate).resolve("pg");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not resolve pg module.");
}

function normalizeFsPath(pathname: string): string {
  return pathname.startsWith("/@fs/") ? pathname.slice("/@fs".length) : pathname;
}

function resolveLocalDbPackageJsonPath(): string {
  const packageUrl = new URL("../package.json", import.meta.url);
  if (packageUrl.protocol === "file:") {
    return normalizeFsPath(fileURLToPath(packageUrl));
  }
  return normalizeFsPath(packageUrl.pathname);
}

function resolveWorkerRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.AGENT_SPACE_DB_WORKER_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

function resolveSchemaLockTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.AGENT_SPACE_DB_SCHEMA_LOCK_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.max(1_000, WORKER_REQUEST_TIMEOUT_MS - 1_000);
}

function normalizeWorkerFailure(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function formatSqlPreview(sql: string): string {
  const compactSql = sql.replace(/\s+/g, " ").trim();
  return compactSql.length > 160 ? `${compactSql.slice(0, 157)}...` : compactSql;
}

function deserializeWorkerError(error: WorkerResponse["error"]): Error {
  const nextError = new Error(error?.message ?? "Unknown PostgreSQL worker error.");
  nextError.name = error?.name ?? "Error";
  if (error?.stack) {
    nextError.stack = error.stack;
  }
  return nextError;
}

function convertSqliteParameters(sql: string): string {
  let index = 0;
  let result = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let position = 0; position < sql.length; position += 1) {
    const current = sql[position];
    const next = sql[position + 1];

    if (inLineComment) {
      result += current;
      if (current === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      result += current;
      if (current === "*" && next === "/") {
        result += next;
        position += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && current === "-" && next === "-") {
      result += current + next;
      position += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && current === "/" && next === "*") {
      result += current + next;
      position += 1;
      inBlockComment = true;
      continue;
    }

    if (current === "'" && !inDoubleQuote) {
      result += current;
      if (next === "'" && inSingleQuote) {
        result += next;
        position += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (current === '"' && !inSingleQuote) {
      result += current;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (current === "?" && !inSingleQuote && !inDoubleQuote) {
      index += 1;
      result += `$${index}`;
      continue;
    }

    result += current;
  }

  return result;
}
