import type {
  ExternalIntegrationEventStatus,
  ExternalMessageOutboxStatus,
} from "@agent-space/db";
import type { ReactNode } from "react";
import type { SettingsTx } from "@/features/settings/settings-types";

export interface IntegrationOutboxFailureListItem {
  id: string;
  status: ExternalMessageOutboxStatus;
  attempts: number;
  nextAttemptAt?: string;
  lastError?: string;
  agentId?: string;
  botBindingId?: string;
  targetReference: string;
}

export interface IntegrationInboundEventListItem {
  id: string;
  status: ExternalIntegrationEventStatus;
  eventType: string;
  eventReference: string;
  errorMessage?: string;
  receivedAt?: string;
  processedAt?: string;
}

export interface IntegrationInboundEventSummaryItem {
  label: string;
  value: number;
}

export function IntegrationOutboxFailureList({
  items,
  targetLabel,
  tx,
}: {
  items: IntegrationOutboxFailureListItem[];
  targetLabel: string;
  tx: SettingsTx;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="feishu-outbox-failure-list">
      <strong>{tx("最近出站失败", "Recent Outbound Failures")}</strong>
      {items.map((item) => (
        <div className="feishu-outbox-failure" key={item.id}>
          <div>
            <span className={`status-chip ${item.status === "failed" ? "status-chip--danger" : "status-chip--warning"}`}>
              {translateOutboxStatus(item.status, tx)}
            </span>
            <span>{tx("尝试", "Attempts")}: {item.attempts}</span>
            {item.nextAttemptAt ? (
              <span>{tx("下次重试", "Next Retry")}: {item.nextAttemptAt}</span>
            ) : null}
            {item.agentId ? (
              <span>{tx("Agent", "Agent")}: {item.agentId}</span>
            ) : null}
            {item.botBindingId ? (
              <span>{tx("Bot 绑定", "Bot binding")}: {item.botBindingId}</span>
            ) : null}
            <span>{targetLabel}: {item.targetReference}</span>
          </div>
          <p>{item.lastError ?? tx("无错误详情", "No error detail")}</p>
        </div>
      ))}
    </div>
  );
}

export function IntegrationInboundEventList<TItem extends IntegrationInboundEventListItem>({
  items,
  renderBindingSuggestion,
  summaries,
  tx,
}: {
  items: TItem[];
  renderBindingSuggestion?: (item: TItem) => ReactNode;
  summaries: IntegrationInboundEventSummaryItem[];
  tx: SettingsTx;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="feishu-inbound-event-list">
      <div>
        <strong>{tx("最近入站事件", "Recent Inbound Events")}</strong>
        {summaries.map((summary) => (
          <span key={summary.label}>{summary.label}: {summary.value}</span>
        ))}
      </div>
      {items.map((item) => (
        <div className="feishu-inbound-event" key={item.id}>
          <div>
            <span className={`status-chip ${resolveInboundEventStatusClass(item.status)}`}>
              {translateInboundEventStatus(item.status, tx)}
            </span>
            <span>{item.eventType}</span>
            <span>{item.eventReference}</span>
          </div>
          <p>
            {item.errorMessage
              ? `${tx("原因", "Reason")}: ${item.errorMessage}`
              : tx("无失败原因", "No failure reason")}
          </p>
          {renderBindingSuggestion?.(item)}
          {item.receivedAt ? (
            <small>
              {tx("接收", "Received")}: {item.receivedAt}
              {item.processedAt ? ` · ${tx("处理", "Processed")}: ${item.processedAt}` : ""}
            </small>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function translateOutboxStatus(status: ExternalMessageOutboxStatus, tx: SettingsTx): string {
  switch (status) {
    case "failed":
      return tx("失败", "Failed");
    case "pending":
      return tx("待重试", "Retry Pending");
    case "locked":
      return tx("发送中", "Sending");
    case "sent":
      return tx("已发送", "Sent");
    case "cancelled":
      return tx("已取消", "Cancelled");
  }
}

function translateInboundEventStatus(status: ExternalIntegrationEventStatus, tx: SettingsTx): string {
  switch (status) {
    case "received":
      return tx("已接收", "Received");
    case "processed":
      return tx("已处理", "Processed");
    case "ignored":
      return tx("已忽略", "Ignored");
    case "failed":
      return tx("失败", "Failed");
  }
}

function resolveInboundEventStatusClass(status: ExternalIntegrationEventStatus): string {
  switch (status) {
    case "processed":
      return "status-chip--active";
    case "ignored":
    case "received":
      return "status-chip--warning";
    case "failed":
      return "status-chip--danger";
  }
}
