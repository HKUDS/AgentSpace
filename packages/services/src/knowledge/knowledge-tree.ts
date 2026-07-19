// Knowledge parent-chain helpers (pure; no workspace I/O).

export type KnowledgeParentPage = {
  id: string;
  parentId?: string | null;
};

/** True when candidateId is under ancestorId in the parent chain. */
export function isDescendant(
  pages: KnowledgeParentPage[],
  ancestorId: string,
  candidateId: string,
): boolean {
  let current = pages.find((p) => p.id === candidateId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) {
      return false;
    }
    seen.add(current.id);
    if (current.parentId === ancestorId) {
      return true;
    }
    current = current.parentId
      ? pages.find((p) => p.id === current!.parentId)
      : undefined;
  }
  return false;
}
