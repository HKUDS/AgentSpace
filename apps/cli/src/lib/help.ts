export function printRootHelp(): void {
  console.log(`agent-space — local control CLI for AgentSpace

Usage:
  agent-space <command> [subcommand] [options]

Commands:
  doctor                    Check local project readiness
  db status                 Show database status
  db storage-scan           Scan orphan workspace and daemon storage artifacts
  db workspace-purge        Hard-delete a workspace and its storage roots
  daemon start              Start the native daemon
  daemon stop               Stop the native daemon
  daemon status             Show native daemon status
  daemon logs               Show daemon logs
  daemon token              Manage remote daemon API tokens
  dev web [--port <n>]      Start the web app
  workspace status          Show current workspace summary
  workspace context         Query workspace context from the current agent runtime
  workspace init            Initialize workspace; use --reset to clear current state
  im channels               List IM channels
  im feed                   Show recent collaboration feed
  integrations outbox       Drain external integration outbox
  integrations feishu       Start/dry-run Feishu worker and inspect readiness/smoke plan
  channel list              List channels
  channel create            Create a new channel
  employee list             List active digital employees
  employee create           Create an active employee
  material list             List imported source materials
  material add              Add a new source material
  material import-file      Import a real file into local workspace state
  material parse            Parse an imported file into preview text
  skill list                List workspace skills
  skill import              Import a skill from a supported external URL
  skill export              Export one or more skills as a zip bundle
  output attach             Add a runtime-output attachment manifest entry
  output sheets-result      Register an Agent-executed Google Sheet result
  output google-docs        Register Google Docs operations
  output validate           Validate runtime-output manifests
  output preview            Preview runtime-output manifests
  message list              List recent collaboration messages
  message post              Post a new collaboration message
  task list                 List current tasks
  task create               Create a task
  task move                 Change task status
  cost summary              Show workspace cost summary
  cost agent                Show cost for a specific agent
  cost recent               Show recent token usage records
  cost pricing              List model pricing table
  cost budget list          List budget settings
  cost budget set           Create or update a budget
  cost budget check         Check budget status for an agent
  help                      Show this help

Output:
  --json
  --format json|text

Examples:
  agent-space doctor
  agent-space db status
  agent-space daemon start
  agent-space daemon token create --label build-box-1
  agent-space workspace status
  agent-space workspace context list-entities --json
  agent-space im channels --json
  agent-space integrations outbox drain --workspace-id default --limit 10 --json
  agent-space integrations feishu worker --dry-run --include-webhook --json
  agent-space integrations feishu readiness --workspace-id default --strict --require data-plane --json
  agent-space integrations feishu health-check --workspace-id default --json
  agent-space integrations feishu evidence --workspace-id default --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json
  agent-space integrations feishu smoke-plan --workspace-id default --app-url https://agentspace.example.com --json
  agent-space integrations feishu smoke-env --workspace-id default --integration feishu-1 --app-url https://agentspace.example.com
  agent-space employee create --name Vega --role "发布协调员" --traits 发布窗口,跨组协调
  agent-space employee create --name Nova --role "值守协调员" --channel general
  agent-space material add --source "客户录音" --status "待转写"
  agent-space material import-file --path ./Target.md --label "产品目标文档"
  agent-space material parse --id mat-123
  agent-space skill list --json
  agent-space skill import --url https://github.com/octo-org/skill-repo/tree/main/skills/research-pack --conflict rename --json
  agent-space skill export skill-abc123 --out ./research-pack.zip --json
  agent-space output attach runtime-output/artifacts/chart.png --name chart.png --media-type image/png --text "图表已生成。"
  agent-space output sheets-result add --document-id channel-doc-123 --operation read --range Sheet1!A1:Z20 --result-json runtime-output/artifacts/sheets/read-1.json --summary "Read 20 rows."
  agent-space output google-docs append-text --document-id channel-doc-456 --intent "Append meeting notes" --text-file runtime-output/artifacts/docs/summary.md
  agent-space output validate --json
  agent-space message post --channel general --summary "先确认今天的优先级"
  agent-space task create --title "整理联调顺序" --channel general --assignee Nova --priority high
  agent-space dev web --port 1455`);
}

export function printCommandHelp(command: string): void {
  if (command === "dev") {
    console.log(`Usage:
  agent-space dev web [--port <n>] [--hostname <host>]`);
    return;
  }

  if (command === "db") {
    console.log(`Usage:
  agent-space db status [--json]
  agent-space db storage-scan [--json]
  agent-space db workspace-purge --id <workspace-id> --force [--json]`);
    return;
  }

  if (command === "daemon") {
    console.log(`Usage:
  agent-space daemon start [--foreground] [--mode local|remote] [--daemon-id <id>] [--device-name <name>] [--runtime-name <label>] [--heartbeat-interval <ms>] [--server-url <url>] [--daemon-token <token>]
  agent-space daemon stop
  agent-space daemon status [--json]
  agent-space daemon logs [--lines <n>] [--follow]
  agent-space daemon token create --label <label> [--created-by <name>] [--json]
  agent-space daemon token list [--json]
  agent-space daemon token revoke --id <token-id> [--json]`);
    return;
  }

  if (command === "workspace") {
    console.log(`Usage:
  agent-space workspace status [--json]
  agent-space workspace context list-entities [--json]
  agent-space workspace context resolve-entity --query <text> [--json]
  agent-space workspace context list-channels [--json]
  agent-space workspace context search-messages --query <text> [--channel <name>] [--json]
  agent-space workspace context list-documents [--channel <name>] [--json]
  agent-space workspace init --reset [--json]
  agent-space workspace init --name <organization> --owner <name> --owner-role <role> [--json]`);
    return;
  }

  if (command === "im") {
    console.log(`Usage:
  agent-space im channels [--json]
  agent-space im feed [--json]`);
    return;
  }

  if (command === "integrations") {
    console.log(`Usage:
  agent-space integrations outbox drain [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--locked-by <id>] [--json]
  agent-space integrations feishu worker [--workspace-id <id>] [--integration <id>] [--limit <n>] [--base-url <url>] [--domain <host>] [--locked-by <id>] [--dry-run] [--include-webhook] [--drain-outbox|--once] [--json]
  agent-space integrations feishu readiness [--workspace-id <id>] [--integration <id>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu smoke-plan [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--strict] [--require bot|data-plane|worker] [--json]
  agent-space integrations feishu smoke-env [--workspace-id <id>] [--integration <id>] [--app-url <url>] [--json]
  agent-space integrations feishu health-check [--workspace-id <id>] [--integration <id>] [--base-url <url>] [--dry-run] [--strict] [--json]
  agent-space integrations feishu evidence [--workspace-id <id>] [--integration <id>] [--openapi-evidence <path>] [--strict] [--require bot|native|guest-policy|data-plane|worker|failure|all] [--json]
  agent-space integrations feishu data-operation --workspace-id <id> --integration <id> --operation read-doc|read-sheet|query-base|plan-sheet-write|plan-base-update --resource <url-or-token> [--range <sheet-range>] [--json]
  agent-space integrations feishu agent-channel-access --workspace-id <id> (--agent <agent-id-or-name>|--integration <agent-bot-id>) --access enabled|disabled [--json]
  agent-space integrations feishu bind-channel --workspace-id <id> --integration <id> --channel <name> --chat-id <oc_xxx> [--json]
  agent-space integrations feishu bind-user --workspace-id <id> --integration <id> --user-id <agent-space-user-id> --open-id <ou_xxx> [--json]
  agent-space integrations feishu bind-resource --workspace-id <id> --integration <id> --type doc|sheet|base|base_table|base_view --resource <url-or-token> --agent-space-type channel_document|data_table|knowledge_page [--allow-write] [--json]

Examples:
  agent-space integrations feishu worker --dry-run --include-webhook --json
  agent-space integrations feishu worker --workspace-id default --integration feishu-1 --once --json
  agent-space integrations feishu readiness --workspace-id default --strict --require data-plane --json
  agent-space integrations feishu smoke-plan --workspace-id default --app-url https://agentspace.example.com --json
  agent-space integrations feishu smoke-env --workspace-id default --integration feishu-1 --app-url https://agentspace.example.com
  agent-space integrations feishu health-check --workspace-id default --json
  agent-space integrations feishu agent-channel-access --workspace-id default --agent Codex --access disabled --json
  agent-space integrations feishu evidence --workspace-id default --openapi-evidence runtime-output/feishu-smoke/live.json --strict --require all --json
  agent-space integrations feishu bind-channel --workspace-id default --integration feishu-1 --channel general --chat-id oc_xxx --json`);
    return;
  }

  if (command === "channel") {
    console.log(`Usage:
  agent-space channel list [--json]
  agent-space channel create --name <name> [--json]
  agent-space channel delete --name <name> [--json]
  agent-space channel rename --name <name> --to <next-name> [--json]`);
    return;
  }

  if (command === "employee") {
    console.log(`Usage:
  agent-space employee list [--json]
  agent-space employee create --name <name> --role <role> [--traits a,b] [--summary <text>] [--fit <text>] [--origin <label>] [--json]
  agent-space employee bind-runtime --name <employee> --runtime-id <runtime-id> [--json]
  agent-space employee unbind-runtime --name <employee> [--json]`);
    return;
  }

  if (command === "material") {
    console.log(`Usage:
  agent-space material list [--json]
  agent-space material add --source <source> [--status <status>] [--json]
  agent-space material import-file --path <file-path> [--label <name>] [--status <status>] [--json]
  agent-space material parse --id <material-id> [--json]`);
    return;
  }

  if (command === "skill") {
    console.log(`Usage:
  agent-space skill list [--workspace-id <id>] [--json]
  agent-space skill get <skill-id> [--workspace-id <id>] [--json]
  agent-space skill create --name <name> [--description <text>] [--workspace-id <id>] [--json]
  agent-space skill update <skill-id> [--name <name>] [--description <text>] [--workspace-id <id>] [--json]
  agent-space skill delete <skill-id> [--workspace-id <id>] [--json]
  agent-space skill files list <skill-id> [--workspace-id <id>] [--json]
  agent-space skill files upsert <skill-id> --path <path> --content <content> [--file-id <id>] [--workspace-id <id>] [--json]
  agent-space skill files delete <skill-id> --file-id <id> [--workspace-id <id>] [--json]
  agent-space skill import --url <url> [--conflict reject|rename|replace|skip] [--workspace-id <id>] [--json]
  agent-space skill export <skill-id> [more-skill-ids...] [--workspace-id <id>] [--out <zip-path>] [--json]`);
    return;
  }

  if (command === "output") {
    console.log(`Usage:
  agent-space output attach <file> [--name <display-name>] [--media-type <mime>] [--text <message>] [--copy] [--work-dir <path>] [--json]
  agent-space output text <message> [--work-dir <path>] [--json]
  agent-space output document upsert --title <title> --content <path> [--document-id <id>] [--base-version-id <id>] [--summary <text>] [--mode create|update|create_or_update] [--json]
  agent-space output document replace-block --document-id <id> --base-version-id <id> --title <title> --block-id <id> --base-revision <n> --content <path> [--heading <text>] [--json]
  agent-space output document insert-after --document-id <id> --base-version-id <id> --title <title> [--after-block-id <id>] --content <path> [--heading <text>] [--json]
  agent-space output document delete-block --document-id <id> --base-version-id <id> --title <title> --block-id <id> --base-revision <n> [--json]
  agent-space output skill import --url <url> [--conflict reject|rename|replace|skip] [--assign-to-self true|false] [--json]
  agent-space output skill import --path runtime-output/artifacts/skills/name [--conflict reject|rename|replace|skip] [--json]
  agent-space output skill import --local-path <path> [--conflict reject|rename|replace|skip] [--json]
  agent-space output knowledge propose-create --title <title> --content-file runtime-output/artifacts/knowledge/page.md [--assignment-mode all_agents|selected_agents] [--reason <text>] [--json]
  agent-space output knowledge propose-update --knowledge-page-id <page-id> --base-updated-at <iso> --title <title> --content-file runtime-output/artifacts/knowledge/page.md [--reason <text>] [--json]
  agent-space output sheets read --document-id <id> --range <A1> --intent <text> [--json]
  agent-space output sheets append-rows --document-id <id> --range <A1> --intent <text> --values-json <json> [--json]
  agent-space output sheets update-values --document-id <id> --range <A1> --intent <text> --values-json <json> [--json]
  agent-space output sheets batch-update --document-id <id> --intent <text> --requests-json <json> [--json]
  agent-space output sheets-result add --document-id <id> --operation read|append_rows|update_values|batch_update --result-json runtime-output/artifacts/sheets/result.json [--range <A1>] [--summary <text>] [--request-summary <text>] [--json]
  agent-space output google-docs append-text --document-id <doc-id> --intent <text> --text-file runtime-output/artifacts/docs/summary.md [--request-summary <text>] [--json]
  agent-space output google-docs batch-update --document-id <doc-id> --intent <text> --requests-json runtime-output/artifacts/docs/requests.json [--request-summary <text>] [--json]
  agent-space output feishu data-operation-approval --operation docs.update_document|sheets.update_range|base.mutate_records --type doc|sheet|base_table --resource <bound-feishu-token> [--parameters-json <json>] [--preview <text>] [--json]
  agent-space output validate [--work-dir <path>] [--json]
  agent-space output preview [--work-dir <path>] [--json]`);
    return;
  }

  if (command === "message") {
    console.log(`Usage:
  agent-space message list [--json]
  agent-space message post --channel <name> --summary <text> [--speaker <name>] [--role human|agent] [--json]`);
    return;
  }

  if (command === "task") {
    console.log(`Usage:
  agent-space task list [--json]
  agent-space task create --title <title> --channel <name> --assignee <employee> [--priority low|medium|high] [--json]
  agent-space task move --id <task-id> --status todo|in_progress|blocked|done [--json]
  agent-space task inspect --id <task-id> [--json]`);
    return;
  }

  if (command === "cost") {
    console.log(`Usage:
  agent-space cost summary [--workspace-id <id>] [--period monthly|total] [--json]
  agent-space cost agent --name <agent> [--workspace-id <id>] [--period monthly|total] [--json]
  agent-space cost recent [--workspace-id <id>] [--agent <name>] [--limit <n>] [--json]
  agent-space cost pricing [--json]
  agent-space cost budget list [--workspace-id <id>] [--json]
  agent-space cost budget set --scope <workspace|agent|channel> [--scope-id <id>] --workspace-id <id> --limit <usd> [--period monthly|total] [--action warn|pause|approve] [--threshold <0-1>] [--json]
  agent-space cost budget toggle --id <budget-id> [--workspace-id <id>] --enabled true|false [--json]
  agent-space cost budget delete --id <budget-id> [--workspace-id <id>] [--json]
  agent-space cost budget check --agent <name> [--workspace-id <id>] [--channel <name>] [--json]`);
    return;
  }

  printRootHelp();
}
