import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  applyChannelDocumentBlockOperations,
  assertAgentDocumentActionAllowedSync,
  AgentDocumentPermissionError,
  type ChannelDocumentOperation,
  createChannelDocumentSync,
  BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_NAME,
  listChannelDocumentBlocksSync,
  listChannelDocumentsSync,
  listChannelDocumentVersionsSync,
  recordChannelDocumentConflictSync,
  readWorkspaceStateSync,
  updateChannelDocumentSync,
  writeWorkspaceStateSync,
} from "@agent-space/services";
import type { AgentDocumentContext } from "@agent-space/services";
import type { ChannelDocument } from "@agent-space/domain/workspace";
import {
  getRuntimeOutputChannelDocumentsPath,
  RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR,
  RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_RELATIVE_PATH,
  RUNTIME_OUTPUT_EXTERNAL_GOOGLE_DOCS_RELATIVE_PATH,
  RUNTIME_OUTPUT_EXTERNAL_SHEETS_RESULTS_RELATIVE_PATH,
} from "./runtime-output.ts";

export function resolveChannelDocuments(channelName: string, workspaceId?: string): ChannelDocument[] {
  return listChannelDocumentsSync(channelName, workspaceId).filter((document) => document.status === "active");
}

export function materializeChannelDocuments(
  documentsOrContexts: ChannelDocument[] | AgentDocumentContext[],
  workDir: string,
  workspaceId?: string,
): string | undefined {
  const contexts = normalizeDocumentContexts(documentsOrContexts);
  if (contexts.length === 0) {
    return undefined;
  }

  const documentsDir = join(workDir, ".agent_context", "channel-documents");
  rmSync(documentsDir, { recursive: true, force: true });
  mkdirSync(documentsDir, { recursive: true });

  for (const context of contexts) {
    const { document } = context;
    const versions = listChannelDocumentVersionsSync(document.id, workspaceId);
    const currentVersion = versions.find((version) => version.id === document.currentVersionId) ?? versions[0];
    if (!currentVersion) {
      continue;
    }

    const documentDir = join(documentsDir, `${sanitizePathSegment(document.slug)}-${document.id.slice(-6)}`);
    mkdirSync(documentDir, { recursive: true });
    writeFileSync(
      join(documentDir, "meta.json"),
      JSON.stringify(
        {
          id: document.id,
          title: document.title,
          currentVersionId: document.currentVersionId,
          summary: document.summary,
          updatedBy: document.updatedBy,
          updatedAt: document.updatedAt,
          kind: document.kind,
          storageMode: document.storageMode ?? "native",
          externalProvider: document.externalProvider,
          externalFileId: document.externalFileId,
          externalUrl: document.externalUrl,
          externalSyncStatus: document.externalSyncStatus,
          accessRole: context.role,
          accessSource: context.source,
          allowedActions: context.allowedActions,
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(documentDir, "blocks.json"),
      JSON.stringify(
        listChannelDocumentBlocksSync(document.id, workspaceId).map((block) => ({
          id: block.id,
          order: block.order,
          heading: block.heading,
          revision: block.revision,
          updatedBy: block.updatedBy,
          updatedAt: block.updatedAt,
        })),
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(join(documentDir, "document.md"), currentVersion.contentMarkdown, "utf8");
  }

  return documentsDir;
}

export function buildChannelDocumentPromptLines(
  channelDocumentsOrContexts: ChannelDocument[] | AgentDocumentContext[],
  channelDocumentsContextDir?: string,
): string[] {
  const contexts = normalizeDocumentContexts(channelDocumentsOrContexts);
  const channelDocuments = contexts.map((context) => context.document);
  const externalGoogleSheets = channelDocuments.filter(
    (document) =>
      document.kind === "sheet" &&
      document.storageMode === "external" &&
      document.externalProvider === "google_workspace" &&
      document.externalFileId &&
      document.externalUrl,
  );
  const roleByDocumentId = new Map(contexts.map((context) => [context.document.id, context.role]));
  const externalGoogleDocs = channelDocuments.filter(
    (document) =>
      document.storageMode === "external" &&
      document.externalProvider === "google_workspace" &&
      document.externalFileId &&
      document.externalUrl &&
      document.externalMimeType === "application/vnd.google-apps.document",
  );
  return [
    channelDocuments.length > 0 ? `当前任务有 ${channelDocuments.length} 份按文档权限授权的协作文档。` : "当前任务没有已授权文档。",
    channelDocuments.length > 0
      ? contexts
          .map(
            ({ document, role, source, allowedActions }) =>
              `- 文档 ${document.id} | ${document.title} | role ${role} | source ${source} | allowed ${allowedActions.join(",")} | 类型 ${document.kind} | 存储 ${document.storageMode ?? "native"} | 当前版本 ${document.currentVersionId} | ${document.summary || "无摘要"} | 每份文档目录中都包含 document.md、blocks.json 和 meta.json`,
          )
          .join("\n")
      : "",
    contexts.some((context) => context.role === "viewer")
      ? "viewer 文档只读：不得更新群文档、不得写入 Google Sheet/Doc、不得转发到其他频道。"
      : "",
    contexts.some((context) => context.role === "editor")
      ? "editor 文档可在当前授权上下文读取和编辑，但不可跨频道转发、复制 external binding 或挂到其他频道。"
      : "",
    contexts.some((context) => context.role === "forwarder")
      ? "forwarder 文档可读取、编辑并通过受控 output 命令转发/链接到目标频道；必须使用 agent-space output external-document link-google-sheet 或权限申请命令。"
      : "",
    externalGoogleSheets.length > 0
      ? [
          `当前频道有 ${externalGoogleSheets.length} 份 Google Sheet 外部群文档；Google Sheets data plane 必须由当前 Agent runtime 直接运行官方 gws 完成，Web 后端只回收结果。`,
          externalGoogleSheets
            .map((document) => `- Google Sheet ${document.id} | ${document.title} | role ${roleByDocumentId.get(document.id) ?? "editor"} | spreadsheetId ${document.externalFileId} | ${document.externalUrl} | 状态 ${document.externalSyncStatus ?? "unknown"}`)
            .join("\n"),
          `如需读取 Google Sheet，先单独运行 gws 读取命令，例如：gws sheets spreadsheets values get --format json --params '{"spreadsheetId":"spreadsheetId","range":"Sheet1!A1:Z20"}'。不要把 mkdir、gws、重定向和 cat 合并成一条 Bash 命令；你可以在同一轮读取 stdout 并基于真实单元格内容回答用户。`,
          `当前 Agent runtime 是非交互 headless 执行环境；不要要求 Web 用户批准 CLI/Bash/命令权限，也不要等待聊天里的“允许”。如果命令权限被 provider 拦截，请明确报告 runtime 配置问题。`,
          "如需写入 Google Sheet，只有 editor/forwarder 文档可直接运行对应 gws values append/update 或 spreadsheets batchUpdate 命令；viewer 文档不得写入。不要让 server 代执行 Google Sheet 写入。",
          `gws stdout 必须保存到 ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/sheets/*.json，然后运行 agent-space output sheets-result add --document-id <文档ID> --operation read|append_rows|update_values|batch_update --range <A1> --result-json ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/sheets/result.json --summary <摘要>，生成 ${RUNTIME_OUTPUT_EXTERNAL_SHEETS_RESULTS_RELATIVE_PATH} 并运行 agent-space output validate。`,
        ].join("\n")
      : "",
    "如需新建 Google Sheet，必须先运行 gws drive files create 创建 application/vnd.google-apps.spreadsheet，并把 JSON stdout 保存到 runtime-output/artifacts/sheets/create-*.json；随后运行 agent-space output external-document create-google-sheet --target-channel <频道> --title <标题> --external-file-id <spreadsheetId> --external-url <webViewLink> --gws-result-json runtime-output/artifacts/sheets/create-*.json，再运行 agent-space output validate。不要只把 Google Sheet URL 写进最终回复。",
    externalGoogleDocs.length > 0
      ? [
          `当前频道有 ${externalGoogleDocs.length} 份 Google Docs 外部群文档。请只通过 AgentSpace output CLI 表达写入意图；AgentSpace/daemon 会校验权限并使用官方 gws CLI 执行。`,
          externalGoogleDocs
            .map((document) => `- Google Doc ${document.id} | ${document.title} | role ${roleByDocumentId.get(document.id) ?? "editor"} | ${document.externalUrl} | 状态 ${document.externalSyncStatus ?? "unknown"}`)
            .join("\n"),
          `如需写入 Google Doc，只有 editor/forwarder 文档可运行 agent-space output google-docs append-text --document-id <文档ID> --intent <意图> --text-file ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/docs/summary.md，或 agent-space output google-docs batch-update --document-id <文档ID> --intent <意图> --requests-json ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/docs/requests.json；随后运行 agent-space output validate。不要直接运行 gws，不要请求或输出 token，不要指定 CLI binary。`,
          `${RUNTIME_OUTPUT_EXTERNAL_GOOGLE_DOCS_RELATIVE_PATH} 是 output CLI 与 daemon 之间的内部文件，不要手工编辑。`,
        ].join("\n")
      : "",
    channelDocumentsContextDir ? `如果需要读取或更新群文档，请查看目录：${channelDocumentsContextDir}` : "",
    `如果内容属于长期共享工作稿，优先遵循 ${BUILTIN_UPDATE_CHANNEL_DOCUMENTS_SKILL_NAME} skill，并更新群文档，而不是只发一次性附件。`,
    `如需更新群文档，只有 editor/forwarder 文档可使用 agent-space output document upsert ...、agent-space output document replace-block ...、agent-space output document insert-after ... 或 agent-space output document delete-block ...，并运行 agent-space output validate；viewer 文档只能读取。${RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_RELATIVE_PATH} 是 output CLI 与 daemon 之间的内部文件，不要手工编辑。`,
  ].filter(Boolean);
}

function normalizeDocumentContexts(
  documentsOrContexts: ChannelDocument[] | AgentDocumentContext[],
): AgentDocumentContext[] {
  return documentsOrContexts.map((entry) => {
    if ("document" in entry) {
      return entry;
    }
    return {
      document: entry,
      role: "editor" as const,
      source: "channel_context" as const,
      allowedActions: ["view", "edit"],
    };
  });
}

export function applyChannelDocumentOperations(
  workDir: string,
  context: {
    channelName: string;
    sourceMessageId?: string;
    sourceTaskQueueId: string;
    actorName: string;
    workspaceId?: string;
  },
): {
  warnings: string[];
  documentUpdates: Array<{ documentId: string; documentVersionId: string }>;
} {
  const warnings: string[] = [];
  const documentUpdates: Array<{ documentId: string; documentVersionId: string }> = [];
  const operationsPath = getRuntimeOutputChannelDocumentsPath(workDir);
  if (!existsSync(operationsPath)) {
    return { warnings, documentUpdates };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(operationsPath, "utf8"));
  } catch (error) {
    return {
      warnings: [`检测到 ${RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_RELATIVE_PATH}，但 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`],
      documentUpdates,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { warnings: [`${RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_RELATIVE_PATH} 必须是对象。`], documentUpdates };
  }

  const manifest = parsed as { documents?: unknown };
  const operations = Array.isArray(manifest.documents) ? manifest.documents : [];
  const existingDocuments = [...listChannelDocumentsSync(context.channelName, context.workspaceId)];

  for (const operation of operations) {
    const normalized = normalizeChannelDocumentOperation(workDir, operation);
    if ("error" in normalized) {
      warnings.push(normalized.error);
      continue;
    }

    try {
      const existing =
        (normalized.documentId
          ? existingDocuments.find((document) => document.id === normalized.documentId)
          : undefined) ??
        existingDocuments.find((document) => sameValue(document.title, normalized.title) && document.status === "active");

      if (existing && normalized.operations.length > 0) {
        assertAgentDocumentActionAllowedSync({
          workspaceId: context.workspaceId ?? "default",
          agentName: context.actorName,
          documentId: existing.id,
          channelName: context.channelName,
          action: "edit",
        });
        const normalizedOperations = normalized.operations.map((item) =>
          item.op === "insert_after"
            ? {
                ...item,
                contentMarkdown: readFileSync(item.contentAbsolutePath, "utf8"),
              }
            : "contentAbsolutePath" in item
              ? {
                  ...item,
                  contentMarkdown: readFileSync(item.contentAbsolutePath, "utf8"),
                }
              : item,
        );

        const result = applyChannelDocumentBlockOperations({
          state: readWorkspaceStateSync(context.workspaceId),
          document: existing,
          baseVersionId: normalized.baseVersionId ?? existing.currentVersionId,
          actorId: context.actorName,
          actorType: "agent",
          operations: normalizedOperations as ChannelDocumentOperation[],
          summary: normalized.summary,
          sourceMessageId: context.sourceMessageId,
          sourceTaskQueueId: context.sourceTaskQueueId,
        });
        writeWorkspaceStateSync(result.state, context.workspaceId);
        if (result.document && result.version) {
          const index = existingDocuments.findIndex((document) => document.id === result.document!.id);
          if (index >= 0) {
            existingDocuments[index] = result.document;
          }
          documentUpdates.push({
            documentId: result.document.id,
            documentVersionId: result.document.currentVersionId,
          });
        }
        if (result.conflictCount > 0) {
          warnings.push(`群文档《${existing.title}》有 ${result.conflictCount} 个 block 更新冲突。`);
        }
        continue;
      }

      const contentMarkdown = normalized.contentAbsolutePath ? readFileSync(normalized.contentAbsolutePath, "utf8") : "";

      if (existing && normalized.mode !== "create") {
        assertAgentDocumentActionAllowedSync({
          workspaceId: context.workspaceId ?? "default",
          agentName: context.actorName,
          documentId: existing.id,
          channelName: context.channelName,
          action: "edit",
        });
        if (normalized.baseVersionId && existing.currentVersionId !== normalized.baseVersionId) {
          recordChannelDocumentConflictSync({
            documentId: existing.id,
            actorId: context.actorName,
            actorType: "agent",
            baseVersionId: normalized.baseVersionId,
            operationsJson: JSON.stringify([
              {
                op: "replace_document",
                title: normalized.title,
                contentMarkdown,
                summary: normalized.summary,
              },
            ]),
            sourceMessageId: context.sourceMessageId,
            sourceTaskQueueId: context.sourceTaskQueueId,
          }, context.workspaceId);
          warnings.push(`群文档《${existing.title}》在提交期间已被更新，本次修改已标记为 conflict。`);
          continue;
        }
        const { document } = updateChannelDocumentSync({
          documentId: existing.id,
          contentMarkdown,
          summary: normalized.summary,
          updatedBy: context.actorName,
          updatedByType: "agent",
          triggerType: normalized.triggerType,
          sourceMessageId: context.sourceMessageId,
          sourceTaskQueueId: context.sourceTaskQueueId,
        }, context.workspaceId);
        const index = existingDocuments.findIndex((documentItem) => documentItem.id === document.id);
        if (index >= 0) {
          existingDocuments[index] = document;
        }
        documentUpdates.push({
          documentId: document.id,
          documentVersionId: document.currentVersionId,
        });
        continue;
      }

      const { document } = createChannelDocumentSync({
        channelName: context.channelName,
        title: normalized.title,
        contentMarkdown,
        summary: normalized.summary,
        createdBy: context.actorName,
        createdByType: "agent",
        triggerType: normalized.triggerType,
        sourceMessageId: context.sourceMessageId,
        sourceTaskQueueId: context.sourceTaskQueueId,
      }, context.workspaceId);
      existingDocuments.unshift(document);
      documentUpdates.push({
        documentId: document.id,
        documentVersionId: document.currentVersionId,
      });
    } catch (error) {
      if (error instanceof AgentDocumentPermissionError) {
        throw error;
      }
      warnings.push(`群文档操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { warnings, documentUpdates };
}

export function clearChannelDocumentOperationArtifacts(workDir: string): void {
  rmSync(getRuntimeOutputChannelDocumentsPath(workDir), { force: true });
}

function normalizeChannelDocumentOperation(
  workDir: string,
  entry: unknown,
):
  | {
      documentId?: string;
      baseVersionId?: string;
      title: string;
      contentPath?: string;
      contentAbsolutePath?: string;
      summary?: string;
      mode: "create" | "create_or_update" | "update";
      triggerType: "agent" | "handoff";
      operations: Array<
        | { op: "replace_block"; blockId: string; baseRevision: number; contentAbsolutePath: string; heading?: string }
        | { op: "insert_after"; afterBlockId?: string; contentAbsolutePath: string; heading?: string }
        | { op: "delete_block"; blockId: string; baseRevision: number }
      >;
    }
  | { error: string } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: "documents[] 的每一项都必须是对象。" };
  }

  const candidate = entry as {
    documentId?: unknown;
    baseVersionId?: unknown;
    title?: unknown;
    contentPath?: unknown;
    summary?: unknown;
    mode?: unknown;
    triggerType?: unknown;
  };
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (!title) {
    return { error: "documents[].title 不能为空。" };
  }

  const contentPath = typeof candidate.contentPath === "string" ? candidate.contentPath.trim() : "";
  const operations = Array.isArray((candidate as { operations?: unknown }).operations)
    ? ((candidate as { operations?: unknown }).operations as unknown[])
    : [];

  if (!contentPath && operations.length === 0) {
    return { error: `群文档《${title}》缺少 contentPath 或 operations。` };
  }

  let contentAbsolutePath: string | undefined;
  if (contentPath) {
    const resolvedContentPath = resolveDocumentContentPath(workDir, contentPath);
    if (typeof resolvedContentPath !== "string") {
      return resolvedContentPath;
    }
    contentAbsolutePath = resolvedContentPath;
  }

  const normalizedOperations = operations
    .map((operation) => normalizeDocumentOperationEntry(workDir, operation))
    .filter((item): item is Exclude<typeof item, { error: string }> => !("error" in item));
  const operationError = operations
    .map((operation) => normalizeDocumentOperationEntry(workDir, operation))
    .find((item): item is { error: string } => "error" in item);
  if (operationError) {
    return operationError;
  }

  return {
    documentId: typeof candidate.documentId === "string" && candidate.documentId.trim().length > 0 ? candidate.documentId.trim() : undefined,
    baseVersionId:
      typeof candidate.baseVersionId === "string" && candidate.baseVersionId.trim().length > 0
        ? candidate.baseVersionId.trim()
        : undefined,
    title,
    contentPath,
    contentAbsolutePath: contentAbsolutePath as string | undefined,
    summary: typeof candidate.summary === "string" && candidate.summary.trim().length > 0 ? candidate.summary.trim() : undefined,
    mode:
      candidate.mode === "create" || candidate.mode === "update" ? candidate.mode : "create_or_update",
    triggerType: candidate.triggerType === "handoff" ? "handoff" : "agent",
    operations: normalizedOperations,
  };
}

function normalizeDocumentOperationEntry(
  workDir: string,
  entry: unknown,
):
  | { error: string }
  | { op: "replace_block"; blockId: string; baseRevision: number; contentAbsolutePath: string; heading?: string }
  | { op: "insert_after"; afterBlockId?: string; contentAbsolutePath: string; heading?: string }
  | { op: "delete_block"; blockId: string; baseRevision: number } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: "documents[].operations[] 的每一项都必须是对象。" };
  }

  const candidate = entry as {
    op?: unknown;
    blockId?: unknown;
    afterBlockId?: unknown;
    baseRevision?: unknown;
    contentPath?: unknown;
    heading?: unknown;
  };

  if (candidate.op === "delete_block") {
    if (typeof candidate.blockId !== "string" || candidate.blockId.trim().length === 0) {
      return { error: "delete_block 缺少 blockId。" };
    }
    if (typeof candidate.baseRevision !== "number") {
      return { error: "delete_block 缺少 baseRevision。" };
    }
    return {
      op: "delete_block",
      blockId: candidate.blockId.trim(),
      baseRevision: candidate.baseRevision,
    };
  }

  const contentPath = typeof candidate.contentPath === "string" ? candidate.contentPath.trim() : "";
  if (!contentPath) {
    return { error: `operation ${String(candidate.op)} 缺少 contentPath。` };
  }
  const resolved = resolveDocumentContentPath(workDir, contentPath);
  if (typeof resolved !== "string") {
    return resolved;
  }

  if (candidate.op === "replace_block") {
    if (typeof candidate.blockId !== "string" || candidate.blockId.trim().length === 0) {
      return { error: "replace_block 缺少 blockId。" };
    }
    if (typeof candidate.baseRevision !== "number") {
      return { error: "replace_block 缺少 baseRevision。" };
    }
    return {
      op: "replace_block",
      blockId: candidate.blockId.trim(),
      baseRevision: candidate.baseRevision,
      contentAbsolutePath: resolved,
      heading: typeof candidate.heading === "string" ? candidate.heading.trim() : undefined,
    };
  }

  if (candidate.op === "insert_after") {
    return {
      op: "insert_after",
      afterBlockId: typeof candidate.afterBlockId === "string" && candidate.afterBlockId.trim().length > 0 ? candidate.afterBlockId.trim() : undefined,
      contentAbsolutePath: resolved,
      heading: typeof candidate.heading === "string" ? candidate.heading.trim() : undefined,
    };
  }

  return { error: `不支持的群文档 operation：${String(candidate.op)}` };
}

function resolveDocumentContentPath(workDir: string, contentPath: string): string | { error: string } {
  if (isAbsolute(contentPath)) {
    return { error: `群文档 contentPath 只支持相对路径：${contentPath}` };
  }
  if (containsParentTraversal(contentPath)) {
    return { error: `群文档 contentPath 不允许包含 .. ：${contentPath}` };
  }

  const absolutePath = resolve(workDir, contentPath);
  if (!existsSync(absolutePath)) {
    return { error: `群文档内容文件不存在：${contentPath}` };
  }
  const realWorkDir = realpathSync(workDir);
  const realFilePath = realpathSync(absolutePath);
  const relativeToWorkDir = relative(realWorkDir, realFilePath);
  if (
    relativeToWorkDir !== "" &&
    relativeToWorkDir !== "." &&
    (relativeToWorkDir.startsWith("..") || isAbsolute(relativeToWorkDir))
  ) {
    return { error: `群文档 contentPath 超出当前 workDir：${contentPath}` };
  }

  const fileStat = statSync(realFilePath);
  if (!fileStat.isFile()) {
    return { error: `群文档 contentPath 不是文件：${contentPath}` };
  }
  return realFilePath;
}

function containsParentTraversal(value: string): boolean {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment.trim() === "..");
}

function sanitizePathSegment(value: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "document";
}

function sameValue(left: string, right: string): boolean {
  return left.localeCompare(right, "zh-CN", { sensitivity: "base" }) === 0;
}
