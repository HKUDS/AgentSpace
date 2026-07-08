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
  nextCommands: string[];
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
  messageReference?: string;
  botUserReference?: string;
  fileReference?: string;
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

interface ParsedArgs {
  flags: Record<string, string | boolean>;
}

const REQUIRED_ENV = [
  "AGENT_SPACE_WORKSPACE_ID",
  "AGENT_SPACE_SLACK_INTEGRATION_ID",
  "AGENT_SPACE_PUBLIC_APP_URL",
  "SLACK_SMOKE_CALLBACK_URL",
  "SLACK_SMOKE_CHANNEL_ID",
  "SLACK_SMOKE_USER_ID",
] as const;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const env = readEnv(getStringFlag(parsed.flags, "env-file"));
  const output = parsed.flags["replay-webhook"] === true
    ? await buildSlackSmokeWebhookReplayOutput(env)
    : parsed.flags.live === true
    ? await buildSlackSmokeLiveOutput(env)
    : buildSlackSmokeDryRunOutput(env);
  const evidencePath = getStringFlag(parsed.flags, "evidence");
  if (evidencePath && (output.mode === "live" || output.mode === "webhook-replay")) {
    writeSlackSmokeEvidenceArtifact(evidencePath, output);
  }
  if (parsed.flags.json === true) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatSlackSmokeDryRunOutput(output));
  }
  process.exitCode = output.ready ? 0 : 1;
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
    nextCommands: [
      "agent-space integrations slack health-check --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
      "agent-space integrations slack readiness --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --json",
      "npm run smoke:slack -- --env-file scripts/slack/.env --replay-webhook --json",
      "npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json",
      "SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json",
      "SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json",
      "agent-space integrations slack evidence --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --require message --json",
      "agent-space integrations slack evidence --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --strict --require all --json",
      "agent-space integrations slack outbox drain --workspace-id $AGENT_SPACE_WORKSPACE_ID --integration $AGENT_SPACE_SLACK_INTEGRATION_ID --json",
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
      messageReference: typeof data.ts === "string" ? buildSafeReference("message", data.ts) : undefined,
      botUserReference: input.mode === "app_mention" ? buildSafeReference("user", input.botUserId) : undefined,
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
      botUserReference: input.mode === "app_mention" ? buildSafeReference("user", input.botUserId) : undefined,
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
        fileReference: buildSafeReference("file", ticket.fileId),
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
      fileReference: buildSafeReference("file", ticket.fileId),
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
  lines.push("Next commands:");
  for (const command of output.nextCommands) {
    lines.push(`- ${command}`);
  }
  return lines.join("\n");
}

function readEnv(envFile: string | undefined): Record<string, string | undefined> {
  return {
    ...(envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {}),
    ...process.env,
  };
}

function writeSlackSmokeEvidenceArtifact(path: string, output: SlackSmokeOutput): void {
  const existing = readSlackSmokeEvidenceArtifact(path);
  const runs = [
    ...existing,
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
  if (normalized.length <= 8) {
    return `${kind} ${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
  }
  return `${kind} ${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
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

void main();
