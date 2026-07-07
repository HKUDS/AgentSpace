import { type OutputFormat } from "../../lib/format.ts";
import { runFeishuIntegrationCommand } from "./feishu.ts";
import { runIntegrationsOutboxCommand } from "./outbox.ts";
import { runSlackIntegrationCommand } from "./slack.ts";

export async function runIntegrationsCommand(
  subcommand: string | undefined,
  args: string[],
  format: OutputFormat,
): Promise<number> {
  if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    printIntegrationsHelp();
    return subcommand ? 0 : 1;
  }

  if (subcommand === "outbox") {
    return runIntegrationsOutboxCommand(args, format);
  }

  if (subcommand === "feishu") {
    return runFeishuIntegrationCommand(args, format);
  }

  if (subcommand === "slack") {
    return runSlackIntegrationCommand(args, format);
  }

  printIntegrationsHelp();
  return 1;
}

function printIntegrationsHelp(): void {
  console.log(`Usage:
  agent-space integrations outbox drain [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--json]
  agent-space integrations slack create --workspace-id <id> --app-id <A...> [--team-id <T...>] [--env-file scripts/slack/.env] [--bot-token-env SLACK_BOT_TOKEN] [--signing-secret-env SLACK_SIGNING_SECRET] [--app-level-token-env SLACK_APP_TOKEN] [--transport http_webhook|websocket_worker] [--json]
  agent-space integrations slack bind-channel --workspace-id <id> --integration <id> --channel <name> --slack-channel <C...|G...|D...> [--json]
  agent-space integrations slack bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --slack-user <U...> [--json]
  agent-space integrations slack worker [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--dry-run] [--include-webhook] [--drain-outbox|--once] [--json]
  agent-space integrations slack health-check --workspace-id <id> --integration <id> [--base-url <url>] [--json]
  agent-space integrations slack readiness [--workspace-id <id>] [--integration <id>] [--strict] [--require message|worker|all] [--json]
  agent-space integrations slack smoke-plan [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--strict] [--require message|worker|all] [--json]
  agent-space integrations slack smoke-env [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--json]
  agent-space integrations slack outbox drain [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--json]
  agent-space integrations feishu create --workspace-id <id> [--env-file scripts/feishu/.env] --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET --verification-token-env FEISHU_VERIFICATION_TOKEN [--encrypt-key-env FEISHU_ENCRYPT_KEY] [--json]
  agent-space integrations feishu bind-agent-bot --workspace-id <id> --agent <agent-id-or-name> [--env-file scripts/feishu/.env] --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET [--json]
  agent-space integrations feishu rotate-agent-bot-secret --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) --app-secret-env FEISHU_APP_SECRET [--json]
  agent-space integrations feishu disable-agent-bot --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) [--json]
  agent-space integrations feishu auto-provision-policy --workspace-id <id> (--agent <agent-id-or-name>|--integration <id>) [--bot-added-policy auto_create_channel|pending_admin_review|disabled] [--unbound-user-mode ignore|reply_on_mention|reply_all|require_identity] [--json]
  agent-space integrations feishu agent-channel-access --workspace-id <id> (--agent <agent-id-or-name>|--integration <agent-bot-id>) --access enabled|disabled [--json]
  agent-space integrations feishu agent-bot-readiness --workspace-id <id> [--agent <agent-id-or-name>|--integration <id>] [--strict] [--json]
  agent-space integrations feishu worker [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--domain <host>] [--locked-by <id>] [--dry-run] [--include-webhook] [--drain-outbox|--once] [--json]
  agent-space integrations feishu readiness [--workspace-id <id>] [--integration <id>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu smoke-plan [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu smoke-env [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--json]
  agent-space integrations feishu health-check [--workspace-id <id>] [--integration <id>|--agent <agent-id-or-name>] [--base-url <url>] [--dry-run] [--strict] [--json]
  agent-space integrations feishu evidence [--workspace-id <id>] [--integration <id>] [--openapi-evidence <path>] [--bot-added-payload-evidence <path>] [--strict] [--require bot|native|guest-policy|data-plane|worker|failure|all] [--json]
  agent-space integrations feishu data-operation --workspace-id <id> --integration <id> --operation read-doc|plan-doc-create|plan-doc-update|plan-doc-append|read-sheet|query-base|plan-sheet-write|plan-base-update --resource <url-or-token> [--range <sheet-range>] [--parent-block-id <block-id>] [--approval-agent <agent-id> --approval-channel <channel>] [--json]
  agent-space integrations feishu review-data-operation --workspace-id <id> --approval-id <approval-id> --decision approved|rejected [--json]
  agent-space integrations feishu channel-bindings --workspace-id <id> [--integration <id>] [--status active|disabled|archived] [--json]
  agent-space integrations feishu bind-channel --workspace-id <id> --integration <id> --channel <name> --chat-id <oc_xxx> [--json]
  agent-space integrations feishu bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --open-id <ou_xxx> [--json]
  agent-space integrations feishu bind-resource --workspace-id <id> --integration <id> --type doc|sheet|base|base_table|base_view --resource <url-or-token> --agent-space-type channel_document|data_table|knowledge_page [--allow-write] [--guest-readable] [--json]

Feishu evidence artifacts:
  --openapi-evidence and --bot-added-payload-evidence are required for --require all.

Examples:
  agent-space integrations feishu create --workspace-id default --env-file scripts/feishu/.env --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET --verification-token-env FEISHU_VERIFICATION_TOKEN --encrypt-key-env FEISHU_ENCRYPT_KEY --json
  agent-space integrations feishu bind-agent-bot --workspace-id default --agent Codex --env-file scripts/feishu/.env --app-id-env FEISHU_APP_ID --app-secret-env FEISHU_APP_SECRET --json
  agent-space integrations feishu auto-provision-policy --workspace-id default --agent Codex --unbound-user-mode reply_on_mention --guest-permission-profile channel_context_only --json
  agent-space integrations feishu agent-channel-access --workspace-id default --agent Codex --access disabled --json
  agent-space integrations feishu agent-bot-readiness --workspace-id default --agent Codex --strict --json
  agent-space integrations feishu worker --dry-run --include-webhook --json
  agent-space integrations feishu worker --workspace-id default --integration feishu-1 --once --json
  agent-space integrations feishu readiness --workspace-id default --strict --require data-plane --json
  agent-space integrations feishu smoke-plan --workspace-id default --app-url https://agentspace.example.com
  agent-space integrations feishu smoke-env --workspace-id default --integration feishu-1 --app-url https://agentspace.example.com
  agent-space integrations feishu health-check --workspace-id default --agent Codex --json
  agent-space integrations feishu evidence --workspace-id default --openapi-evidence runtime-output/feishu-smoke/live.json --bot-added-payload-evidence runtime-output/feishu-smoke/bot-added-payload-evidence.json --strict --require all
  agent-space integrations feishu data-operation --workspace-id default --integration feishu-1 --operation plan-doc-append --resource CHANGE_ME_FEISHU_DOC_URL_OR_TOKEN --parent-block-id CHANGE_ME_DOC_BLOCK_ID --blocks-json '[{"block_type":2,"text":{"elements":[]}}]' --approval-agent Atlas --approval-channel general --json
  agent-space integrations feishu review-data-operation --workspace-id default --approval-id CHANGE_ME_FEISHU_APPROVAL_ID --decision approved --json
  agent-space integrations feishu channel-bindings --workspace-id default --json
  agent-space integrations feishu data-operation --workspace-id default --integration feishu-1 --operation read-sheet --resource CHANGE_ME_FEISHU_SHEET_URL_OR_TOKEN --range Sheet1!A1:C5 --json
  agent-space integrations feishu bind-channel --workspace-id default --integration feishu-1 --channel CHANGE_ME_AGENTSPACE_CHANNEL --chat-id CHANGE_ME_FEISHU_CHAT_ID --json`);
}
