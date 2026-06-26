import { join } from "node:path";

export const RUNTIME_OUTPUT_DIR = "runtime-output";
export const RUNTIME_OUTPUT_ARTIFACTS_DIR = "artifacts";
export const RUNTIME_OUTPUT_MANIFEST_FILE = "agent-output.json";
export const RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_FILE = "channel-documents.json";
export const RUNTIME_OUTPUT_SKILL_IMPORTS_FILE = "skill-imports.json";
export const RUNTIME_OUTPUT_KNOWLEDGE_PROPOSALS_FILE = "knowledge-proposals.json";
export const RUNTIME_OUTPUT_EXTERNAL_SHEETS_FILE = "external-sheets.json";
export const RUNTIME_OUTPUT_EXTERNAL_SHEETS_RESULTS_FILE = "external-sheets-results.json";
export const RUNTIME_OUTPUT_EXTERNAL_GOOGLE_DOCS_FILE = "external-google-docs.json";
export const RUNTIME_OUTPUT_EXTERNAL_DOCUMENTS_FILE = "external-documents.json";
export const RUNTIME_OUTPUT_PERMISSION_REQUESTS_FILE = "permission-requests.json";
export const RUNTIME_OUTPUT_FEISHU_DATA_OPERATION_REQUESTS_FILE = "feishu-data-operation-requests.json";

export const RUNTIME_OUTPUT_MANIFEST_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_MANIFEST_FILE}`;
export const RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_FILE}`;
export const RUNTIME_OUTPUT_SKILL_IMPORTS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_SKILL_IMPORTS_FILE}`;
export const RUNTIME_OUTPUT_KNOWLEDGE_PROPOSALS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_KNOWLEDGE_PROPOSALS_FILE}`;
export const RUNTIME_OUTPUT_EXTERNAL_SHEETS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_EXTERNAL_SHEETS_FILE}`;
export const RUNTIME_OUTPUT_EXTERNAL_SHEETS_RESULTS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_EXTERNAL_SHEETS_RESULTS_FILE}`;
export const RUNTIME_OUTPUT_EXTERNAL_GOOGLE_DOCS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_EXTERNAL_GOOGLE_DOCS_FILE}`;
export const RUNTIME_OUTPUT_EXTERNAL_DOCUMENTS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_EXTERNAL_DOCUMENTS_FILE}`;
export const RUNTIME_OUTPUT_PERMISSION_REQUESTS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_PERMISSION_REQUESTS_FILE}`;
export const RUNTIME_OUTPUT_FEISHU_DATA_OPERATION_REQUESTS_RELATIVE_PATH = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_FEISHU_DATA_OPERATION_REQUESTS_FILE}`;
export const RUNTIME_OUTPUT_ARTIFACTS_RELATIVE_DIR = `${RUNTIME_OUTPUT_DIR}/${RUNTIME_OUTPUT_ARTIFACTS_DIR}`;

export function getRuntimeOutputDir(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR);
}

export function getRuntimeOutputArtifactsDir(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_ARTIFACTS_DIR);
}

export function getRuntimeOutputManifestPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_MANIFEST_FILE);
}

export function getRuntimeOutputChannelDocumentsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_CHANNEL_DOCUMENTS_FILE);
}

export function getRuntimeOutputSkillImportsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_SKILL_IMPORTS_FILE);
}

export function getRuntimeOutputKnowledgeProposalsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_KNOWLEDGE_PROPOSALS_FILE);
}

export function getRuntimeOutputExternalSheetsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_EXTERNAL_SHEETS_FILE);
}

export function getRuntimeOutputExternalSheetsResultsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_EXTERNAL_SHEETS_RESULTS_FILE);
}

export function getRuntimeOutputExternalGoogleDocsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_EXTERNAL_GOOGLE_DOCS_FILE);
}

export function getRuntimeOutputExternalDocumentsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_EXTERNAL_DOCUMENTS_FILE);
}

export function getRuntimeOutputPermissionRequestsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_PERMISSION_REQUESTS_FILE);
}

export function getRuntimeOutputFeishuDataOperationRequestsPath(workDir: string): string {
  return join(workDir, RUNTIME_OUTPUT_DIR, RUNTIME_OUTPUT_FEISHU_DATA_OPERATION_REQUESTS_FILE);
}
