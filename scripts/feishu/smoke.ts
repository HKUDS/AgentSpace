import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import {
  buildFeishuUrlVerificationResponse,
  resolveFeishuEventType,
} from "../../packages/services/src/integrations/providers/feishu/events.ts";
import {
  isFeishuBotAddedToChatPayload,
  resolveFeishuChatDescriptor,
} from "../../packages/services/src/integrations/providers/feishu/agent-bot-routing.ts";
import { summarizeFeishuInboundEventPayload } from "../../packages/services/src/integrations/providers/feishu/event-summary.ts";
import {
  FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS,
  FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS,
  FEISHU_OPENAPI_REQUIRED_REQUEST_STEPS,
  FEISHU_REQUIRED_EVENTS,
} from "../../packages/services/src/integrations/providers/feishu/constants.ts";
import {
  createFeishuApiClient,
  fetchFeishuTenantAccessToken,
  type FeishuApiClient,
  type FeishuApiRequest,
} from "../../packages/services/src/integrations/providers/feishu/client.ts";

type SmokeStatus = "pass" | "skip" | "fail";

interface LarkSdkModule {
  Client: new(params: LarkClientParams) => {
    im: {
      message: {
        create(payload: Record<string, unknown>): Promise<unknown>;
      };
    };
  };
  EventDispatcher: new(params: Record<string, unknown>) => {
    register(handles: Record<string, unknown>): {
      invoke(data: unknown, params?: Record<string, unknown>): Promise<unknown>;
    };
    invoke(data: unknown, params?: Record<string, unknown>): Promise<unknown>;
  };
  LoggerLevel: {
    warn: number;
  };
}

interface LarkClientParams extends Record<string, unknown> {
  appId: string;
  appSecret: string;
  domain?: string;
  loggerLevel?: number;
}

interface SmokeStep {
  name: string;
  status: SmokeStatus;
  detail?: string;
  request?: FeishuApiRequest;
  liveCheck?: boolean;
  requiredEnv?: string[];
  destructive?: boolean;
  callbackRoute?: string;
  callbackRouteFingerprint?: string;
}

interface SmokeSummary {
  total: number;
  passed: number;
  skipped: number;
  failed: number;
  liveChecks: number;
  livePassed: number;
  liveSkipped: number;
  liveFailed: number;
  destructiveLiveChecks: number;
  missingEnv: string[];
  strictLiveSatisfied: boolean;
}

interface SmokeOutput {
  generatedAt: string;
  live: boolean;
  strictLive: boolean;
  summary: SmokeSummary;
  todo120NativeSmoke: SmokeEnvCheckOutput["todo120NativeSmoke"];
  steps: SafeSmokeStep[];
}

interface SmokeEvidenceVerificationOutput {
  evidencePath: string;
  valid: boolean;
  issues: string[];
  summary: {
    live: boolean;
    strictLive: boolean;
    strictLiveSatisfied: boolean;
    liveChecks: number;
    livePassed: number;
    liveSkipped: number;
    liveFailed: number;
    destructiveLiveChecks: number;
    requiredLiveSteps: number;
    todo120NativeSmokeReady: boolean;
    todo120NativeSmokeRequiredForCommand: boolean;
    todo120NativeSmokeRequired: number;
    todo120NativeSmokeConfigured: number;
  };
}

interface FeishuBotAddedPayloadVerificationOutput {
  payloadPath: string;
  valid: boolean;
  issues: string[];
  summary: {
    eventType: string;
    botAddedEvent: boolean;
    chatDescriptorPresent: boolean;
    chatIdSource?: string;
    chatReference?: string;
    chatIdRedacted: boolean;
    chatType?: string;
    chatNamePresent: boolean;
    chatNameHash?: string;
    chatNameLength?: number;
    externalEventReference?: string;
    externalEventIdRedacted: boolean;
    payloadHash: string;
    rawPayloadStored: false;
  };
}

interface SmokeEnvCheckOutput {
  generatedAt: string;
  envFilePath?: string;
  ready: boolean;
  summary: {
    required: number;
    ready: number;
    missing: number;
    invalid: number;
    optionalConfigured: number;
  };
  todo120NativeSmoke: {
    ready: boolean;
    requiredForCommand: boolean;
    required: number;
    configured: number;
    missing: string[];
    invalid: Array<{
      key: string;
      reason: string;
    }>;
  };
  missingRequired: string[];
  invalidRequired: Array<{
    key: string;
    reason: string;
  }>;
  items: SmokeEnvCheckItem[];
}

interface SmokeEnvCheckItem {
  group: "app" | "callback" | "im" | "docs" | "sheets" | "base" | "optional";
  key: string;
  required: boolean;
  status: "ready" | "missing" | "invalid" | "optional";
  note: string;
  reason?: string;
  todo120NativeSmokeRequired?: boolean;
}

interface SmokeCliErrorOutput {
  ok: false;
  errorCode: string;
  errorMessage: string;
  envName?: string;
  envNames?: string[];
  issues?: string[];
  reason?: string;
}

interface SafeSmokeStep extends Omit<SmokeStep, "request"> {
  request?: SafeFeishuApiRequest;
}

interface SafeFeishuApiRequest {
  method: FeishuApiRequest["method"];
  path: string;
  queryKeys?: string[];
  bodyKeys?: string[];
}

interface SmokeEnv {
  appId?: string;
  appSecret?: string;
  apiBaseUrl?: string;
  callbackUrl?: string;
  verificationToken?: string;
  chatId?: string;
  docToken?: string;
  docParentBlockId?: string;
  docAppendBlocks?: Record<string, unknown>[];
  sheetToken?: string;
  sheetRange?: string;
  sheetWriteRange?: string;
  sheetWriteValues?: unknown[][];
  baseAppToken?: string;
  baseTableId?: string;
  baseRecordId?: string;
  baseUpdateFields?: Record<string, unknown>;
}

const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const json = args.has("--json");
const strictLive = args.has("--strict-live");
const checkEnv = args.has("--check-env");
const requireTodo120NativeSmoke = args.has("--require-todo120-native");

class SmokeCliError extends Error {
  readonly code: string;
  readonly envName?: string;
  readonly envNames?: string[];
  readonly issues?: string[];
  readonly reason?: string;

  constructor(input: {
    code: string;
    message: string;
    envName?: string;
    envNames?: string[];
    issues?: string[];
    reason?: string;
  }) {
    super(input.message);
    this.name = "SmokeCliError";
    this.code = input.code;
    this.envName = input.envName;
    this.envNames = input.envNames;
    this.issues = input.issues;
    this.reason = input.reason;
  }
}

async function main(): Promise<void> {
  const verifyBotAddedPayloadPath = readArgValue("--verify-bot-added-payload");
  if (verifyBotAddedPayloadPath) {
    const verification = verifyFeishuBotAddedPayloadFile(verifyBotAddedPayloadPath);
    if (json) {
      console.log(JSON.stringify(verification, null, 2));
    } else {
      printBotAddedPayloadVerificationSummary(verification);
    }
    if (!verification.valid) {
      process.exitCode = 1;
    }
    return;
  }

  const verifyEvidencePath = readArgValue("--verify-evidence");
  if (verifyEvidencePath) {
    const verification = verifySmokeEvidenceFile(verifyEvidencePath);
    if (json) {
      console.log(JSON.stringify(verification, null, 2));
    } else {
      printEvidenceVerificationSummary(verification);
    }
    if (!verification.valid) {
      process.exitCode = 1;
    }
    return;
  }

  const envFilePath = readArgValue("--env-file");
  if (envFilePath) {
    loadSmokeEnvFile(envFilePath);
  }
  if (checkEnv) {
    const report = buildSmokeEnvCheckOutput(envFilePath, { requireTodo120NativeSmoke });
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printSmokeEnvCheckSummary(report);
    }
    if (!report.ready) {
      process.exitCode = 1;
    }
    return;
  }

  const evidencePath = readArgValue("--evidence");
  if (evidencePath && !live) {
    throw new SmokeCliError({
      code: "feishu.smoke.evidence_requires_live",
      message: "--evidence only writes live Feishu smoke artifacts. Rerun with --live --strict-live before saving evidence.",
      reason: "not_live_run",
    });
  }
  if (evidencePath && !strictLive) {
    throw new SmokeCliError({
      code: "feishu.smoke.evidence_requires_strict_live",
      message: "--evidence only writes strict live Feishu smoke artifacts. Rerun with --live --strict-live before saving evidence.",
      reason: "not_strict_live_run",
    });
  }

  const env = readSmokeEnv();
  if (live) {
    assertLiveSmokeEnvReadyForNetwork(envFilePath, { strictLive, requireTodo120NativeSmoke });
  }
  const steps: SmokeStep[] = [];

  steps.push(await smokeSdkClientMessageCreate({ live, env }));
  steps.push(await smokeEventDispatcher());
  steps.push(await smokeBotAddedEventDispatcher());
  steps.push(await smokeCardActionEventDispatcher());
  steps.push(smokeHttpChallenge());
  steps.push(await smokeAgentSpaceCallbackVerification({ live, env }));

  const client = await createLiveClientIfNeeded({ live, env, steps });
  steps.push(await smokeFeishuRequest({
    name: "Docs docx metadata",
    live,
    client,
    required: env.docToken,
    requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_DOC_TOKEN"],
    request: buildDocMetadataRequest(env.docToken ?? "doccnSmokeToken"),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Docs docx read blocks",
    live,
    client,
    required: env.docToken,
    requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_DOC_TOKEN"],
    request: buildDocBlocksRequest(env.docToken ?? "doccnSmokeToken"),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Docs docx append blocks",
    live,
    client,
    required: env.docToken && env.docParentBlockId && env.docAppendBlocks,
    requiredEnv: [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_SMOKE_DOC_TOKEN",
      "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID",
      "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON",
    ],
    destructive: true,
    request: buildDocAppendBlocksRequest({
      docToken: env.docToken ?? "doccnSmokeToken",
      parentBlockId: env.docParentBlockId ?? "blkSmokeParent",
      children: env.docAppendBlocks ?? [{
        block_type: 2,
        text: {
          elements: [{
            text_run: {
              content: "AgentSpace smoke",
            },
          }],
        },
      }],
    }),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Sheets metadata",
    live,
    client,
    required: env.sheetToken,
    requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_SHEET_TOKEN"],
    request: buildSheetMetadataRequest(env.sheetToken ?? "shtcnSmokeToken"),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Sheets read values",
    live,
    client,
    required: env.sheetToken,
    requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_SHEET_TOKEN"],
    request: buildSheetReadRequest({
      sheetToken: env.sheetToken ?? "shtcnSmokeToken",
      range: env.sheetRange ?? "Sheet1!A1:B2",
    }),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Sheets write values",
    live,
    client,
    required: env.sheetToken && env.sheetWriteRange && env.sheetWriteValues,
    requiredEnv: [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_SMOKE_SHEET_TOKEN",
      "FEISHU_SMOKE_SHEET_WRITE_RANGE",
      "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON",
    ],
    destructive: true,
    request: buildSheetWriteRequest({
      sheetToken: env.sheetToken ?? "shtcnSmokeToken",
      range: env.sheetWriteRange ?? "Sheet1!A1:B1",
      values: env.sheetWriteValues ?? [["AgentSpace smoke"]],
    }),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Base list tables",
    live,
    client,
    required: env.baseAppToken,
    requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_BASE_APP_TOKEN"],
    request: buildBaseListTablesRequest(env.baseAppToken ?? "appSmokeToken"),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Base list records",
    live,
    client,
    required: env.baseAppToken && env.baseTableId,
    requiredEnv: [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_SMOKE_BASE_APP_TOKEN",
      "FEISHU_SMOKE_BASE_TABLE_ID",
    ],
    request: buildBaseListRecordsRequest({
      appToken: env.baseAppToken ?? "appSmokeToken",
      tableId: env.baseTableId ?? "tblSmokeId",
    }),
  }));
  steps.push(await smokeFeishuRequest({
    name: "Base update record",
    live,
    client,
    required: env.baseAppToken && env.baseTableId && env.baseRecordId && env.baseUpdateFields,
    requiredEnv: [
      "FEISHU_APP_ID",
      "FEISHU_APP_SECRET",
      "FEISHU_SMOKE_BASE_APP_TOKEN",
      "FEISHU_SMOKE_BASE_TABLE_ID",
      "FEISHU_SMOKE_BASE_RECORD_ID",
      "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON",
    ],
    destructive: true,
    request: buildBaseUpdateRecordRequest({
      appToken: env.baseAppToken ?? "appSmokeToken",
      tableId: env.baseTableId ?? "tblSmokeId",
      recordId: env.baseRecordId ?? "recSmokeId",
      fields: env.baseUpdateFields ?? { Smoke: "AgentSpace" },
    }),
  }));

  const summary = summarizeSteps({ live, strictLive, steps });
  const envCheck = buildSmokeEnvCheckOutput(envFilePath, {
    requireTodo120NativeSmoke,
  });
  const output = buildSmokeOutput({
    live,
    strictLive,
    summary,
    todo120NativeSmoke: envCheck.todo120NativeSmoke,
    steps,
  });
  const evidenceWritten = Boolean(evidencePath && summary.strictLiveSatisfied);
  if (evidenceWritten && evidencePath) {
    writeVerifiedEvidenceFile(evidencePath, output);
  }

  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printHumanSummary(output);
    if (evidenceWritten && evidencePath) {
      console.log(`Evidence written: ${evidencePath}`);
    }
  }

  if (summary.failed > 0 || (strictLive && !summary.strictLiveSatisfied)) {
    process.exitCode = 1;
  }
}

async function smokeSdkClientMessageCreate(input: {
  live: boolean;
  env: SmokeEnv;
}): Promise<SmokeStep> {
  const lark = loadLarkSdk();
  if (typeof lark.Client !== "function") {
    return {
      name: "SDK Client import",
      status: "fail",
      detail: "@larksuiteoapi/node-sdk Client export is unavailable.",
    };
  }
  if (!input.live) {
    new lark.Client({
      appId: "cli_smoke_app",
      appSecret: "smoke-secret",
      loggerLevel: lark.LoggerLevel.warn,
    });
    return {
      name: "Client im.message.create",
      status: "pass",
      detail: "dry-run: SDK Client constructed and message.create payload shape is ready.",
      request: buildImMessageCreateRequest(input.env.chatId ?? "oc_smoke_chat"),
      liveCheck: true,
      requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_CHAT_ID"],
    };
  }
  if (!input.env.appId || !input.env.appSecret || !input.env.chatId) {
    return {
      name: "Client im.message.create",
      status: "skip",
      detail: formatMissingEnvDetail([
        "FEISHU_APP_ID",
        "FEISHU_APP_SECRET",
        "FEISHU_SMOKE_CHAT_ID",
      ], "send a live bot message"),
      liveCheck: true,
      requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_CHAT_ID"],
    };
  }

  const client = new lark.Client({
    appId: input.env.appId,
    appSecret: input.env.appSecret,
    ...(input.env.apiBaseUrl ? { domain: input.env.apiBaseUrl } : {}),
    loggerLevel: lark.LoggerLevel.warn,
  });
  const response = await client.im.message.create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: input.env.chatId,
      msg_type: "text",
      content: JSON.stringify({
        text: `AgentSpace Feishu smoke ${new Date().toISOString()}`,
      }),
      uuid: `agentspace-smoke-${Date.now()}`,
    },
  });
  return {
    name: "Client im.message.create",
    status: readFeishuApiOk(response) ? "pass" : "fail",
    detail: summarizeResponse(response),
    request: buildImMessageCreateRequest(input.env.chatId),
    liveCheck: true,
    requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_SMOKE_CHAT_ID"],
  };
}

async function smokeEventDispatcher(): Promise<SmokeStep> {
  const lark = loadLarkSdk();
  if (typeof lark.EventDispatcher !== "function") {
    return {
      name: "EventDispatcher im.message.receive_v1",
      status: "fail",
      detail: "@larksuiteoapi/node-sdk EventDispatcher export is unavailable.",
    };
  }

  let handled = false;
  const dispatcher = new lark.EventDispatcher({
    verificationToken: "verify-token",
    loggerLevel: lark.LoggerLevel.warn,
  });
  dispatcher.register({
    "im.message.receive_v1": async () => {
      handled = true;
    },
  });
  await dispatcher.invoke({
    schema: "2.0",
    header: {
      event_id: "evt-smoke",
      event_type: "im.message.receive_v1",
      token: "verify-token",
      create_time: String(Date.now()),
    },
    event: {
      message: {
        chat_id: "oc_smoke",
        chat_type: "group",
        message_id: "om_smoke",
        message_type: "text",
        content: JSON.stringify({ text: "@AgentSpace smoke" }),
      },
      sender: {
        sender_id: {
          open_id: "ou_smoke",
        },
      },
    },
  }, { needCheck: true });

  return {
    name: "EventDispatcher im.message.receive_v1",
    status: handled ? "pass" : "fail",
    detail: handled ? "local dispatcher invoked the receive-message handler." : "handler was not invoked.",
  };
}

async function smokeCardActionEventDispatcher(): Promise<SmokeStep> {
  const lark = loadLarkSdk();
  if (typeof lark.EventDispatcher !== "function") {
    return {
      name: "EventDispatcher card.action.trigger",
      status: "fail",
      detail: "@larksuiteoapi/node-sdk EventDispatcher export is unavailable.",
    };
  }

  let handled = false;
  const dispatcher = new lark.EventDispatcher({
    verificationToken: "verify-token",
    loggerLevel: lark.LoggerLevel.warn,
  });
  dispatcher.register({
    "card.action.trigger": async () => {
      handled = true;
    },
  });
  await dispatcher.invoke({
    schema: "2.0",
    header: {
      event_id: "evt-card-smoke",
      event_type: "card.action.trigger",
      token: "verify-token",
      create_time: String(Date.now()),
    },
    event: {
      action: {
        value: {
          approvalId: "approval-smoke",
          decision: "approved",
          payloadHash: "payload-smoke",
          token: "token-smoke",
        },
      },
      operator: {
        operator_id: {
          open_id: "ou_smoke",
        },
      },
    },
  }, { needCheck: true });

  return {
    name: "EventDispatcher card.action.trigger",
    status: handled ? "pass" : "fail",
    detail: handled ? "local dispatcher invoked the card-action handler." : "handler was not invoked.",
  };
}

async function smokeBotAddedEventDispatcher(): Promise<SmokeStep> {
  const lark = loadLarkSdk();
  if (typeof lark.EventDispatcher !== "function") {
    return {
      name: "EventDispatcher im.chat.member.bot.added_v1",
      status: "fail",
      detail: "@larksuiteoapi/node-sdk EventDispatcher export is unavailable.",
    };
  }

  let handled = false;
  const dispatcher = new lark.EventDispatcher({
    verificationToken: "verify-token",
    loggerLevel: lark.LoggerLevel.warn,
  });
  dispatcher.register({
    "im.chat.member.bot.added_v1": async () => {
      handled = true;
    },
  });
  await dispatcher.invoke({
    schema: "2.0",
    header: {
      event_id: "evt-bot-added-smoke",
      event_type: "im.chat.member.bot.added_v1",
      token: "verify-token",
      create_time: String(Date.now()),
    },
    event: {
      chat_id: "oc_smoke",
      chat_type: "group",
      chat: {
        chat_id: "oc_smoke",
        chat_type: "group",
        name: "Smoke Room",
      },
      operator: {
        operator_id: {
          open_id: "ou_smoke",
        },
      },
    },
  }, { needCheck: true });

  return {
    name: "EventDispatcher im.chat.member.bot.added_v1",
    status: handled ? "pass" : "fail",
    detail: handled ? "local dispatcher invoked the bot-added handler." : "handler was not invoked.",
  };
}

function smokeHttpChallenge(): SmokeStep {
  const response = buildFeishuUrlVerificationResponse({
    type: "url_verification",
    challenge: "challenge-smoke",
  });
  return {
    name: "HTTP challenge auto response",
    status: response.challenge === "challenge-smoke" ? "pass" : "fail",
    detail: JSON.stringify(response),
  };
}

async function smokeAgentSpaceCallbackVerification(input: {
  live: boolean;
  env: SmokeEnv;
}): Promise<SmokeStep> {
  const requiredEnv = ["FEISHU_SMOKE_CALLBACK_URL", "FEISHU_VERIFICATION_TOKEN"];
  const callbackRouteProof = buildCallbackRouteProof(input.env.callbackUrl);
  if (!input.live) {
    return {
      name: "AgentSpace callback URL verification",
      status: "pass",
      detail: "dry-run: AgentSpace callback probe payload is ready.",
      liveCheck: true,
      requiredEnv,
      ...callbackRouteProof,
    };
  }
  if (!input.env.callbackUrl || !input.env.verificationToken) {
    return {
      name: "AgentSpace callback URL verification",
      status: "skip",
      detail: formatMissingEnvDetail(requiredEnv, "verify the AgentSpace callback endpoint"),
      liveCheck: true,
      requiredEnv,
      ...callbackRouteProof,
    };
  }

  const challenge = `agentspace-callback-smoke-${Date.now()}`;
  try {
    const response = await fetch(input.env.callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type: "url_verification",
        token: input.env.verificationToken,
        challenge,
      }),
    });
    const body = await readJsonResponse(response);
    const matched = body?.challenge === challenge;
    return {
      name: "AgentSpace callback URL verification",
      status: response.ok && matched ? "pass" : "fail",
      detail: `status=${response.status}; challenge=${matched ? "matched" : "not matched"}`,
      liveCheck: true,
      requiredEnv,
      ...callbackRouteProof,
    };
  } catch (error) {
    return {
      name: "AgentSpace callback URL verification",
      status: "fail",
      detail: formatCallbackProbeError(error, input.env.callbackUrl),
      liveCheck: true,
      requiredEnv,
      ...callbackRouteProof,
    };
  }
}

async function createLiveClientIfNeeded(input: {
  live: boolean;
  env: SmokeEnv;
  steps: SmokeStep[];
}): Promise<FeishuApiClient | undefined> {
  if (!input.live) {
    input.steps.push({
      name: "Tenant access token",
      status: "pass",
      detail: "dry-run: tenant access token request is deferred until --live.",
      liveCheck: true,
      requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
    });
    return undefined;
  }
  if (!input.env.appId || !input.env.appSecret) {
    input.steps.push({
      name: "Tenant access token",
      status: "skip",
      detail: formatMissingEnvDetail([
        "FEISHU_APP_ID",
        "FEISHU_APP_SECRET",
      ], "run live data-plane checks"),
      liveCheck: true,
      requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
    });
    return undefined;
  }
  try {
    const token = await fetchFeishuTenantAccessToken({
      appId: input.env.appId,
      appSecret: input.env.appSecret,
      baseUrl: input.env.apiBaseUrl,
    });
    input.steps.push({
      name: "Tenant access token",
      status: "pass",
      detail: `received token expiring in ${token.expireSeconds ?? "unknown"} seconds.`,
      liveCheck: true,
      requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
    });
    return createFeishuApiClient({
      credentials: {
        appId: input.env.appId,
        appSecret: input.env.appSecret,
        tenantAccessToken: token.tenantAccessToken,
      },
      baseUrl: input.env.apiBaseUrl,
    });
  } catch (error) {
    input.steps.push({
      name: "Tenant access token",
      status: "fail",
      detail: formatError(error),
      liveCheck: true,
      requiredEnv: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"],
    });
    return undefined;
  }
}

async function smokeFeishuRequest(input: {
  name: string;
  live: boolean;
  client?: FeishuApiClient;
  required: unknown;
  requiredEnv: string[];
  destructive?: boolean;
  request: FeishuApiRequest;
}): Promise<SmokeStep> {
  if (!input.live) {
    return {
      name: input.name,
      status: "pass",
      detail: "dry-run: request shape built.",
      request: input.request,
      liveCheck: true,
      requiredEnv: input.requiredEnv,
      destructive: input.destructive,
    };
  }
  if (!input.required) {
    return {
      name: input.name,
      status: "skip",
      detail: formatMissingEnvDetail(input.requiredEnv, "run this live check"),
      request: input.request,
      liveCheck: true,
      requiredEnv: input.requiredEnv,
      destructive: input.destructive,
    };
  }
  if (!input.client) {
    return {
      name: input.name,
      status: "skip",
      detail: "tenant client unavailable.",
      request: input.request,
      liveCheck: true,
      requiredEnv: input.requiredEnv,
      destructive: input.destructive,
    };
  }
  try {
    const response = await input.client.request<Record<string, unknown>>(input.request);
    return {
      name: input.name,
      status: readFeishuApiOk(response) ? "pass" : "fail",
      detail: summarizeResponse(response),
      request: input.request,
      liveCheck: true,
      requiredEnv: input.requiredEnv,
      destructive: input.destructive,
    };
  } catch (error) {
    return {
      name: input.name,
      status: "fail",
      detail: formatError(error),
      request: input.request,
      liveCheck: true,
      requiredEnv: input.requiredEnv,
      destructive: input.destructive,
    };
  }
}

function buildImMessageCreateRequest(chatId: string): FeishuApiRequest {
  return {
    method: "POST",
    path: "/open-apis/im/v1/messages",
    query: {
      receive_id_type: "chat_id",
    },
    body: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text: "AgentSpace Feishu smoke" }),
    },
  };
}

function buildDocMetadataRequest(docToken: string): FeishuApiRequest {
  return {
    method: "POST",
    path: "/open-apis/drive/v1/metas/batch_query",
    body: {
      request_docs: [{
        doc_token: docToken,
        doc_type: "docx",
      }],
      with_url: true,
    },
  };
}

function buildDocBlocksRequest(docToken: string): FeishuApiRequest {
  return {
    method: "GET",
    path: `/open-apis/docx/v1/documents/${encodeURIComponent(docToken)}/blocks`,
    query: {
      page_size: 20,
    },
  };
}

function buildDocAppendBlocksRequest(input: {
  docToken: string;
  parentBlockId: string;
  children: Record<string, unknown>[];
}): FeishuApiRequest {
  return {
    method: "POST",
    path: `/open-apis/docx/v1/documents/${encodeURIComponent(input.docToken)}/blocks/${encodeURIComponent(input.parentBlockId)}/children`,
    body: {
      children: input.children,
      index: -1,
    },
  };
}

function buildSheetMetadataRequest(sheetToken: string): FeishuApiRequest {
  return {
    method: "GET",
    path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(sheetToken)}/metainfo`,
  };
}

function buildSheetReadRequest(input: {
  sheetToken: string;
  range: string;
}): FeishuApiRequest {
  return {
    method: "GET",
    path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(input.sheetToken)}/values/${encodeURIComponent(input.range)}`,
  };
}

function buildSheetWriteRequest(input: {
  sheetToken: string;
  range: string;
  values: unknown[][];
}): FeishuApiRequest {
  return {
    method: "PUT",
    path: `/open-apis/sheets/v2/spreadsheets/${encodeURIComponent(input.sheetToken)}/values`,
    body: {
      valueRange: {
        range: input.range,
        values: input.values,
      },
    },
  };
}

function buildBaseListTablesRequest(appToken: string): FeishuApiRequest {
  return {
    method: "GET",
    path: `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
    query: {
      page_size: 20,
    },
  };
}

function buildBaseListRecordsRequest(input: {
  appToken: string;
  tableId: string;
}): FeishuApiRequest {
  return {
    method: "GET",
    path: `/open-apis/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables/${encodeURIComponent(input.tableId)}/records`,
    query: {
      page_size: 20,
    },
  };
}

function buildBaseUpdateRecordRequest(input: {
  appToken: string;
  tableId: string;
  recordId: string;
  fields: Record<string, unknown>;
}): FeishuApiRequest {
  return {
    method: "PUT",
    path: `/open-apis/bitable/v1/apps/${encodeURIComponent(input.appToken)}/tables/${encodeURIComponent(input.tableId)}/records/${encodeURIComponent(input.recordId)}`,
    body: {
      fields: input.fields,
    },
  };
}

function readSmokeEnv(): SmokeEnv {
  return {
    appId: readEnv("FEISHU_APP_ID"),
    appSecret: readEnv("FEISHU_APP_SECRET"),
    apiBaseUrl: readEnv("FEISHU_API_BASE_URL") ?? readEnv("AGENT_SPACE_FEISHU_API_BASE_URL"),
    callbackUrl: readEnv("FEISHU_SMOKE_CALLBACK_URL"),
    verificationToken: readEnv("FEISHU_VERIFICATION_TOKEN"),
    chatId: readEnv("FEISHU_SMOKE_CHAT_ID"),
    docToken: readEnv("FEISHU_SMOKE_DOC_TOKEN"),
    docParentBlockId: readEnv("FEISHU_SMOKE_DOC_PARENT_BLOCK_ID"),
    docAppendBlocks: readJsonEnv<Record<string, unknown>[]>(
      "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON",
      validateDocAppendBlocksEnv,
    ),
    sheetToken: readEnv("FEISHU_SMOKE_SHEET_TOKEN"),
    sheetRange: readEnv("FEISHU_SMOKE_SHEET_RANGE"),
    sheetWriteRange: readEnv("FEISHU_SMOKE_SHEET_WRITE_RANGE"),
    sheetWriteValues: readJsonEnv<unknown[][]>(
      "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON",
      validateSheetWriteValuesEnv,
    ),
    baseAppToken: readEnv("FEISHU_SMOKE_BASE_APP_TOKEN"),
    baseTableId: readEnv("FEISHU_SMOKE_BASE_TABLE_ID"),
    baseRecordId: readEnv("FEISHU_SMOKE_BASE_RECORD_ID"),
    baseUpdateFields: readJsonEnv<Record<string, unknown>>(
      "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON",
      validateBaseUpdateFieldsEnv,
    ),
  };
}

function loadSmokeEnvFile(path: string): void {
  const content = readFileSync(path, "utf8");
  const entries = parseSmokeEnvFile(content);
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseSmokeEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      throw new SmokeCliError({
        code: "feishu.smoke.invalid_env_file",
        message: `Invalid --env-file line ${index + 1}: expected KEY=value.`,
        reason: "expected_key_value",
      });
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new SmokeCliError({
        code: "feishu.smoke.invalid_env_file",
        message: `Invalid --env-file line ${index + 1}: invalid env name.`,
        reason: "invalid_env_name",
      });
    }

    values[key] = parseSmokeEnvFileValue(normalizedLine.slice(separatorIndex + 1).trim(), index + 1);
  }
  return values;
}

function parseSmokeEnvFileValue(value: string, lineNumber: number): string {
  if (!value) {
    return "";
  }

  const quote = value[0];
  if (quote === "\"" || quote === "'") {
    if (!value.endsWith(quote)) {
      throw new SmokeCliError({
        code: "feishu.smoke.invalid_env_file",
        message: `Invalid --env-file line ${lineNumber}: unterminated quoted value.`,
        reason: "unterminated_quoted_value",
      });
    }
    const inner = value.slice(1, -1);
    return quote === "\"" ? unescapeDoubleQuotedEnvValue(inner) : inner;
  }

  const commentIndex = value.search(/\s#/);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}

function unescapeDoubleQuotedEnvValue(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readJsonEnv<T>(
  name: string,
  validate?: (value: string) => string | undefined,
): T | undefined {
  const value = readEnv(name);
  if (!value) {
    return undefined;
  }
  const invalidReason = validate?.(value);
  if (invalidReason) {
    throw new SmokeCliError({
      code: "feishu.smoke.invalid_json_env",
      message: `Invalid ${name}: ${invalidReason}.`,
      envName: name,
      reason: invalidReason,
    });
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new SmokeCliError({
      code: "feishu.smoke.invalid_json_env",
      message: `Invalid ${name}: must_be_valid_json.`,
      envName: name,
      reason: "must_be_valid_json",
    });
  }
}

const LIVE_SMOKE_ENV_CHECKS: Array<{
  group: SmokeEnvCheckItem["group"];
  key: string;
  required: boolean;
  note: string;
  validate?: (value: string) => string | undefined;
  todo120NativeSmokeRequired?: boolean;
}> = [
  {
    group: "app",
    key: "FEISHU_APP_ID",
    required: true,
    note: "Feishu self-built app id used for IM and Docs/Sheets/Base OpenAPI calls.",
  },
  {
    group: "app",
    key: "FEISHU_APP_SECRET",
    required: true,
    note: "Feishu app secret used to fetch a tenant access token.",
  },
  {
    group: "callback",
    key: "FEISHU_VERIFICATION_TOKEN",
    required: true,
    note: "Verification token used by the AgentSpace callback challenge probe.",
  },
  {
    group: "callback",
    key: "FEISHU_SMOKE_CALLBACK_URL",
    required: true,
    note: "Workspace/integration callback URL generated by AgentSpace.",
    validate: validateAgentSpaceCallbackUrlEnv,
  },
  {
    group: "im",
    key: "FEISHU_SMOKE_CHAT_ID",
    required: true,
    note: "Disposable Feishu chat id where the bot can send a smoke message.",
  },
  {
    group: "docs",
    key: "FEISHU_SMOKE_DOC_TOKEN",
    required: true,
    note: "Authorized Docx token for metadata, block-read, and append-block smoke.",
  },
  {
    group: "docs",
    key: "FEISHU_SMOKE_DOC_PARENT_BLOCK_ID",
    required: true,
    note: "Disposable parent block id where strict live smoke appends a small Docx block.",
  },
  {
    group: "docs",
    key: "FEISHU_SMOKE_DOC_APPEND_BLOCKS_JSON",
    required: true,
    note: "JSON array of Docx child blocks appended under the disposable parent block.",
    validate: validateDocAppendBlocksEnv,
  },
  {
    group: "sheets",
    key: "FEISHU_SMOKE_SHEET_TOKEN",
    required: true,
    note: "Authorized spreadsheet token for read/write smoke.",
  },
  {
    group: "sheets",
    key: "FEISHU_SMOKE_SHEET_WRITE_RANGE",
    required: true,
    note: "Disposable sheet range mutated by strict live smoke.",
  },
  {
    group: "sheets",
    key: "FEISHU_SMOKE_SHEET_WRITE_VALUES_JSON",
    required: true,
    note: "JSON array of rows written to the disposable sheet range.",
    validate: validateSheetWriteValuesEnv,
  },
  {
    group: "base",
    key: "FEISHU_SMOKE_BASE_APP_TOKEN",
    required: true,
    note: "Authorized Base/Bitable app token for table/record smoke.",
  },
  {
    group: "base",
    key: "FEISHU_SMOKE_BASE_TABLE_ID",
    required: true,
    note: "Base table id used for list-records and update-record smoke.",
  },
  {
    group: "base",
    key: "FEISHU_SMOKE_BASE_RECORD_ID",
    required: true,
    note: "Disposable Base record id mutated by strict live smoke.",
  },
  {
    group: "base",
    key: "FEISHU_SMOKE_BASE_UPDATE_FIELDS_JSON",
    required: true,
    note: "JSON object fields used to update the disposable Base record.",
    validate: validateBaseUpdateFieldsEnv,
  },
  {
    group: "optional",
    key: "FEISHU_SECOND_AGENT_APP_ID",
    required: false,
    todo120NativeSmokeRequired: true,
    note: "TODO120 native multi-agent smoke: second disposable Feishu app id for another AgentSpace agent bot.",
  },
  {
    group: "optional",
    key: "FEISHU_SECOND_AGENT_APP_SECRET",
    required: false,
    todo120NativeSmokeRequired: true,
    note: "TODO120 native multi-agent smoke: second Feishu app secret used to bind another AgentSpace agent bot.",
  },
  {
    group: "optional",
    key: "FEISHU_API_BASE_URL",
    required: false,
    note: "Optional Feishu/Lark OpenAPI base URL override.",
    validate: validateHttpUrlEnv,
  },
  {
    group: "optional",
    key: "FEISHU_ENCRYPT_KEY",
    required: false,
    note: "Optional event encrypt key, required only when event encryption is enabled for the app.",
  },
  {
    group: "optional",
    key: "FEISHU_SMOKE_SHEET_RANGE",
    required: false,
    note: "Optional sheet read range; defaults to Sheet1!A1:B2.",
  },
];

function buildSmokeEnvCheckOutput(
  envFilePath?: string,
  options: { requireTodo120NativeSmoke?: boolean } = {},
): SmokeEnvCheckOutput {
  const baseItems = LIVE_SMOKE_ENV_CHECKS.map((check): SmokeEnvCheckItem => {
    const value = readEnv(check.key);
    if (!value) {
      return {
        group: check.group,
        key: check.key,
        required: check.required,
        status: check.required ? "missing" : "optional",
        note: check.note,
        ...(check.todo120NativeSmokeRequired ? { todo120NativeSmokeRequired: true } : {}),
      };
    }

    const invalidReason = detectPlaceholderSmokeEnvValue(value) ?? check.validate?.(value);
    if (invalidReason) {
      return {
        group: check.group,
        key: check.key,
        required: check.required,
        status: "invalid",
        note: check.note,
        reason: invalidReason,
        ...(check.todo120NativeSmokeRequired ? { todo120NativeSmokeRequired: true } : {}),
      };
    }

    return {
      group: check.group,
      key: check.key,
      required: check.required,
      status: "ready",
      note: check.note,
      ...(check.todo120NativeSmokeRequired ? { todo120NativeSmokeRequired: true } : {}),
    };
  });
  const items = applyTodo120NativeSmokeCrossFieldChecks(baseItems);
  const requiredItems = items.filter((item) => item.required);
  const todo120NativeSmokeItems = items.filter((item) => item.todo120NativeSmokeRequired);
  const missingRequired = requiredItems
    .filter((item) => item.status === "missing")
    .map((item) => item.key);
  const invalidRequired = requiredItems
    .filter((item) => item.status === "invalid")
    .map((item) => ({
      key: item.key,
      reason: item.reason ?? "invalid",
    }));
  const todo120NativeSmokeReady = todo120NativeSmokeItems.every((item) => item.status === "ready");

  return {
    generatedAt: new Date().toISOString(),
    ...(envFilePath ? { envFilePath } : {}),
    ready: missingRequired.length === 0 &&
      invalidRequired.length === 0 &&
      (!options.requireTodo120NativeSmoke || todo120NativeSmokeReady),
    summary: {
      required: requiredItems.length,
      ready: requiredItems.filter((item) => item.status === "ready").length,
      missing: missingRequired.length,
      invalid: invalidRequired.length,
      optionalConfigured: items.filter((item) => !item.required && item.status === "ready").length,
    },
    todo120NativeSmoke: {
      ready: todo120NativeSmokeReady,
      requiredForCommand: Boolean(options.requireTodo120NativeSmoke),
      required: todo120NativeSmokeItems.length,
      configured: todo120NativeSmokeItems.filter((item) => item.status === "ready").length,
      missing: todo120NativeSmokeItems
        .filter((item) => item.status === "optional")
        .map((item) => item.key),
      invalid: todo120NativeSmokeItems
        .filter((item) => item.status === "invalid")
        .map((item) => ({
          key: item.key,
          reason: item.reason ?? "invalid",
        })),
    },
    missingRequired,
    invalidRequired,
    items,
  };
}

function applyTodo120NativeSmokeCrossFieldChecks(items: SmokeEnvCheckItem[]): SmokeEnvCheckItem[] {
  const primaryAppId = readEnv("FEISHU_APP_ID")?.trim();
  const secondAgentAppId = readEnv("FEISHU_SECOND_AGENT_APP_ID")?.trim();
  const primaryAppSecret = readEnv("FEISHU_APP_SECRET")?.trim();
  const secondAgentAppSecret = readEnv("FEISHU_SECOND_AGENT_APP_SECRET")?.trim();
  const duplicateAppId = Boolean(primaryAppId && secondAgentAppId && primaryAppId === secondAgentAppId);
  const duplicateAppSecret = Boolean(
    primaryAppSecret &&
    secondAgentAppSecret &&
    primaryAppSecret === secondAgentAppSecret
  );
  if (!duplicateAppId && !duplicateAppSecret) {
    return items;
  }
  return items.map((item) => {
    if (item.status !== "ready") {
      return item;
    }
    if (duplicateAppId && item.key === "FEISHU_SECOND_AGENT_APP_ID") {
      return {
        ...item,
        status: "invalid",
        reason: "must_differ_from_feishu_app_id",
      };
    }
    if (duplicateAppSecret && item.key === "FEISHU_SECOND_AGENT_APP_SECRET") {
      return {
        ...item,
        status: "invalid",
        reason: "must_differ_from_feishu_app_secret",
      };
    }
    return item;
  });
}

function assertLiveSmokeEnvReadyForNetwork(
  envFilePath: string | undefined,
  input: { strictLive: boolean; requireTodo120NativeSmoke: boolean },
): void {
  const report = buildSmokeEnvCheckOutput(envFilePath, {
    requireTodo120NativeSmoke: input.requireTodo120NativeSmoke,
  });
  const invalidEnvNames = report.items
    .filter((item) => item.status === "invalid")
    .filter((item) => item.required || item.key === "FEISHU_API_BASE_URL" || item.key === "FEISHU_SMOKE_SHEET_RANGE")
    .map((item) => item.key)
    .sort();
  if (invalidEnvNames.length > 0) {
    throw new SmokeCliError({
      code: "feishu.smoke.live_env_not_ready",
      message: `Live smoke env has invalid values. Run --check-env and fix ${invalidEnvNames.join(", ")} before --live.`,
      envNames: invalidEnvNames,
      reason: "invalid_env",
    });
  }

  if (!input.strictLive || report.missingRequired.length === 0) {
    if (!input.requireTodo120NativeSmoke || report.todo120NativeSmoke.ready) {
      return;
    }
    const missingTodo120EnvNames = [...report.todo120NativeSmoke.missing].sort();
    const invalidTodo120EnvNames = report.todo120NativeSmoke.invalid.map((item) => item.key).sort();
    const envNames = [...new Set([...missingTodo120EnvNames, ...invalidTodo120EnvNames])].sort();
    throw new SmokeCliError({
      code: "feishu.smoke.live_env_not_ready",
      message: `TODO120 native smoke env is incomplete. Run --check-env --require-todo120-native and set ${envNames.join(", ")} before --live --strict-live --require-todo120-native.`,
      envNames,
      reason: invalidTodo120EnvNames.length > 0 ? "invalid_todo120_native_env" : "missing_todo120_native_env",
    });
  }

  const missingEnvNames = [...report.missingRequired].sort();
  throw new SmokeCliError({
    code: "feishu.smoke.live_env_not_ready",
    message: `Strict live smoke env is missing required values. Run --check-env and set ${missingEnvNames.join(", ")} before --live --strict-live.`,
    envNames: missingEnvNames,
    reason: "missing_env",
  });
}

function validateHttpUrlEnv(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "must_be_http_or_https_url";
    }
    return undefined;
  } catch {
    return "must_be_valid_url";
  }
}

function validateAgentSpaceCallbackUrlEnv(value: string): string | undefined {
  const urlReason = validateHttpUrlEnv(value);
  if (urlReason) {
    return urlReason;
  }
  const url = new URL(value);
  if (url.pathname !== "/api/integrations/feishu/events") {
    return "must_be_agentspace_feishu_callback_url";
  }
  if (!url.searchParams.get("workspaceId")?.trim() || !url.searchParams.get("integrationId")?.trim()) {
    return "workspace_or_integration_query_missing";
  }
  return undefined;
}

function detectPlaceholderSmokeEnvValue(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  const placeholderMarkerPatterns = [
    /(^|[_-\s])xxx($|[_-\s])/,
    /(^|[_-\s])change[_-]?me($|[_-\s])/,
    /(^|[_-\s])replace[_-]?me($|[_-\s])/,
    /^(todo|placeholder)([_-\s:]|$)/,
    /(^|[_-\s:])(todo|placeholder)$/,
  ];
  if (
    !normalized
    || normalized.includes("<")
    || normalized.includes("example.com")
    || placeholderMarkerPatterns.some((pattern) => pattern.test(normalized))
  ) {
    return "placeholder_value";
  }
  return undefined;
}

function validateSheetWriteValuesEnv(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((row) => Array.isArray(row))) {
      return "must_be_json_array_of_rows";
    }
    return undefined;
  } catch {
    return "must_be_valid_json";
  }
}

function validateDocAppendBlocksEnv(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((block) =>
      block && typeof block === "object" && !Array.isArray(block)
    )) {
      return "must_be_json_array_of_blocks";
    }
    return undefined;
  } catch {
    return "must_be_valid_json";
  }
}

function validateBaseUpdateFieldsEnv(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "must_be_json_object";
    }
    return undefined;
  } catch {
    return "must_be_valid_json";
  }
}

function loadLarkSdk(): LarkSdkModule {
  const require = createRequire(new URL("../../packages/services/package.json", import.meta.url));
  return require("@larksuiteoapi/node-sdk") as LarkSdkModule;
}

function readFeishuApiOk(response: unknown): boolean {
  if (!response || typeof response !== "object") {
    return false;
  }
  const code = (response as { code?: unknown }).code;
  return code === undefined || code === 0;
}

function summarizeResponse(response: unknown): string {
  if (!response || typeof response !== "object") {
    return sanitizeSmokeOutputText(String(response));
  }
  const record = response as Record<string, unknown>;
  const code = typeof record.code === "number"
    ? record.code
    : typeof record.code === "string"
      ? sanitizeSmokeOutputText(record.code).slice(0, 200)
      : record.code === undefined
        ? undefined
        : "[non-scalar-code]";
  const msg = typeof record.msg === "string"
    ? sanitizeSmokeOutputText(record.msg).slice(0, 500)
    : record.msg === undefined
      ? undefined
      : "[non-string-msg]";
  return JSON.stringify({
    code,
    msg,
    dataKeys: record.data && typeof record.data === "object"
      ? Object.keys(record.data as Record<string, unknown>).slice(0, 12).map((key) => sanitizeSmokeOutputText(key))
      : undefined,
  });
}

function formatError(error: unknown): string {
  return sanitizeSmokeOutputText(error instanceof Error ? error.message : String(error));
}

function sanitizeSmokeOutputText(value: string): string {
  return value
    .replace(/https?:\/\/[^"'\s<>]+\/api\/integrations\/feishu\/events(?:\?[^"'\s<>]*)?/gi, "[redacted-callback-url]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(app_id|appId|app_secret|appSecret|tenant_access_token|tenantAccessToken|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*("[^"]+"|'[^']+'|[^,\s]+)/gi, "$1=[redacted]")
    .replace(/\b(?:doccn|doxcn|shtcn|bascn)[A-Za-z0-9_-]{4,}\b/gi, "[redacted-feishu-resource]")
    .replace(/\b(?:tbl|vew)[A-Za-z0-9_-]{4,}\b/gi, "[redacted-feishu-resource]")
    .replace(/\brec(?!eive|ord)[A-Za-z0-9_-]{4,}\b/gi, "[redacted-feishu-resource]")
    .replace(/\b(?:oc|ou|om|on)_[A-Za-z0-9_-]{4,}\b/gi, "[redacted-feishu-id]")
    .replace(/\b[\p{L}\p{N}_. -]{1,80}![A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\b/gu, "[redacted-sheet-range]");
}

function buildSmokeCliErrorOutput(error: unknown): SmokeCliErrorOutput {
  if (error instanceof SmokeCliError) {
    return {
      ok: false,
      errorCode: error.code,
      errorMessage: error.message,
      ...(error.envName ? { envName: error.envName } : {}),
      ...(error.envNames && error.envNames.length > 0 ? { envNames: error.envNames } : {}),
      ...(error.issues && error.issues.length > 0 ? { issues: error.issues } : {}),
      ...(error.reason ? { reason: error.reason } : {}),
    };
  }

  return {
    ok: false,
    errorCode: "feishu.smoke.failed",
    errorMessage: formatError(error).slice(0, 500),
  };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function verifyFeishuBotAddedPayloadFile(path: string): FeishuBotAddedPayloadVerificationOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    const issues = ["bot_added_payload_unreadable"];
    return buildFeishuBotAddedPayloadVerificationOutput({
      payloadPath: path,
      payload: {},
      issues,
    });
  }

  const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined;
  const issues: string[] = [];
  if (!payload) {
    issues.push("bot_added_payload_not_object");
  }

  const safePayload = payload ?? {};
  if (!isFeishuBotAddedToChatPayload(safePayload)) {
    issues.push("bot_added_event_not_recognized");
  }
  if (!resolveFeishuChatDescriptor(safePayload)) {
    issues.push("bot_added_chat_descriptor_missing");
  }

  const output = buildFeishuBotAddedPayloadVerificationOutput({
    payloadPath: path,
    payload: safePayload,
    issues,
  });
  const serialized = JSON.stringify(output);
  if (containsSecretLikeEvidence(serialized)) {
    output.issues.push("bot_added_summary_secret_like_value");
  }
  if (containsRawFeishuEvidenceIdentifier(serialized)) {
    output.issues.push("bot_added_summary_raw_feishu_identifier");
  }
  if (containsAgentSpaceCallbackUrlEvidence(serialized)) {
    output.issues.push("bot_added_summary_callback_url");
  }
  output.valid = output.issues.length === 0;
  return output;
}

function buildFeishuBotAddedPayloadVerificationOutput(input: {
  payloadPath: string;
  payload: Record<string, unknown>;
  issues: string[];
}): FeishuBotAddedPayloadVerificationOutput {
  const descriptor = resolveFeishuChatDescriptor(input.payload);
  const eventSummary = summarizeFeishuInboundEventPayload(input.payload);
  const externalEventReference = readString(eventSummary.externalEventReference);
  const externalEventIdRedacted = eventSummary.externalEventIdRedacted === true;
  const payloadHash = readString(eventSummary.payloadHash) ?? sha256Json(input.payload);
  const chatName = descriptor?.externalChatName?.trim();
  return {
    payloadPath: sanitizeSmokeOutputText(input.payloadPath),
    valid: input.issues.length === 0,
    issues: [...input.issues],
    summary: {
      eventType: sanitizeSmokeOutputText(resolveFeishuEventType(input.payload)).slice(0, 160),
      botAddedEvent: isFeishuBotAddedToChatPayload(input.payload),
      chatDescriptorPresent: Boolean(descriptor),
      ...(descriptor ? { chatIdSource: resolveFeishuChatIdSource(input.payload) } : {}),
      ...(descriptor ? { chatReference: buildSafeReference("chat", descriptor.externalChatId) } : {}),
      chatIdRedacted: Boolean(descriptor?.externalChatId),
      ...(descriptor?.externalChatType
        ? { chatType: sanitizeSmokeOutputText(descriptor.externalChatType).slice(0, 80) }
        : {}),
      chatNamePresent: Boolean(chatName),
      ...(chatName ? { chatNameHash: sha256Text(chatName) } : {}),
      ...(chatName ? { chatNameLength: Buffer.byteLength(chatName, "utf8") } : {}),
      ...(externalEventReference ? { externalEventReference } : {}),
      externalEventIdRedacted,
      payloadHash,
      rawPayloadStored: false,
    },
  };
}

function resolveFeishuChatIdSource(payload: Record<string, unknown>): string | undefined {
  const event = readRecord(payload.event);
  const message = readRecord(event?.message);
  const chat = readRecord(event?.chat) ?? readRecord(message?.chat);
  const candidates: Array<[string, unknown]> = [
    ["event.message.chat_id", message?.chat_id],
    ["event.message.chatId", message?.chatId],
    ["event.chat_id", event?.chat_id],
    ["event.chatId", event?.chatId],
    ["event.chat.chat_id", chat?.chat_id],
    ["event.chat.chatId", chat?.chatId],
    ["event.chat.open_chat_id", chat?.open_chat_id],
    ["event.chat.openChatId", chat?.openChatId],
    ["event.chat.id", chat?.id],
  ];
  return candidates.find(([, value]) => typeof value === "string" && value.trim())?.[0];
}

function formatCallbackProbeError(error: unknown, callbackUrl: string | undefined): string {
  let message = formatError(error);
  if (callbackUrl) {
    message = message.split(callbackUrl).join("[redacted-callback-url]");
  }
  return message.slice(0, 500);
}

function verifySmokeEvidenceFile(path: string): SmokeEvidenceVerificationOutput {
  const evidence = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return verifySmokeEvidence(path, evidence);
}

function verifySmokeEvidence(path: string, evidence: unknown): SmokeEvidenceVerificationOutput {
  const issues: string[] = [];
  const output = evidence && typeof evidence === "object" ? evidence as Partial<SmokeOutput> : undefined;
  const summary = output?.summary && typeof output.summary === "object"
    ? output.summary as Partial<SmokeSummary>
    : undefined;
  const todo120NativeSmoke = output?.todo120NativeSmoke && typeof output.todo120NativeSmoke === "object"
    ? output.todo120NativeSmoke as Partial<SmokeEnvCheckOutput["todo120NativeSmoke"]>
    : undefined;
  const steps = Array.isArray(output?.steps) ? output.steps : [];

  if (!output) {
    issues.push("evidence_not_object");
  }
  if (output?.live !== true) {
    issues.push("not_live_run");
  }
  if (output?.strictLive !== true) {
    issues.push("not_strict_live_run");
  }
  if (summary?.strictLiveSatisfied !== true) {
    issues.push("strict_live_not_satisfied");
  }
  if ((summary?.liveSkipped ?? 0) !== 0) {
    issues.push("live_steps_skipped");
  }
  if ((summary?.liveFailed ?? 0) !== 0) {
    issues.push("live_steps_failed");
  }
  if ((summary?.missingEnv?.length ?? 0) !== 0) {
    issues.push("missing_live_env");
  }
  if (!todo120NativeSmoke) {
    issues.push("todo120_native_smoke_missing");
  } else {
    if (todo120NativeSmoke.requiredForCommand !== true) {
      issues.push("todo120_native_smoke_not_required");
    }
    if (todo120NativeSmoke.ready !== true) {
      issues.push("todo120_native_smoke_not_ready");
    }
    if (readNumber(todo120NativeSmoke.required) < 2) {
      issues.push("todo120_native_smoke_requirement_incomplete");
    }
    if (readNumber(todo120NativeSmoke.configured) < readNumber(todo120NativeSmoke.required)) {
      issues.push("todo120_native_smoke_env_incomplete");
    }
  }
  if (readNumber(summary?.liveChecks) < FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length) {
    issues.push("live_check_summary_incomplete");
  }
  if (readNumber(summary?.livePassed) < FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length) {
    issues.push("live_passed_summary_incomplete");
  }

  for (const stepName of FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS) {
    const step = steps.find((item) => isSafeSmokeStepNamed(item, stepName));
    if (!step) {
      issues.push(`required_step_missing:${stepName}`);
      continue;
    }
    if (step.status !== "pass") {
      issues.push(`required_step_not_passed:${stepName}`);
    }
    if (step.liveCheck !== true) {
      issues.push(`required_step_not_marked_live:${stepName}`);
    }
  }

  for (const eventType of FEISHU_REQUIRED_EVENTS) {
    const stepName = `EventDispatcher ${eventType}`;
    const step = steps.find((item) => isSafeSmokeStepNamed(item, stepName));
    if (!step) {
      issues.push(`required_event_dispatcher_step_missing:${eventType}`);
      continue;
    }
    if (step.status !== "pass") {
      issues.push(`required_event_dispatcher_step_failed:${eventType}`);
    }
  }

  const callbackStep = steps.find((item) => isSafeSmokeStepNamed(item, "AgentSpace callback URL verification"));
  if (!hasValidCallbackRouteProof(callbackStep)) {
    issues.push("callback_route_proof_missing");
  }

  for (const stepName of FEISHU_OPENAPI_REQUIRED_REQUEST_STEPS) {
    const step = steps.find((item) => isSafeSmokeStepNamed(item, stepName));
    if (!step) {
      continue;
    }
    if (!hasSafeSmokeRequestSummary(step)) {
      issues.push(`required_request_summary_missing:${stepName}`);
    }
  }

  const sheetWrite = steps.find((item) => isSafeSmokeStepNamed(item, "Sheets write values"));
  const docAppend = steps.find((item) => isSafeSmokeStepNamed(item, "Docs docx append blocks"));
  const baseUpdate = steps.find((item) => isSafeSmokeStepNamed(item, "Base update record"));
  if (docAppend?.destructive !== true) {
    issues.push("doc_append_not_marked_destructive");
  }
  if (sheetWrite?.destructive !== true) {
    issues.push("sheet_write_not_marked_destructive");
  }
  if (baseUpdate?.destructive !== true) {
    issues.push("base_update_not_marked_destructive");
  }
  if ((summary?.destructiveLiveChecks ?? 0) < FEISHU_OPENAPI_REQUIRED_DESTRUCTIVE_LIVE_SMOKE_STEPS.length) {
    issues.push("destructive_live_checks_missing");
  }

  for (const step of steps) {
    if (!isSafeSmokeStep(step)) {
      continue;
    }
    if (hasSmokeRequestObject(step) && !hasSafeSmokeRequestSummary(step)) {
      issues.push(`request_summary_malformed:${step.name}`);
    } else if (hasSafeSmokeRequestSummary(step) && !isRedactedSmokeRequestPath(step.request.path)) {
      issues.push(`request_path_not_redacted:${step.name}`);
    }
    if (typeof step.detail === "string" && containsRawFeishuEvidenceIdentifier(step.detail)) {
      issues.push(`raw_feishu_identifier_in_detail:${step.name}`);
    }
    if (typeof step.detail === "string" && containsAgentSpaceCallbackUrlEvidence(step.detail)) {
      issues.push(`callback_url_in_detail:${step.name}`);
    }
  }

  if (containsSecretLikeEvidence(JSON.stringify(evidence))) {
    issues.push("secret_like_value_in_evidence");
  }
  if (containsRawFeishuEvidenceIdentifier(JSON.stringify(evidence))) {
    issues.push("raw_feishu_identifier_in_evidence");
  }
  if (containsAgentSpaceCallbackUrlEvidence(JSON.stringify(evidence))) {
    issues.push("callback_url_in_evidence");
  }

  return {
    evidencePath: path,
    valid: issues.length === 0,
    issues,
    summary: {
      live: output?.live === true,
      strictLive: output?.strictLive === true,
      strictLiveSatisfied: summary?.strictLiveSatisfied === true,
      liveChecks: readNumber(summary?.liveChecks),
      livePassed: readNumber(summary?.livePassed),
      liveSkipped: readNumber(summary?.liveSkipped),
      liveFailed: readNumber(summary?.liveFailed),
      destructiveLiveChecks: readNumber(summary?.destructiveLiveChecks),
      requiredLiveSteps: FEISHU_OPENAPI_REQUIRED_LIVE_SMOKE_STEPS.length,
      todo120NativeSmokeReady: todo120NativeSmoke?.ready === true,
      todo120NativeSmokeRequiredForCommand: todo120NativeSmoke?.requiredForCommand === true,
      todo120NativeSmokeRequired: readNumber(todo120NativeSmoke?.required),
      todo120NativeSmokeConfigured: readNumber(todo120NativeSmoke?.configured),
    },
  };
}

function isSafeSmokeStepNamed(value: unknown, name: string): value is SafeSmokeStep {
  return isSafeSmokeStep(value) && value.name === name;
}

function isSafeSmokeStep(value: unknown): value is SafeSmokeStep {
  return Boolean(value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string");
}

function hasSmokeRequestObject(value: SafeSmokeStep): boolean {
  return Boolean(value.request && typeof value.request === "object");
}

function hasSafeSmokeRequestSummary(value: SafeSmokeStep): value is SafeSmokeStep & { request: SafeFeishuApiRequest } {
  return Boolean(
    value.request &&
    typeof value.request === "object" &&
    typeof (value.request as { method?: unknown }).method === "string" &&
    typeof (value.request as { path?: unknown }).path === "string" &&
    (value.request as { path: string }).path.trim().length > 0
  );
}

function isRedactedSmokeRequestPath(path: string): boolean {
  if (!path.startsWith("/open-apis/")) {
    return false;
  }
  if (path.startsWith("/open-apis/docx/v1/documents/")) {
    return [
      "/open-apis/docx/v1/documents/:doc_token/blocks",
      "/open-apis/docx/v1/documents/:doc_token/blocks/:parent_block_id/children",
    ].includes(path);
  }
  if (path.startsWith("/open-apis/sheets/v2/spreadsheets/")) {
    return [
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/metainfo",
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/values",
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/:range",
    ].includes(path);
  }
  if (path.startsWith("/open-apis/bitable/v1/apps/")) {
    return [
      "/open-apis/bitable/v1/apps/:app_token/tables",
      "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records",
      "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id",
    ].includes(path);
  }
  return true;
}

function containsSecretLikeEvidence(serialized: string): boolean {
  return [
    /\bBearer\s+[A-Za-z0-9._-]{8,}/i,
    /\b(?:tenant_access_token|tenantAccessToken|app_secret|appSecret|verification_token|verificationToken|encrypt_key|encryptKey)\b\s*[:=]\s*["']?[A-Za-z0-9._-]{4,}/i,
  ].some((pattern) => pattern.test(serialized));
}

function containsRawFeishuEvidenceIdentifier(serialized: string): boolean {
  return [
    /\b(?:doccn|doxcn|shtcn|bascn)[A-Za-z0-9_-]{4,}\b/i,
    /\b(?:tbl|vew)[A-Za-z0-9_-]{4,}\b/i,
    /\brec(?!eive|ord)[A-Za-z0-9_-]{4,}\b/i,
    /\b(?:oc|ou|om|on)_[A-Za-z0-9_-]{4,}\b/i,
    /\b[\p{L}\p{N}_. -]{1,80}![A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\b/u,
  ].some((pattern) => pattern.test(serialized));
}

function containsAgentSpaceCallbackUrlEvidence(serialized: string): boolean {
  return /https?:\/\/[^"'\s<>]+\/api\/integrations\/feishu\/events(?:\?[^"'\s<>]*)?/i.test(serialized);
}

function buildCallbackRouteProof(
  callbackUrl: string | undefined,
): Pick<SmokeStep, "callbackRoute" | "callbackRouteFingerprint"> {
  if (!callbackUrl) {
    return {};
  }
  try {
    const url = new URL(callbackUrl);
    const workspaceId = url.searchParams.get("workspaceId")?.trim();
    const integrationId = url.searchParams.get("integrationId")?.trim();
    if (url.pathname !== "/api/integrations/feishu/events" || !workspaceId || !integrationId) {
      return {};
    }
    const routeKey = `${url.pathname}?workspaceId=${workspaceId}&integrationId=${integrationId}`;
    return {
      callbackRoute: url.pathname,
      callbackRouteFingerprint: `sha256:${createHash("sha256").update(routeKey, "utf8").digest("hex").slice(0, 16)}`,
    };
  } catch {
    return {};
  }
}

function hasValidCallbackRouteProof(step: unknown): boolean {
  if (!step || typeof step !== "object") {
    return false;
  }
  const value = step as Record<string, unknown>;
  return value.callbackRoute === "/api/integrations/feishu/events" &&
    typeof value.callbackRouteFingerprint === "string" &&
    /^sha256:[a-f0-9]{16}$/.test(value.callbackRouteFingerprint);
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSafeReference(kind: string, value: string): string {
  return `${kind} ${sha256Text(value).slice(0, 16)}`;
}

function buildSmokeOutput(input: {
  live: boolean;
  strictLive: boolean;
  summary: SmokeSummary;
  todo120NativeSmoke: SmokeEnvCheckOutput["todo120NativeSmoke"];
  steps: SmokeStep[];
}): SmokeOutput {
  return {
    generatedAt: new Date().toISOString(),
    live: input.live,
    strictLive: input.strictLive,
    summary: input.summary,
    todo120NativeSmoke: input.todo120NativeSmoke,
    steps: input.steps.map((step) => ({
      ...step,
      ...(step.detail ? { detail: sanitizeSmokeOutputText(step.detail) } : {}),
      request: step.request ? summarizeFeishuApiRequest(step.request) : undefined,
    })),
  };
}

function summarizeFeishuApiRequest(request: FeishuApiRequest): SafeFeishuApiRequest {
  return {
    method: request.method,
    path: redactFeishuApiPath(request.path),
    ...(request.query && typeof request.query === "object"
      ? { queryKeys: Object.keys(request.query as Record<string, unknown>).sort() }
      : {}),
    ...(request.body && typeof request.body === "object"
      ? { bodyKeys: Object.keys(request.body as Record<string, unknown>).sort() }
      : {}),
  };
}

function redactFeishuApiPath(path: string): string {
  return path
    .replace(
      /^\/open-apis\/docx\/v1\/documents\/[^/]+\/blocks$/,
      "/open-apis/docx/v1/documents/:doc_token/blocks",
    )
    .replace(
      /^\/open-apis\/docx\/v1\/documents\/[^/]+\/blocks\/[^/]+\/children$/,
      "/open-apis/docx/v1/documents/:doc_token/blocks/:parent_block_id/children",
    )
    .replace(
      /^\/open-apis\/sheets\/v2\/spreadsheets\/[^/]+\/metainfo$/,
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/metainfo",
    )
    .replace(
      /^\/open-apis\/sheets\/v2\/spreadsheets\/[^/]+\/values\/.+$/,
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/values/:range",
    )
    .replace(
      /^\/open-apis\/sheets\/v2\/spreadsheets\/[^/]+\/values$/,
      "/open-apis/sheets/v2/spreadsheets/:sheet_token/values",
    )
    .replace(
      /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/[^/]+$/,
      "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records/:record_id",
    )
    .replace(
      /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records$/,
      "/open-apis/bitable/v1/apps/:app_token/tables/:table_id/records",
    )
    .replace(
      /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/,
      "/open-apis/bitable/v1/apps/:app_token/tables",
    );
}

function writeVerifiedEvidenceFile(path: string, output: SmokeOutput): void {
  const verification = verifySmokeEvidence(path, output);
  if (!verification.valid) {
    throw new SmokeCliError({
      code: "feishu.smoke.evidence_verification_failed",
      message: "Feishu smoke evidence failed redaction or coverage verification before writing.",
      issues: verification.issues,
      reason: "verification_failed",
    });
  }

  const directory = dirname(path);
  if (directory && directory !== ".") {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function summarizeSteps(input: {
  live: boolean;
  strictLive: boolean;
  steps: SmokeStep[];
}): SmokeSummary {
  const liveSteps = input.steps.filter((step) => step.liveCheck);
  const missingEnv = new Set<string>();
  for (const step of liveSteps) {
    for (const envName of findMissingEnv(step.requiredEnv ?? [])) {
      missingEnv.add(envName);
    }
  }

  return {
    total: input.steps.length,
    passed: input.steps.filter((step) => step.status === "pass").length,
    skipped: input.steps.filter((step) => step.status === "skip").length,
    failed: input.steps.filter((step) => step.status === "fail").length,
    liveChecks: liveSteps.length,
    livePassed: input.live ? liveSteps.filter((step) => step.status === "pass").length : 0,
    liveSkipped: input.live ? liveSteps.filter((step) => step.status === "skip").length : liveSteps.length,
    liveFailed: input.live ? liveSteps.filter((step) => step.status === "fail").length : 0,
    destructiveLiveChecks: liveSteps.filter((step) => step.destructive).length,
    missingEnv: Array.from(missingEnv).sort(),
    strictLiveSatisfied: input.live &&
      liveSteps.length > 0 &&
      liveSteps.every((step) => step.status === "pass") &&
      missingEnv.size === 0,
  };
}

function findMissingEnv(envNames: string[]): string[] {
  return envNames.filter((envName) => !readEnv(envName));
}

function formatMissingEnvDetail(envNames: string[], action: string): string {
  const missing = findMissingEnv(envNames);
  if (missing.length === 0) {
    return `Set the live resource values to ${action}.`;
  }
  return `Set ${missing.join(", ")} to ${action}.`;
}

function printHumanSummary(input: {
  live: boolean;
  strictLive: boolean;
  summary: SmokeSummary;
  steps: SafeSmokeStep[];
}): void {
  console.log(`Feishu smoke (${input.live ? "live" : "dry-run"})`);
  console.log(
    `Summary: ${input.summary.passed} pass, ${input.summary.skipped} skip, ${input.summary.failed} fail.`,
  );
  if (input.live) {
    console.log(
      `Live coverage: ${input.summary.livePassed}/${input.summary.liveChecks} checks passed`
      + ` (${input.summary.destructiveLiveChecks} write checks configured in the plan).`,
    );
    if (input.strictLive) {
      console.log(`Strict live gate: ${input.summary.strictLiveSatisfied ? "satisfied" : "not satisfied"}.`);
    }
  } else {
    console.log("Live coverage: not executed; rerun with --live --strict-live after setting smoke env.");
  }
  if (input.summary.missingEnv.length > 0) {
    console.log(`Missing live env: ${input.summary.missingEnv.join(", ")}`);
  }

  for (const step of input.steps) {
    const icon = step.status === "pass" ? "PASS" : step.status === "skip" ? "SKIP" : "FAIL";
    const writeNote = step.destructive ? " [writes external data]" : "";
    console.log(`- ${icon} ${step.name}${writeNote}${step.detail ? `: ${step.detail}` : ""}`);
    if (!input.live && step.request) {
      console.log(`  ${step.request.method} ${step.request.path}`);
    }
  }
}

function printSmokeEnvCheckSummary(input: SmokeEnvCheckOutput): void {
  console.log(`Feishu live smoke env: ${input.ready ? "ready" : "not ready"}`);
  if (input.envFilePath) {
    console.log(`Env file: ${input.envFilePath}`);
  }
  console.log(
    `Required env: ${input.summary.ready}/${input.summary.required} ready`
    + `, ${input.summary.missing} missing`
    + `, ${input.summary.invalid} invalid.`,
  );
  if (input.summary.optionalConfigured > 0) {
    console.log(`Optional env configured: ${input.summary.optionalConfigured}.`);
  }
  console.log(
    `TODO120 native multi-agent env: ${input.todo120NativeSmoke.configured}/`
    + `${input.todo120NativeSmoke.required} configured`
    + `${input.todo120NativeSmoke.requiredForCommand ? " (required for this command)" : ""}.`,
  );
  if (!input.todo120NativeSmoke.ready) {
    const missing = input.todo120NativeSmoke.missing.length > 0
      ? ` missing ${input.todo120NativeSmoke.missing.join(", ")}`
      : "";
    const invalid = input.todo120NativeSmoke.invalid.length > 0
      ? ` invalid ${input.todo120NativeSmoke.invalid.map((item) => `${item.key}:${item.reason}`).join(", ")}`
      : "";
    console.log(`TODO120 native multi-agent smoke not ready:${missing}${invalid}`);
  }
  if (input.missingRequired.length > 0) {
    console.log(`Missing required env: ${input.missingRequired.join(", ")}`);
  }
  if (input.invalidRequired.length > 0) {
    console.log(`Invalid required env: ${input.invalidRequired.map((item) => `${item.key}:${item.reason}`).join(", ")}`);
  }

  for (const item of input.items) {
    const marker = item.status === "ready"
      ? "READY"
      : item.status === "missing"
        ? "MISSING"
        : item.status === "invalid"
          ? "INVALID"
          : "OPTIONAL";
    const reason = item.reason ? ` (${item.reason})` : "";
    console.log(`- ${marker} [${item.group}] ${item.key}${reason}: ${item.note}`);
  }
}

function printEvidenceVerificationSummary(input: SmokeEvidenceVerificationOutput): void {
  console.log(`Feishu smoke evidence: ${input.valid ? "valid" : "invalid"}`);
  console.log(`Evidence: ${input.evidencePath}`);
  console.log(
    `Live checks: ${input.summary.livePassed}/${input.summary.liveChecks} passed`
    + `; required steps: ${input.summary.requiredLiveSteps}`
    + `; destructive checks: ${input.summary.destructiveLiveChecks}`,
  );
  console.log(
    `TODO120 native env: ${input.summary.todo120NativeSmokeConfigured}/`
    + `${input.summary.todo120NativeSmokeRequired} configured`
    + `; required: ${input.summary.todo120NativeSmokeRequiredForCommand ? "yes" : "no"}`
    + `; ready: ${input.summary.todo120NativeSmokeReady ? "yes" : "no"}`,
  );
  if (input.issues.length > 0) {
    console.log(`Issues: ${input.issues.join(", ")}`);
  }
}

function printBotAddedPayloadVerificationSummary(input: FeishuBotAddedPayloadVerificationOutput): void {
  console.log(`Feishu bot-added payload: ${input.valid ? "valid" : "invalid"}`);
  console.log(`Payload: ${input.payloadPath}`);
  console.log(
    `Event: ${input.summary.eventType || "(missing)"}`
    + `; bot-added: ${input.summary.botAddedEvent ? "yes" : "no"}`
    + `; chat descriptor: ${input.summary.chatDescriptorPresent ? "yes" : "no"}`,
  );
  console.log(
    `Chat: ${input.summary.chatReference ?? "(missing)"}`
    + `; source: ${input.summary.chatIdSource ?? "(missing)"}`
    + `; name: ${input.summary.chatNamePresent ? "present" : "missing"}`
    + "; raw payload stored: no",
  );
  if (input.issues.length > 0) {
    console.log(`Issues: ${input.issues.join(", ")}`);
  }
}

function readArgValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path.`);
  }
  return value;
}

main().catch((error) => {
  const output = buildSmokeCliErrorOutput(error);
  if (json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.error(`${output.errorCode}: ${output.errorMessage}`);
  }
  process.exitCode = 1;
});
