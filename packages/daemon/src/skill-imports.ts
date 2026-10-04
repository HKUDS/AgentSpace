import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importWorkspaceSkillFromUrl,
  listEmployeeSkillIdsSync,
  setEmployeeSkillIdsSync,
  tryRecordWorkspaceAuditEventSync,
} from "@agent-space/services";
import {
  getRuntimeOutputSkillImportsPath,
  RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR,
  RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH,
} from "./runtime-output.ts";

type SkillImportConflict = "reject" | "rename" | "replace" | "skip";

interface NormalizedSkillImportOperation {
  source: string;
  sourceLabel: string;
  conflict: SkillImportConflict;
  assignToSelf: boolean;
}

export interface AppliedSkillImportOperation {
  skillId: string;
  skillName: string;
  sourceUrl: string;
  created: boolean;
  renamed: boolean;
  replaced: boolean;
  skipped: boolean;
  assignedToSelf: boolean;
}

export interface SkillImportOperationResult {
  warnings: string[];
  imports: AppliedSkillImportOperation[];
  statusMessages: string[];
}

const ALLOWED_IMPORT_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "skills.sh",
  "clawhub.ai",
]);
const PACKAGED_SKILL_IMPORTS_RELATIVE_DIR = `${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/skills`;
const IMPORTABLE_TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".csv",
  ".js",
  ".ts",
  ".py",
  ".sh",
]);

export interface PreparedSkillImportOperationArtifacts {
  warnings: string[];
  packaged: number;
}

export function prepareSkillImportOperationArtifacts(workDir: string): PreparedSkillImportOperationArtifacts {
  const warnings: string[] = [];
  const operationsPath = getRuntimeOutputSkillImportsPath(workDir);

  if (!existsSync(operationsPath)) {
    return { warnings, packaged: 0 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(operationsPath, "utf8"));
  } catch (error) {
    warnings.push(`检测到 ${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH}，但本地 skill 打包前 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    return { warnings, packaged: 0 };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { warnings, packaged: 0 };
  }

  const manifest = parsed as { imports?: unknown };
  if (!Array.isArray(manifest.imports)) {
    return { warnings, packaged: 0 };
  }

  let packaged = 0;
  let changed = false;
  const nextImports = manifest.imports.map((operation, index) => {
    const prepared = prepareSingleSkillImportArtifact(operation, index, workDir, warnings);
    if (!prepared) {
      return operation;
    }
    if (prepared.packaged) {
      packaged += 1;
    }
    changed = true;
    return prepared.entry;
  });

  if (changed) {
    writeFileSync(
      operationsPath,
      `${JSON.stringify({ ...parsed, imports: nextImports }, null, 2)}\n`,
      "utf8",
    );
  }

  return { warnings, packaged };
}

export async function applySkillImportOperations(
  workDir: string,
  context: {
    workspaceId: string;
    agentName?: string;
  },
): Promise<SkillImportOperationResult> {
  const warnings: string[] = [];
  const imports: AppliedSkillImportOperation[] = [];
  const statusMessages: string[] = [];
  const operationsPath = getRuntimeOutputSkillImportsPath(workDir);

  if (!existsSync(operationsPath)) {
    return { warnings, imports, statusMessages };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(operationsPath, "utf8"));
  } catch (error) {
    return {
      warnings: [`检测到 ${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH}，但 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`],
      imports,
      statusMessages,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      warnings: [`${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 必须是对象。`],
      imports,
      statusMessages,
    };
  }

  const manifest = parsed as { imports?: unknown };
  const operations = Array.isArray(manifest.imports) ? manifest.imports : [];
  if (operations.length === 0) {
    return { warnings, imports, statusMessages };
  }

  for (const [index, operation] of operations.entries()) {
    const normalized = normalizeSkillImportOperation(operation, index, workDir);
    if ("error" in normalized) {
      warnings.push(normalized.error);
      continue;
    }

    try {
      const result = await importWorkspaceSkillFromUrl({
        workspaceId: context.workspaceId,
        url: normalized.source,
        conflict: normalized.conflict,
      });
      const assignedToSelf = normalized.assignToSelf
        ? assignSkillToCurrentAgent({
            workspaceId: context.workspaceId,
            agentName: context.agentName,
            skillId: result.skillId,
            skillName: result.skillName,
            warnings,
          })
        : false;

      const applied = {
        skillId: result.skillId,
        skillName: result.skillName,
        sourceUrl: normalized.sourceLabel,
        created: result.created,
        renamed: result.renamed,
        replaced: result.replaced,
        skipped: result.skipped,
        assignedToSelf,
      } satisfies AppliedSkillImportOperation;
      imports.push(applied);
      statusMessages.push(formatSkillImportStatus(applied));

      tryRecordWorkspaceAuditEventSync({
        workspaceId: context.workspaceId,
        title: "Skill imported by agent",
        note: `Skill "${result.skillName}" was requested from runtime output by ${context.agentName ?? "an agent"}.`,
        code: "workspace.skill_imported_by_agent",
        data: {
          actorType: "agent",
          resourceType: "skill",
          resourceId: result.skillId,
          sourceUrl: normalized.sourceLabel,
          assignedToSelf,
          created: result.created,
          renamed: result.renamed,
          replaced: result.replaced,
          skipped: result.skipped,
        },
      });
    } catch (error) {
      warnings.push(`Skill 导入失败（${normalized.sourceLabel}）：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { warnings, imports, statusMessages };
}

export function clearSkillImportOperationArtifacts(workDir: string): void {
  rmSync(getRuntimeOutputSkillImportsPath(workDir), { force: true });
}

function prepareSingleSkillImportArtifact(
  entry: unknown,
  index: number,
  workDir: string,
  warnings: string[],
): { entry: Record<string, unknown>; packaged: boolean } | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const candidate = entry as {
    url?: unknown;
    path?: unknown;
    archivePath?: unknown;
  };
  const sourceFields = [
    typeof candidate.url === "string" && candidate.url.trim().length > 0 ? "url" : "",
    typeof candidate.path === "string" && candidate.path.trim().length > 0 ? "path" : "",
    typeof candidate.archivePath === "string" && candidate.archivePath.trim().length > 0 ? "archivePath" : "",
  ].filter(Boolean) as Array<"url" | "path" | "archivePath">;
  if (sourceFields.length !== 1) {
    return null;
  }

  const sourceField = sourceFields[0];
  const rawSource = String(candidate[sourceField]).trim();
  if (sourceField !== "url" && isRelativeRuntimeArtifactReference(rawSource)) {
    return null;
  }
  const existingArtifactPath = resolveExistingRuntimeArtifactReference(rawSource, sourceField, workDir);
  if (existingArtifactPath) {
    const rewritten = { ...(entry as Record<string, unknown>) };
    delete rewritten.url;
    delete rewritten.path;
    delete rewritten.archivePath;
    rewritten[sourceField === "archivePath" ? "archivePath" : "path"] = existingArtifactPath;
    return { entry: rewritten, packaged: false };
  }

  const localSource = resolvePackableLocalSkillSource(rawSource, sourceField, workDir);
  if (!localSource) {
    return null;
  }

  let packaged: { relativePath: string; archive: boolean };
  try {
    packaged = packageLocalSkillImportSource(localSource, workDir, warnings);
  } catch (error) {
    warnings.push(`本地 Skill 打包失败（imports[${index}].${sourceField}: ${rawSource}）：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const rewritten = { ...(entry as Record<string, unknown>) };
  delete rewritten.url;
  delete rewritten.path;
  delete rewritten.archivePath;
  if (packaged.archive) {
    rewritten.archivePath = packaged.relativePath;
  } else {
    rewritten.path = packaged.relativePath;
  }
  return { entry: rewritten, packaged: true };
}

function isRelativeRuntimeArtifactReference(value: string): boolean {
  const normalized = value.replace(/\\/g, "/").trim();
  return !isAbsolute(normalized)
    && (
      normalized === RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR
      || normalized.startsWith(`${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/`)
    );
}

function resolveExistingRuntimeArtifactReference(
  value: string,
  field: "url" | "path" | "archivePath",
  workDir: string,
): string | null {
  if (field === "url") {
    return null;
  }

  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return null;
  }

  if (!isAbsolute(normalized)) {
    if (
      normalized !== RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR
      && !normalized.startsWith(`${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/`)
    ) {
      return null;
    }
    return normalized;
  }

  const artifactsRoot = resolve(workDir, RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR);
  const absolutePath = resolve(normalized);
  if (!isPathInside(artifactsRoot, absolutePath)) {
    return null;
  }

  return join(RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR, relative(artifactsRoot, absolutePath)).replace(/\\/g, "/");
}

function resolvePackableLocalSkillSource(
  value: string,
  field: "url" | "path" | "archivePath",
  workDir: string,
): string | null {
  if (!value) {
    return null;
  }

  if (isAbsolute(value)) {
    return value;
  }

  if (field === "url") {
    let parsed: URL | null = null;
    try {
      parsed = new URL(value);
    } catch {
      parsed = null;
    }

    if (parsed) {
      if (parsed.protocol === "https:") {
        return null;
      }
      if (parsed.protocol === "file:") {
        return fileURLToPath(parsed);
      }
      return null;
    }
  }

  return resolve(workDir, value);
}

function packageLocalSkillImportSource(
  sourcePath: string,
  workDir: string,
  warnings: string[],
): { relativePath: string; archive: boolean } {
  const absolutePath = resolve(sourcePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`路径不存在：${absolutePath}`);
  }

  const stats = statSync(absolutePath);
  const archive = stats.isFile() && extname(absolutePath).toLowerCase() === ".zip";
  const directSkillFile = stats.isFile() && samePathName(basename(absolutePath), "SKILL.md");
  if (!stats.isDirectory() && !archive && !directSkillFile) {
    throw new Error("本地 skill 来源必须是 skill 目录、.zip 文件或 SKILL.md。");
  }

  const artifactName = resolveUniqueSkillArtifactName(workDir, deriveSkillArtifactName(absolutePath, directSkillFile));
  if (archive) {
    const relativePath = `${PACKAGED_SKILL_IMPORTS_RELATIVE_DIR}/${artifactName}.zip`;
    const targetPath = resolve(workDir, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(absolutePath));
    return { relativePath, archive: true };
  }

  const relativePath = `${PACKAGED_SKILL_IMPORTS_RELATIVE_DIR}/${artifactName}`;
  const targetDir = resolve(workDir, relativePath);
  mkdirSync(targetDir, { recursive: true });
  if (directSkillFile) {
    writeFileSync(join(targetDir, "SKILL.md"), readFileSync(absolutePath));
    return { relativePath, archive: false };
  }

  const copiedFiles = copySkillDirectoryFiles(absolutePath, targetDir, warnings);
  if (!copiedFiles.some((path) => samePathName(path, "SKILL.md"))) {
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`本地 skill 目录必须包含 SKILL.md：${absolutePath}`);
  }

  return { relativePath, archive: false };
}

function copySkillDirectoryFiles(
  sourceDir: string,
  targetDir: string,
  warnings: string[],
  relativePrefix = "",
): string[] {
  const copiedFiles: string[] = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = normalizeSkillArtifactFilePath(relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name);
    if (!relativePath) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      copiedFiles.push(...copySkillDirectoryFiles(sourcePath, targetDir, warnings, relativePath));
      continue;
    }

    if (!entry.isFile()) {
      warnings.push(`打包本地 skill 时跳过不支持的条目：${relativePath}`);
      continue;
    }

    if (!isImportableSkillTextFile(relativePath)) {
      warnings.push(`打包本地 skill 时跳过非文本文件：${relativePath}`);
      continue;
    }

    const targetPath = join(targetDir, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath));
    copiedFiles.push(relativePath);
  }

  return copiedFiles;
}

function deriveSkillArtifactName(sourcePath: string, directSkillFile: boolean): string {
  const rawName = directSkillFile ? basename(dirname(sourcePath)) : basename(sourcePath).replace(/\.zip$/i, "");
  return sanitizeSkillArtifactSegment(rawName);
}

function resolveUniqueSkillArtifactName(workDir: string, baseName: string): string {
  let candidate = baseName;
  let index = 2;
  while (
    existsSync(resolve(workDir, `${PACKAGED_SKILL_IMPORTS_RELATIVE_DIR}/${candidate}`))
    || existsSync(resolve(workDir, `${PACKAGED_SKILL_IMPORTS_RELATIVE_DIR}/${candidate}.zip`))
  ) {
    candidate = `${baseName}-${index}`;
    index += 1;
  }
  return candidate;
}

function sanitizeSkillArtifactSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

function normalizeSkillArtifactFilePath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return "";
  }
  return segments.join("/");
}

function isImportableSkillTextFile(path: string): boolean {
  if (samePathName(path, "SKILL.md")) {
    return true;
  }
  return IMPORTABLE_TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function samePathName(left: string, right: string): boolean {
  return left.localeCompare(right, "en-US", { sensitivity: "base" }) === 0;
}

function normalizeSkillImportOperation(
  entry: unknown,
  index: number,
  workDir: string,
): NormalizedSkillImportOperation | { error: string } {
  const label = `imports[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label} 必须是对象。` };
  }

  const candidate = entry as {
    url?: unknown;
    path?: unknown;
    archivePath?: unknown;
    conflict?: unknown;
    assignToSelf?: unknown;
  };

  const sourceFields = [
    typeof candidate.url === "string" && candidate.url.trim().length > 0 ? "url" : "",
    typeof candidate.path === "string" && candidate.path.trim().length > 0 ? "path" : "",
    typeof candidate.archivePath === "string" && candidate.archivePath.trim().length > 0 ? "archivePath" : "",
  ].filter(Boolean);
  if (sourceFields.length !== 1) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label} 必须且只能提供 url、path 或 archivePath 之一。` };
  }

  const conflict = normalizeConflict(candidate.conflict);
  if (!conflict) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label}.conflict 只能是 reject、rename、replace 或 skip。` };
  }

  if (candidate.assignToSelf !== undefined && typeof candidate.assignToSelf !== "boolean") {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label}.assignToSelf 必须是布尔值。` };
  }

  const source = resolveSkillImportSource(candidate, label, workDir);
  if ("error" in source) {
    return source;
  }

  return {
    source: source.source,
    sourceLabel: source.sourceLabel,
    conflict,
    assignToSelf: candidate.assignToSelf ?? true,
  };
}

function resolveSkillImportSource(
  candidate: {
    url?: unknown;
    path?: unknown;
    archivePath?: unknown;
  },
  label: string,
  workDir: string,
): { source: string; sourceLabel: string } | { error: string } {
  if (typeof candidate.url === "string" && candidate.url.trim().length > 0) {
    const url = candidate.url.trim();
    const parsedUrl = parseImportUrl(url);
    if ("error" in parsedUrl) {
      return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label}.url ${parsedUrl.error}` };
    }
    return { source: url, sourceLabel: url };
  }

  if (typeof candidate.path === "string" && candidate.path.trim().length > 0) {
    const source = resolveRuntimeArtifactSource(candidate.path, `${label}.path`, workDir);
    if ("error" in source) {
      return source;
    }
    return source;
  }

  if (typeof candidate.archivePath === "string" && candidate.archivePath.trim().length > 0) {
    const source = resolveRuntimeArtifactSource(candidate.archivePath, `${label}.archivePath`, workDir);
    if ("error" in source) {
      return source;
    }
    if (!source.sourceLabel.toLocaleLowerCase("en-US").endsWith(".zip")) {
      return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label}.archivePath 必须指向 .zip 文件。` };
    }
    return source;
  }

  return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${label} 缺少导入来源。` };
}

function resolveRuntimeArtifactSource(
  value: string,
  fieldLabel: string,
  workDir: string,
): { source: string; sourceLabel: string } | { error: string } {
  const relativePath = value.replace(/\\/g, "/").trim();
  if (!relativePath) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${fieldLabel} 必须是非空字符串。` };
  }
  if (isAbsolute(relativePath)) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${fieldLabel} 必须是相对路径。` };
  }
  if (relativePath.split("/").some((segment) => segment === "..")) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${fieldLabel} 不能包含 ..。` };
  }
  if (
    relativePath !== RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR
    && !relativePath.startsWith(`${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/`)
  ) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${fieldLabel} 必须位于 ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/ 下。` };
  }

  const artifactsRoot = resolve(workDir, RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR);
  const absolutePath = resolve(workDir, relativePath);
  if (!isPathInside(artifactsRoot, absolutePath)) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${fieldLabel} 超出当前 workDir。` };
  }

  if (!existsSync(absolutePath)) {
    return { source: absolutePath, sourceLabel: relativePath };
  }

  const realArtifactsRoot = realpathSync(artifactsRoot);
  const realSourcePath = realpathSync(absolutePath);
  if (!isPathInside(realArtifactsRoot, realSourcePath)) {
    return { error: `${RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH} 的 ${fieldLabel} 不能指向 ${RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR}/ 外部。` };
  }

  return {
    source: realSourcePath,
    sourceLabel: relativePath,
  };
}

function parseImportUrl(value: string): URL | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { error: "必须是 HTTPS URL。" };
  }
  if (parsed.protocol !== "https:") {
    return { error: "必须使用 HTTPS。暂不允许本地路径、file: 或 http: 导入。" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMPORT_HOSTS.has(hostname) && !hostname.endsWith(".clawhub.ai")) {
    return { error: "只允许从 GitHub、skills.sh 或 ClawHub 导入。" };
  }

  return parsed;
}

function normalizeConflict(value: unknown): SkillImportConflict | null {
  if (value === undefined || value === null || value === "") {
    return "skip";
  }
  if (value === "reject" || value === "rename" || value === "replace" || value === "skip") {
    return value;
  }
  return null;
}

function isPathInside(rootDir: string, candidatePath: string): boolean {
  const relativePath = relative(rootDir, candidatePath);
  return (
    relativePath === ""
    || relativePath === "."
    || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function assignSkillToCurrentAgent(input: {
  workspaceId: string;
  agentName?: string;
  skillId: string;
  skillName: string;
  warnings: string[];
}): boolean {
  const agentName = input.agentName?.trim();
  if (!agentName) {
    input.warnings.push(`Skill "${input.skillName}" 已导入，但无法自动绑定：缺少当前 Agent 名称。`);
    return false;
  }

  try {
    const currentSkillIds = listEmployeeSkillIdsSync(agentName, input.workspaceId);
    if (currentSkillIds.includes(input.skillId)) {
      return false;
    }
    setEmployeeSkillIdsSync(agentName, [...currentSkillIds, input.skillId], input.workspaceId);
    return true;
  } catch (error) {
    input.warnings.push(`Skill "${input.skillName}" 已导入，但绑定给 ${agentName} 失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function formatSkillImportStatus(imported: AppliedSkillImportOperation): string {
  const action = imported.skipped
    ? "已存在，跳过导入"
    : imported.replaced
      ? "已按来源替换"
      : imported.renamed
        ? "已导入并因重名自动重命名"
        : "已导入工作区";
  const assignment = imported.assignedToSelf ? "，并已绑定给当前 Agent" : "";
  return `Skill "${imported.skillName}" ${action}${assignment}。`;
}
