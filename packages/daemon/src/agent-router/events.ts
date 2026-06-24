import type { AgentRouterEvent } from "./types.ts";
import { extractSessionId, extractText, extractUsage, readNumberAtPaths, readStringAtPaths, readValueAtPaths } from "./utils.ts";

export function mapClaudeNativeEvent(event: Record<string, unknown>): AgentRouterEvent[] {
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "result") {
    const result: AgentRouterEvent[] = [];
    if (typeof event.usage === "object" && event.usage) {
      const usage = event.usage as Record<string, unknown>;
      result.push({
        type: "tool_output",
        tool: "usage",
        metadata: {
          input_tokens: usage.input_tokens ?? usage.inputTokens,
          output_tokens: usage.output_tokens ?? usage.outputTokens,
        },
      });
    }
    result.push(...extractClaudePermissionDenials(event).map((denial) => ({
      type: "approval_requested" as const,
      toolName: denial.toolName,
      toolInput: denial.toolInput,
      contentPreview: formatToolApprovalPreview(denial.toolName, denial.toolInput),
    })));
    return result;
  }

  if (type === "assistant") {
    const text = extractClaudeAssistantText(event);
    return text ? [{ type: "thought_delta", text }] : [];
  }

  if (type === "text" || type === "message") {
    const text = extractText(event.text ?? event.content);
    return text ? [{ type: "text_delta", text }] : [];
  }

  if (type === "content_block_delta" && event.delta && typeof event.delta === "object") {
    const text = extractText((event.delta as Record<string, unknown>).text);
    return text ? [{ type: "text_delta", text }] : [];
  }

  if (type === "tool_use") {
    return [{
      type: "tool_started",
      tool: typeof event.name === "string" ? event.name : "unknown",
      title: typeof event.name === "string" ? event.name : undefined,
      input: typeof event.input === "object" && event.input ? event.input : undefined,
    }];
  }

  if (type === "tool_result") {
    const tool = typeof event.name === "string" ? event.name : "unknown";
    const output = extractText(event.output ?? event.content);
    return [
      { type: "tool_output", tool, output },
      { type: "tool_finished", tool, status: "completed" },
    ];
  }

  return [];
}

export function mapCodexNativeEvent(event: Record<string, unknown>): AgentRouterEvent[] {
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "item.started" || type === "item.completed") {
    const item = event.item;
    if (!item || typeof item !== "object") {
      return [];
    }
    const typedItem = item as Record<string, unknown>;
    const itemType = normalizeCodexItemType(typedItem.type);
    if (itemType === "command_execution") {
      const command = typeof typedItem.command === "string"
        ? typedItem.command
        : readStringAtPaths(typedItem, [["input", "command"]]);
      if (type === "item.started") {
        return [{
          type: "tool_started",
          tool: "exec_command",
          title: command ? `bash: ${command}` : "bash",
          input: command ? { command } : undefined,
        }];
      }

      const output = typeof typedItem.aggregatedOutput === "string"
        ? typedItem.aggregatedOutput
        : typeof typedItem.aggregated_output === "string"
          ? typedItem.aggregated_output
        : typeof typedItem.output === "string"
          ? typedItem.output
          : undefined;
      return [
        { type: "tool_output", tool: "exec_command", output },
        { type: "tool_finished", tool: "exec_command", status: "completed" },
      ];
    }

    if (itemType === "file_change") {
      return type === "item.started"
        ? [{ type: "tool_started", tool: "patch_apply", title: "file change" }]
        : [{ type: "tool_finished", tool: "patch_apply", status: "completed" }];
    }

    if (itemType === "agent_message" && typeof typedItem.text === "string") {
      return typedItem.phase === "final_answer"
        ? [{ type: "text_delta", text: typedItem.text }]
        : [{ type: "thought_delta", text: typedItem.text }];
    }
  }

  if (type === "thread.started") {
    const sessionId = readStringAtPaths(event, [["thread_id"], ["threadId"]]);
    return sessionId ? [{ type: "session_updated", sessionId }] : [];
  }

  return [];
}

export function mapOpenClawNativeEvent(event: Record<string, unknown>): AgentRouterEvent[] {
  const sessionId = readStringAtPaths(event, [
    ["sessionId"],
    ["session_id"],
    ["conversationId"],
    ["conversation_id"],
    ["result", "sessionId"],
    ["result", "session_id"],
    ["result", "conversationId"],
    ["result", "conversation_id"],
    ["meta", "sessionId"],
    ["meta", "session_id"],
  ]);
  const result: AgentRouterEvent[] = sessionId ? [{ type: "session_updated", sessionId }] : [];
  const type = typeof event.type === "string" ? event.type : "";
  const eventName = typeof event.event === "string" ? event.event : "";

  const status = readStringAtPaths(event, [
    ["status"],
    ["phase"],
    ["state"],
    ["result", "status"],
    ["message", "status"],
  ]);
  if ((type === "status" || eventName === "status" || status) && !isTerminalTextOpenClawEvent(event)) {
    const statusText = extractText(event.message ?? event.content ?? event.text ?? status);
    if (statusText) {
      result.push({ type: "thought_delta", text: statusText });
    }
  }

  const toolName = readStringAtPaths(event, [
    ["tool"],
    ["toolName"],
    ["tool_name"],
    ["name"],
    ["tool", "name"],
    ["message", "tool"],
    ["result", "tool"],
  ]);
  if (toolName && /tool|command|exec|function/i.test(`${type} ${eventName}`)) {
    if (/start|started|call|calling|tool_use/i.test(`${type} ${eventName}`)) {
      result.push({
        type: "tool_started",
        tool: toolName,
        title: toolName,
        input: readOpenClawToolInput(event),
      });
    } else if (/finish|finished|result|output|complete|completed|failed|error/i.test(`${type} ${eventName}`)) {
      const output = extractText(event.output ?? event.result ?? event.content ?? event.message);
      result.push({ type: "tool_output", tool: toolName, output });
      result.push({
        type: "tool_finished",
        tool: toolName,
        status: /fail|error|denied/i.test(`${type} ${eventName} ${status ?? ""}`) ? "failed" : "completed",
      });
    }
  }

  const text = extractTextFromOpenClawEvent(event);
  if (text) {
    result.push({ type: "text_delta", text });
  }

  const usage = extractUsage(event);
  if (usage) {
    result.push({
      type: "tool_output",
      tool: "usage",
      metadata: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      },
    });
  }

  return result;
}

export function mapOpenCodeNativeEvent(event: Record<string, unknown>): AgentRouterEvent[] {
  const result: AgentRouterEvent[] = [];
  const sessionId = extractSessionId(event);
  if (sessionId) {
    result.push({ type: "session_updated", sessionId });
  }

  const type = typeof event.type === "string" ? event.type : "";
  const eventName = typeof event.event === "string" ? event.event : "";
  const part = event.part && typeof event.part === "object" ? event.part as Record<string, unknown> : undefined;
  const combinedType = `${type} ${eventName} ${typeof part?.type === "string" ? part.type : ""}`;

  const toolName = readOpenCodeToolName(event);
  if (toolName && /tool|command|exec|function/i.test(combinedType)) {
    if (/start|started|call|calling|tool_use/i.test(combinedType)) {
      result.push({
        type: "tool_started",
        tool: toolName,
        title: toolName,
        input: readOpenCodeToolInput(event),
      });
    } else if (/finish|finished|result|output|complete|completed|failed|error/i.test(combinedType)) {
      const output = extractText(event.output ?? event.result ?? part?.output ?? part?.result ?? event.content ?? event.message);
      result.push({ type: "tool_output", tool: toolName, output });
      result.push({
        type: "tool_finished",
        tool: toolName,
        status: /fail|error|denied/i.test(combinedType) ? "failed" : "completed",
      });
    }
  }

  const usage = extractOpenCodeUsage(event);
  if (usage) {
    result.push({
      type: "tool_output",
      tool: "usage",
      metadata: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      },
    });
  }

  if (type === "text" || type === "message") {
    const text = extractOpenCodeFinalText(event);
    if (text) {
      result.push({ type: "text_delta", text });
    }
    return result;
  }

  if (type === "step_start" || type === "step" || type === "status") {
    const text = extractOpenCodeStepText(event);
    if (text) {
      result.push({ type: "thought_delta", text });
    }
    return result;
  }

  const finalText = extractOpenCodeFinalText(event);
  if (finalText && !/step_finish|usage|debug/i.test(combinedType)) {
    result.push({ type: "text_delta", text: finalText });
  }

  return result;
}

export function extractClaudeFallbackText(event: Record<string, unknown>): string | undefined {
  if (event.type === "result" && typeof event.result === "string") {
    return event.result.trim() || undefined;
  }
  if (event.type === "assistant") {
    return extractClaudeAssistantText(event);
  }
  if (event.type === "text" || event.type === "message") {
    return extractText(event.text ?? event.content);
  }
  if (event.type === "content_block_delta" && event.delta && typeof event.delta === "object") {
    return extractText((event.delta as Record<string, unknown>).text);
  }
  return undefined;
}

export function extractCodexFinalText(event: Record<string, unknown>): string | undefined {
  const item = event.item;
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const typedItem = item as Record<string, unknown>;
  if (normalizeCodexItemType(typedItem.type) === "agent_message" && typeof typedItem.text === "string") {
    if (typedItem.phase && typedItem.phase !== "final_answer") {
      return undefined;
    }
    return typedItem.text.trim() || undefined;
  }
  return undefined;
}

export function extractOpenCodeFinalText(event: Record<string, unknown>): string | undefined {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "step_start" || type === "step" || type === "status" || type === "step_finish" || type === "usage" || type === "debug") {
    return undefined;
  }

  return extractText(
    readValueAtPaths(event, [
      ["part", "text"],
      ["part", "content"],
      ["part", "message"],
      ["text"],
      ["content"],
      ["message"],
      ["result", "text"],
      ["result", "content"],
    ]),
  );
}

function normalizeCodexItemType(value: unknown): string {
  if (value === "commandExecution" || value === "command_execution") {
    return "command_execution";
  }
  if (value === "fileChange" || value === "file_change") {
    return "file_change";
  }
  if (value === "agentMessage" || value === "agent_message") {
    return "agent_message";
  }
  return typeof value === "string" ? value : "";
}

function extractClaudeAssistantText(event: Record<string, unknown>): string | undefined {
  const message = event.message && typeof event.message === "object"
    ? event.message as Record<string, unknown>
    : undefined;
  return extractText(message?.content ?? event.content);
}

function extractTextFromOpenClawEvent(event: Record<string, unknown>): string | undefined {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "usage" || type === "debug" || type === "status") {
    return undefined;
  }
  return extractText(event);
}

function extractOpenCodeStepText(event: Record<string, unknown>): string | undefined {
  return extractText(
    readValueAtPaths(event, [
      ["part", "title"],
      ["part", "text"],
      ["message"],
      ["content"],
      ["text"],
    ]),
  );
}

function extractOpenCodeUsage(event: Record<string, unknown>): { inputTokens: number; outputTokens: number } | undefined {
  const sharedUsage = extractUsage(event);
  if (sharedUsage) {
    return sharedUsage;
  }

  const inputTokens = readNumberAtPaths(event, [
    ["tokens", "input"],
    ["tokens", "inputTokens"],
    ["tokens", "input_tokens"],
    ["part", "tokens", "input"],
    ["part", "tokens", "inputTokens"],
    ["part", "tokens", "input_tokens"],
  ]) ?? 0;
  const outputTokens = readNumberAtPaths(event, [
    ["tokens", "output"],
    ["tokens", "outputTokens"],
    ["tokens", "output_tokens"],
    ["part", "tokens", "output"],
    ["part", "tokens", "outputTokens"],
    ["part", "tokens", "output_tokens"],
  ]) ?? 0;

  if (inputTokens <= 0 && outputTokens <= 0) {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

function readOpenCodeToolName(event: Record<string, unknown>): string | undefined {
  return readStringAtPaths(event, [
    ["tool"],
    ["toolName"],
    ["tool_name"],
    ["name"],
    ["part", "tool"],
    ["part", "toolName"],
    ["part", "tool_name"],
    ["part", "name"],
  ]);
}

function readOpenCodeToolInput(event: Record<string, unknown>): unknown {
  const part = event.part && typeof event.part === "object" ? event.part as Record<string, unknown> : undefined;
  return event.input ?? event.args ?? event.arguments ?? event.params ?? event.command
    ?? part?.input ?? part?.args ?? part?.arguments ?? part?.params ?? part?.command;
}

function isTerminalTextOpenClawEvent(event: Record<string, unknown>): boolean {
  const type = typeof event.type === "string" ? event.type : "";
  return type === "message" || type === "text" || type === "result" || type === "assistant";
}

function readOpenClawToolInput(event: Record<string, unknown>): unknown {
  return event.input ?? event.args ?? event.arguments ?? event.params ?? event.command;
}

function extractClaudePermissionDenials(event: Record<string, unknown>): Array<{
  toolName: string;
  toolInput?: Record<string, unknown>;
}> {
  const denials = Array.isArray(event.permission_denials) ? event.permission_denials : [];
  return denials.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const toolName = typeof record.tool_name === "string" && record.tool_name.trim()
      ? record.tool_name.trim()
      : "unknown";
    const toolInput = record.tool_input && typeof record.tool_input === "object"
      ? record.tool_input as Record<string, unknown>
      : undefined;
    return [{ toolName, toolInput }];
  });
}

function formatToolApprovalPreview(toolName: string, toolInput?: Record<string, unknown>): string {
  if (toolName === "Bash" && typeof toolInput?.command === "string") {
    return `Bash: ${toolInput.command}`;
  }
  return `${toolName}: ${JSON.stringify(toolInput ?? {})}`;
}
