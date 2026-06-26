import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  appendAgentOutputAttachment,
  appendChannelDocumentManifestEntry,
  appendExternalDocumentCreateGoogleSheetOperation,
  appendDocumentPermissionRequest,
  appendKnowledgeProposalManifestEntry,
  appendExternalDocumentLinkOperation,
  appendExternalGoogleDocOperation,
  appendExternalSheetOperation,
  appendExternalSheetResult,
  appendSkillImportManifestEntry,
  createRuntimeOutputPreview,
  prepareRuntimeOutputArtifactReference,
  readSkillImportsManifest,
  setAgentOutputText,
  validateRuntimeOutputManifests,
  type ChannelDocumentManifestEntry,
  type ChannelDocumentManifestOperation,
  type DocumentPermissionRequestManifestEntry,
  type ExternalDocumentCreateGoogleSheetManifestEntry,
  type ExternalDocumentLinkManifestEntry,
  type ExternalGoogleDocManifestOperation,
  type ExternalSheetManifestOperation,
  type ExternalSheetResultManifestEntry,
  type KnowledgeProposalManifestEntry,
  type SkillImportManifestEntry,
} from "../../../../packages/daemon/src/runtime-output-manifests.ts";
import {
  appendFeishuRuntimeDataOperationRequest,
  type FeishuRuntimeDataOperationRequestManifestEntry,
} from "@agent-space/services";
import { prepareSkillImportOperationArtifacts } from "../../../../packages/daemon/src/skill-imports.ts";
import { getStringFlag, parseArgs } from "../lib/args.ts";
import { writeData, type OutputFormat } from "../lib/format.ts";
import { RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR } from "../lib/runtime-output.ts";

type OutputConflict = "reject" | "rename" | "replace" | "skip";

export async function runOutputCommand(
  subcommand: string | undefined,
  args: string[],
  format: OutputFormat,
): Promise<number> {
  try {
    if (!subcommand || subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
      printOutputHelp();
      return subcommand ? 0 : 1;
    }
    if (subcommand === "attach") {
      return runAttach(args, format);
    }
    if (subcommand === "text") {
      return runText(args, format);
    }
    if (subcommand === "validate") {
      if (hasHelpFlag(args)) {
        printOutputHelp();
        return 0;
      }
      return runValidate(args, format);
    }
    if (subcommand === "preview") {
      return runPreview(args, format);
    }
    if (subcommand === "document") {
      return runDocumentCommand(args, format);
    }
    if (subcommand === "skill") {
      return runSkillCommand(args, format);
    }
    if (subcommand === "knowledge") {
      return runKnowledgeCommand(args, format);
    }
    if (subcommand === "sheets") {
      return runSheetsCommand(args, format);
    }
    if (subcommand === "sheets-result") {
      return runSheetsResultCommand(args, format);
    }
    if (subcommand === "google-docs") {
      return runGoogleDocsCommand(args, format);
    }
    if (subcommand === "external-document") {
      return runExternalDocumentCommand(args, format);
    }
    if (subcommand === "feishu") {
      return runFeishuCommand(args, format);
    }
    if (subcommand === "permission") {
      return runPermissionCommand(args, format);
    }
    printOutputHelp();
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function runAttach(args: string[], format: OutputFormat): number {
  const parsed = parseArgs(args);
  const workDir = resolveWorkDir(parsed.flags);
  const sourcePath = parsed.positionals[0];
  if (!sourcePath) {
    throw new Error("Usage: agent-space output attach <file> [--name <display-name>] [--media-type <mime>] [--text <message>] [--copy] [--work-dir <path>]");
  }

  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath,
    copyOutsideWorkDir: parsed.flags.copy === true,
  });
  const manifest = appendAgentOutputAttachment(
    workDir,
    {
      path: prepared.relativePath,
      name: getStringFlag(parsed.flags, "name") ?? basename(prepared.relativePath),
      mediaType: getStringFlag(parsed.flags, "media-type"),
    },
    getStringFlag(parsed.flags, "text"),
  );

  if (format === "json") {
    writeData(format, manifest);
  } else {
    console.log(`Attached ${prepared.relativePath}${prepared.copied ? " (copied)" : ""}.`);
  }
  return 0;
}

function runText(args: string[], format: OutputFormat): number {
  const parsed = parseArgs(args);
  const workDir = resolveWorkDir(parsed.flags);
  const text = parsed.positionals.join(" ").trim();
  if (!text) {
    throw new Error("Usage: agent-space output text <message> [--work-dir <path>]");
  }

  const manifest = setAgentOutputText(workDir, text);
  if (format === "json") {
    writeData(format, manifest);
  } else {
    console.log("Updated runtime-output/agent-output.json text.");
  }
  return 0;
}

function runValidate(args: string[], format: OutputFormat): number {
  const parsed = parseArgs(args);
  const workDir = resolveWorkDir(parsed.flags);
  const result = validateRuntimeOutputManifests(workDir);
  if (format === "json") {
    writeData(format, result);
  } else if (result.valid) {
    console.log("runtime-output manifests are valid.");
  } else {
    for (const error of result.errors) {
      console.error(error);
    }
  }
  return result.valid ? 0 : 1;
}

function runPreview(args: string[], format: OutputFormat): number {
  const parsed = parseArgs(args);
  const workDir = resolveWorkDir(parsed.flags);
  const preview = createRuntimeOutputPreview(workDir);
  if (format === "json") {
    writeData(format, preview);
  } else {
    printPreview(preview);
  }
  return preview.errors.length === 0 ? 0 : 1;
}

function runDocumentCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printDocumentHelp();
    return action ? 0 : 1;
  }
  if (action === "upsert") {
    return runDocumentUpsert(rest, format);
  }
  if (action === "replace-block") {
    return runDocumentBlockOperation(rest, format, "replace_block");
  }
  if (action === "insert-after") {
    return runDocumentBlockOperation(rest, format, "insert_after");
  }
  if (action === "delete-block") {
    return runDocumentBlockOperation(rest, format, "delete_block");
  }
  printDocumentHelp();
  return 1;
}

function runDocumentUpsert(args: string[], format: OutputFormat): number {
  const parsed = parseArgs(args);
  const workDir = resolveWorkDir(parsed.flags);
  const title = requireStringFlag(parsed.flags, "title");
  const content = requireStringFlag(parsed.flags, "content");
  const mode = normalizeDocumentMode(getStringFlag(parsed.flags, "mode"));
  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath: content,
  });
  const manifest = appendChannelDocumentManifestEntry(workDir, {
    title,
    contentPath: prepared.relativePath,
    documentId: getStringFlag(parsed.flags, "document-id"),
    baseVersionId: getStringFlag(parsed.flags, "base-version-id"),
    summary: getStringFlag(parsed.flags, "summary"),
    mode,
  });
  writeCommandResult(format, manifest, `Added document upsert for "${title}".`);
  return 0;
}

function runDocumentBlockOperation(
  args: string[],
  format: OutputFormat,
  op: ChannelDocumentManifestOperation["op"],
): number {
  const parsed = parseArgs(args);
  const workDir = resolveWorkDir(parsed.flags);
  const title = requireStringFlag(parsed.flags, "title");
  const documentId = requireStringFlag(parsed.flags, "document-id");
  const baseVersionId = requireStringFlag(parsed.flags, "base-version-id");
  const operation = buildDocumentBlockOperation(workDir, parsed.flags, op);
  const entry: ChannelDocumentManifestEntry = {
    title,
    documentId,
    baseVersionId,
    mode: "create_or_update",
    operations: [operation],
  };
  const summary = getStringFlag(parsed.flags, "summary");
  if (summary) {
    entry.summary = summary;
  }
  const manifest = appendChannelDocumentManifestEntry(workDir, entry);
  writeCommandResult(format, manifest, `Added ${op} operation for "${title}".`);
  return 0;
}

function buildDocumentBlockOperation(
  workDir: string,
  flags: Record<string, string | boolean>,
  op: ChannelDocumentManifestOperation["op"],
): ChannelDocumentManifestOperation {
  if (op === "delete_block") {
    return {
      op,
      blockId: requireStringFlag(flags, "block-id"),
      baseRevision: requireNumberFlag(flags, "base-revision"),
    };
  }

  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath: requireStringFlag(flags, "content"),
  });
  const operation: ChannelDocumentManifestOperation = {
    op,
    contentPath: prepared.relativePath,
    heading: getStringFlag(flags, "heading"),
  };
  if (op === "replace_block") {
    operation.blockId = requireStringFlag(flags, "block-id");
    operation.baseRevision = requireNumberFlag(flags, "base-revision");
  }
  if (op === "insert_after") {
    operation.afterBlockId = getStringFlag(flags, "after-block-id");
  }
  return operation;
}

function runSkillCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printSkillHelp();
    return action ? 0 : 1;
  }
  if (action !== "import") {
    printSkillHelp();
    return 1;
  }
  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const entry = buildSkillImportEntry(workDir, parsed.flags);
  appendSkillImportManifestEntry(workDir, entry);

  if (getStringFlag(parsed.flags, "local-path")) {
    const prepared = prepareSkillImportOperationArtifacts(workDir);
    const validation = validateRuntimeOutputManifests(workDir);
    if (!validation.valid) {
      throw new Error(validation.errors.join("\n"));
    }
    for (const warning of prepared.warnings) {
      console.error(warning);
    }
  }

  const manifest = readSkillImportsManifest(workDir);
  writeCommandResult(format, manifest, "Added skill import operation.");
  return 0;
}

function buildSkillImportEntry(
  workDir: string,
  flags: Record<string, string | boolean>,
): SkillImportManifestEntry {
  const url = getStringFlag(flags, "url");
  const path = getStringFlag(flags, "path");
  const localPath = getStringFlag(flags, "local-path");
  const sources = [url ? "url" : "", path ? "path" : "", localPath ? "local-path" : ""].filter(Boolean);
  if (sources.length !== 1) {
    throw new Error("skill import requires exactly one of --url, --path, or --local-path.");
  }

  const entry: SkillImportManifestEntry = {
    conflict: normalizeConflict(getStringFlag(flags, "conflict")),
    assignToSelf: parseBooleanFlag(flags, "assign-to-self", true),
  };
  if (url) {
    assertSkillImportUrl(url);
    entry.url = url;
  } else if (path) {
    entry.path = normalizeRuntimeArtifactPath(workDir, path);
  } else if (localPath) {
    entry.path = localPath;
  }
  return entry;
}

function runKnowledgeCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printKnowledgeHelp();
    return action ? 0 : 1;
  }
  if (action !== "propose-create" && action !== "propose-update") {
    printKnowledgeHelp();
    return 1;
  }
  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const proposal = buildKnowledgeProposal(workDir, action, parsed.flags);
  const manifest = appendKnowledgeProposalManifestEntry(workDir, proposal);
  writeCommandResult(format, manifest, `Added knowledge ${action} proposal for "${proposal.title}".`);
  return 0;
}

function buildKnowledgeProposal(
  workDir: string,
  action: "propose-create" | "propose-update",
  flags: Record<string, string | boolean>,
): KnowledgeProposalManifestEntry {
  const contentFile = requireStringFlag(flags, "content-file");
  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath: contentFile,
    copyOutsideWorkDir: true,
  });
  if (!prepared.relativePath.toLocaleLowerCase("en-US").endsWith(".md")) {
    throw new Error("--content-file must point to a Markdown .md file.");
  }
  const assignmentMode = normalizeKnowledgeAssignmentMode(getStringFlag(flags, "assignment-mode"));
  const assignedEmployeeNames = parseCommaSeparatedFlag(getStringFlag(flags, "assigned-employee-names"));
  const tags = parseCommaSeparatedFlag(getStringFlag(flags, "tags"));
  const entry = removeUndefinedProperties({
    operation: action === "propose-create" ? "create" as const : "update" as const,
    title: requireStringFlag(flags, "title"),
    contentPath: prepared.relativePath,
    summary: getStringFlag(flags, "summary")?.trim(),
    reason: getStringFlag(flags, "reason")?.trim(),
    tags: tags.length > 0 ? tags : undefined,
    parentId: getStringFlag(flags, "parent-id")?.trim(),
    assignmentMode,
    assignedEmployeeNames: assignedEmployeeNames.length > 0 ? assignedEmployeeNames : undefined,
    assignToSelf: parseBooleanFlag(flags, "assign-to-self", true),
    targetKnowledgePageId: getStringFlag(flags, "knowledge-page-id")?.trim(),
    baseUpdatedAt: getStringFlag(flags, "base-updated-at")?.trim(),
  }) as KnowledgeProposalManifestEntry;
  if (entry.operation === "update") {
    if (!entry.targetKnowledgePageId) {
      throw new Error("propose-update requires --knowledge-page-id.");
    }
    if (!entry.baseUpdatedAt) {
      throw new Error("propose-update requires --base-updated-at.");
    }
  }
  return entry;
}

function normalizeKnowledgeAssignmentMode(value: string | undefined): KnowledgeProposalManifestEntry["assignmentMode"] {
  if (!value) {
    return "selected_agents";
  }
  if (value === "all_agents" || value === "selected_agents") {
    return value;
  }
  throw new Error("--assignment-mode must be all_agents or selected_agents.");
}

function assertSkillImportUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("--url must be a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("--url must use HTTPS.");
  }
  const allowedHosts = new Set(["github.com", "raw.githubusercontent.com", "skills.sh", "clawhub.ai"]);
  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts.has(hostname) && !hostname.endsWith(".clawhub.ai")) {
    throw new Error("--url host must be GitHub, skills.sh, or ClawHub.");
  }
}

function runSheetsCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printSheetsHelp();
    return action ? 0 : 1;
  }
  if (action !== "read" && action !== "append-rows" && action !== "update-values" && action !== "batch-update") {
    printSheetsHelp();
    return 1;
  }
  if (hasHelpFlag(rest)) {
    printSheetsHelp();
    return 0;
  }

  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const operation = buildSheetOperation(action, parsed.flags);
  const manifest = appendExternalSheetOperation(workDir, operation);
  writeCommandResult(format, manifest, `Added sheets ${action} operation.`);
  return 0;
}

function buildSheetOperation(
  action: string,
  flags: Record<string, string | boolean>,
): ExternalSheetManifestOperation {
  const documentId = requireStringFlag(flags, "document-id");
  const intent = requireStringFlag(flags, "intent");
  if (action === "batch-update") {
    const requests = parseJsonFlag(flags, "requests-json");
    if (!Array.isArray(requests) || requests.length === 0 || requests.some((item) => !isRecord(item))) {
      throw new Error("--requests-json must be a non-empty JSON array of objects.");
    }
    return {
      documentId,
      intent,
      operationType: "batch_update",
      requests: requests as Array<Record<string, unknown>>,
    };
  }

  const rangeA1 = requireStringFlag(flags, "range");
  if (action === "read") {
    return {
      documentId,
      intent,
      operationType: "read",
      rangeA1,
    };
  }

  const values = parseJsonFlag(flags, "values-json");
  if (!Array.isArray(values) || values.length === 0 || values.some((row) => !Array.isArray(row))) {
    throw new Error("--values-json must be a non-empty two-dimensional JSON array.");
  }
  return {
    documentId,
    intent,
    operationType: action === "append-rows" ? "append_rows" : "update_values",
    rangeA1,
    values: values as unknown[][],
  };
}

function runSheetsResultCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printSheetsResultHelp();
    return action ? 0 : 1;
  }
  if (action !== "add") {
    printSheetsResultHelp();
    return 1;
  }
  if (hasHelpFlag(rest)) {
    printSheetsResultHelp();
    return 0;
  }

  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const result = buildSheetResultEntry(workDir, parsed.flags);
  const manifest = appendExternalSheetResult(workDir, result);
  writeCommandResult(format, manifest, `Added sheets ${result.operation} result.`);
  return 0;
}

function runGoogleDocsCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printGoogleDocsHelp();
    return action ? 0 : 1;
  }
  if (action !== "append-text" && action !== "batch-update") {
    printGoogleDocsHelp();
    return 1;
  }
  if (hasHelpFlag(rest)) {
    printGoogleDocsHelp();
    return 0;
  }

  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const operation = buildGoogleDocOperation(workDir, action, parsed.flags);
  const manifest = appendExternalGoogleDocOperation(workDir, operation);
  writeCommandResult(format, manifest, `Added Google Docs ${action} operation.`);
  return 0;
}

function buildGoogleDocOperation(
  workDir: string,
  action: "append-text" | "batch-update",
  flags: Record<string, string | boolean>,
): ExternalGoogleDocManifestOperation {
  const documentId = requireStringFlag(flags, "document-id");
  const intent = requireStringFlag(flags, "intent");
  const requestSummary = getStringFlag(flags, "request-summary")?.trim();
  if (action === "append-text") {
    const textFile = requireStringFlag(flags, "text-file");
    const prepared = prepareRuntimeOutputArtifactReference({
      workDir,
      sourcePath: textFile,
      copyOutsideWorkDir: true,
    });
    const text = readFileSyncUtf8(prepared.absolutePath);
    if (containsSensitiveTokenMaterial(text)) {
      throw new Error("--text-file appears to contain Google Workspace token material. Remove credentials before registering the operation.");
    }
    return removeUndefinedProperties({
      documentId,
      operationType: "append_text" as const,
      intent,
      text,
      textPath: prepared.relativePath,
      requestSummary,
    }) as ExternalGoogleDocManifestOperation;
  }

  const requestsJson = requireStringFlag(flags, "requests-json");
  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath: requestsJson,
    copyOutsideWorkDir: true,
  });
  if (!prepared.relativePath.toLocaleLowerCase("en-US").endsWith(".json")) {
    throw new Error("--requests-json must point to a JSON file.");
  }
  const requests = readGoogleDocsRequestsJsonArtifact(prepared.absolutePath);
  return removeUndefinedProperties({
    documentId,
    operationType: "batch_update" as const,
    intent,
    requests,
    requestsPath: prepared.relativePath,
    requestSummary,
  }) as ExternalGoogleDocManifestOperation;
}

function runExternalDocumentCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printExternalDocumentHelp();
    return action ? 0 : 1;
  }
  if (action !== "link-google-sheet" && action !== "create-google-sheet") {
    printExternalDocumentHelp();
    return 1;
  }
  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  if (action === "create-google-sheet") {
    const operation = buildExternalDocumentCreateGoogleSheetOperation(workDir, parsed.flags);
    const manifest = appendExternalDocumentCreateGoogleSheetOperation(workDir, operation);
    writeCommandResult(format, manifest, `Added agent-created Google Sheet "${operation.title}".`);
    return 0;
  }
  const operation = buildExternalDocumentLinkOperation(parsed.flags);
  const manifest = appendExternalDocumentLinkOperation(workDir, operation);
  writeCommandResult(format, manifest, `Added external Google Sheet link for "${operation.title}".`);
  return 0;
}

function buildExternalDocumentLinkOperation(
  flags: Record<string, string | boolean>,
): ExternalDocumentLinkManifestEntry {
  const sourceDocumentId = getStringFlag(flags, "source-document-id")?.trim();
  const externalFileId = getStringFlag(flags, "external-file-id")?.trim();
  const externalUrl = getStringFlag(flags, "external-url")?.trim();
  const sources = [sourceDocumentId, externalFileId, externalUrl].filter((value) => value && value.length > 0);
  if (sources.length === 0) {
    throw new Error("link-google-sheet requires --source-document-id, --external-file-id, or --external-url.");
  }
  return removeUndefinedProperties({
    operationType: "link_google_sheet" as const,
    sourceDocumentId,
    externalFileId,
    externalUrl,
    targetChannel: requireStringFlag(flags, "target-channel"),
    title: requireStringFlag(flags, "title"),
    summary: getStringFlag(flags, "summary")?.trim(),
  }) as ExternalDocumentLinkManifestEntry;
}

function buildExternalDocumentCreateGoogleSheetOperation(
  workDir: string,
  flags: Record<string, string | boolean>,
): ExternalDocumentCreateGoogleSheetManifestEntry {
  const externalFileId = requireStringFlag(flags, "external-file-id").trim();
  const externalUrl = requireStringFlag(flags, "external-url").trim();
  const gwsResultJson = requireStringFlag(flags, "gws-result-json");
  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath: gwsResultJson,
  });
  if (!prepared.relativePath.toLocaleLowerCase("en-US").endsWith(".json")) {
    throw new Error("--gws-result-json must point to a JSON file.");
  }
  const rawResult = readResultJsonArtifact(prepared.absolutePath);
  assertGoogleSheetCreateResultMatches(rawResult, {
    externalFileId,
    externalUrl,
  });
  return removeUndefinedProperties({
    operationType: "create_google_sheet" as const,
    targetChannel: requireStringFlag(flags, "target-channel"),
    title: requireStringFlag(flags, "title"),
    summary: getStringFlag(flags, "summary")?.trim(),
    externalFileId,
    externalUrl,
    externalMimeType: getStringFlag(flags, "external-mime-type")?.trim() || "application/vnd.google-apps.spreadsheet",
    externalRevisionId: getStringFlag(flags, "external-revision-id")?.trim() || readStringProperty(rawResult, ["headRevisionId", "version"]),
    externalUpdatedAt: getStringFlag(flags, "external-updated-at")?.trim() || readStringProperty(rawResult, ["modifiedTime"]),
    resultPath: prepared.relativePath,
    parentFolderId: getStringFlag(flags, "parent-folder-id")?.trim(),
  }) as ExternalDocumentCreateGoogleSheetManifestEntry;
}

function runFeishuCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printFeishuOutputHelp();
    return action ? 0 : 1;
  }
  if (action !== "data-operation-approval") {
    printFeishuOutputHelp();
    return 1;
  }
  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const request = buildFeishuRuntimeDataOperationRequest(parsed.flags);
  const manifest = appendFeishuRuntimeDataOperationRequest(workDir, request);
  writeCommandResult(format, manifest, `Added Feishu ${request.operationType} approval request.`);
  return 0;
}

function buildFeishuRuntimeDataOperationRequest(
  flags: Record<string, string | boolean>,
): FeishuRuntimeDataOperationRequestManifestEntry {
  const parameters = buildFeishuRuntimeDataOperationParameters(flags);
  return removeUndefinedProperties({
    operationType: requireStringFlag(flags, "operation"),
    providerResourceType: requireStringFlag(flags, "type"),
    providerResourceToken: requireStringFlag(flags, "resource"),
    parameters,
    contentPreview: getStringFlag(flags, "preview")?.trim(),
  }) as FeishuRuntimeDataOperationRequestManifestEntry;
}

function buildFeishuRuntimeDataOperationParameters(
  flags: Record<string, string | boolean>,
): Record<string, unknown> | undefined {
  const parametersJson = getStringFlag(flags, "parameters-json");
  const parameters = parametersJson
    ? parseJsonObjectFlag(parametersJson, "--parameters-json")
    : {};
  const valuesJson = getStringFlag(flags, "values-json");
  const fieldsJson = getStringFlag(flags, "fields-json");
  const recordsJson = getStringFlag(flags, "records-json");
  const blocksJson = getStringFlag(flags, "blocks-json");
  const childrenJson = getStringFlag(flags, "children-json");
  const blockJson = getStringFlag(flags, "block-json");
  const additions: Record<string, unknown> = {
    mutation: getStringFlag(flags, "mutation")?.trim(),
    action: getStringFlag(flags, "action")?.trim(),
    range: getStringFlag(flags, "range")?.trim(),
    values: valuesJson ? parseJsonFlagValue(valuesJson, "--values-json") : undefined,
    recordId: getStringFlag(flags, "record-id")?.trim(),
    fields: fieldsJson ? parseJsonObjectFlag(fieldsJson, "--fields-json") : undefined,
    records: recordsJson ? parseJsonFlagValue(recordsJson, "--records-json") : undefined,
    title: getStringFlag(flags, "title")?.trim(),
    folderToken: getStringFlag(flags, "folder-token")?.trim(),
    parentBlockId: getStringFlag(flags, "parent-block-id")?.trim(),
    blockId: getStringFlag(flags, "block-id")?.trim(),
    documentRevisionId: getStringFlag(flags, "document-revision-id")?.trim(),
    clientToken: getStringFlag(flags, "client-token")?.trim(),
    blocks: blocksJson ? parseJsonFlagValue(blocksJson, "--blocks-json") : undefined,
    children: childrenJson ? parseJsonFlagValue(childrenJson, "--children-json") : undefined,
    block: blockJson ? parseJsonObjectFlag(blockJson, "--block-json") : undefined,
  };
  for (const [key, value] of Object.entries(additions)) {
    if (value !== undefined && value !== "") {
      parameters[key] = value;
    }
  }
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function runPermissionCommand(args: string[], format: OutputFormat): number {
  const [action, ...rest] = args;
  if (!action || action === "help" || action === "--help") {
    printPermissionHelp();
    return action ? 0 : 1;
  }
  if (action !== "request-document") {
    printPermissionHelp();
    return 1;
  }
  const parsed = parseArgs(rest);
  const workDir = resolveWorkDir(parsed.flags);
  const request = buildDocumentPermissionRequest(parsed.flags);
  const manifest = appendDocumentPermissionRequest(workDir, request);
  writeCommandResult(format, manifest, `Added document permission request for ${request.requestedRole}.`);
  return 0;
}

function buildDocumentPermissionRequest(
  flags: Record<string, string | boolean>,
): DocumentPermissionRequestManifestEntry {
  const requestedRole = normalizeDocumentPermissionRole(requireStringFlag(flags, "role"));
  const documentId = getStringFlag(flags, "document-id")?.trim();
  const externalUrl = getStringFlag(flags, "external-url")?.trim();
  const externalFileId = getStringFlag(flags, "external-file-id")?.trim();
  const externalProvider = normalizeExternalProvider(getStringFlag(flags, "external-provider") ?? (externalUrl || externalFileId ? "google_workspace" : undefined));
  const sources = [documentId, externalUrl, externalFileId].filter((value) => value && value.length > 0);
  if (sources.length === 0) {
    throw new Error("request-document requires --document-id, --external-file-id, or --external-url.");
  }
  return removeUndefinedProperties({
    requestedRole,
    reason: requireStringFlag(flags, "reason"),
    documentId,
    externalProvider,
    externalFileId,
    externalUrl,
    targetChannel: getStringFlag(flags, "target-channel")?.trim(),
  }) as DocumentPermissionRequestManifestEntry;
}

function buildSheetResultEntry(
  workDir: string,
  flags: Record<string, string | boolean>,
): ExternalSheetResultManifestEntry {
  const documentId = requireStringFlag(flags, "document-id");
  const operation = normalizeSheetResultOperation(requireStringFlag(flags, "operation"));
  const resultJson = requireStringFlag(flags, "result-json");
  const prepared = prepareRuntimeOutputArtifactReference({
    workDir,
    sourcePath: resultJson,
  });
  const rawResult = readResultJsonArtifact(prepared.absolutePath);
  const preview = buildSheetResultPreview(rawResult);
  const range = getStringFlag(flags, "range")?.trim() || readStringProperty(rawResult, ["range", "updatedRange"]);
  const summary = getStringFlag(flags, "summary")?.trim() || buildDefaultSheetResultSummary(operation, preview);
  const startedAt = getStringFlag(flags, "started-at")?.trim();
  const finishedAt = getStringFlag(flags, "finished-at")?.trim();
  const durationMs = getStringFlag(flags, "duration-ms")?.trim();
  const result: ExternalSheetResultManifestEntry = {
    documentId,
    operation,
    range,
    resultPath: prepared.relativePath,
    summary,
    requestSummary: getStringFlag(flags, "request-summary")?.trim() || buildDefaultSheetRequestSummary(operation, range),
    rowCount: preview.rowCount,
    cellCount: preview.cellCount,
    headers: preview.headers,
    rowsPreview: preview.rowsPreview,
    truncated: preview.truncated,
    preview,
    status: "succeeded",
    startedAt,
    finishedAt,
    durationMs: durationMs ? requireNonNegativeInteger(durationMs, "--duration-ms") : undefined,
  };
  return removeUndefinedProperties(result) as ExternalSheetResultManifestEntry;
}

function readResultJsonArtifact(path: string): unknown {
  const raw = existsSync(path) ? statSync(path) : undefined;
  if (!raw?.isFile()) {
    throw new Error(`--result-json must point to a JSON file: ${path}`);
  }
  const content = readFileSyncUtf8(path);
  if (containsSensitiveTokenMaterial(content)) {
    throw new Error("--result-json appears to contain Google Workspace token material. Remove credentials before registering the result.");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`--result-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertGoogleSheetCreateResultMatches(
  value: unknown,
  input: {
    externalFileId: string;
    externalUrl: string;
  },
): void {
  if (!isRecord(value)) {
    throw new Error("--gws-result-json must contain a JSON object.");
  }
  if (value.id !== undefined && value.id !== input.externalFileId) {
    throw new Error("--gws-result-json id must match --external-file-id.");
  }
  if (value.mimeType !== undefined && value.mimeType !== "application/vnd.google-apps.spreadsheet") {
    throw new Error("--gws-result-json mimeType must be application/vnd.google-apps.spreadsheet.");
  }
  const resultFileId = typeof value.webViewLink === "string" ? extractGoogleWorkspaceFileId(value.webViewLink) : undefined;
  const urlFileId = extractGoogleWorkspaceFileId(input.externalUrl);
  if (!urlFileId || urlFileId !== input.externalFileId) {
    throw new Error("--external-url must be a Google Sheets URL for --external-file-id.");
  }
  if (resultFileId && resultFileId !== input.externalFileId) {
    throw new Error("--gws-result-json webViewLink must point to --external-file-id.");
  }
}

function readGoogleDocsRequestsJsonArtifact(path: string): Array<Record<string, unknown>> {
  const raw = existsSync(path) ? statSync(path) : undefined;
  if (!raw?.isFile()) {
    throw new Error(`--requests-json must point to a JSON file: ${path}`);
  }
  const content = readFileSyncUtf8(path);
  if (containsSensitiveTokenMaterial(content)) {
    throw new Error("--requests-json appears to contain Google Workspace token material. Remove credentials before registering the operation.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`--requests-json must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => !isRecord(item))) {
    throw new Error("--requests-json must contain a non-empty JSON array of objects.");
  }
  return parsed as Array<Record<string, unknown>>;
}

function buildSheetResultPreview(value: unknown): Required<Pick<ExternalSheetResultManifestEntry, "rowCount" | "cellCount" | "headers" | "rowsPreview" | "truncated">> {
  const values = readSheetValues(value);
  const rowCount = values.length;
  const cellCount = countCells(values);
  const rowsPreview = values.slice(0, 6).map((row) => row.slice(0, 8));
  const headers = values[0]?.map((cell) => stringifyCell(cell)).filter((cell) => cell.length > 0).slice(0, 8) ?? [];
  const truncated = values.length > rowsPreview.length || values.some((row) => row.length > 8);
  return {
    rowCount,
    cellCount,
    headers,
    rowsPreview,
    truncated,
  };
}

function readSheetValues(value: unknown): unknown[][] {
  if (isRecord(value) && Array.isArray(value.values)) {
    return value.values.filter((row): row is unknown[] => Array.isArray(row));
  }
  if (Array.isArray(value) && value.every((row) => Array.isArray(row))) {
    return value as unknown[][];
  }
  return [];
}

function buildDefaultSheetResultSummary(
  operation: ExternalSheetResultManifestEntry["operation"],
  preview: Pick<ExternalSheetResultManifestEntry, "rowCount" | "cellCount">,
): string {
  if (operation === "read") {
    return `Read ${preview.rowCount ?? 0} rows and ${preview.cellCount ?? 0} cells.`;
  }
  if (operation === "batch_update") {
    return "Applied Google Sheets batch update.";
  }
  return `Completed Google Sheets ${operation}.`;
}

function buildDefaultSheetRequestSummary(
  operation: ExternalSheetResultManifestEntry["operation"],
  range: string | undefined,
): string {
  if (operation === "batch_update") {
    return "Batch update executed by Agent runtime gws.";
  }
  return `${operation} ${range ? `range ${range}` : "Google Sheet"} via Agent runtime gws.`;
}

function normalizeSheetResultOperation(value: string): ExternalSheetResultManifestEntry["operation"] {
  if (value === "read" || value === "append_rows" || value === "update_values" || value === "batch_update") {
    return value;
  }
  if (value === "append-rows") {
    return "append_rows";
  }
  if (value === "update-values") {
    return "update_values";
  }
  if (value === "batch-update") {
    return "batch_update";
  }
  throw new Error("--operation must be read, append_rows, update_values, or batch_update.");
}

function normalizeDocumentPermissionRole(value: string): DocumentPermissionRequestManifestEntry["requestedRole"] {
  if (value === "viewer" || value === "editor" || value === "forwarder") {
    return value;
  }
  if (value === "owner") {
    throw new Error("Agents cannot request owner document access.");
  }
  throw new Error("--role must be viewer, editor, or forwarder.");
}

function normalizeExternalProvider(value: string | undefined): DocumentPermissionRequestManifestEntry["externalProvider"] | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "google_workspace" || value === "notion" || value === "microsoft_365") {
    return value;
  }
  throw new Error("--external-provider must be google_workspace, notion, or microsoft_365.");
}

function extractGoogleWorkspaceFileId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /\/(?:spreadsheets|document)\/d\/([^/?#]+)/.exec(trimmed);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function parseCommaSeparatedFlag(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item, index, items) => item.length > 0 && items.indexOf(item) === index);
}

function resolveWorkDir(flags: Record<string, string | boolean>): string {
  return resolve(getStringFlag(flags, "work-dir") ?? process.cwd());
}

function normalizeDocumentMode(value: string | undefined): ChannelDocumentManifestEntry["mode"] {
  if (!value) {
    return "create_or_update";
  }
  if (value === "create" || value === "update" || value === "create_or_update") {
    return value;
  }
  throw new Error("--mode must be create, update, or create_or_update.");
}

function normalizeConflict(value: string | undefined): OutputConflict {
  if (!value) {
    return "skip";
  }
  if (value === "reject" || value === "rename" || value === "replace" || value === "skip") {
    return value;
  }
  throw new Error("--conflict must be reject, rename, replace, or skip.");
}

function normalizeRuntimeArtifactPath(workDir: string, value: string): string {
  const raw = value.replace(/\\/g, "/").trim();
  if (!raw) {
    throw new Error("Artifact path is required.");
  }
  if (isAbsolute(raw)) {
    const artifactsRoot = resolve(workDir, RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR);
    const absolutePath = resolve(raw);
    const relativePath = relative(artifactsRoot, absolutePath).replace(/\\/g, "/");
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error(`Artifact path must be under ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/.`);
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Artifact path does not exist: ${raw}`);
    }
    const stats = statSync(absolutePath);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error(`Artifact path is not a file or directory: ${raw}`);
    }
    return `${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/${relativePath}`;
  }
  const segments = raw.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Artifact path cannot contain . or ..");
  }
  if (raw !== RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR && !raw.startsWith(`${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/`)) {
    throw new Error(`Artifact path must be under ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/.`);
  }
  const absolutePath = resolve(workDir, raw);
  if (!existsSync(absolutePath)) {
    throw new Error(`Artifact path does not exist: ${raw}`);
  }
  const stats = statSync(absolutePath);
  if (!stats.isDirectory() && !stats.isFile()) {
    throw new Error(`Artifact path is not a file or directory: ${raw}`);
  }
  return segments.join("/");
}

function parseBooleanFlag(
  flags: Record<string, string | boolean>,
  key: string,
  fallback: boolean,
): boolean {
  const value = flags[key];
  if (value === undefined) {
    return fallback;
  }
  if (value === true) {
    return true;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`--${key} must be true or false.`);
}

function requireStringFlag(flags: Record<string, string | boolean>, key: string): string {
  const value = getStringFlag(flags, key)?.trim();
  if (!value) {
    throw new Error(`--${key} is required.`);
  }
  return value;
}

function requireNumberFlag(flags: Record<string, string | boolean>, key: string): number {
  const value = requireStringFlag(flags, key);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${key} must be a number.`);
  }
  return parsed;
}

function requireNonNegativeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseJsonFlag(flags: Record<string, string | boolean>, key: string): unknown {
  const value = requireStringFlag(flags, key);
  return parseJsonFlagValue(value, `--${key}`);
}

function parseJsonFlagValue(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJsonObjectFlag(value: string, label: string): Record<string, unknown> {
  const parsed = parseJsonFlagValue(value, label);
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function writeCommandResult(format: OutputFormat, value: unknown, message: string): void {
  if (format === "json") {
    writeData(format, value);
    return;
  }
  console.log(message);
}

function printPreview(preview: ReturnType<typeof createRuntimeOutputPreview>): void {
  console.log(`workDir: ${preview.workDir}`);
  console.log(`agent-output: ${preview.manifests.agentOutput.exists ? "yes" : "no"} (${preview.manifests.agentOutput.attachmentCount} attachments, ${preview.manifests.agentOutput.totalAttachmentBytes} bytes)`);
  console.log(`channel-documents: ${preview.manifests.channelDocuments.exists ? "yes" : "no"} (${preview.manifests.channelDocuments.documentOperations} operations)`);
  console.log(`skill-imports: ${preview.manifests.skillImports.exists ? "yes" : "no"} (${preview.manifests.skillImports.imports} imports)`);
  console.log(`external-sheets: ${preview.manifests.externalSheets.exists ? "yes" : "no"} (${preview.manifests.externalSheets.operations} operations)`);
  console.log(`external-sheets-results: ${preview.manifests.externalSheetResults.exists ? "yes" : "no"} (${preview.manifests.externalSheetResults.results} results)`);
  console.log(`external-google-docs: ${preview.manifests.externalGoogleDocs.exists ? "yes" : "no"} (${preview.manifests.externalGoogleDocs.operations} operations)`);
  for (const operation of preview.manifests.externalGoogleDocs.operationSummaries) {
    console.log(`- Google Docs ${operation.operationType}: ${operation.documentId} · ${operation.intent}`);
  }
  console.log(`external-documents: ${preview.manifests.externalDocuments.exists ? "yes" : "no"} (${preview.manifests.externalDocuments.operations} operations)`);
  console.log(`permission-requests: ${preview.manifests.permissionRequests.exists ? "yes" : "no"} (${preview.manifests.permissionRequests.requests} requests)`);
  console.log(`feishu-data-operation-requests: ${preview.manifests.feishuDataOperationRequests.exists ? "yes" : "no"} (${preview.manifests.feishuDataOperationRequests.requests} requests)`);
  console.log(`knowledge-proposals: ${preview.manifests.knowledgeProposals.exists ? "yes" : "no"} (${preview.manifests.knowledgeProposals.proposals} proposals)`);
  if (preview.errors.length > 0) {
    console.log("errors:");
    for (const error of preview.errors) {
      console.log(`- ${error}`);
    }
  }
}

function printOutputHelp(): void {
  console.log(`Usage:
  agent-space output attach <file> [--name <display-name>] [--media-type <mime>] [--text <message>] [--copy] [--work-dir <path>] [--json]
  agent-space output text <message> [--work-dir <path>] [--json]
  agent-space output document <command> ...
  agent-space output skill import ...
  agent-space output knowledge propose-create ...
  agent-space output knowledge propose-update ...
  agent-space output sheets <command> ...
  agent-space output sheets-result add ...
  agent-space output google-docs <command> ...
  agent-space output external-document link-google-sheet ...
  agent-space output external-document create-google-sheet ...
  agent-space output feishu data-operation-approval ...
  agent-space output permission request-document ...
  agent-space output validate [--work-dir <path>] [--json]
  agent-space output preview [--work-dir <path>] [--json]`);
}

function printDocumentHelp(): void {
  console.log(`Usage:
  agent-space output document upsert --title <title> --content <path> [--document-id <id>] [--base-version-id <id>] [--summary <text>] [--mode create|update|create_or_update]
  agent-space output document replace-block --document-id <id> --base-version-id <id> --title <title> --block-id <id> --base-revision <n> --content <path> [--heading <text>]
  agent-space output document insert-after --document-id <id> --base-version-id <id> --title <title> [--after-block-id <id>] --content <path> [--heading <text>]
  agent-space output document delete-block --document-id <id> --base-version-id <id> --title <title> --block-id <id> --base-revision <n>`);
}

function printSkillHelp(): void {
  console.log(`Usage:
  agent-space output skill import --url <url> [--conflict reject|rename|replace|skip] [--assign-to-self true|false]
  agent-space output skill import --path runtime-output/artifacts/skills/name [--conflict reject|rename|replace|skip]
  agent-space output skill import --local-path <path> [--conflict reject|rename|replace|skip]`);
}

function printKnowledgeHelp(): void {
  console.log(`Usage:
  agent-space output knowledge propose-create --title <title> --content-file runtime-output/artifacts/knowledge/page.md [--assignment-mode all_agents|selected_agents] [--assigned-employee-names "Agent A,Agent B"] [--assign-to-self true|false] [--tags "tag-a,tag-b"] [--parent-id <page-id>] [--summary <text>] [--reason <text>]
  agent-space output knowledge propose-update --knowledge-page-id <page-id> --base-updated-at <iso> --title <title> --content-file runtime-output/artifacts/knowledge/page.md [--assignment-mode all_agents|selected_agents] [--assigned-employee-names "Agent A,Agent B"] [--tags "tag-a,tag-b"] [--summary <text>] [--reason <text>]`);
}

function printSheetsHelp(): void {
  console.log(`Usage:
  agent-space output sheets read --document-id <id> --range <A1> --intent <text>
  agent-space output sheets append-rows --document-id <id> --range <A1> --intent <text> --values-json <json>
  agent-space output sheets update-values --document-id <id> --range <A1> --intent <text> --values-json <json>
  agent-space output sheets batch-update --document-id <id> --intent <text> --requests-json <json>`);
}

function printSheetsResultHelp(): void {
  console.log(`Usage:
  agent-space output sheets-result add --document-id <id> --operation read|append_rows|update_values|batch_update --result-json runtime-output/artifacts/sheets/result.json [--range <A1>] [--summary <text>] [--request-summary <text>] [--started-at <iso>] [--finished-at <iso>] [--duration-ms <ms>]`);
}

function printGoogleDocsHelp(): void {
  console.log(`Usage:
  agent-space output google-docs append-text --document-id <doc-id> --intent <text> --text-file runtime-output/artifacts/docs/summary.md [--request-summary <text>]
  agent-space output google-docs batch-update --document-id <doc-id> --intent <text> --requests-json runtime-output/artifacts/docs/requests.json [--request-summary <text>]`);
}

function printExternalDocumentHelp(): void {
  console.log(`Usage:
  agent-space output external-document link-google-sheet --source-document-id <doc-id> --target-channel <channel> --title <title> [--summary <text>]
  agent-space output external-document link-google-sheet --external-file-id <spreadsheet-id> --external-url <url> --target-channel <channel> --title <title> [--summary <text>]
  agent-space output external-document create-google-sheet --external-file-id <spreadsheet-id> --external-url <url> --target-channel <channel> --title <title> --gws-result-json runtime-output/artifacts/sheets/create-sheet.json [--summary <text>]`);
}

function printFeishuOutputHelp(): void {
  console.log(`Usage:
  agent-space output feishu data-operation-approval --operation docs.update_document|sheets.update_range|base.mutate_records --type doc|sheet|base_table --resource <bound-feishu-token> [--parameters-json <json>] [--preview <text>] [--work-dir <path>] [--json]

Common parameter helpers:
  --range <A1> --values-json <json>                  Sheet update range
  --record-id <id> --fields-json <json>              Base record update
  --records-json <json>                              Base batch create/update
  --mutation <value> --blocks-json <json>            Docs append/update mutation
  --parent-block-id <id> --block-id <id>             Docs mutation target`);
}

function printPermissionHelp(): void {
  console.log(`Usage:
  agent-space output permission request-document --role viewer|editor|forwarder --reason <text> --document-id <doc-id> [--target-channel <channel>]
  agent-space output permission request-document --role viewer|editor|forwarder --reason <text> --external-url <url> [--external-provider google_workspace] [--target-channel <channel>]`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readFileSyncUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

function readStringProperty(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
  }
  return undefined;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function countCells(rows: unknown[][]): number {
  return rows.reduce((sum, row) => sum + row.length, 0);
}

function containsSensitiveTokenMaterial(value: string): boolean {
  return [
    /GOOGLE_WORKSPACE_CLI_TOKEN/i,
    /"refresh_token"\s*:/i,
    /"access_token"\s*:/i,
    /"client_secret"\s*:/i,
    /"private_key"\s*:/i,
    /"credentials?"\s*:/i,
    /["']?authorization["']?\s*:\s*["']?(Bearer|Basic|ya29\.)/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i,
    /\bya29\.[A-Za-z0-9._-]{20,}/i,
  ].some((pattern) => pattern.test(value));
}

function removeUndefinedProperties<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}
