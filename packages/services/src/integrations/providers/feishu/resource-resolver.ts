import type { ExternalResourceDescriptor } from "../../core/index.ts";
import { resolveFeishuBaseResource } from "./base.ts";
import { resolveFeishuDocResource } from "./docs.ts";
import { resolveFeishuSheetResource } from "./sheets.ts";

export type FeishuResourceDescriptorBindingValidationResult =
  | {
    ok: true;
  }
  | {
    ok: false;
    errorCode: string;
    errorMessage: string;
    data?: Record<string, unknown>;
  };

export function resolveFeishuResourceDescriptor(value: string): ExternalResourceDescriptor | null {
  return resolveFeishuDocResource(value)
    ?? resolveFeishuSheetResource(value)
    ?? resolveFeishuBaseResource(value);
}

export function resolveFeishuResourceDescriptorForType(
  providerResourceType: string,
  value: string,
): ExternalResourceDescriptor | null {
  const resourceType = providerResourceType.trim();
  if (resourceType === "doc") {
    return resolveFeishuDocResource(value);
  }
  if (resourceType === "sheet") {
    return resolveFeishuSheetResource(value);
  }
  if (resourceType === "base") {
    return resolveFeishuBaseResource(value);
  }
  if (resourceType === "base_table" || resourceType === "base_view") {
    return resolveFeishuBaseScopedResource(resourceType, value);
  }
  return null;
}

export function validateFeishuResourceDescriptorForBinding(
  descriptor: ExternalResourceDescriptor,
): FeishuResourceDescriptorBindingValidationResult {
  if (descriptor.providerResourceType !== "base_table" && descriptor.providerResourceType !== "base_view") {
    return { ok: true };
  }
  const metadata = descriptor.metadata ?? {};
  const appToken = readMetadataString(metadata, "appToken") ?? readMetadataString(metadata, "baseToken");
  const tableId = descriptor.providerResourceType === "base_table"
    ? descriptor.providerResourceToken.trim()
    : readMetadataString(metadata, "tableId");
  if (!appToken) {
    return {
      ok: false,
      errorCode: "feishu.resource_binding.base_app_token_missing",
      errorMessage: "Feishu Base table/view bindings require a Base app token. Use a Base URL that contains the app token instead of a raw table or view id.",
      data: {
        providerResourceType: descriptor.providerResourceType,
        missing: "appToken",
      },
    };
  }
  if (!tableId) {
    return {
      ok: false,
      errorCode: "feishu.resource_binding.base_table_id_missing",
      errorMessage: "Feishu Base view bindings require table context. Use a Base URL that includes table=... and view=....",
      data: {
        providerResourceType: descriptor.providerResourceType,
        missing: "tableId",
      },
    };
  }
  return { ok: true };
}

function resolveFeishuBaseScopedResource(
  providerResourceType: "base_table" | "base_view",
  value: string,
): ExternalResourceDescriptor | null {
  const trimmed = value.trim();
  const appToken = extractFeishuBaseToken(trimmed);
  const tableId = extractFeishuBaseTableId(trimmed);
  const viewId = extractFeishuBaseViewId(trimmed);
  const fallbackToken = normalizeFeishuResourceToken(trimmed);
  const providerResourceToken = providerResourceType === "base_table"
    ? tableId ?? fallbackToken
    : viewId ?? fallbackToken;
  if (!providerResourceToken) {
    return null;
  }
  return {
    providerResourceType,
    providerResourceToken,
    providerResourceUrl: trimmed.startsWith("http") ? trimmed : undefined,
    metadata: {
      appToken,
      tableId: providerResourceType === "base_table" ? providerResourceToken : tableId,
      viewId: providerResourceType === "base_view" ? providerResourceToken : viewId,
    },
  };
}

function extractFeishuBaseToken(value: string): string | undefined {
  return /(?:base|bitable)\/([A-Za-z0-9_-]+)/.exec(value)?.[1]
    ?? readUrlParameter(value, "app_token")
    ?? readUrlParameter(value, "appToken");
}

function extractFeishuBaseTableId(value: string): string | undefined {
  return readUrlParameter(value, "table")
    ?? readUrlParameter(value, "table_id")
    ?? readUrlParameter(value, "tableId")
    ?? /(?:table|tbl)\/([A-Za-z0-9_-]+)/.exec(value)?.[1];
}

function extractFeishuBaseViewId(value: string): string | undefined {
  return readUrlParameter(value, "view")
    ?? readUrlParameter(value, "view_id")
    ?? readUrlParameter(value, "viewId")
    ?? /(?:view|vew)\/([A-Za-z0-9_-]+)/.exec(value)?.[1];
}

function readUrlParameter(value: string, key: string): string | undefined {
  try {
    const parsed = new URL(value);
    const candidate = parsed.searchParams.get(key);
    return candidate?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeFeishuResourceToken(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{4,}$/.test(trimmed) ? trimmed : undefined;
}

function readMetadataString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}
