import {
  SYSTEM_AGENT_TEMPLATE_PRESETS,
  type AgentTemplateSkillRecommendation,
  type SystemAgentTemplatePreset,
} from "@agent-space/domain";
import {
  type ConversationAutoContinuationState,
  type ConversationExecutionWorkspaceState,
  createDefaultWorkspaceState,
  type ActiveEmployee,
  type AgentSpaceState,
  type ChannelRecord,
  type DirectConversationState,
  type HumanMember,
  type KnowledgePage,
  type LedgerItem,
  type MessageAttachment,
  type MessageMention,
  type WorkspaceMessage,
  type WorkspaceSkill,
  type WorkspaceSkillFile,
} from "@agent-space/domain/workspace";
import {
  normalizeChannelDocuments,
  normalizeChannelDocumentVersions,
  normalizeExternalSheetOperationRuns,
} from "../documents/model.ts";
import { findPreloadedAgentTemplateSkillSource } from "../agent-templates/preloaded-skill-sources.ts";
import {
  normalizeChannelDocumentAccesses,
  normalizeChannelDocumentBlocks,
  normalizeChannelDocumentChangeSets,
  normalizeChannelDocumentConflicts,
  normalizeChannelDocumentPresences,
} from "../documents/collab.ts";
import { normalizeChannelDocumentRuns, normalizeChannelDocumentRunSteps } from "../documents/runs.ts";
import {
  normalizeCollaborationActivities,
  normalizeCollaborationChangeProposals,
  normalizeCollaborationComments,
  normalizeCollaborationCommentThreads,
} from "../collaboration/model.ts";
import {
  createOpaqueId,
  slugify,
  nowTime,
  sameValue,
  uniqueNames,
  normalizeSkillFilePath,
  normalizeSkillIds,
  readSkillFileContent,
} from "./helpers.ts";
import { formatFrontmatterDescription, createDefaultSkillFileContent } from "./skill-frontmatter.ts";

const BUILTIN_RETURN_OUTPUT_FILES_SKILL_NAME = "return-output-files";
const BUILTIN_RETURN_OUTPUT_FILES_SKILL_DESCRIPTION = "Return generated files to AgentSpace via agent-space output attach/text. Use when a task should deliver artifacts such as images, markdown, PDFs, or other files back into chat instead of only replying with plain text.";
const BUILTIN_WORKSPACE_CONTEXT_SKILL_NAME = "workspace-context";
const BUILTIN_WORKSPACE_CONTEXT_SKILL_DESCRIPTION = "Inspect workspace-scoped collaborators, channels, messages, and documents with agent-space workspace context commands. Use when the inline task context is insufficient and the agent needs verifiable workspace facts before answering.";
const BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_NAME = "update-channel-documents";
const BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_DESCRIPTION = "Use when Codex should create or update shared channel documents via agent-space output document.";
const BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_NAME = "google-workspace-cli";
const BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_DESCRIPTION = "Read or write Google Workspace channel documents from the Agent runtime using the official gws CLI and AgentSpace runtime-output manifests.";

export function normalizeWorkspaceState(state: Partial<AgentSpaceState>): AgentSpaceState {
  const fallback = createDefaultWorkspaceState();
  const skillPool = ensureBuiltinWorkspaceSkills(normalizeWorkspaceSkills(state.skills, fallback.skills));
  const activeEmployees = normalizeActiveEmployees(state.activeEmployees, fallback.activeEmployees, skillPool);
  const humanMembers = Array.isArray(state.humanMembers) ? state.humanMembers : fallback.humanMembers;
  const channelDocuments = normalizeChannelDocuments(state.channelDocuments, fallback.channelDocuments);

  return {
    organizationName: state.organizationName ?? fallback.organizationName,
    pendingHandoffs: state.pendingHandoffs ?? fallback.pendingHandoffs,
    humanMembers,
    skills: sortWorkspaceSkills(skillPool),
    activeEmployees,
    directConversations: normalizeDirectConversations(
      (state as { directConversations?: AgentSpaceState["directConversations"] }).directConversations,
      fallback.directConversations,
    ),
    conversationExecutionWorkspaces: normalizeConversationExecutionWorkspaces(
      (state as { conversationExecutionWorkspaces?: AgentSpaceState["conversationExecutionWorkspaces"] }).conversationExecutionWorkspaces,
      fallback.conversationExecutionWorkspaces ?? [],
    ),
    channels: normalizeChannels(state.channels, fallback.channels, humanMembers),
    channelDocuments,
    channelDocumentVersions: normalizeChannelDocumentVersions(
      state.channelDocumentVersions,
      fallback.channelDocumentVersions,
      channelDocuments,
    ),
    channelDocumentBlocks: normalizeChannelDocumentBlocks(
      state.channelDocumentBlocks,
      fallback.channelDocumentBlocks,
    ),
    channelDocumentAccesses: normalizeChannelDocumentAccesses(
      state.channelDocumentAccesses,
      fallback.channelDocumentAccesses,
    ),
    channelDocumentChangeSets: normalizeChannelDocumentChangeSets(
      state.channelDocumentChangeSets,
      fallback.channelDocumentChangeSets,
    ),
    channelDocumentConflicts: normalizeChannelDocumentConflicts(
      state.channelDocumentConflicts,
      fallback.channelDocumentConflicts,
    ),
    channelDocumentPresences: normalizeChannelDocumentPresences(
      state.channelDocumentPresences,
      fallback.channelDocumentPresences,
    ),
    channelDocumentRuns: normalizeChannelDocumentRuns(state.channelDocumentRuns, fallback.channelDocumentRuns),
    channelDocumentRunSteps: normalizeChannelDocumentRunSteps(
      state.channelDocumentRunSteps,
      fallback.channelDocumentRunSteps,
    ),
    externalSheetOperationRuns: normalizeExternalSheetOperationRuns(
      state.externalSheetOperationRuns,
      fallback.externalSheetOperationRuns,
      channelDocuments,
    ),
    collaborationCommentThreads: normalizeCollaborationCommentThreads(
      state.collaborationCommentThreads,
      fallback.collaborationCommentThreads,
    ),
    collaborationComments: normalizeCollaborationComments(state.collaborationComments, fallback.collaborationComments),
    collaborationActivities: normalizeCollaborationActivities(
      state.collaborationActivities,
      fallback.collaborationActivities,
    ),
    collaborationChangeProposals: normalizeCollaborationChangeProposals(
      state.collaborationChangeProposals,
      fallback.collaborationChangeProposals,
    ),
    materials: state.materials ?? fallback.materials,
    knowledgePages: normalizeKnowledgePages(state.knowledgePages, fallback.knowledgePages),
    messages: normalizeWorkspaceMessages(state.messages, fallback.messages),
    tasks: state.tasks ?? fallback.tasks,
    approvals: Array.isArray(state.approvals) ? state.approvals : fallback.approvals,
    dataTables: Array.isArray(state.dataTables) ? state.dataTables : fallback.dataTables,
    automationRules: Array.isArray(state.automationRules) ? state.automationRules : fallback.automationRules,
    scheduledTasks: Array.isArray(state.scheduledTasks) ? state.scheduledTasks : fallback.scheduledTasks,
    templates: Array.isArray(state.templates) ? state.templates : fallback.templates,
    ledger: normalizeLedgerItems(state.ledger, fallback.ledger),
  };
}

function normalizeChannels(
  channels: AgentSpaceState["channels"] | undefined,
  fallback: AgentSpaceState["channels"],
  humanMembers: HumanMember[],
): AgentSpaceState["channels"] {
  if (!Array.isArray(channels)) {
    return fallback;
  }

  return channels
    .map((channel) => normalizeChannel(channel, humanMembers))
    .filter((channel): channel is ChannelRecord => channel !== null);
}

function normalizeChannel(channel: unknown, humanMembers: HumanMember[]): ChannelRecord | null {
  if (!channel || typeof channel !== "object") {
    return null;
  }

  const candidate = channel as Partial<ChannelRecord>;
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
    return null;
  }

  const normalizedHumanMemberNames = uniqueNames(
    Array.isArray(candidate.humanMemberNames)
      ? candidate.humanMemberNames.filter((value): value is string => typeof value === "string")
      : [],
  );
  const fallbackHumanMemberNames =
    normalizedHumanMemberNames.length > 0
      ? normalizedHumanMemberNames
      : humanMembers
          .slice(
            0,
            typeof candidate.humanMembers === "number" && Number.isFinite(candidate.humanMembers)
              ? Math.max(0, Math.round(candidate.humanMembers))
              : humanMembers.length,
          )
          .map((member) => member.name);

  return {
    name: candidate.name.trim(),
    kind: candidate.kind === "direct" ? "direct" : "group",
    humanMemberNames: fallbackHumanMemberNames,
    humanMembers: fallbackHumanMemberNames.length,
    employeeNames: uniqueNames(
      Array.isArray(candidate.employeeNames)
        ? candidate.employeeNames.filter((value): value is string => typeof value === "string")
        : [],
    ),
  };
}

export function buildRecoveredActiveEmployee(
  state: AgentSpaceState,
  employeeName: string,
  runtimeName: string,
): ActiveEmployee {
  const channels = state.channels
    .filter((channel) => channel.employeeNames.some((name) => sameValue(name, employeeName)))
    .map((channel) => channel.name);

  return {
    name: employeeName,
    role: "Agent",
    remarkName: employeeName,
    origin: "runtime-recovered",
    summary: `${employeeName} was recovered from runtime binding ${runtimeName}.`,
    traits: [],
    fit: `Recovered from runtime binding ${runtimeName}.`,
    skillIds: [],
    channels,
    status: "active",
    instructions: "",
  };
}

export function createWorkspaceSkillRecord(input: {
  name: string;
  description: string;
  content?: string;
  sourceType?: string;
  sourceUrl?: string;
  configJson?: string;
}): WorkspaceSkill {
  const now = new Date().toISOString();
  return {
    id: `skill-${createOpaqueId()}`,
    name: input.name,
    description: input.description,
    files: normalizeWorkspaceSkillFiles(
      [
        {
          id: `skill-file-${createOpaqueId()}`,
          path: "SKILL.md",
          content: input.content ?? createDefaultSkillFileContent(input.name, input.description),
          createdAt: now,
          updatedAt: now,
        },
      ],
      input.name,
      input.description,
    ),
    sourceType: input.sourceType?.trim() || "manual",
    sourceUrl: input.sourceUrl?.trim() || undefined,
    configJson: input.configJson?.trim() || "{}",
    createdAt: now,
    updatedAt: now,
  };
}

export function ensureRequiredSkillFile(skill: WorkspaceSkill): WorkspaceSkill {
  return {
    ...skill,
    files: normalizeWorkspaceSkillFiles(skill.files, skill.name, skill.description),
  };
}

export function sortWorkspaceSkills(skills: WorkspaceSkill[]): WorkspaceSkill[] {
  return [...skills].sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { sensitivity: "base" }));
}

export function sortWorkspaceSkillFiles(files: WorkspaceSkillFile[]): WorkspaceSkillFile[] {
  return [...files].sort((left, right) => {
    if (sameValue(left.path, "SKILL.md")) {
      return -1;
    }
    if (sameValue(right.path, "SKILL.md")) {
      return 1;
    }
    return left.path.localeCompare(right.path, "en-US", { sensitivity: "base" });
  });
}

export function ensureBuiltinWorkspaceSkills(skills: WorkspaceSkill[]): WorkspaceSkill[] {
  let nextSkills = [...skills];
  nextSkills = replaceBuiltinWorkspaceSkill(nextSkills, BUILTIN_RETURN_OUTPUT_FILES_SKILL_NAME, createBuiltinReturnOutputFilesSkill);
  nextSkills = replaceBuiltinWorkspaceSkill(nextSkills, BUILTIN_WORKSPACE_CONTEXT_SKILL_NAME, createBuiltinWorkspaceContextSkill);
  nextSkills = replaceBuiltinWorkspaceSkill(nextSkills, BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_NAME, createBuiltinUpdateChannelDocumentsSkill);
  nextSkills = replaceBuiltinWorkspaceSkill(nextSkills, BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_NAME, createBuiltinGoogleWorkspaceCliSkill);
  for (const skill of createPredefinedAgentTemplateSkillRecords()) {
    nextSkills = replaceBuiltinWorkspaceSkill(nextSkills, skill.name, () => skill);
  }
  return sortWorkspaceSkills(nextSkills);
}

export function createPredefinedAgentTemplateSkillRecords(): WorkspaceSkill[] {
  const seenKeys = new Set<string>();
  const skills: WorkspaceSkill[] = [];
  for (const template of SYSTEM_AGENT_TEMPLATE_PRESETS) {
    for (const recommendation of template.skillRecommendations) {
      const key = `${recommendation.sourceType}:${recommendation.sourceUrl}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      skills.push(createPredefinedAgentTemplateSkill(template, recommendation));
    }
  }
  return skills;
}

export function isPredefinedAgentTemplateSkillName(name: string): boolean {
  return SYSTEM_AGENT_TEMPLATE_PRESETS.some((template) =>
    template.skillRecommendations.some((recommendation) => sameValue(recommendation.key, name)),
  );
}

function replaceBuiltinWorkspaceSkill(
  skills: WorkspaceSkill[],
  builtinName: string,
  createBuiltin: () => WorkspaceSkill,
): WorkspaceSkill[] {
  const existingSkill = skills.find((skill) => sameValue(skill.name, builtinName));
  const nextSkills = skills.filter((skill) => !sameValue(skill.name, builtinName));
  nextSkills.unshift(existingSkill ? mergeBuiltinWorkspaceSkill(existingSkill, createBuiltin()) : createBuiltin());
  return nextSkills;
}

function mergeBuiltinWorkspaceSkill(
  existingSkill: WorkspaceSkill,
  builtinSkill: WorkspaceSkill,
): WorkspaceSkill {
  const existingSkillFile = existingSkill.files.find((file) => sameValue(file.path, "SKILL.md"));
  return {
    ...builtinSkill,
    id: existingSkill.id,
    createdAt: existingSkill.createdAt,
    updatedAt: existingSkill.updatedAt,
    files: builtinSkill.files.map((file) =>
      existingSkillFile && sameValue(file.path, "SKILL.md")
        ? {
            ...file,
            id: existingSkillFile.id,
            createdAt: existingSkillFile.createdAt,
            updatedAt: existingSkillFile.updatedAt,
          }
        : file,
    ),
  };
}

export function createUniqueWorkspaceSkillName(skills: WorkspaceSkill[], baseName: string): string {
  const trimmedBaseName = baseName.trim() || "New Skill";
  if (!skills.some((skill) => sameValue(skill.name, trimmedBaseName))) {
    return trimmedBaseName;
  }

  let counter = 2;
  while (skills.some((skill) => sameValue(skill.name, `${trimmedBaseName} ${counter}`))) {
    counter += 1;
  }
  return `${trimmedBaseName} ${counter}`;
}

export function migrateLegacySkillIds(skills: unknown, skillPool: WorkspaceSkill[], employeeName: string): string[] {
  if (!Array.isArray(skills)) {
    return [];
  }

  const result: string[] = [];
  for (const skill of skills) {
    const normalized = normalizeLegacyAgentSkill(skill);
    if (!normalized) {
      continue;
    }

    const existing = skillPool.find(
      (item) =>
        sameValue(item.name, normalized.name) &&
        sameValue(item.description, normalized.description) &&
        readSkillFileContent(item, "SKILL.md") === normalized.content,
    );
    if (existing) {
      if (!result.includes(existing.id)) {
        result.push(existing.id);
      }
      continue;
    }

    const uniqueName = createUniqueWorkspaceSkillName(
      skillPool,
      skillPool.some((item) => sameValue(item.name, normalized.name)) ? `${normalized.name} (${employeeName})` : normalized.name,
    );
    const workspaceSkill = createWorkspaceSkillRecord({
      name: uniqueName,
      description: normalized.description,
      content: normalized.content,
    });
    skillPool.push(workspaceSkill);
    result.push(workspaceSkill.id);
  }

  return result;
}

export function createBuiltinReturnOutputFilesSkillContent(): string {
  return `---
name: ${BUILTIN_RETURN_OUTPUT_FILES_SKILL_NAME}
description: ${BUILTIN_RETURN_OUTPUT_FILES_SKILL_DESCRIPTION}
---

# Return Output Files

Use this skill when your final answer should include generated files instead of only plain text.

## When to use it

- The user explicitly asks for a file, image, PDF, markdown note, or downloadable artifact
- The result is easier to consume as a file than as a pasted chat reply
- You generated a chart, report, draft, export, or other deliverable inside the current workDir

## Contract

- Write output files inside the current \`workDir\`
- Place generated files under \`runtime-output/artifacts/\`
- Do not reference absolute paths
- Do not reference files outside \`workDir\`
- Do not reply with only a file path in plain text

## Commands

\`\`\`bash
agent-space output text "Optional summary shown in the chat message."
agent-space output attach runtime-output/artifacts/chart.png --name chart.png --media-type image/png --text "Chart generated."
agent-space output validate
\`\`\`

## Rules

- Every file passed to \`agent-space output attach\` must already exist and be non-empty
- Keep \`text\` as the human-readable summary shown in chat
- Use \`name\` only when you want a different display name
- Use \`mediaType\` when the file type is not obvious from the extension
- If no file should be returned, use a normal text reply or \`agent-space output text\`

## Examples

- PNG: \`runtime-output/artifacts/preview.png\`
- Markdown: \`runtime-output/artifacts/summary.md\`
- PDF: \`runtime-output/artifacts/report.pdf\`
`;
}

export function createBuiltinWorkspaceContextSkillContent(): string {
  return `---
name: ${BUILTIN_WORKSPACE_CONTEXT_SKILL_NAME}
description: ${BUILTIN_WORKSPACE_CONTEXT_SKILL_DESCRIPTION}
---

# Workspace Context

Use this skill when the inline task prompt does not contain enough workspace facts and you need to query the current workspace safely.

## When to use it

- You need to confirm who someone is in the current workspace
- You need recent channel history before replying
- You need to check which documents exist in a channel
- You need a verifiable answer instead of guessing from incomplete prompt context

## Contract

- Use the shared \`agent-space workspace context ...\` commands
- Do not pass an agent name, user identity, or database path
- The runtime injects the current Agent context automatically
- Treat all returned data as workspace-scoped context, not real-world identity

## Commands

\`\`\`bash
agent-space workspace context list-entities --json
agent-space workspace context resolve-entity --query "个人助手" --json
agent-space workspace context list-channels --json
agent-space workspace context search-messages --query "任天堂博物馆" --channel "tour visit" --json
agent-space workspace context list-documents --channel "tour visit" --json
\`\`\`

## Rules

- Use these commands only when the inline task context is not enough
- For simple questions like "Do you know X?", answer directly if the prompt already gives enough relationship facts
- Only describe entities, channels, messages, and documents that appear in the returned workspace context
- Do not infer hidden channels, user-private labels, or real-world identity from these results
- Prefer the narrowest query that answers the question instead of dumping everything
`;
}

export function createBuiltinUpdateChannelDocumentsSkillContent(): string {
  return `---
name: ${BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_NAME}
description: ${BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_DESCRIPTION}
---

# Update Channel Documents

Use this skill when your result should become a persistent shared channel document instead of only a one-off reply.

## When to use it

- The user explicitly asks you to create or update a channel document
- The result should stay in the channel as a long-lived working draft
- The content will likely be edited again by humans or other agents

## Output contract

\`\`\`bash
agent-space output document upsert --title "Research Notes" --content runtime-output/artifacts/research-notes.md --summary "Summarized interview findings."
agent-space output document replace-block --document-id channel-doc-123 --base-version-id channel-doc-version-456 --title "Research Notes" --block-id channel-doc-block-1 --base-revision 3 --content runtime-output/artifacts/updated-block.md
agent-space output document insert-after --document-id channel-doc-123 --base-version-id channel-doc-version-456 --title "Research Notes" --after-block-id channel-doc-block-1 --content runtime-output/artifacts/new-block.md
agent-space output document delete-block --document-id channel-doc-123 --base-version-id channel-doc-version-456 --title "Research Notes" --block-id channel-doc-block-1 --base-revision 3
agent-space output validate
\`\`\`

Referenced markdown files should live under \`runtime-output/artifacts/\`.

## Rules

- Put referenced markdown files under \`runtime-output/artifacts/\`
- Do not use absolute paths
- Do not reference files outside the current \`workDir\`
- Prefer updating the shared document instead of replying with a disposable summary
- If you do not want to modify documents, do not run an output document command
`;
}

export function createBuiltinGoogleWorkspaceCliSkillContent(): string {
  return `---
name: ${BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_NAME}
description: ${BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_DESCRIPTION}
---

# Google Workspace CLI

Use this skill when the current task includes Google Workspace channel documents, or when the user asks you to create a Google Sheet for the current channel.

## Contract

- For Google Sheets, run the official \`gws\` CLI in the current Agent runtime so you can use the real stdout in the same reply.
- Save Google Sheets JSON stdout under \`runtime-output/artifacts/sheets/*.json\`
- Register Sheets results with \`agent-space output sheets-result add ...\`, then run \`agent-space output validate\`
- For new Google Sheets, run \`gws drive files create\`, save the JSON stdout, register it with \`agent-space output external-document create-google-sheet ...\`, then run \`agent-space output validate\`
- For Google Docs, use \`agent-space output google-docs append-text ...\` or \`agent-space output google-docs batch-update ...\`, then run \`agent-space output validate\`
- Do not request, print, or store Google OAuth tokens
- Do not specify a credential, CLI binary path, or token environment variable
- AgentSpace validates permissions, injects delegated credentials, audits operation runs, and reports status

## Sheets Runtime Flow

Read example:

\`\`\`bash
gws sheets spreadsheets values get --format json --params '{"spreadsheetId":"google-file-id","range":"Sheet1!A1:Z20"}'
mkdir -p runtime-output/artifacts/sheets
# Save the JSON stdout from the previous gws command to runtime-output/artifacts/sheets/read.json.
agent-space output sheets-result add --document-id channel-doc-sheet-123 --operation read --range "Sheet1!A1:Z20" --result-json runtime-output/artifacts/sheets/read.json --summary "Read Sheet1 A1:Z20."
agent-space output validate
\`\`\`

For append/update/batch_update, run the matching \`gws\` Sheets command first, save the JSON result, then register it with \`agent-space output sheets-result add --operation append_rows|update_values|batch_update\`.

Create example:

\`\`\`bash
mkdir -p runtime-output/artifacts/sheets
gws drive files create --format json --params '{"fields":"id,name,webViewLink,mimeType,modifiedTime"}' --json '{"name":"Pipeline Forecast","mimeType":"application/vnd.google-apps.spreadsheet"}'
# Save the JSON stdout from the previous gws command to runtime-output/artifacts/sheets/create-sheet.json.
agent-space output external-document create-google-sheet --target-channel "sales" --title "Pipeline Forecast" --external-file-id "spreadsheet-id-from-gws" --external-url "webViewLink-from-gws" --summary "Agent-created forecast sheet." --gws-result-json runtime-output/artifacts/sheets/create-sheet.json
agent-space output validate
\`\`\`

Do not only paste the Google Sheets URL into the final reply. The sheet must be registered with \`external-document create-google-sheet\` so AgentSpace can add it to the channel cloud documents list, validate permissions, and audit the operation.

## Docs Runtime Flow

\`\`\`bash
mkdir -p runtime-output/artifacts/docs
# Save append text to runtime-output/artifacts/docs/summary.md.
agent-space output google-docs append-text --document-id channel-doc-google-doc-123 --intent "Append meeting summary" --text-file runtime-output/artifacts/docs/summary.md
# Save a JSON array of Docs batchUpdate requests to runtime-output/artifacts/docs/requests.json.
agent-space output google-docs batch-update --document-id channel-doc-google-doc-123 --intent "Apply structured Docs changes" --requests-json runtime-output/artifacts/docs/requests.json
agent-space output validate
\`\`\`

## Rules

- Use the AgentSpace channel document id in \`documentId\`, not the raw Google file id
- Keep \`intent\` specific enough for audit review
- Use \`requestSummary\` for risky writes when helpful
- Batch update payloads should match Google API request schemas; use smaller, explicit requests
- Mutating operations are audited and may require dry-run, review, or human approval as configured
- If the task does not require Google Workspace access, do not run Google Workspace output commands
`;
}

// ── Private normalizers ──────────────────────────────────────────────

function normalizeActiveEmployees(
  employees: AgentSpaceState["activeEmployees"] | undefined,
  fallback: AgentSpaceState["activeEmployees"],
  skillPool: WorkspaceSkill[],
): AgentSpaceState["activeEmployees"] {
  if (!Array.isArray(employees)) {
    return fallback;
  }

  return employees
    .map((employee) => normalizeActiveEmployee(employee, skillPool))
    .filter((employee): employee is ActiveEmployee => employee !== null);
}

function normalizeActiveEmployee(employee: unknown, skillPool: WorkspaceSkill[]): ActiveEmployee | null {
  if (!employee || typeof employee !== "object") {
    return null;
  }

  const candidate = employee as Partial<ActiveEmployee>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.origin !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.fit !== "string" ||
    !Array.isArray(candidate.channels) ||
    candidate.status !== "active"
  ) {
    return null;
  }

  return {
    name: candidate.name,
    role: typeof candidate.role === "string" ? candidate.role : "Agent",
    remarkName:
      typeof candidate.remarkName === "string" && candidate.remarkName.trim().length > 0
        ? candidate.remarkName
        : candidate.name,
    ownerUserId:
      typeof candidate.ownerUserId === "string" && candidate.ownerUserId.trim().length > 0
        ? candidate.ownerUserId
        : undefined,
    channelMemberAccess: normalizeEmployeeChannelMemberAccess(candidate),
    origin: candidate.origin,
    summary: candidate.summary,
    traits: Array.isArray(candidate.traits) ? candidate.traits.filter((item): item is string => typeof item === "string") : [],
    fit: candidate.fit,
    skillIds: Array.isArray((candidate as { skillIds?: unknown }).skillIds)
      ? normalizeSkillIds((candidate as { skillIds?: unknown }).skillIds, skillPool)
      : migrateLegacySkillIds((candidate as { skills?: unknown }).skills, skillPool, candidate.name),
    channels: candidate.channels.filter((item): item is string => typeof item === "string"),
    status: "active",
    instructions: typeof candidate.instructions === "string" ? candidate.instructions : "",
  };
}

function normalizeEmployeeChannelMemberAccess(candidate: Partial<ActiveEmployee>): ActiveEmployee["channelMemberAccess"] {
  if (candidate.channelMemberAccess === "enabled" || candidate.channelMemberAccess === "disabled") {
    return candidate.channelMemberAccess;
  }
  return typeof candidate.ownerUserId === "string" && candidate.ownerUserId.trim().length > 0
    ? "disabled"
    : "enabled";
}

function normalizeWorkspaceSkills(skills: unknown, fallback: WorkspaceSkill[]): WorkspaceSkill[] {
  if (!Array.isArray(skills)) {
    return [];
  }

  const result: WorkspaceSkill[] = [];
  for (const skill of skills) {
    const normalized = normalizeWorkspaceSkill(skill);
    if (!normalized) {
      continue;
    }
    if (result.some((existing) => existing.id === normalized.id || sameValue(existing.name, normalized.name))) {
      continue;
    }
    result.push(normalized);
  }

  return result.length > 0 ? sortWorkspaceSkills(result) : fallback;
}

function normalizeWorkspaceSkill(skill: unknown): WorkspaceSkill | null {
  if (!skill || typeof skill !== "object") {
    return null;
  }

  const candidate = skill as Partial<WorkspaceSkill>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) {
    return null;
  }

  return ensureRequiredSkillFile({
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : `skill-${slugify(name)}-${createOpaqueId()}`,
    name,
    description: typeof candidate.description === "string" ? candidate.description.trim() : "",
    files: normalizeWorkspaceSkillFiles(candidate.files, name, typeof candidate.description === "string" ? candidate.description.trim() : ""),
    sourceType:
      typeof candidate.sourceType === "string" && candidate.sourceType.trim().length > 0
        ? candidate.sourceType.trim()
        : "manual",
    sourceUrl:
      typeof candidate.sourceUrl === "string" && candidate.sourceUrl.trim().length > 0
        ? candidate.sourceUrl.trim()
        : undefined,
    configJson:
      typeof candidate.configJson === "string" && candidate.configJson.trim().length > 0
        ? candidate.configJson
        : "{}",
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
        ? candidate.updatedAt
        : new Date().toISOString(),
  });
}

function normalizeKnowledgePages(
  pages: AgentSpaceState["knowledgePages"] | undefined,
  fallback: AgentSpaceState["knowledgePages"],
): AgentSpaceState["knowledgePages"] {
  if (!Array.isArray(pages)) {
    return fallback;
  }

  return pages
    .filter((page): page is KnowledgePage =>
      Boolean(page) &&
      typeof page === "object" &&
      typeof (page as Partial<KnowledgePage>).id === "string" &&
      typeof (page as Partial<KnowledgePage>).title === "string",
    )
    .map((page) => ({
      id: page.id,
      parentId: typeof page.parentId === "string" ? page.parentId : null,
      title: page.title,
      contentMarkdown: typeof page.contentMarkdown === "string" ? page.contentMarkdown : "",
      sortOrder: typeof page.sortOrder === "number" ? page.sortOrder : 0,
      tags: Array.isArray(page.tags) ? page.tags.filter((tag): tag is string => typeof tag === "string") : [],
      createdBy: typeof page.createdBy === "string" ? page.createdBy : "",
      createdAt: typeof page.createdAt === "string" ? page.createdAt : nowTime(),
      updatedAt: typeof page.updatedAt === "string" ? page.updatedAt : nowTime(),
      assignmentMode: page.assignmentMode === "selected_agents" ? "selected_agents" : "all_agents",
      assignmentUpdatedAt:
        typeof page.assignmentUpdatedAt === "string" && page.assignmentUpdatedAt.trim().length > 0
          ? page.assignmentUpdatedAt
          : undefined,
      assignmentUpdatedBy:
        typeof page.assignmentUpdatedBy === "string" && page.assignmentUpdatedBy.trim().length > 0
          ? page.assignmentUpdatedBy
          : undefined,
      sourceAttachmentId:
        typeof page.sourceAttachmentId === "string" && page.sourceAttachmentId.trim().length > 0
          ? page.sourceAttachmentId
          : undefined,
      sourceAttachmentStoredPath:
        typeof page.sourceAttachmentStoredPath === "string" && page.sourceAttachmentStoredPath.trim().length > 0
          ? page.sourceAttachmentStoredPath
          : undefined,
      sourceChannelDocumentId:
        typeof page.sourceChannelDocumentId === "string" && page.sourceChannelDocumentId.trim().length > 0
          ? page.sourceChannelDocumentId
          : undefined,
      sourceKnowledgeProposalId:
        typeof page.sourceKnowledgeProposalId === "string" && page.sourceKnowledgeProposalId.trim().length > 0
          ? page.sourceKnowledgeProposalId
          : undefined,
      sourceApprovalId:
        typeof page.sourceApprovalId === "string" && page.sourceApprovalId.trim().length > 0
          ? page.sourceApprovalId
          : undefined,
      sourceTaskQueueId:
        typeof page.sourceTaskQueueId === "string" && page.sourceTaskQueueId.trim().length > 0
          ? page.sourceTaskQueueId
          : undefined,
      sourceAgentName:
        typeof page.sourceAgentName === "string" && page.sourceAgentName.trim().length > 0
          ? page.sourceAgentName
          : undefined,
    }));
}

function normalizeLedgerItems(
  ledger: AgentSpaceState["ledger"] | undefined,
  fallback: AgentSpaceState["ledger"],
): AgentSpaceState["ledger"] {
  if (!Array.isArray(ledger)) {
    return fallback;
  }

  return ledger
    .map((entry) => normalizeLedgerItem(entry))
    .filter((entry): entry is LedgerItem => entry !== null);
}

function normalizeLedgerItem(entry: unknown): LedgerItem | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const candidate = entry as Partial<LedgerItem>;
  if (typeof candidate.title !== "string" || typeof candidate.note !== "string") {
    return null;
  }

  const inferred = inferLegacyLedgerEntry(candidate.title, candidate.note);
  const data = normalizeLedgerData(candidate.data) ?? inferred?.data;

  return {
    title: candidate.title,
    note: candidate.note,
    code: typeof candidate.code === "string" && candidate.code.trim().length > 0 ? candidate.code : inferred?.code,
    data,
  };
}

export function normalizeLedgerData(data: unknown): Record<string, string> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      result[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      result[key] = String(value);
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function inferLegacyLedgerEntry(title: string, note: string): { code: string; data?: Record<string, string> } | null {
  const patterns: Array<{ title: string; regex: RegExp; code: string; keys: string[] }> = [
    { title: "Runtime 绑定", regex: /^(.+?) 已绑定到 (.+)。$/, code: "runtime.bound", keys: ["employee_name", "runtime_name"] },
    { title: "Runtime 解绑", regex: /^(.+?) 已解绑 native runtime。$/, code: "runtime.unbound", keys: ["employee_name"] },
    { title: "Agent 已删除", regex: /^(.+?) 已从组织中移除，并清理绑定、任务和工作区域。$/, code: "agent.deleted", keys: ["employee_name"] },
    { title: "Agent 指令更新", regex: /^(.+?) 的 instructions 已更新。$/, code: "agent.instructions_updated", keys: ["employee_name"] },
    { title: "Skill 创建", regex: /^(.+?) 已加入工作区技能库。$/, code: "skill.created", keys: ["skill_name"] },
    { title: "Skill 更新", regex: /^(.+?) 的元信息已更新。$/, code: "skill.updated", keys: ["skill_name"] },
    { title: "Skill 删除", regex: /^(.+?) 已从工作区技能库移除，并解除所有 agent 绑定。$/, code: "skill.deleted", keys: ["skill_name"] },
    { title: "Skill 文件更新", regex: /^(.+?) 的 (.+) 已更新。$/, code: "skill.file_updated", keys: ["skill_name", "file_path"] },
    { title: "Skill 文件创建", regex: /^(.+?) 新增文件 (.+)。$/, code: "skill.file_created", keys: ["skill_name", "file_path"] },
    { title: "Skill 文件删除", regex: /^(.+?) 的 (.+) 已删除。$/, code: "skill.file_deleted", keys: ["skill_name", "file_path"] },
    { title: "Agent Skills 绑定更新", regex: /^(.+?) 的 skills 绑定已更新，共 (\d+) 项。$/, code: "agent.skills_updated", keys: ["employee_name", "skill_count"] },
    { title: "联系人私聊入队", regex: /^你向 (.+?) 发起了一条私聊，已转交 Agent 执行。$/, code: "contact.queued", keys: ["contact_name"] },
    { title: "频道创建", regex: /^已创建频道 (.+?)，成员 (\d+) 名人类 \/ (\d+) 名 agent。$/, code: "channel.created", keys: ["channel_name", "human_count", "agent_count"] },
    { title: "频道删除", regex: /^频道 (.+?) 已删除，并清理相关消息、任务和成员绑定。$/, code: "channel.deleted", keys: ["channel_name"] },
    { title: "频道重命名", regex: /^频道 (.+?) 已重命名为 (.+)。$/, code: "channel.renamed", keys: ["previous_name", "next_name"] },
    { title: "原料补充", regex: /^新增原料来源 (.+?)，当前状态：(.+)。$/, code: "material.added", keys: ["source", "status"] },
    { title: "文件导入", regex: /^已导入文件 (.+?)，落盘到 (.+?)，后续可用于切片和员工生成。$/, code: "material.imported", keys: ["source", "stored_name"] },
    { title: "原料解析", regex: /^文件 (.+?) 已完成首轮解析，可进入切片或员工生成流程。$/, code: "material.parsed", keys: ["source"] },
    { title: "群聊消息", regex: /^(.+?) 在 (.+?) 发送了一条普通消息，未触发任何 Agent。$/, code: "channel.message", keys: ["speaker", "channel_name"] },
    { title: "群聊 mention", regex: /^(.+?) 在 (.+?) 定向 @了 (.+?)，已分发给 (\d+) 个 Agent。$/, code: "channel.mention_dispatched", keys: ["speaker", "channel_name", "mentions", "queued_count"] },
    { title: "群聊 mention", regex: /^(.+?) 在 (.+?) @了 (.+?)，但目标 Agent 当前不可执行。$/, code: "channel.mention_unavailable", keys: ["speaker", "channel_name", "mentions"] },
    { title: "员工直加入组", regex: /^(.+?) 已直接入组，等待后续手动加入频道。$/, code: "employee.created", keys: ["employee_name"] },
    { title: "任务创建", regex: /^(.+?) 已在 (.+?) 接收任务：(.+)。$/, code: "task.created", keys: ["assignee", "channel_name", "task_title"] },
    { title: "任务入队", regex: /^(.+?) 已进入 native queue，等待 (.+?) 执行。$/, code: "task.queued", keys: ["task_title", "runtime_name"] },
    { title: "任务状态更新", regex: /^任务 (.+?) 已更新为 (.+)。$/, code: "task.status_updated", keys: ["task_title", "status"] },
  ];

  for (const pattern of patterns) {
    if (pattern.title !== title) {
      continue;
    }
    const match = note.match(pattern.regex);
    if (!match) {
      continue;
    }
    const data: Record<string, string> = {};
    for (const [index, key] of pattern.keys.entries()) {
      data[key] = match[index + 1] ?? "";
    }
    return { code: pattern.code, data };
  }

  return null;
}

export function inferLegacyWorkspaceMessage(
  speaker: string,
  summary: string,
): { code: string; data?: Record<string, string> } | null {
  const patterns: Array<{ speaker?: RegExp; regex: RegExp; code: string; keys: string[] }> = [
    { speaker: /^(?:Atlas · 运行时协调器|系统提示)$/, regex: /^(.+?) 已绑定到 native runtime：(.+?)。$/, code: "runtime.bound", keys: ["employee_name", "runtime_name"] },
    { speaker: /^(?:Atlas · 运行时协调器|系统提示)$/, regex: /^(.+?) 已解除 native runtime 绑定。$/, code: "runtime.unbound", keys: ["employee_name"] },
    { speaker: /^(?:Atlas · 运行时协调器|系统提示)$/, regex: /^(.+?) 已删除，相关容器绑定与工作区域已清理。$/, code: "agent.deleted", keys: ["employee_name"] },
    { speaker: /^系统通知$/, regex: /^新频道 (.+?) 已创建，可立即接入数字员工与协作流。$/, code: "channel.created_notice", keys: ["channel_name"] },
    { speaker: /^系统通知$/, regex: /^频道 (.+?) 已重命名为 (.+?)。$/, code: "channel.renamed_notice", keys: ["previous_name", "next_name"] },
    { speaker: /^(?:Atlas · 运行时协调器|系统提示)$/, regex: /^(.+?) 当前没有绑定可执行 runtime，无法响应这次 @。$/, code: "mention.unavailable", keys: ["agent_names"] },
    { speaker: /^(?:Atlas · 任务分派器|系统提示)$/, regex: /^新任务已分派给 (.+?)：(.+?)。$/, code: "task.assigned_notice", keys: ["assignee", "task_title"] },
    { speaker: /^(?:Atlas · 运行时协调器|系统提示)$/, regex: /^任务 (.+?) 已进入 native queue，目标 runtime：(.+?)。$/, code: "task.queued_notice", keys: ["task_title", "runtime_name"] },
    { speaker: /^(?:Atlas · 任务分派器|系统提示)$/, regex: /^任务 (.+?) 当前状态已更新为 (.+?)。$/, code: "task.status_notice", keys: ["task_title", "status"] },
    { speaker: /^(?:Atlas · 文档协调器|系统提示)$/, regex: /^群文档《(.+?)》已创建。$/, code: "channel_document.created_notice", keys: ["document_title"] },
    { speaker: /^(?:Atlas · 文档协调器|系统提示)$/, regex: /^群文档《(.+?)》已更新。(?: 摘要：(.+))?$/, code: "channel_document.updated_notice", keys: ["document_title", "summary"] },
    { speaker: /^(?:Atlas · 文档协调器|系统提示)$/, regex: /^群文档《(.+?)》已归档。$/, code: "channel_document.archived_notice", keys: ["document_title"] },
    { regex: /^思考中$/, code: "agent.pending", keys: [] },
  ];

  for (const pattern of patterns) {
    if (pattern.speaker && !pattern.speaker.test(speaker)) {
      continue;
    }
    const match = summary.match(pattern.regex);
    if (!match) {
      continue;
    }
    const data: Record<string, string> = {};
    for (const [index, key] of pattern.keys.entries()) {
      data[key] = match[index + 1] ?? "";
    }
    if (pattern.code === "agent.pending") {
      data.agent_name = speaker;
    }
    return { code: pattern.code, data: Object.keys(data).length > 0 ? data : undefined };
  }

  return null;
}

export function normalizeWorkspaceSkillFiles(
  files: unknown,
  skillName: string,
  skillDescription: string,
): WorkspaceSkillFile[] {
  const result: WorkspaceSkillFile[] = [];
  if (Array.isArray(files)) {
    for (const file of files) {
      const normalized = normalizeWorkspaceSkillFile(file);
      if (!normalized) {
        continue;
      }
      if (result.some((existing) => existing.id === normalized.id || sameValue(existing.path, normalized.path))) {
        continue;
      }
      result.push(normalized);
    }
  }

  if (!result.some((file) => sameValue(file.path, "SKILL.md"))) {
    const now = new Date().toISOString();
    result.unshift({
      id: `skill-file-${createOpaqueId()}`,
      path: "SKILL.md",
      content: createDefaultSkillFileContent(skillName, skillDescription),
      createdAt: now,
      updatedAt: now,
    });
  }

  return sortWorkspaceSkillFiles(result);
}

function normalizeWorkspaceSkillFile(file: unknown): WorkspaceSkillFile | null {
  if (!file || typeof file !== "object") {
    return null;
  }

  const candidate = file as Partial<WorkspaceSkillFile>;
  const path = normalizeSkillFilePath(candidate.path);
  if (!path) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : `skill-file-${createOpaqueId()}`,
    path,
    content: typeof candidate.content === "string" ? candidate.content : "",
    createdAt:
      typeof candidate.createdAt === "string" && candidate.createdAt.trim().length > 0
        ? candidate.createdAt
        : now,
    updatedAt:
      typeof candidate.updatedAt === "string" && candidate.updatedAt.trim().length > 0
        ? candidate.updatedAt
        : now,
  };
}

function normalizeLegacyAgentSkill(skill: unknown): { name: string; description: string; content: string } | null {
  if (!skill || typeof skill !== "object") {
    return null;
  }

  const candidate = skill as {
    name?: unknown;
    summary?: unknown;
    category?: unknown;
    level?: unknown;
    enabled?: unknown;
  };
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name) {
    return null;
  }

  const description = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
  return {
    name,
    description,
    content: createLegacySkillFileContent({
      name,
      description,
      category: typeof candidate.category === "string" ? candidate.category.trim() : "",
      level: typeof candidate.level === "string" ? candidate.level.trim() : "",
      enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
    }),
  };
}

function normalizeDirectConversations(
  conversations: AgentSpaceState["directConversations"] | undefined,
  fallback: AgentSpaceState["directConversations"],
): AgentSpaceState["directConversations"] {
  if (!Array.isArray(conversations)) {
    return fallback;
  }

  return sortDirectConversations(
    conversations
      .map((thread) => normalizeDirectConversation(thread))
      .filter((thread): thread is DirectConversationState => thread !== null),
  );
}

function normalizeDirectConversation(thread: unknown): DirectConversationState | null {
  if (!thread || typeof thread !== "object") {
    return null;
  }

  const candidate = thread as Partial<DirectConversationState>;
  if (
    typeof candidate.contactId !== "string"
  ) {
    return null;
  }

  return {
    contactId: candidate.contactId,
    humanMemberName:
      typeof candidate.humanMemberName === "string" && candidate.humanMemberName.length > 0
        ? candidate.humanMemberName
        : undefined,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
    sessionId: typeof candidate.sessionId === "string" && candidate.sessionId.length > 0 ? candidate.sessionId : undefined,
    workDir: typeof candidate.workDir === "string" && candidate.workDir.length > 0 ? candidate.workDir : undefined,
  };
}

function normalizeConversationExecutionWorkspaces(
  workspaces: AgentSpaceState["conversationExecutionWorkspaces"] | undefined,
  fallback: ConversationExecutionWorkspaceState[],
): ConversationExecutionWorkspaceState[] {
  if (!Array.isArray(workspaces)) {
    return fallback;
  }

  return [...workspaces]
    .map((workspace) => normalizeConversationExecutionWorkspace(workspace))
    .filter((workspace): workspace is ConversationExecutionWorkspaceState => workspace !== null)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function normalizeConversationExecutionWorkspace(workspace: unknown): ConversationExecutionWorkspaceState | null {
  if (!workspace || typeof workspace !== "object") {
    return null;
  }

  const candidate = workspace as Partial<ConversationExecutionWorkspaceState>;
  const channelName = typeof candidate.channelName === "string" ? candidate.channelName : "";
  const agentId = typeof candidate.agentId === "string" ? candidate.agentId : "";
  const conversationKind =
    candidate.conversationKind === "direct" || candidate.conversationKind === "group"
      ? candidate.conversationKind
      : typeof candidate.contactId === "string" && candidate.contactId.length > 0
        ? "direct"
        : "group";
  if (
    !channelName ||
    !agentId
  ) {
    return null;
  }
  const conversationKey =
    typeof candidate.conversationKey === "string" && candidate.conversationKey.length > 0
      ? candidate.conversationKey
      : `${conversationKind}:${channelName}:${agentId}`;

  return {
    conversationKey,
    conversationKind,
    channelName,
    agentId,
    contactId: typeof candidate.contactId === "string" && candidate.contactId.length > 0 ? candidate.contactId : undefined,
    humanMemberName:
      typeof candidate.humanMemberName === "string" && candidate.humanMemberName.length > 0
        ? candidate.humanMemberName
        : undefined,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
    lastTaskQueueId:
      typeof candidate.lastTaskQueueId === "string" && candidate.lastTaskQueueId.length > 0
        ? candidate.lastTaskQueueId
        : undefined,
    sessionId:
      typeof candidate.sessionId === "string" && candidate.sessionId.length > 0
        ? candidate.sessionId
        : undefined,
    workDir:
      typeof candidate.workDir === "string" && candidate.workDir.length > 0
        ? candidate.workDir
        : undefined,
    lastError:
      typeof candidate.lastError === "string" && candidate.lastError.length > 0
        ? candidate.lastError
        : undefined,
    autoContinuation: normalizeConversationAutoContinuation(candidate.autoContinuation),
  };
}

function normalizeConversationAutoContinuation(input: unknown): ConversationAutoContinuationState | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  const candidate = input as Partial<ConversationAutoContinuationState>;
  if (
    candidate.mode !== "until" ||
    (candidate.status !== "active" && candidate.status !== "expired" && candidate.status !== "stopped") ||
    typeof candidate.startedAt !== "string" ||
    typeof candidate.until !== "string" ||
    typeof candidate.instruction !== "string"
  ) {
    return undefined;
  }

  return {
    mode: "until",
    status: candidate.status,
    startedAt: candidate.startedAt,
    until: candidate.until,
    instruction: candidate.instruction,
    requestedByUserId:
      typeof candidate.requestedByUserId === "string" && candidate.requestedByUserId.length > 0
        ? candidate.requestedByUserId
        : undefined,
    requestedByDisplayName:
      typeof candidate.requestedByDisplayName === "string" && candidate.requestedByDisplayName.length > 0
        ? candidate.requestedByDisplayName
        : undefined,
    sourceMessageId:
      typeof candidate.sourceMessageId === "string" && candidate.sourceMessageId.length > 0
        ? candidate.sourceMessageId
        : undefined,
    iteration:
      typeof candidate.iteration === "number" && Number.isFinite(candidate.iteration)
        ? candidate.iteration
        : 0,
    lastContinuedAt:
      typeof candidate.lastContinuedAt === "string" && candidate.lastContinuedAt.length > 0
        ? candidate.lastContinuedAt
        : undefined,
  };
}

function normalizeWorkspaceMessages(messages: AgentSpaceState["messages"] | undefined, fallback: AgentSpaceState["messages"]): AgentSpaceState["messages"] {
  if (!Array.isArray(messages)) {
    return fallback;
  }

  return messages
    .map((message) => normalizeWorkspaceMessage(message))
    .filter((message): message is WorkspaceMessage => message !== null);
}

function normalizeWorkspaceMessage(message: unknown): WorkspaceMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const candidate = message as Partial<WorkspaceMessage>;
  if (
    typeof candidate.speaker !== "string" ||
    typeof candidate.summary !== "string" ||
    (candidate.role !== "human" && candidate.role !== "agent")
  ) {
    return null;
  }
  const inferred = inferLegacyWorkspaceMessage(candidate.speaker, candidate.summary);

  return {
    id:
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : `message-${createOpaqueId()}`,
    channel: typeof candidate.channel === "string" ? candidate.channel : undefined,
    speaker: candidate.speaker,
    speakerUserId:
      typeof candidate.speakerUserId === "string" && candidate.speakerUserId.trim().length > 0
        ? candidate.speakerUserId.trim()
        : undefined,
    role: candidate.role,
    time: typeof candidate.time === "string" && candidate.time.trim().length > 0 ? candidate.time : nowTime(),
    summary: candidate.summary,
    code: typeof candidate.code === "string" && candidate.code.trim().length > 0 ? candidate.code : inferred?.code,
    data: normalizeLedgerData((candidate as { data?: unknown }).data) ?? inferred?.data,
    status: candidate.status === "error" ? "error" : candidate.status === "pending" ? "pending" : "completed",
    kind: candidate.kind === "process" ? "process" : "message",
    processType: typeof candidate.processType === "string" ? candidate.processType : undefined,
    tool: typeof candidate.tool === "string" ? candidate.tool : undefined,
    attachments: normalizeMessageAttachments(candidate.attachments),
    mentions: normalizeMessageMentions((candidate as { mentions?: unknown }).mentions),
    acknowledgements: normalizeMessageAcknowledgements((candidate as { acknowledgements?: unknown }).acknowledgements),
    pinned: candidate.pinned === true ? true : undefined,
    pinnedAt: candidate.pinned === true && typeof candidate.pinnedAt === "string" ? candidate.pinnedAt : undefined,
    replyToMessageId: typeof candidate.replyToMessageId === "string" && candidate.replyToMessageId.length > 0 ? candidate.replyToMessageId : undefined,
  };
}

function normalizeMessageAttachments(attachments: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(attachments)) {
    return undefined;
  }

  const normalized = attachments
    .map((attachment) => normalizeMessageAttachment(attachment))
    .filter((attachment): attachment is MessageAttachment => attachment !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMessageAttachment(attachment: unknown): MessageAttachment | null {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const candidate = attachment as Partial<MessageAttachment>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.fileName !== "string" ||
    typeof candidate.mediaType !== "string" ||
    typeof candidate.sizeBytes !== "number" ||
    typeof candidate.storedPath !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    fileName: candidate.fileName,
    mediaType: candidate.mediaType,
    sizeBytes: candidate.sizeBytes,
    kind: candidate.kind === "image" ? "image" : "file",
    storedPath: candidate.storedPath,
    storageProvider:
      candidate.storageProvider === "r2" || candidate.storageProvider === "s3" || candidate.storageProvider === "local"
        ? candidate.storageProvider
        : undefined,
    storageBucket: normalizeOptionalString(candidate.storageBucket),
    storageRegion: normalizeOptionalString(candidate.storageRegion),
    storageEndpoint: normalizeOptionalString(candidate.storageEndpoint),
    storageKey: normalizeOptionalString(candidate.storageKey),
    storageUrl: normalizeOptionalString(candidate.storageUrl),
    sha256: normalizeOptionalString(candidate.sha256),
    deletedAt:
      typeof candidate.deletedAt === "string" && candidate.deletedAt.trim().length > 0
        ? candidate.deletedAt
        : undefined,
    deletedByUserId:
      typeof candidate.deletedByUserId === "string" && candidate.deletedByUserId.trim().length > 0
        ? candidate.deletedByUserId
        : undefined,
    deletedByDisplayName:
      typeof candidate.deletedByDisplayName === "string" && candidate.deletedByDisplayName.trim().length > 0
        ? candidate.deletedByDisplayName
        : undefined,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeMessageMentions(mentions: unknown): MessageMention[] | undefined {
  if (!Array.isArray(mentions)) {
    return undefined;
  }

  const normalized = mentions
    .map((mention) => normalizeMessageMention(mention))
    .filter((mention): mention is MessageMention => mention !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMessageMention(mention: unknown): MessageMention | null {
  if (!mention || typeof mention !== "object") {
    return null;
  }

  const candidate = mention as {
    agentId?: unknown;
    humanId?: unknown;
    label?: unknown;
    token?: unknown;
    mentionType?: unknown;
    inChannel?: unknown;
  };
  if (
    typeof candidate.label !== "string" ||
    typeof candidate.token !== "string"
  ) {
    return null;
  }

  if (candidate.mentionType === "human") {
    if (typeof candidate.humanId !== "string") {
      return null;
    }
    return {
      humanId: candidate.humanId,
      label: candidate.label,
      token: candidate.token,
      mentionType: "human",
      inChannel: candidate.inChannel === true,
    };
  }

  if (typeof candidate.agentId !== "string") {
    return null;
  }

  return {
    agentId: candidate.agentId,
    label: candidate.label,
    token: candidate.token,
    mentionType: "agent",
    inChannel: candidate.inChannel === true,
  };
}

function normalizeMessageAcknowledgements(acknowledgements: unknown): WorkspaceMessage["acknowledgements"] {
  if (!Array.isArray(acknowledgements)) {
    return undefined;
  }

  const normalized = acknowledgements
    .map((acknowledgement) => normalizeMessageAcknowledgement(acknowledgement))
    .filter((acknowledgement): acknowledgement is NonNullable<WorkspaceMessage["acknowledgements"]>[number] => acknowledgement !== null);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMessageAcknowledgement(acknowledgement: unknown): NonNullable<WorkspaceMessage["acknowledgements"]>[number] | null {
  if (!acknowledgement || typeof acknowledgement !== "object") {
    return null;
  }

  const candidate = acknowledgement as {
    userId?: unknown;
    label?: unknown;
    acknowledgedAt?: unknown;
  };
  if (
    typeof candidate.label !== "string" ||
    candidate.label.trim().length === 0 ||
    typeof candidate.acknowledgedAt !== "string" ||
    candidate.acknowledgedAt.trim().length === 0
  ) {
    return null;
  }

  return {
    userId: typeof candidate.userId === "string" && candidate.userId.trim().length > 0 ? candidate.userId : undefined,
    label: candidate.label.trim(),
    acknowledgedAt: candidate.acknowledgedAt,
  };
}

function sortDirectConversations(threads: DirectConversationState[]): DirectConversationState[] {
  return [...threads].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function createLegacySkillFileContent(input: {
  name: string;
  description: string;
  category: string;
  level: string;
  enabled: boolean;
}): string {
  const metadataLines = [
    input.category ? `- Legacy category: ${input.category}` : "",
    input.level ? `- Legacy level: ${input.level}` : "",
    input.enabled ? "" : "- Legacy state: disabled",
  ].filter(Boolean);
  const summary =
    input.description || `Use when Codex should apply the ${input.name} workflow.`;

  return `---
name: ${slugify(input.name)}
${formatFrontmatterDescription(summary)}
---

# ${input.name}

${input.description || "Migrated from the previous agent-local skill configuration."}

${metadataLines.length > 0 ? `## Migration Notes\n\n${metadataLines.join("\n")}\n` : ""}`;
}

function createBuiltinReturnOutputFilesSkill(): WorkspaceSkill {
  return createWorkspaceSkillRecord({
    name: BUILTIN_RETURN_OUTPUT_FILES_SKILL_NAME,
    description: BUILTIN_RETURN_OUTPUT_FILES_SKILL_DESCRIPTION,
    content: createBuiltinReturnOutputFilesSkillContent(),
    sourceType: "builtin",
  });
}

function createBuiltinWorkspaceContextSkill(): WorkspaceSkill {
  return createWorkspaceSkillRecord({
    name: BUILTIN_WORKSPACE_CONTEXT_SKILL_NAME,
    description: BUILTIN_WORKSPACE_CONTEXT_SKILL_DESCRIPTION,
    content: createBuiltinWorkspaceContextSkillContent(),
    sourceType: "builtin",
  });
}

function createBuiltinUpdateChannelDocumentsSkill(): WorkspaceSkill {
  return createWorkspaceSkillRecord({
    name: BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_NAME,
    description: BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_DESCRIPTION,
    content: createBuiltinUpdateChannelDocumentsSkillContent(),
    sourceType: "builtin",
  });
}

function createBuiltinGoogleWorkspaceCliSkill(): WorkspaceSkill {
  return createWorkspaceSkillRecord({
    name: BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_NAME,
    description: BUILTIN_GOOGLE_WORKSPACE_CLI_SKILL_DESCRIPTION,
    content: createBuiltinGoogleWorkspaceCliSkillContent(),
    sourceType: "builtin",
  });
}

function createPredefinedAgentTemplateSkill(
  template: SystemAgentTemplatePreset,
  recommendation: AgentTemplateSkillRecommendation,
): WorkspaceSkill {
  const source = findPreloadedAgentTemplateSkillSource({
    key: recommendation.key,
    sourceType: recommendation.sourceType,
    sourceUrl: recommendation.sourceUrl,
  });
  if (!source) {
    throw new Error(`Missing preloaded source snapshot for agent template skill "${recommendation.key}".`);
  }

  const skill = createWorkspaceSkillRecord({
    name: source.name,
    description: source.description,
    content: source.files.find((file) => sameValue(file.path, "SKILL.md"))?.content,
    sourceType: recommendation.sourceType,
    sourceUrl: recommendation.sourceUrl,
    configJson: JSON.stringify({
      provider: "system-agent-template",
      templateId: template.id,
      templateVersion: template.version,
      requirement: recommendation.requirement,
      sourceType: recommendation.sourceType,
      sourceUrl: recommendation.sourceUrl,
      resolvedSourceUrl: source.resolvedSourceUrl,
      resolvedCommit: source.resolvedCommit,
      sourcePath: source.sourcePath,
    }),
  });

  const now = skill.createdAt;
  skill.files = normalizeWorkspaceSkillFiles(
    source.files.map((file) => ({
      id: `skill-file-${createOpaqueId()}`,
      path: file.path,
      content: file.content,
      createdAt: now,
      updatedAt: now,
    })),
    skill.name,
    skill.description,
  );
  return skill;
}
