import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { deleteWorkspaceAttachmentsSync, persistWorkspaceAttachmentFromFileSync } from "@agent-space/services";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import { clearChannelDocumentOperationArtifacts } from "./channel-documents.ts";
import {
  getRuntimeOutputDir,
  getRuntimeOutputManifestPath,
  RUNTIME_OUTPUT_MANIFEST_RELATIVE_PATH,
} from "./runtime-output.ts";
import {
  MAX_OUTPUT_ATTACHMENT_BYTES,
  MAX_OUTPUT_ATTACHMENTS,
  MAX_OUTPUT_ATTACHMENTS_TOTAL_BYTES,
} from "./runtime-output-manifests.ts";

export function clearTaskOutputArtifacts(workDir: string): void {
  rmSync(join(workDir, "last-message.txt"), { force: true });
  rmSync(getRuntimeOutputDir(workDir), { recursive: true, force: true });
  clearChannelDocumentOperationArtifacts(workDir);
}

export function loadTaskOutputEnvelope(
  workDir: string,
  fallbackText: string,
  workspaceId: string,
): {
  text: string;
  attachments: MessageAttachment[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const manifestPath = getRuntimeOutputManifestPath(workDir);
  const fallbackOutput = fallbackText.trim();

  if (!existsSync(manifestPath)) {
    return {
      text: fallbackOutput,
      attachments: [],
      warnings,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    warnings.push(`检测到 ${RUNTIME_OUTPUT_MANIFEST_RELATIVE_PATH}，但 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    return {
      text: fallbackOutput,
      attachments: [],
      warnings,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push(`${RUNTIME_OUTPUT_MANIFEST_RELATIVE_PATH} 必须是对象。`);
    return {
      text: fallbackOutput,
      attachments: [],
      warnings,
    };
  }

  const manifest = parsed as {
    text?: unknown;
    attachments?: unknown;
  };
  const attachments = Array.isArray(manifest.attachments) ? manifest.attachments : [];
  if (attachments.length > MAX_OUTPUT_ATTACHMENTS) {
    warnings.push(`附件数超过限制，最多只接受 ${MAX_OUTPUT_ATTACHMENTS} 个。`);
  }

  const persistedAttachments: MessageAttachment[] = [];
  let totalAcceptedBytes = 0;
  for (const attachment of attachments.slice(0, MAX_OUTPUT_ATTACHMENTS)) {
    const normalized = normalizeOutputAttachmentEntry(workDir, attachment);
    if ("error" in normalized) {
      warnings.push(normalized.error);
      continue;
    }
    if (totalAcceptedBytes + normalized.sizeBytes > MAX_OUTPUT_ATTACHMENTS_TOTAL_BYTES) {
      warnings.push(
        `附件总大小超过限制，最多只接受 ${(MAX_OUTPUT_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024)).toFixed(0)} MB。`,
      );
      continue;
    }

    try {
      const persisted = persistWorkspaceAttachmentFromFileSync({
        workspaceId,
        sourcePath: normalized.absolutePath,
        fileName: normalized.fileName,
        mediaType: normalized.mediaType,
      });
      persistedAttachments.push(persisted);
      totalAcceptedBytes += normalized.sizeBytes;
    } catch (error) {
      warnings.push(`附件落盘失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestText = typeof manifest.text === "string" ? manifest.text.trim() : "";
  return {
    text: manifestText || fallbackOutput,
    attachments: persistedAttachments,
    warnings,
  };
}

export function discardTaskOutputAttachments(attachments: MessageAttachment[]): void {
  if (attachments.length > 0) {
    deleteWorkspaceAttachmentsSync(attachments);
  }
}

function normalizeOutputAttachmentEntry(
  workDir: string,
  entry: unknown,
):
  | {
      absolutePath: string;
      fileName: string;
      mediaType?: string;
      sizeBytes: number;
    }
  | { error: string } {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: "attachments[] 的每一项都必须是对象。" };
  }

  const candidate = entry as {
    path?: unknown;
    name?: unknown;
    mediaType?: unknown;
  };
  const relativePath = typeof candidate.path === "string" ? candidate.path.trim() : "";
  if (!relativePath) {
    return { error: "attachments[].path 不能为空。" };
  }
  if (isAbsolute(relativePath)) {
    return { error: `只支持相对路径，不允许绝对路径：${relativePath}` };
  }
  if (containsParentTraversal(relativePath)) {
    return { error: `附件路径不允许包含 .. ：${relativePath}` };
  }

  const absolutePath = resolve(workDir, relativePath);
  if (!existsSync(absolutePath)) {
    return { error: `附件文件不存在：${relativePath}` };
  }
  const realWorkDir = realpathSync(workDir);
  if (containsSymlinkBetween(workDir, absolutePath)) {
    return { error: `附件路径不允许经过符号链接：${relativePath}` };
  }
  const fileStat = statSync(absolutePath);
  if (!fileStat.isFile()) {
    return { error: `附件路径不是文件：${relativePath}` };
  }
  if (fileStat.size <= 0) {
    return { error: `附件文件不能为空：${relativePath}` };
  }
  if (fileStat.size > MAX_OUTPUT_ATTACHMENT_BYTES) {
    return { error: `附件文件超过大小限制：${relativePath}` };
  }

  const realFilePath = realpathSync(absolutePath);
  const relativeToWorkDir = relative(realWorkDir, realFilePath);
  if (
    relativeToWorkDir === "" ||
    relativeToWorkDir === "." ||
    (!relativeToWorkDir.startsWith("..") && !isAbsolute(relativeToWorkDir))
  ) {
    return {
      absolutePath: realFilePath,
      fileName:
        typeof candidate.name === "string" && candidate.name.trim().length > 0
          ? candidate.name.trim()
          : basename(relativePath),
      mediaType: typeof candidate.mediaType === "string" && candidate.mediaType.trim().length > 0 ? candidate.mediaType.trim() : undefined,
      sizeBytes: fileStat.size,
    };
  }

  return { error: `附件路径超出当前 workDir：${relativePath}` };
}

function containsParentTraversal(value: string): boolean {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment.trim() === "..");
}

function containsSymlinkBetween(baseDir: string, targetPath: string): boolean {
  const relativePath = relative(baseDir, targetPath);
  if (!relativePath || relativePath === ".") {
    return false;
  }

  let currentPath = baseDir;
  for (const segment of relativePath.split(/[\\/]+/).filter((item) => item.length > 0)) {
    currentPath = join(currentPath, segment);
    if (lstatSync(currentPath).isSymbolicLink()) {
      return true;
    }
  }
  return false;
}
