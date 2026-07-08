import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type SmokeStatus = "pass" | "fail";
type SlackSmokeLiveMode = "post_message" | "app_mention" | "file_upload";

interface SlackSmokeEnvItem {
  key: string;
  required: boolean;
  status: SmokeStatus;
  note: string;
}

interface SlackSmokeOutput {
  generatedAt: string;
  mode: "dry-run" | "live" | "webhook-replay";
  live: boolean;
  ready: boolean;
  context?: SlackSmokeContext;
  liveResult?: SlackSmokeLiveResult;
  webhookReplay?: SlackSmokeWebhookReplayResult;
  summary: {
    required: number;
    passed: number;
    failed: number;
  };
  missingRequired: string[];
  items: SlackSmokeEnvItem[];
  manualActions: SlackSmokeManualAction[];
  nextCommands: string[];
  evidenceArtifact?: SlackSmokeEvidenceArtifactStatus;
}

interface SlackSmokeContext {
  workspaceId?: string;
  integrationId?: string;
  appReference?: string;
  teamReference?: string;
}

interface SlackSmokeLiveResult {
  attempted: boolean;
  ok: boolean;
  mode: SlackSmokeLiveMode;
  channelReference?: string;
  channelRef?: string;
  messageReference?: string;
  messageRef?: string;
  botUserReference?: string;
  botUserRef?: string;
  fileReference?: string;
  fileRef?: string;
  appMentionText?: boolean;
  fileUpload?: boolean;
  uploadCompleted?: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
}

interface SlackSmokeWebhookReplayResult {
  attempted: boolean;
  ok: boolean;
  callbackReference?: string;
  challenge?: SlackSmokeWebhookReplayStep;
  event?: SlackSmokeWebhookReplayStep & {
    eventStatus?: string;
    dispatchStatus?: string;
    reasonCode?: string;
  };
  errorCode?: string;
  errorMessage?: string;
}

interface SlackSmokeWebhookReplayStep {
  ok: boolean;
  status: number;
  errorCode?: string;
  errorMessage?: string;
}

interface SlackSmokeEvidenceArtifactStatus {
  path: string;
  written: boolean;
  reasonCode?: "slack.smoke.evidence_requires_live_or_replay" | "slack.smoke.evidence_output_not_ready";
}

interface SlackSmokeManualAction {
  id: "native_agent_experience" | "approval_block_actions";
  detail: string;
}

interface SlackSmokeEvidenceVerificationOutput {
  evidencePath: string;
  checkedAt: string;
  valid: boolean;
  generatedAt?: string;
  context?: SlackSmokeContext;
  summary: {
    runCount: number;
    freshRunCount: number;
    requiredModes: SlackSmokeLiveMode[];
    satisfiedModes: SlackSmokeLiveMode[];
    missingModes: SlackSmokeLiveMode[];
    contextMatched: boolean;
    channelMatched: boolean;
    channelReferences: string[];
    malformedReferenceCount: number;
  };
  expectedContext?: SlackSmokeContext;
  issues: string[];
  manualActions: SlackSmokeManualAction[];
  nextCommands: string[];
}

interface SlackSmokeFatalOutput {
  generatedAt: string;
  mode: SlackSmokeOutput["mode"] | "verify-evidence";
  ready: false;
  errorCode: "slack.smoke.env_file_read_failed" | "slack.smoke.unexpected_error";
  errorMessage: string;
  envFileReference?: string;
  issues: string[];
  nextCommands: string[];
}

interface ParsedArgs {
  flags: Record<string, string | boolean>;
}

const SLACK_SMOKE_REQUIRED_LIVE_MODES: SlackSmokeLiveMode[] = ["post_message", "app_mention", "file_upload"];
const SLACK_SMOKE_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const REQUIRED_ENV = [
  "AGENT_SPACE_WORKSPACE_ID",
  "AGENT_SPACE_SLACK_INTEGRATION_ID",
  "AGENT_SPACE_PUBLIC_APP_URL",
  "SLACK_SMOKE_CALLBACK_URL",
  "SLACK_SMOKE_CHANNEL_ID",
  "SLACK_SMOKE_USER_ID",
  "SLACK_SMOKE_APP_ID",
  "SLACK_SMOKE_TEAM_ID",
] as const;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const verifyEvidencePath = getStringFlag(parsed.flags, "verify-evidence");
  if (verifyEvidencePath) {
    const envFile = getStringFlag(parsed.flags, "env-file");
    const expectedContext = envFile ? buildSlackSmokeContext(readEnv(envFile)) : undefined;
    const output = verifySlackSmokeEvidenceFile(verifyEvidencePath, {
      expectedContext,
      requireExpectedContext: Boolean(envFile),
    });
    if (parsed.flags.json === true) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatSlackSmokeEvidenceVerificationOutput(output));
    }
    process.exitCode = output.valid ? 0 : 1;
    return;
  }
  const env = readEnv(getStringFlag(parsed.flags, "env-file"));
  const output = parsed.flags["replay-webhook"] === true
    ? await buildSlackSmokeWebhookReplayOutput(env)
    : parsed.flags.live === true
    ? await buildSlackSmokeLiveOutput(env)
    : buildSlackSmokeDryRunOutput(env);
  const evidencePath = getStringFlag(parsed.flags, "evidence");
  const evidenceArtifact = writeSlackSmokeEvidenceArtifactIfRequested(evidencePath, output);
  const finalOutput = evidenceArtifact ? { ...output, evidenceArtifact } : output;
  if (parsed.flags.json === true) {
    console.log(JSON.stringify(finalOutput, null, 2));
  } else {
    console.log(formatSlackSmokeDryRunOutput(finalOutput));
  }
  process.exitCode = finalOutput.ready && (!evidenceArtifact || evidenceArtifact.written) ? 0 : 1;
}

export function buildSlackSmokeDryRunOutput(env: Record<string, string | undefined>): SlackSmokeOutput {
  const items = REQUIRED_ENV.map((key): SlackSmokeEnvItem => {
    const value = env[key]?.trim();
    const ready = Boolean(value) && !isPlaceholderValue(value) && isWellFormedEnvValue(key, value);
    return {
      key,
      required: true,
      status: ready ? "pass" : "fail",
      note: describeSlackSmokeEnvItem(key, value, ready),
    };
  });
  const missingRequired = items
    .filter((item) => item.status === "fail")
    .map((item) => item.key);
  return {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    live: false,
    ready: missingRequired.length === 0,
    context: buildSlackSmokeContext(env),
    summary: {
      required: items.length,
      passed: items.filter((item) => item.status === "pass").length,
      failed: missingRequired.length,
    },
    missingRequired,
    items,
    manualActions: buildSlackSmokeManualActions(),
    nextCommands: [
      "agent-space integrations slack health-check --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
      "agent-space integrations slack readiness --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --json",
      "npm run smoke:slack -- --env-file scripts/slack/.env --replay-webhook --json",
      "npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json",
      "SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json",
      "agent-space integrations slack outbox drain --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
      "SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json",
      "npm run smoke:slack:verify -- --env-file scripts/slack/.env --json",
      "agent-space integrations slack evidence --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --require message --json",
      "agent-space integrations slack evidence --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --live-smoke-evidence runtime-output/slack-smoke/live.json --strict --require all --json",
    ],
  };
}

export async function buildSlackSmokeLiveOutput(env: Record<string, string | undefined>): Promise<SlackSmokeOutput> {
  const dryRunOutput = buildSlackSmokeDryRunOutput(env);
  const liveMode = readSlackSmokeLiveMode(env.SLACK_SMOKE_LIVE_MODE);
  const botToken = env.SLACK_BOT_TOKEN?.trim();
  const postToken = env.SLACK_SMOKE_POST_TOKEN?.trim();
  const channelId = env.SLACK_SMOKE_CHANNEL_ID?.trim();
  const appId = env.SLACK_SMOKE_APP_ID?.trim();
  const teamId = env.SLACK_SMOKE_TEAM_ID?.trim();
  const messageText = env.SLACK_SMOKE_MESSAGE_TEXT?.trim() || "AgentSpace Slack smoke";
  const threadTs = env.SLACK_SMOKE_THREAD_TS?.trim();
  const botUserId = env.SLACK_SMOKE_BOT_USER_ID?.trim();
  const fileName = env.SLACK_SMOKE_FILE_NAME?.trim() || "agentspace-slack-smoke.txt";
  const fileTitle = env.SLACK_SMOKE_FILE_TITLE?.trim() || "AgentSpace Slack smoke file";
  const fileContent = env.SLACK_SMOKE_FILE_CONTENT?.trim() || "AgentSpace Slack file smoke\n";
  const fileMime = env.SLACK_SMOKE_FILE_MIME?.trim() || "text/plain";
  const missingLive = [
    ...((liveMode === "post_message" || liveMode === "file_upload") && botToken && !isPlaceholderValue(botToken) ? [] : liveMode === "post_message" || liveMode === "file_upload" ? ["SLACK_BOT_TOKEN"] : []),
    ...(liveMode === "app_mention" && postToken && !isPlaceholderValue(postToken) ? [] : liveMode === "app_mention" ? ["SLACK_SMOKE_POST_TOKEN"] : []),
    ...(liveMode === "app_mention" && botUserId && !isPlaceholderValue(botUserId) ? [] : liveMode === "app_mention" ? ["SLACK_SMOKE_BOT_USER_ID"] : []),
    ...(channelId && !isPlaceholderValue(channelId) ? [] : ["SLACK_SMOKE_CHANNEL_ID"]),
    ...(appId && !isPlaceholderValue(appId) ? [] : ["SLACK_SMOKE_APP_ID"]),
    ...(teamId && !isPlaceholderValue(teamId) ? [] : ["SLACK_SMOKE_TEAM_ID"]),
  ];
  const items = [
    ...dryRunOutput.items,
    {
      key: "SLACK_SMOKE_LIVE_MODE",
      required: true,
      status: "pass",
      note: liveMode,
    } satisfies SlackSmokeEnvItem,
    {
      key: "SLACK_BOT_TOKEN",
      required: liveMode === "post_message" || liveMode === "file_upload",
      status: missingLive.includes("SLACK_BOT_TOKEN") ? "fail" : "pass",
      note: liveMode === "post_message" || liveMode === "file_upload"
        ? missingLive.includes("SLACK_BOT_TOKEN") ? "missing_or_placeholder" : "configured"
        : "not_required_for_app_mention_mode",
    } satisfies SlackSmokeEnvItem,
    {
      key: "SLACK_SMOKE_APP_ID",
      required: true,
      status: missingLive.includes("SLACK_SMOKE_APP_ID") ? "fail" : "pass",
      note: missingLive.includes("SLACK_SMOKE_APP_ID") ? "missing_or_placeholder" : "configured",
    } satisfies SlackSmokeEnvItem,
    {
      key: "SLACK_SMOKE_TEAM_ID",
      required: true,
      status: missingLive.includes("SLACK_SMOKE_TEAM_ID") ? "fail" : "pass",
      note: missingLive.includes("SLACK_SMOKE_TEAM_ID") ? "missing_or_placeholder" : "configured",
    } satisfies SlackSmokeEnvItem,
    ...(liveMode === "app_mention" ? [
      {
        key: "SLACK_SMOKE_POST_TOKEN",
        required: true,
        status: missingLive.includes("SLACK_SMOKE_POST_TOKEN") ? "fail" : "pass",
        note: missingLive.includes("SLACK_SMOKE_POST_TOKEN") ? "missing_or_placeholder" : "configured",
      } satisfies SlackSmokeEnvItem,
      {
        key: "SLACK_SMOKE_BOT_USER_ID",
        required: true,
        status: missingLive.includes("SLACK_SMOKE_BOT_USER_ID") ? "fail" : "pass",
        note: missingLive.includes("SLACK_SMOKE_BOT_USER_ID") ? "missing_or_placeholder" : "configured",
      } satisfies SlackSmokeEnvItem,
    ] : []),
    ...(liveMode === "file_upload" ? [
      {
        key: "SLACK_SMOKE_FILE_NAME",
        required: false,
        status: "pass",
        note: fileName === "agentspace-slack-smoke.txt" ? "default" : "configured",
      } satisfies SlackSmokeEnvItem,
      {
        key: "SLACK_SMOKE_FILE_TITLE",
        required: false,
        status: "pass",
        note: fileTitle === "AgentSpace Slack smoke file" ? "default" : "configured",
      } satisfies SlackSmokeEnvItem,
      {
        key: "SLACK_SMOKE_FILE_MIME",
        required: false,
        status: "pass",
        note: fileMime === "text/plain" ? "default" : "configured",
      } satisfies SlackSmokeEnvItem,
    ] : []),
  ];
  if (dryRunOutput.missingRequired.length > 0 || missingLive.length > 0) {
    const missingRequired = [...new Set([...dryRunOutput.missingRequired, ...missingLive])];
    return {
      ...dryRunOutput,
      mode: "live",
      live: true,
      ready: false,
      liveResult: {
        attempted: false,
        ok: false,
        mode: liveMode,
        errorCode: "slack.smoke.live_env_incomplete",
        errorMessage: liveMode === "app_mention"
          ? "Slack app mention live smoke requires a complete env, SLACK_SMOKE_POST_TOKEN, SLACK_SMOKE_BOT_USER_ID, SLACK_SMOKE_APP_ID, and SLACK_SMOKE_TEAM_ID."
          : liveMode === "file_upload"
          ? "Slack file upload live smoke requires a complete env, SLACK_BOT_TOKEN, SLACK_SMOKE_APP_ID, and SLACK_SMOKE_TEAM_ID."
          : "Slack live smoke requires a complete env, SLACK_BOT_TOKEN, SLACK_SMOKE_APP_ID, and SLACK_SMOKE_TEAM_ID.",
      },
      summary: {
        required: items.length,
        passed: items.filter((item) => item.status === "pass").length,
        failed: missingRequired.length,
      },
      missingRequired,
      items,
    };
  }

  const liveResult = liveMode === "file_upload"
    ? await sendSlackSmokeFileUpload({
      token: botToken ?? "",
      channelId: channelId ?? "",
      initialComment: messageText,
      threadTs,
      filename: fileName,
      title: fileTitle,
      content: fileContent,
      mediaType: fileMime,
      baseUrl: env.SLACK_API_BASE_URL?.trim(),
      sensitiveValues: [botToken, postToken, channelId, threadTs, botUserId],
    })
    : await sendSlackSmokeMessage({
      token: liveMode === "app_mention" ? postToken ?? "" : botToken ?? "",
      channelId: channelId ?? "",
      text: liveMode === "app_mention" ? `<@${botUserId}> ${messageText}` : messageText,
      threadTs,
      baseUrl: env.SLACK_API_BASE_URL?.trim(),
      mode: liveMode,
      botUserId,
      sensitiveValues: [botToken, postToken, channelId, threadTs, botUserId],
    });
  return {
    ...dryRunOutput,
    mode: "live",
    live: true,
    ready: liveResult.ok,
    liveResult,
    summary: {
      required: items.length,
      passed: items.filter((item) => item.status === "pass").length,
      failed: liveResult.ok ? 0 : 1,
    },
    missingRequired: liveResult.ok ? [] : dryRunOutput.missingRequired,
    items,
  };
}

export async function buildSlackSmokeWebhookReplayOutput(
  env: Record<string, string | undefined>,
): Promise<SlackSmokeOutput> {
  const dryRunOutput = buildSlackSmokeDryRunOutput(env);
  const signingSecret = env.SLACK_SIGNING_SECRET?.trim();
  const appId = env.SLACK_SMOKE_APP_ID?.trim();
  const teamId = env.SLACK_SMOKE_TEAM_ID?.trim();
  const missingReplay = [
    ...(signingSecret && !isPlaceholderValue(signingSecret) ? [] : ["SLACK_SIGNING_SECRET"]),
    ...(appId && !isPlaceholderValue(appId) ? [] : ["SLACK_SMOKE_APP_ID"]),
    ...(teamId && !isPlaceholderValue(teamId) ? [] : ["SLACK_SMOKE_TEAM_ID"]),
  ];
  const replayItems: SlackSmokeEnvItem[] = [
    {
      key: "SLACK_SIGNING_SECRET",
      required: true,
      status: missingReplay.includes("SLACK_SIGNING_SECRET") ? "fail" : "pass",
      note: missingReplay.includes("SLACK_SIGNING_SECRET") ? "missing_or_placeholder" : "configured",
    },
    {
      key: "SLACK_SMOKE_APP_ID",
      required: true,
      status: missingReplay.includes("SLACK_SMOKE_APP_ID") ? "fail" : "pass",
      note: missingReplay.includes("SLACK_SMOKE_APP_ID") ? "missing_or_placeholder" : "configured",
    },
    {
      key: "SLACK_SMOKE_TEAM_ID",
      required: true,
      status: missingReplay.includes("SLACK_SMOKE_TEAM_ID") ? "fail" : "pass",
      note: missingReplay.includes("SLACK_SMOKE_TEAM_ID") ? "missing_or_placeholder" : "configured",
    },
  ];
  const items = [...dryRunOutput.items, ...replayItems];
  if (dryRunOutput.missingRequired.length > 0 || missingReplay.length > 0) {
    const missingRequired = [...new Set([...dryRunOutput.missingRequired, ...missingReplay])];
    return {
      ...dryRunOutput,
      mode: "webhook-replay",
      ready: false,
      webhookReplay: {
        attempted: false,
        ok: false,
        errorCode: "slack.smoke.webhook_replay_env_incomplete",
        errorMessage: "Slack webhook replay requires a complete env, SLACK_SIGNING_SECRET, SLACK_SMOKE_APP_ID, and SLACK_SMOKE_TEAM_ID.",
      },
      summary: {
        required: items.length,
        passed: items.filter((item) => item.status === "pass").length,
        failed: missingRequired.length,
      },
      missingRequired,
      items,
    };
  }

  const replayResult = await replaySlackWebhookSmoke({
    callbackUrl: resolveSlackSmokeCallbackUrl(env),
    signingSecret: signingSecret ?? "",
    appId: appId ?? "",
    teamId: teamId ?? "",
    channelId: env.SLACK_SMOKE_CHANNEL_ID?.trim() ?? "",
    userId: env.SLACK_SMOKE_USER_ID?.trim() ?? "",
    botUserId: env.SLACK_SMOKE_BOT_USER_ID?.trim(),
    text: env.SLACK_SMOKE_MESSAGE_TEXT?.trim() || "AgentSpace Slack smoke",
    targetBaseUrl: env.AGENT_SPACE_SMOKE_CALLBACK_BASE_URL?.trim(),
  });
  return {
    ...dryRunOutput,
    mode: "webhook-replay",
    ready: replayResult.ok,
    webhookReplay: replayResult,
    summary: {
      required: items.length,
      passed: items.filter((item) => item.status === "pass").length,
      failed: replayResult.ok ? 0 : 1,
    },
    missingRequired: replayResult.ok ? [] : dryRunOutput.missingRequired,
    items,
  };
}

async function replaySlackWebhookSmoke(input: {
  callbackUrl: string;
  signingSecret: string;
  appId: string;
  teamId: string;
  channelId: string;
  userId: string;
  botUserId?: string;
  text: string;
  targetBaseUrl?: string;
}): Promise<SlackSmokeWebhookReplayResult> {
  const callbackUrl = resolveReplayTargetUrl(input.callbackUrl, input.targetBaseUrl);
  const sensitiveValues = [
    input.signingSecret,
    input.appId,
    input.teamId,
    input.channelId,
    input.userId,
    input.botUserId,
    input.targetBaseUrl,
  ];
  try {
    const challenge = await postSignedSlackWebhook({
      url: callbackUrl,
      signingSecret: input.signingSecret,
      payload: {
        type: "url_verification",
        challenge: "agentspace-slack-smoke-challenge",
      },
    });
    const challengeOk = challenge.status >= 200 &&
      challenge.status < 300 &&
      readChallengeValue(challenge.body) === "agentspace-slack-smoke-challenge";
    const eventPayload = buildSlackSmokeSignedEventPayload(input);
    const event = await postSignedSlackWebhook({
      url: callbackUrl,
      signingSecret: input.signingSecret,
      payload: eventPayload,
    });
    const eventBody = parseJsonRecord(event.body);
    const eventOk = event.status >= 200 && event.status < 300;
    return {
      attempted: true,
      ok: challengeOk && eventOk,
      callbackReference: buildSafeUrlReference(input.callbackUrl),
      challenge: {
        ok: challengeOk,
        status: challenge.status,
        errorCode: challengeOk ? undefined : "slack.smoke.challenge_replay_failed",
        errorMessage: challengeOk ? undefined : sanitizeSlackSmokeMessage(challenge.body, sensitiveValues),
      },
      event: {
        ok: eventOk,
        status: event.status,
        eventStatus: readString(eventBody?.eventStatus),
        dispatchStatus: readString(eventBody?.dispatchStatus),
        reasonCode: readString(eventBody?.reasonCode),
        errorCode: eventOk ? undefined : "slack.smoke.signed_event_replay_failed",
        errorMessage: eventOk ? undefined : sanitizeSlackSmokeMessage(event.body, sensitiveValues),
      },
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      callbackReference: buildSafeUrlReference(input.callbackUrl),
      errorCode: "slack.smoke.webhook_replay_network_failed",
      errorMessage: sanitizeSlackSmokeMessage(error instanceof Error ? error.message : String(error), sensitiveValues),
    };
  }
}

function buildSlackSmokeSignedEventPayload(input: {
  appId: string;
  teamId: string;
  channelId: string;
  userId: string;
  botUserId?: string;
  text: string;
}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const messageTs = `${nowSeconds}.000100`;
  const botUserId = input.botUserId?.trim() || "USMOKEBOT";
  return {
    type: "event_callback",
    event_id: `EvSmoke${nowSeconds}`,
    event_time: nowSeconds,
    api_app_id: input.appId,
    team_id: input.teamId,
    event: {
      type: "app_mention",
      channel: input.channelId,
      user: input.userId,
      ts: messageTs,
      team: input.teamId,
      text: `<@${botUserId}> ${input.text}`,
    },
  };
}

async function postSignedSlackWebhook(input: {
  url: string;
  signingSecret: string;
  payload: Record<string, unknown>;
}): Promise<{ status: number; body: string }> {
  const body = JSON.stringify(input.payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createSlackSignature({
    signingSecret: input.signingSecret,
    timestamp,
    body,
  });
  const response = await fetch(input.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    body,
  });
  return {
    status: response.status,
    body: await response.text(),
  };
}

function createSlackSignature(input: {
  signingSecret: string;
  timestamp: string;
  body: string;
}): string {
  const baseString = `v0:${input.timestamp}:${input.body}`;
  return `v0=${createHmac("sha256", input.signingSecret).update(baseString, "utf8").digest("hex")}`;
}

async function sendSlackSmokeMessage(input: {
  token: string;
  channelId: string;
  text: string;
  threadTs?: string;
  baseUrl?: string;
  mode: SlackSmokeLiveMode;
  botUserId?: string;
  sensitiveValues?: Array<string | undefined>;
}): Promise<SlackSmokeLiveResult> {
  try {
    const response = await fetch(`${input.baseUrl || "https://slack.com/api"}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channelId,
        text: input.text,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      }),
    });
    const data = await response.json() as Record<string, unknown>;
    const ok = response.ok && data.ok === true;
    const retryAfter = Number(response.headers.get("retry-after"));
    return {
      attempted: true,
      ok,
      mode: input.mode,
      channelReference: buildSafeReference("channel", typeof data.channel === "string" ? data.channel : input.channelId),
      channelRef: buildSlackSmokeExternalReference(typeof data.channel === "string" ? data.channel : input.channelId),
      messageReference: typeof data.ts === "string" ? buildSafeReference("message", data.ts) : undefined,
      messageRef: typeof data.ts === "string" ? buildSlackSmokeExternalReference(data.ts) : undefined,
      botUserReference: input.mode === "app_mention" ? buildSafeReference("user", input.botUserId) : undefined,
      botUserRef: input.mode === "app_mention" && input.botUserId ? buildSlackSmokeExternalReference(input.botUserId) : undefined,
      appMentionText: input.mode === "app_mention" ? true : undefined,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
      errorCode: ok ? undefined : normalizeSlackSmokeErrorCode(data.error, response.status),
      errorMessage: ok
        ? undefined
        : sanitizeSlackSmokeMessage(typeof data.error === "string" ? data.error : `Slack chat.postMessage failed with HTTP ${response.status}.`, [
          input.token,
          input.channelId,
          input.threadTs,
          input.botUserId,
          ...(input.sensitiveValues ?? []),
        ]),
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      mode: input.mode,
      channelReference: buildSafeReference("channel", input.channelId),
      channelRef: buildSlackSmokeExternalReference(input.channelId),
      botUserReference: input.mode === "app_mention" ? buildSafeReference("user", input.botUserId) : undefined,
      botUserRef: input.mode === "app_mention" && input.botUserId ? buildSlackSmokeExternalReference(input.botUserId) : undefined,
      appMentionText: input.mode === "app_mention" ? true : undefined,
      errorCode: "slack.smoke.network_failed",
      errorMessage: sanitizeSlackSmokeMessage(error instanceof Error ? error.message : String(error), [
        input.token,
        input.channelId,
        input.threadTs,
        input.botUserId,
        ...(input.sensitiveValues ?? []),
      ]),
    };
  }
}

async function sendSlackSmokeFileUpload(input: {
  token: string;
  channelId: string;
  initialComment: string;
  threadTs?: string;
  filename: string;
  title: string;
  content: string;
  mediaType: string;
  baseUrl?: string;
  sensitiveValues?: Array<string | undefined>;
}): Promise<SlackSmokeLiveResult> {
  const bytes = new TextEncoder().encode(input.content);
  const sensitiveValues = [
    input.token,
    input.channelId,
    input.threadTs,
    ...(input.sensitiveValues ?? []),
  ];
  try {
    const ticket = await requestSlackSmokeFileUploadUrl({
      token: input.token,
      filename: input.filename,
      length: bytes.byteLength,
      baseUrl: input.baseUrl,
      sensitiveValues,
    });
    if (!ticket.ok) {
      return {
        attempted: true,
        ok: false,
        mode: "file_upload",
        channelReference: buildSafeReference("channel", input.channelId),
        channelRef: buildSlackSmokeExternalReference(input.channelId),
        fileUpload: true,
        uploadCompleted: false,
        retryAfterSeconds: ticket.retryAfterSeconds,
        errorCode: ticket.errorCode,
        errorMessage: ticket.errorMessage,
      };
    }

    const upload = await uploadSlackSmokeFileBytes({
      uploadUrl: ticket.uploadUrl,
      bytes,
      mediaType: input.mediaType,
      sensitiveValues: [...sensitiveValues, ticket.uploadUrl, ticket.fileId],
    });
    if (!upload.ok) {
      return {
        attempted: true,
        ok: false,
        mode: "file_upload",
        channelReference: buildSafeReference("channel", input.channelId),
        channelRef: buildSlackSmokeExternalReference(input.channelId),
        fileReference: buildSafeReference("file", ticket.fileId),
        fileRef: buildSlackSmokeExternalReference(ticket.fileId),
        fileUpload: true,
        uploadCompleted: false,
        retryAfterSeconds: upload.retryAfterSeconds,
        errorCode: upload.errorCode,
        errorMessage: upload.errorMessage,
      };
    }

    const completed = await completeSlackSmokeFileUpload({
      token: input.token,
      channelId: input.channelId,
      fileId: ticket.fileId,
      title: input.title,
      initialComment: input.initialComment,
      threadTs: input.threadTs,
      baseUrl: input.baseUrl,
      sensitiveValues: [...sensitiveValues, ticket.uploadUrl, ticket.fileId],
    });
    return {
      attempted: true,
      ok: completed.ok,
      mode: "file_upload",
      channelReference: buildSafeReference("channel", input.channelId),
      channelRef: buildSlackSmokeExternalReference(input.channelId),
      fileReference: buildSafeReference("file", ticket.fileId),
      fileRef: buildSlackSmokeExternalReference(ticket.fileId),
      fileUpload: true,
      uploadCompleted: completed.ok,
      retryAfterSeconds: completed.retryAfterSeconds,
      errorCode: completed.errorCode,
      errorMessage: completed.errorMessage,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      mode: "file_upload",
      channelReference: buildSafeReference("channel", input.channelId),
      channelRef: buildSlackSmokeExternalReference(input.channelId),
      fileUpload: true,
      uploadCompleted: false,
      errorCode: "slack.smoke.network_failed",
      errorMessage: sanitizeSlackSmokeMessage(error instanceof Error ? error.message : String(error), sensitiveValues),
    };
  }
}

async function requestSlackSmokeFileUploadUrl(input: {
  token: string;
  filename: string;
  length: number;
  baseUrl?: string;
  sensitiveValues: Array<string | undefined>;
}): Promise<{
  ok: boolean;
  uploadUrl: string;
  fileId: string;
  retryAfterSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
}> {
  const response = await fetch(`${input.baseUrl || "https://slack.com/api"}/files.getUploadURLExternal`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      filename: input.filename,
      length: input.length,
    }),
  });
  const data = await readSlackSmokeJsonResponse(response);
  const retryAfter = Number(response.headers.get("retry-after"));
  if (response.ok && data.ok === true && typeof data.upload_url === "string" && typeof data.file_id === "string") {
    return {
      ok: true,
      uploadUrl: resolveSlackSmokeUploadUrl(data.upload_url, input.baseUrl),
      fileId: data.file_id,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    };
  }
  return {
    ok: false,
    uploadUrl: "",
    fileId: "",
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    errorCode: normalizeSlackSmokeErrorCode(data.error, response.status, "files_get_upload_url_external_failed"),
    errorMessage: sanitizeSlackSmokeMessage(typeof data.error === "string" ? data.error : `Slack files.getUploadURLExternal failed with HTTP ${response.status}.`, input.sensitiveValues),
  };
}

async function uploadSlackSmokeFileBytes(input: {
  uploadUrl: string;
  bytes: Uint8Array;
  mediaType: string;
  sensitiveValues: Array<string | undefined>;
}): Promise<{
  ok: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
}> {
  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;
  const response = await fetch(input.uploadUrl, {
    method: "POST",
    headers: {
      "content-type": input.mediaType,
      "content-length": String(input.bytes.byteLength),
    },
    body,
  });
  const retryAfter = Number(response.headers.get("retry-after"));
  if (response.ok) {
    return {
      ok: true,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    };
  }
  return {
    ok: false,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    errorCode: response.status === 429 ? "slack.smoke.rate_limited" : `slack.smoke.file_upload_http_${response.status}`,
    errorMessage: sanitizeSlackSmokeMessage(`Slack file upload URL returned HTTP ${response.status}.`, input.sensitiveValues),
  };
}

async function completeSlackSmokeFileUpload(input: {
  token: string;
  channelId: string;
  fileId: string;
  title: string;
  initialComment: string;
  threadTs?: string;
  baseUrl?: string;
  sensitiveValues: Array<string | undefined>;
}): Promise<{
  ok: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  errorMessage?: string;
}> {
  const response = await fetch(`${input.baseUrl || "https://slack.com/api"}/files.completeUploadExternal`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel_id: input.channelId,
      files: [{
        id: input.fileId,
        title: input.title,
      }],
      initial_comment: input.initialComment,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
    }),
  });
  const data = await readSlackSmokeJsonResponse(response);
  const retryAfter = Number(response.headers.get("retry-after"));
  if (response.ok && data.ok === true) {
    return {
      ok: true,
      retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    };
  }
  return {
    ok: false,
    retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
    errorCode: normalizeSlackSmokeErrorCode(data.error, response.status, "files_complete_upload_external_failed"),
    errorMessage: sanitizeSlackSmokeMessage(typeof data.error === "string" ? data.error : `Slack files.completeUploadExternal failed with HTTP ${response.status}.`, input.sensitiveValues),
  };
}

async function readSlackSmokeJsonResponse(response: Response): Promise<Record<string, unknown>> {
  return parseJsonRecord(await response.text()) ?? {};
}

function resolveSlackSmokeUploadUrl(uploadUrl: string, baseUrl: string | undefined): string {
  try {
    return new URL(uploadUrl, baseUrl || "https://slack.com").toString();
  } catch {
    return uploadUrl;
  }
}

function formatSlackSmokeDryRunOutput(output: SlackSmokeOutput): string {
  const lines = [
    `Slack smoke ${output.mode}: ${output.ready ? "ready" : "blocked"}`,
    `Required env: ${output.summary.passed}/${output.summary.required}`,
  ];
  for (const item of output.items) {
    lines.push(`- ${item.key}: ${item.status} (${item.note})`);
  }
  if (output.liveResult) {
    lines.push(`Live send (${output.liveResult.mode}): ${output.liveResult.ok ? "sent" : "failed"}`);
    if (output.liveResult.channelReference) {
      lines.push(`- channel: ${output.liveResult.channelReference}`);
    }
    if (output.liveResult.botUserReference) {
      lines.push(`- bot user: ${output.liveResult.botUserReference}`);
    }
    if (output.liveResult.messageReference) {
      lines.push(`- message: ${output.liveResult.messageReference}`);
    }
    if (output.liveResult.fileReference) {
      lines.push(`- file: ${output.liveResult.fileReference}`);
    }
    if (output.liveResult.errorCode) {
      lines.push(`- error: ${output.liveResult.errorCode}`);
    }
  }
  if (output.webhookReplay) {
    lines.push(`Webhook replay: ${output.webhookReplay.ok ? "passed" : "failed"}`);
    if (output.webhookReplay.callbackReference) {
      lines.push(`- callback: ${output.webhookReplay.callbackReference}`);
    }
    if (output.webhookReplay.challenge) {
      lines.push(`- challenge: HTTP ${output.webhookReplay.challenge.status}`);
    }
    if (output.webhookReplay.event) {
      lines.push(`- event: HTTP ${output.webhookReplay.event.status}`);
      if (output.webhookReplay.event.dispatchStatus) {
        lines.push(`- dispatch: ${output.webhookReplay.event.dispatchStatus}`);
      }
    }
    if (output.webhookReplay.errorCode) {
      lines.push(`- error: ${output.webhookReplay.errorCode}`);
    }
  }
  if (output.evidenceArtifact) {
    lines.push(`Evidence artifact: ${output.evidenceArtifact.written ? "written" : "not written"}`);
    if (output.evidenceArtifact.reasonCode) {
      lines.push(`- reason: ${output.evidenceArtifact.reasonCode}`);
    }
  }
  lines.push("Manual actions:");
  for (const action of output.manualActions) {
    lines.push(`- ${action.id}: ${action.detail}`);
  }
  lines.push("Next commands:");
  for (const command of output.nextCommands) {
    lines.push(`- ${command}`);
  }
  return lines.join("\n");
}

function formatSlackSmokeEvidenceVerificationOutput(output: SlackSmokeEvidenceVerificationOutput): string {
  const lines = [
    `Slack smoke evidence: ${output.valid ? "valid" : "invalid"}`,
    `Evidence: ${output.evidencePath}`,
    `Live modes: ${output.summary.satisfiedModes.length}/${output.summary.requiredModes.length}`,
  ];
  if (output.generatedAt) {
    lines.push(`Generated at: ${output.generatedAt}`);
  }
  if (output.summary.missingModes.length > 0) {
    lines.push(`Missing modes: ${output.summary.missingModes.join(", ")}`);
  }
  if (output.issues.length > 0) {
    lines.push("Issues:");
    for (const issue of output.issues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push("Manual actions:");
  for (const action of output.manualActions) {
    lines.push(`- ${action.id}: ${action.detail}`);
  }
  lines.push("Next commands:");
  for (const command of output.nextCommands) {
    lines.push(`- ${command}`);
  }
  return lines.join("\n");
}

function formatSlackSmokeFatalOutput(output: SlackSmokeFatalOutput): string {
  const lines = [
    `Slack smoke: failed`,
    `Mode: ${output.mode}`,
    `Error: ${output.errorCode}`,
    output.errorMessage,
  ];
  if (output.envFileReference) {
    lines.push(`Env file: ${output.envFileReference}`);
  }
  lines.push("Next commands:");
  for (const command of output.nextCommands) {
    lines.push(`- ${command}`);
  }
  return lines.join("\n");
}

function buildSlackSmokeFatalOutput(error: unknown, parsed: ParsedArgs): SlackSmokeFatalOutput {
  const envFile = getStringFlag(parsed.flags, "env-file");
  const envFileReadFailed = Boolean(envFile) && isFileReadError(error);
  const errorCode = envFileReadFailed
    ? "slack.smoke.env_file_read_failed"
    : "slack.smoke.unexpected_error";
  return {
    generatedAt: new Date().toISOString(),
    mode: resolveSlackSmokeFatalMode(parsed.flags),
    ready: false,
    errorCode,
    errorMessage: errorCode === "slack.smoke.env_file_read_failed"
      ? "Slack smoke env file could not be read. Generate scripts/slack/.env from the Slack smoke-env command before running live or evidence verification checks."
      : "Slack smoke failed before producing a normal report.",
    ...(envFile ? { envFileReference: buildSafePathReference(envFile) } : {}),
    issues: [errorCode],
    nextCommands: [
      "agent-space integrations slack smoke-env --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --app-url https://agentspace.example.com > scripts/slack/.env",
      "npm run smoke:slack -- --env-file scripts/slack/.env --check-env --json",
    ],
  };
}

function readEnv(envFile: string | undefined): Record<string, string | undefined> {
  return {
    ...(envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {}),
    ...process.env,
  };
}

function writeSlackSmokeEvidenceArtifactIfRequested(
  path: string | undefined,
  output: SlackSmokeOutput,
): SlackSmokeEvidenceArtifactStatus | undefined {
  if (!path) {
    return undefined;
  }
  if (output.mode !== "live" && output.mode !== "webhook-replay") {
    return {
      path,
      written: false,
      reasonCode: "slack.smoke.evidence_requires_live_or_replay",
    };
  }
  if (!output.ready) {
    return {
      path,
      written: false,
      reasonCode: "slack.smoke.evidence_output_not_ready",
    };
  }
  writeSlackSmokeEvidenceArtifact(path, output);
  return {
    path,
    written: true,
  };
}

function writeSlackSmokeEvidenceArtifact(path: string, output: SlackSmokeOutput): void {
  const existing = readSlackSmokeEvidenceArtifact(path);
  const retainedExisting = output.context
    ? existing.filter((run) => slackSmokeEvidenceRunContextMatches(run, output.context))
    : existing;
  const runs = [
    ...retainedExisting,
    {
      generatedAt: output.generatedAt,
      mode: output.mode,
      live: output.live,
      ready: output.ready,
      ...(output.context ? { context: output.context } : {}),
      summary: output.summary,
      ...(output.liveResult ? { liveResult: output.liveResult } : {}),
      ...(output.webhookReplay ? { webhookReplay: output.webhookReplay } : {}),
    },
  ].slice(-20);
  const artifact = {
    schemaVersion: 1,
    provider: "slack",
    generatedAt: new Date().toISOString(),
    ...(output.context ? { context: output.context } : {}),
    runs,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function slackSmokeEvidenceRunContextMatches(run: Record<string, unknown>, expected: SlackSmokeContext): boolean {
  const context = readSlackSmokeEvidenceRunContext(run);
  return (!expected.workspaceId || context.workspaceId === expected.workspaceId) &&
    (!expected.integrationId || context.integrationId === expected.integrationId) &&
    (!expected.appReference || context.appReference === expected.appReference) &&
    (!expected.teamReference || context.teamReference === expected.teamReference);
}

function readSlackSmokeEvidenceRunContext(run: Record<string, unknown>): SlackSmokeContext {
  const context = typeof run.context === "object" && run.context !== null && !Array.isArray(run.context)
    ? run.context as Record<string, unknown>
    : {};
  return {
    workspaceId: readString(context.workspaceId),
    integrationId: readString(context.integrationId),
    appReference: readString(context.appReference),
    teamReference: readString(context.teamReference),
  };
}

function readSlackSmokeEvidenceArtifact(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed = parseJsonRecord(readFileSync(path, "utf8"));
  const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
  return runs.filter((run): run is Record<string, unknown> =>
    typeof run === "object" && run !== null && !Array.isArray(run)
  );
}

function verifySlackSmokeEvidenceFile(path: string, input: {
  expectedContext?: SlackSmokeContext;
  requireExpectedContext?: boolean;
} = {}): SlackSmokeEvidenceVerificationOutput {
  const checkedAt = new Date();
  const issues: string[] = [];
  let artifactText = "";
  let artifact: Record<string, unknown> | undefined;
  if (!existsSync(path)) {
    issues.push("evidence_file_missing");
  } else {
    try {
      artifactText = readFileSync(path, "utf8");
      artifact = parseJsonRecord(artifactText);
      if (!artifact) {
        issues.push("evidence_not_object");
      }
    } catch {
      issues.push("evidence_read_failed");
    }
  }

  const generatedAt = readString(artifact?.generatedAt);
  const context = readSlackSmokeEvidenceRecordContext(artifact);
  const runs = readSlackSmokeEvidenceRuns(artifact);
  if (artifact && artifact.schemaVersion !== 1) {
    issues.push("schema_version_invalid");
  }
  if (artifact && artifact.provider !== "slack") {
    issues.push("provider_invalid");
  }
  if (artifact && !generatedAt) {
    issues.push("evidence_generated_at_missing");
  }
  if (generatedAt && !isFreshIsoTimestamp(generatedAt, checkedAt)) {
    issues.push("evidence_stale");
  }
  if (artifact && runs.length === 0) {
    issues.push("runs_missing");
  }
  if (artifact && !slackSmokeEvidenceContextComplete(context)) {
    issues.push("artifact_context_incomplete");
  }
  const expectedContextComplete = slackSmokeEvidenceContextComplete(input.expectedContext);
  const contextMatched = expectedContextComplete
    ? slackSmokeEvidenceContextsMatch(context, input.expectedContext)
    : slackSmokeEvidenceContextComplete(context);
  if (input.requireExpectedContext && !expectedContextComplete) {
    issues.push("expected_context_incomplete");
  }
  if (expectedContextComplete && !contextMatched) {
    issues.push("expected_context_mismatch");
  }

  const freshRuns = runs.filter((run) => {
    const runGeneratedAt = readString(run.generatedAt);
    return Boolean(runGeneratedAt && isFreshIsoTimestamp(runGeneratedAt, checkedAt));
  });
  const satisfiedModes: SlackSmokeLiveMode[] = [];
  const satisfiedRunsByMode: Partial<Record<SlackSmokeLiveMode, Record<string, unknown>>> = {};
  for (const requiredMode of SLACK_SMOKE_REQUIRED_LIVE_MODES) {
    const run = freshRuns.find((candidate) =>
      slackSmokeEvidenceRunSatisfiesMode(candidate, requiredMode, context, issues)
    );
    if (run) {
      satisfiedModes.push(requiredMode);
      satisfiedRunsByMode[requiredMode] = run;
    } else if (artifact) {
      issues.push(`missing_live_mode_${requiredMode}`);
    }
  }
  const channelReferences = Array.from(new Set(SLACK_SMOKE_REQUIRED_LIVE_MODES.flatMap((mode) => {
    const run = satisfiedRunsByMode[mode];
    const liveResult = readRecord(run?.liveResult);
    const channelReference = readString(liveResult?.channelReference);
    return channelReference ? [channelReference] : [];
  })));
  const channelMatched = satisfiedModes.length === SLACK_SMOKE_REQUIRED_LIVE_MODES.length &&
    channelReferences.length === 1;
  if (satisfiedModes.length === SLACK_SMOKE_REQUIRED_LIVE_MODES.length && channelReferences.length > 1) {
    issues.push("slack_live_smoke_channel_mismatch");
  }

  if (artifactText) {
    issues.push(...findSlackSmokeEvidenceRedactionIssues(artifactText));
  }
  const malformedReferenceCount = countMalformedSlackSmokeEvidenceResultReferences(runs);
  if (malformedReferenceCount > 0) {
    issues.push("slack_live_smoke_reference_malformed");
  }

  const uniqueIssues = [...new Set(issues)];
  const missingModes = SLACK_SMOKE_REQUIRED_LIVE_MODES.filter((mode) => !satisfiedModes.includes(mode));
  const valid = uniqueIssues.length === 0;
  return {
    evidencePath: path,
    checkedAt: checkedAt.toISOString(),
    valid,
    generatedAt,
    ...(context ? { context } : {}),
    ...(input.expectedContext ? { expectedContext: input.expectedContext } : {}),
    summary: {
      runCount: runs.length,
      freshRunCount: freshRuns.length,
      requiredModes: SLACK_SMOKE_REQUIRED_LIVE_MODES,
      satisfiedModes,
      missingModes,
      contextMatched,
      channelMatched,
      channelReferences,
      malformedReferenceCount,
    },
    issues: uniqueIssues,
    manualActions: buildSlackSmokeEvidenceVerificationManualActions(),
    nextCommands: buildSlackSmokeEvidenceVerificationNextCommands({
      evidencePath: path,
      valid,
      missingModes,
      issues: uniqueIssues,
      expectedContext: input.expectedContext,
    }),
  };
}

function buildSlackSmokeEvidenceVerificationManualActions(): SlackSmokeManualAction[] {
  return buildSlackSmokeManualActions();
}

function buildSlackSmokeManualActions(): SlackSmokeManualAction[] {
  return [{
    id: "native_agent_experience",
    detail: "Open the Slack app Messages tab, then send one app-context DM or agent-view message so AgentSpace records app context, app-home welcome, and assistant suggested prompt evidence.",
  }, {
    id: "approval_block_actions",
    detail: "Trigger one AgentSpace runtime approval card in Slack and approve or reject it so AgentSpace records processed block_actions evidence and an approval status outbox receipt.",
  }];
}

function buildSlackSmokeEvidenceVerificationNextCommands(input: {
  evidencePath: string;
  valid: boolean;
  missingModes: SlackSmokeLiveMode[];
  issues: string[];
  expectedContext?: SlackSmokeContext;
}): string[] {
  const commands: string[] = [];
  if (!slackSmokeEvidenceContextComplete(input.expectedContext)) {
    commands.push("npm run smoke:slack -- --env-file scripts/slack/.env --check-env --json");
  }
  const modesToRun = input.valid
    ? []
    : input.missingModes.length > 0
    ? input.missingModes
    : shouldRegenerateSlackSmokeEvidence(input.issues)
    ? SLACK_SMOKE_REQUIRED_LIVE_MODES
    : [];
  for (const mode of modesToRun) {
    commands.push(buildSlackSmokeLiveCommand(mode, input.evidencePath));
    if (mode === "app_mention") {
      commands.push("agent-space integrations slack outbox drain --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json");
    }
  }
  if (!input.valid) {
    commands.push(`npm run smoke:slack:verify -- --verify-evidence ${input.evidencePath} --env-file scripts/slack/.env --json`);
  }
  commands.push("agent-space integrations slack outbox drain --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json");
  commands.push(`agent-space integrations slack evidence --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --live-smoke-evidence ${input.evidencePath} --strict --require all --json`);
  return Array.from(new Set(commands));
}

function buildSlackSmokeLiveCommand(mode: SlackSmokeLiveMode, evidencePath: string): string {
  const command = `npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence ${evidencePath} --json`;
  return mode === "post_message"
    ? command
    : `SLACK_SMOKE_LIVE_MODE=${mode} ${command}`;
}

function shouldRegenerateSlackSmokeEvidence(issues: string[]): boolean {
  return issues.some((issue) =>
    issue === "evidence_stale" ||
    issue === "expected_context_mismatch" ||
    issue === "run_context_mismatch" ||
    issue === "artifact_context_incomplete" ||
    issue === "slack_live_smoke_channel_mismatch" ||
    issue === "slack_live_smoke_reference_malformed" ||
    issue === "secret_like_value_in_evidence" ||
    issue === "raw_slack_identifier_in_evidence" ||
    issue === "raw_slack_identifier_fragment_in_evidence" ||
    issue === "raw_slack_message_ts_in_evidence" ||
    issue === "raw_slack_message_ts_fragment_in_evidence" ||
    issue === "slack_private_file_url_in_evidence" ||
    issue.endsWith("_unsafe")
  );
}

function slackSmokeEvidenceRunSatisfiesMode(
  run: Record<string, unknown>,
  requiredMode: SlackSmokeLiveMode,
  artifactContext: SlackSmokeContext | undefined,
  issues: string[],
): boolean {
  if (run.mode !== "live" || run.live !== true || run.ready !== true) {
    return false;
  }
  const runGeneratedAt = readString(run.generatedAt);
  if (!runGeneratedAt) {
    issues.push("run_generated_at_missing");
    return false;
  }
  const liveResult = readRecord(run.liveResult);
  if (!liveResult || liveResult.mode !== requiredMode) {
    return false;
  }
  const runContext = readSlackSmokeEvidenceRecordContext(run);
  if (!slackSmokeEvidenceContextComplete(runContext)) {
    issues.push("run_context_incomplete");
    return false;
  }
  if (artifactContext && !slackSmokeEvidenceContextsMatch(runContext, artifactContext)) {
    issues.push("run_context_mismatch");
    return false;
  }
  if (liveResult.attempted !== true || liveResult.ok !== true) {
    return false;
  }
  if (!hasSafeSlackSmokeEvidenceResultReference(liveResult, "channelReference", "channel", issues, `live_mode_${requiredMode}_channel_reference`)) {
    issues.push(`live_mode_${requiredMode}_channel_reference_missing`);
    return false;
  }
  if (requiredMode === "post_message") {
    return hasSafeSlackSmokeEvidenceResultReference(liveResult, "messageReference", "message", issues, "live_mode_post_message_message_reference");
  }
  if (requiredMode === "app_mention") {
    if (!hasSafeSlackSmokeEvidenceResultReference(liveResult, "messageRef", undefined, issues, "live_mode_app_mention_message_ref")) {
      issues.push("live_mode_app_mention_message_ref_missing");
      return false;
    }
    if (!hasSafeSlackSmokeEvidenceResultReference(liveResult, "messageReference", "message", issues, "live_mode_app_mention_message_reference")) {
      issues.push("live_mode_app_mention_message_reference_missing");
      return false;
    }
    return liveResult.appMentionText === true &&
      hasSafeSlackSmokeEvidenceResultReference(liveResult, "botUserReference", "user", issues, "live_mode_app_mention_bot_user_reference");
  }
  return liveResult.fileUpload === true &&
    liveResult.uploadCompleted === true &&
    hasSafeSlackSmokeEvidenceResultReference(liveResult, "fileReference", "file", issues, "live_mode_file_upload_file_reference");
}

function readSlackSmokeEvidenceRuns(artifact: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!artifact) {
    return [];
  }
  const runs = Array.isArray(artifact.runs)
    ? artifact.runs.filter((run): run is Record<string, unknown> =>
      typeof run === "object" && run !== null && !Array.isArray(run)
    )
    : [];
  if (runs.length > 0) {
    return runs;
  }
  return artifact.mode === "live" || artifact.liveResult ? [artifact] : [];
}

function hasSafeSlackSmokeEvidenceResultReference(
  record: Record<string, unknown>,
  key: string,
  kind: string | undefined,
  issues: string[],
  issuePrefix: string,
): boolean {
  const value = readString(record[key]);
  if (!value) {
    return false;
  }
  const safe = isSafeSlackSmokeEvidenceReferenceValue(value, kind);
  if (!safe) {
    issues.push(`${issuePrefix}_unsafe`);
  }
  return safe;
}

function isSafeSlackSmokeEvidenceReferenceValue(value: string, kind: string | undefined): boolean {
  const hashPattern = "ref_[a-f0-9]{8}";
  return kind
    ? new RegExp(`^${kind} ${hashPattern}$`).test(value)
    : new RegExp(`^${hashPattern}$`).test(value);
}

function countMalformedSlackSmokeEvidenceResultReferences(runs: Record<string, unknown>[]): number {
  const referenceKeys: Record<string, string | undefined> = {
    channelReference: "channel",
    messageReference: "message",
    botUserReference: "user",
    fileReference: "file",
    channelRef: undefined,
    messageRef: undefined,
    botUserRef: undefined,
    fileRef: undefined,
  };
  let count = 0;
  for (const run of runs) {
    const liveResult = readRecord(run.liveResult);
    if (!liveResult) {
      continue;
    }
    for (const [key, kind] of Object.entries(referenceKeys)) {
      const value = readString(liveResult[key]);
      if (value && !isSafeSlackSmokeEvidenceReferenceValue(value, kind)) {
        count += 1;
      }
    }
  }
  return count;
}

function readSlackSmokeEvidenceRecordContext(record: Record<string, unknown> | undefined): SlackSmokeContext | undefined {
  const context = readRecord(record?.context);
  if (!context) {
    return undefined;
  }
  return {
    workspaceId: readString(context.workspaceId),
    integrationId: readString(context.integrationId),
    appReference: readString(context.appReference),
    teamReference: readString(context.teamReference),
  };
}

function slackSmokeEvidenceContextComplete(context: SlackSmokeContext | undefined): boolean {
  return Boolean(context?.workspaceId && context.integrationId && context.appReference && context.teamReference);
}

function slackSmokeEvidenceContextsMatch(
  left: SlackSmokeContext | undefined,
  right: SlackSmokeContext | undefined,
): boolean {
  return left?.workspaceId === right?.workspaceId &&
    left?.integrationId === right?.integrationId &&
    left?.appReference === right?.appReference &&
    left?.teamReference === right?.teamReference;
}

function isFreshIsoTimestamp(value: string, checkedAt: Date): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  const delta = checkedAt.getTime() - timestamp;
  return delta >= -5 * 60 * 1000 && delta <= SLACK_SMOKE_EVIDENCE_MAX_AGE_MS;
}

function findSlackSmokeEvidenceRedactionIssues(text: string): string[] {
  const issues: string[] = [];
  if (/\b(?:xox[a-z]?|xapp)-[A-Za-z0-9-]+/i.test(text) || /\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(text)) {
    issues.push("secret_like_value_in_evidence");
  }
  if (/\b(?:A|C|D|F|G|T|U|W)[A-Z0-9]{8,}\b/.test(text)) {
    issues.push("raw_slack_identifier_in_evidence");
  }
  if (/\b(?:channel|user|file)\s+[ACDFGTUW][A-Z0-9]{1,4}\.\.\.[A-Z0-9]{2,}\b/i.test(text)) {
    issues.push("raw_slack_identifier_fragment_in_evidence");
  }
  if (/\b\d{10}\.\d{6}\b/.test(text)) {
    issues.push("raw_slack_message_ts_in_evidence");
  }
  if (/\bmessage\s+\d{2,4}\.\.\.\d{2,6}\b/i.test(text)) {
    issues.push("raw_slack_message_ts_fragment_in_evidence");
  }
  if (/url_private|files\.slack\.com|slack-files\.com/i.test(text)) {
    issues.push("slack_private_file_url_in_evidence");
  }
  return issues;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseEnvFile(contents: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") {
      continue;
    }
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { flags };
}

function getStringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function resolveSlackSmokeFatalMode(flags: Record<string, string | boolean>): SlackSmokeFatalOutput["mode"] {
  if (getStringFlag(flags, "verify-evidence")) {
    return "verify-evidence";
  }
  if (flags["replay-webhook"] === true) {
    return "webhook-replay";
  }
  if (flags.live === true) {
    return "live";
  }
  return "dry-run";
}

function describeSlackSmokeEnvItem(key: string, value: string | undefined, ready: boolean): string {
  if (ready) {
    if (key.includes("URL")) {
      return "configured URL";
    }
    return "configured";
  }
  if (!value?.trim()) {
    return "missing";
  }
  if (isPlaceholderValue(value)) {
    return "placeholder";
  }
  return "invalid";
}

function isWellFormedEnvValue(key: string, value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  if (key.includes("URL")) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && (
        key !== "SLACK_SMOKE_CALLBACK_URL" ||
        url.pathname === "/api/integrations/slack/events"
      );
    } catch {
      return false;
    }
  }
  return true;
}

function resolveSlackSmokeCallbackUrl(env: Record<string, string | undefined>): string {
  const callbackUrl = new URL(env.SLACK_SMOKE_CALLBACK_URL?.trim() || "https://agentspace.example.com/api/integrations/slack/events");
  if (!callbackUrl.searchParams.get("workspaceId")) {
    callbackUrl.searchParams.set("workspaceId", env.AGENT_SPACE_WORKSPACE_ID?.trim() || "default");
  }
  if (!callbackUrl.searchParams.get("integrationId")) {
    callbackUrl.searchParams.set("integrationId", env.AGENT_SPACE_SLACK_INTEGRATION_ID?.trim() || "CHANGE_ME_SLACK_INTEGRATION_ID");
  }
  return callbackUrl.toString();
}

function resolveReplayTargetUrl(callbackUrl: string, targetBaseUrl: string | undefined): string {
  if (!targetBaseUrl?.trim()) {
    return callbackUrl;
  }
  const target = new URL(targetBaseUrl);
  const resolved = new URL(callbackUrl);
  resolved.protocol = target.protocol;
  resolved.hostname = target.hostname;
  resolved.port = target.port;
  resolved.username = "";
  resolved.password = "";
  return resolved.toString();
}

function buildSlackSmokeContext(env: Record<string, string | undefined>): SlackSmokeContext | undefined {
  const workspaceId = env.AGENT_SPACE_WORKSPACE_ID?.trim();
  const integrationId = env.AGENT_SPACE_SLACK_INTEGRATION_ID?.trim();
  const appId = env.SLACK_SMOKE_APP_ID?.trim();
  const teamId = env.SLACK_SMOKE_TEAM_ID?.trim();
  const context: SlackSmokeContext = {
    ...(workspaceId && !isPlaceholderValue(workspaceId) ? { workspaceId } : {}),
    ...(integrationId && !isPlaceholderValue(integrationId) ? { integrationId } : {}),
    ...(appId && !isPlaceholderValue(appId) ? { appReference: buildSlackSmokeExternalReference(appId) } : {}),
    ...(teamId && !isPlaceholderValue(teamId) ? { teamReference: buildSlackSmokeExternalReference(teamId) } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

function buildSlackSmokeExternalReference(value: string): string {
  const hash = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
  return `ref_${hash}`;
}

function readChallengeValue(body: string): string | undefined {
  const parsed = parseJsonRecord(body);
  return readString(parsed?.challenge);
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSlackSmokeLiveMode(value: string | undefined): SlackSmokeLiveMode {
  const normalized = value?.trim();
  if (normalized === "app_mention" || normalized === "file_upload") {
    return normalized;
  }
  return "post_message";
}

function isPlaceholderValue(value: string | undefined): boolean {
  return /CHANGE_ME|REPLACE_ME|example\.com|xxx/i.test(value ?? "");
}

function normalizeSlackSmokeErrorCode(
  value: unknown,
  status: number,
  fallback = "post_message_failed",
): string {
  if (status === 429 || value === "ratelimited") {
    return "slack.smoke.rate_limited";
  }
  if (typeof value === "string" && value.trim()) {
    return `slack.smoke.${value.trim().replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}`;
  }
  return `slack.smoke.${fallback}`;
}

function buildSafeReference(kind: string, value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return `${kind} ${buildSlackSmokeExternalReference(normalized)}`;
}

function buildSafeUrlReference(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  try {
    const url = new URL(normalized);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return "callback [invalid-url]";
  }
}

function buildSafePathReference(value: string): string {
  return value
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[email]")
    .replace(/\b(?:xox[a-z]?|xapp)-[A-Za-z0-9-]+/gi, "[redacted]")
    .slice(0, 240);
}

function isFileReadError(error: unknown): boolean {
  const code = readRecord(error)?.code;
  return code === "ENOENT" || code === "EACCES" || code === "EISDIR" || code === "ENOTDIR";
}

function sanitizeSlackSmokeMessage(
  message: string | undefined,
  sensitiveValues: Array<string | undefined>,
): string | undefined {
  if (!message) {
    return undefined;
  }
  let sanitized = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(xoxb|xapp)-[A-Za-z0-9-]+/gi, "[redacted]");
  for (const value of sensitiveValues
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => right.length - left.length)) {
    sanitized = sanitized.split(value).join("[redacted]");
  }
  return sanitized.slice(0, 1000);
}

void main().catch((error: unknown) => {
  const parsed = parseArgs(process.argv.slice(2));
  const output = buildSlackSmokeFatalOutput(error, parsed);
  if (parsed.flags.json === true) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.error(formatSlackSmokeFatalOutput(output));
  }
  process.exitCode = 1;
});
