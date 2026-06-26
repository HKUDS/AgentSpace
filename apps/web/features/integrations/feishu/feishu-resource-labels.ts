export function buildFeishuResourceReference(input: {
  providerResourceType: string;
  providerResourceToken: string;
}): string {
  return `${input.providerResourceType} / ${formatFeishuResourceTokenFingerprint(input.providerResourceToken)}`;
}

export function buildFeishuExternalIdReference(input: {
  kind: "chat" | "user" | "union" | "email" | "thread";
  value?: string;
}): string {
  const normalized = input.value?.trim();
  if (!normalized) {
    return input.kind;
  }
  return `${input.kind} ${hashShortHex(normalized)}`;
}

export function formatFeishuResourceTitle(input: {
  displayName?: string;
  providerResourceReference: string;
}): string {
  const displayName = input.displayName?.trim();
  return displayName || input.providerResourceReference;
}

function formatFeishuResourceTokenFingerprint(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "resource";
  }
  return `resource ${hashShortHex(normalized)}`;
}

function hashShortHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
