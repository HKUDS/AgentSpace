import { parseAgentMentions, type MentionCandidate, type ParsedMention } from "./mentions.ts";

export interface MentionStep {
  id: string;
  agentId: string;
  agentLabel: string;
  instruction: string;
  dependsOnStepIds: string[];
  handoffKind: "document" | "attachment" | "message";
}

export interface MentionPlan {
  mode: "parallel" | "sequential";
  steps: MentionStep[];
  warnings: string[];
  unknownMentions: string[];
}

interface ClauseMention {
  mention: ParsedMention;
  start: number;
}

const MENTION_SEPARATOR = /[\s#，。,.!！？?;；:：、()[\]{}<>《》「」『』"'`~]/;
const SEQUENTIAL_MARKERS = ["然后", "再", "之后", "接着", "完成后", "先"];
const HANDOFF_DOCUMENT_MARKERS = ["markdown", "文档", "计划", "清单", "纪要", "草稿"];
const HANDOFF_ATTACHMENT_MARKERS = ["附件", "文件", "图片", "pdf", "PDF"];
const DOCUMENT_CONTINUATION_MARKERS = ["继续", "完善", "补充", "阅读后", "基于它", "在这版基础上"];
const DIRECT_HANDOFF_MARKERS = ["发给", "交给", "给", "转给", "发我", "给 @", "交给 @"];
const AMBIGUOUS_SEQUENTIAL_MARKERS = ["继续", "完善", "补充", "阅读后", "基于它", "在这版基础上", "一起"];

export function parseMentionPlan(input: string, candidates: MentionCandidate[]): MentionPlan {
  const mentionResult = parseAgentMentions(input, candidates);
  if (mentionResult.mentions.length <= 1) {
    return {
      mode: "parallel",
      steps: mentionResult.mentions.map((mention, index) => ({
        id: `step-${index + 1}`,
        agentId: mention.agentId,
        agentLabel: mention.label,
        instruction: input.trim(),
        dependsOnStepIds: [],
        handoffKind: inferHandoffKind(input),
      })),
      warnings: [],
      unknownMentions: mentionResult.unknownMentions,
    };
  }

  const clauses = splitSequentialClauses(input);
  const steps: MentionStep[] = [];
  const warnings: string[] = [];
  const mentionsWithOffsets = collectMentionsWithOffsets(input, candidates);

  if (clauses.length === 1 && mentionResult.mentions.length >= 2 && hasDirectHandoff(input)) {
    const primary = mentionResult.mentions[0]!;
    const secondary = mentionResult.mentions[1]!;
    const handoffKind = inferHandoffKind(input);

    return {
      mode: "sequential",
      steps: [
        {
          id: "step-1",
          agentId: primary.agentId,
          agentLabel: primary.label,
          instruction: input.trim(),
          dependsOnStepIds: [],
          handoffKind,
        },
        {
          id: "step-2",
          agentId: secondary.agentId,
          agentLabel: secondary.label,
          instruction: inheritedContinuationInstruction(input, secondary.token),
          dependsOnStepIds: ["step-1"],
          handoffKind,
        },
      ],
      warnings,
      unknownMentions: mentionResult.unknownMentions,
    };
  }

  for (const clause of clauses) {
    const clauseMentions = mentionsWithOffsets
      .filter((entry) => entry.start >= clause.start && entry.start < clause.end)
      .sort((left, right) => left.start - right.start);
    if (clauseMentions.length === 0) {
      continue;
    }

    const primary = clauseMentions[0]!.mention;
    const previousStep = steps[steps.length - 1];
    steps.push({
      id: `step-${steps.length + 1}`,
      agentId: primary.agentId,
      agentLabel: primary.label,
      instruction: clause.text.trim(),
      dependsOnStepIds: clause.isSequential && steps.length > 0 ? [steps[steps.length - 1]!.id] : [],
      handoffKind: inferHandoffKind(clause.text, previousStep?.handoffKind),
    });
  }

  if (steps.length <= 1) {
    if (mentionResult.mentions.length > 1 && looksAmbiguousSequential(input)) {
      warnings.push("无法可靠识别顺序依赖，请明确写出先后顺序。");
    }
    return {
      mode: "parallel",
      steps: mentionResult.mentions.map((mention, index) => ({
        id: `step-${index + 1}`,
        agentId: mention.agentId,
        agentLabel: mention.label,
        instruction: input.trim(),
        dependsOnStepIds: [],
        handoffKind: inferHandoffKind(input),
      })),
      warnings,
      unknownMentions: mentionResult.unknownMentions,
    };
  }

  if (!clauses.some((clause) => clause.isSequential)) {
    if (looksAmbiguousSequential(input)) {
      warnings.push("无法可靠识别顺序依赖，请明确写出先后顺序。");
    }
    return {
      mode: "parallel",
      steps: mentionResult.mentions.map((mention, index) => ({
        id: `step-${index + 1}`,
        agentId: mention.agentId,
        agentLabel: mention.label,
        instruction: input.trim(),
        dependsOnStepIds: [],
        handoffKind: inferHandoffKind(input),
      })),
      warnings,
      unknownMentions: mentionResult.unknownMentions,
    };
  }

  return {
    mode: "sequential",
    steps,
    warnings,
    unknownMentions: mentionResult.unknownMentions,
  };
}

function collectMentionsWithOffsets(input: string, candidates: MentionCandidate[]): ClauseMention[] {
  const mentions: ClauseMention[] = [];
  const aliases = candidates.flatMap((candidate) =>
    [candidate.label, ...candidate.aliases]
      .filter((alias, index, all) => all.findIndex((value) => sameText(value, alias)) === index)
      .map((alias) => ({ mention: candidate, alias })),
  )
    .sort((left, right) => right.alias.length - left.alias.length);

  for (let index = 0; index < input.length; index += 1) {
    if (input[index] !== "@") {
      continue;
    }
    if (!isBoundary(input, index - 1)) {
      continue;
    }
    for (const entry of aliases) {
      if (!aliasMatchesAt(input, index + 1, entry.alias)) {
        continue;
      }
      mentions.push({
        start: index,
        mention: {
          agentId: entry.mention.agentId,
          label: entry.mention.label,
          token: entry.alias,
          mentionType: "agent",
          inChannel: entry.mention.inChannel,
        },
      });
      break;
    }
  }

  return mentions;
}

function splitSequentialClauses(input: string): Array<{ text: string; start: number; end: number; isSequential: boolean }> {
  const clauses: Array<{ text: string; start: number; end: number; isSequential: boolean }> = [];
  let cursor = 0;
  let previousEnd = 0;

  while (cursor < input.length) {
    const nextMatch = findNextSequentialMarker(input, cursor);
    if (!nextMatch) {
      const text = input.slice(previousEnd).trim();
      if (text.length > 0) {
        clauses.push({ text, start: previousEnd, end: input.length, isSequential: clauses.length > 0 });
      }
      break;
    }

    const text = input.slice(previousEnd, nextMatch.index).trim();
    if (text.length > 0) {
      clauses.push({ text, start: previousEnd, end: nextMatch.index, isSequential: clauses.length > 0 });
    }
    cursor = nextMatch.index + nextMatch.marker.length;
    previousEnd = cursor;
  }

  return clauses;
}

function findNextSequentialMarker(input: string, fromIndex: number): { marker: string; index: number } | null {
  let best: { marker: string; index: number } | null = null;
  for (const marker of SEQUENTIAL_MARKERS) {
    let searchFrom = fromIndex;
    while (searchFrom <= input.length) {
      const index = input.indexOf(marker, searchFrom);
      if (index < 0) {
        break;
      }
      // Reject markers that continue a preceding CJK token (e.g. 先 inside 首先).
      if (index > 0 && isCjkLetter(input[index - 1]!)) {
        searchFrom = index + marker.length;
        continue;
      }
      if (!best || index < best.index || (index === best.index && marker.length > best.marker.length)) {
        best = { marker, index };
      }
      break;
    }
  }
  return best;
}

function isCjkLetter(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0xf900 && code <= 0xfaff)
  );
}

function inferHandoffKind(input: string, inheritedKind?: "document" | "attachment" | "message"): "document" | "attachment" | "message" {
  const lower = input.toLowerCase();
  if (HANDOFF_DOCUMENT_MARKERS.some((marker) => input.includes(marker) || lower.includes(marker.toLowerCase()))) {
    return "document";
  }
  if (HANDOFF_ATTACHMENT_MARKERS.some((marker) => input.includes(marker) || lower.includes(marker.toLowerCase()))) {
    return "attachment";
  }
  if (inheritedKind === "document" && DOCUMENT_CONTINUATION_MARKERS.some((marker) => input.includes(marker))) {
    return "document";
  }
  return "message";
}

function hasDirectHandoff(input: string): boolean {
  return DIRECT_HANDOFF_MARKERS.some((marker) => input.includes(marker));
}

function looksAmbiguousSequential(input: string): boolean {
  return AMBIGUOUS_SEQUENTIAL_MARKERS.some((marker) => input.includes(marker));
}

function inheritedContinuationInstruction(input: string, mentionToken: string): string {
  const directMentionIndex = input.indexOf(`@${mentionToken}`);
  if (directMentionIndex >= 0) {
    const tail = input.slice(directMentionIndex + mentionToken.length + 1).trim();
    if (tail.length > 0) {
      return tail;
    }
  }
  return "基于上游交付继续处理";
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, "zh-CN", { sensitivity: "base" }) === 0;
}

function aliasMatchesAt(input: string, startIndex: number, alias: string): boolean {
  const candidate = input.slice(startIndex, startIndex + alias.length);
  if (!sameText(candidate, alias)) {
    return false;
  }

  return isBoundary(input, startIndex + alias.length);
}

function isBoundary(input: string, index: number): boolean {
  if (index < 0 || index >= input.length) {
    return true;
  }
  return MENTION_SEPARATOR.test(input[index]);
}
