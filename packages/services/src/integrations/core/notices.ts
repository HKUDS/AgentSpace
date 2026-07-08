import { buildExternalIdReference } from "./references.ts";

export interface ExternalNoticeMetadataInput {
  provider: string;
  noticeType: string;
  noticeSource?: string;
  outboxSource?: string;
  reasonCode?: string;
  externalChatId?: string;
  externalThreadId?: string;
  buildExternalReference?: (value: string) => string;
  extra?: Record<string, unknown>;
}

export function buildExternalNoticeMetadata(input: ExternalNoticeMetadataInput): Record<string, unknown> {
  const buildReference = input.buildExternalReference ?? ((value: string) => buildExternalIdReference(value));
  return {
    provider: input.provider,
    outboxSource: input.outboxSource,
    noticeType: input.noticeType,
    noticeSource: input.noticeSource,
    reasonCode: input.reasonCode,
    ...(input.extra ?? {}),
    externalChatReference: input.externalChatId ? buildReference(input.externalChatId) : undefined,
    externalThreadReference: input.externalThreadId ? buildReference(input.externalThreadId) : undefined,
  };
}
