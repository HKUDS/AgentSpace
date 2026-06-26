"use client";

import type { SettingsTx } from "@/features/settings/settings-types";
import type { FeishuIntegrationSettingsItem } from "./feishu-types";

const MAX_RUN_PREVIEW_CHARS = 1200;
type FeishuOperationRunWithIntegration = FeishuIntegrationSettingsItem["operationRuns"][number] & {
  integrationName: string;
};

export function FeishuOperationRunsPanel({
  integrations,
  tx,
}: {
  integrations: FeishuIntegrationSettingsItem[];
  tx: SettingsTx;
}) {
  const runs = integrations.flatMap((integration) =>
    integration.operationRuns.map((run) => ({
      ...run,
      integrationName: integration.displayName,
    })),
  );
  const sortedRuns = [...runs].sort(compareRunsByCreatedAtDesc);
  const failedRuns = sortedRuns.filter((run) => run.status === "failed");
  const latestFailedRun = failedRuns[0];

  return (
    <section className="page-panel">
      <div className="panel-header">
        <div>
          <h3>{tx("飞书数据操作记录", "Feishu Data Operation Runs")}</h3>
          <p className="settings-panel-note">
            {tx("查看 Docs、Sheets、Base 读写操作的策略决策、状态和错误。", "Review policy decisions, status, and errors for Docs, Sheets, and Base operations.")}
          </p>
        </div>
      </div>

      {latestFailedRun ? (
        <div aria-label={tx("飞书数据操作失败诊断", "Feishu data operation failure diagnostics")} className="feishu-operation-diagnostics">
          <div>
            <strong>{tx("最近数据操作失败", "Latest Data Operation Failure")}</strong>
            <span>{classifyDataOperationFailure(latestFailedRun.errorCode, tx)}</span>
          </div>
          <p>
            {latestFailedRun.integrationName} · {latestFailedRun.operationType} · {latestFailedRun.providerResourceReference}
          </p>
          <dl>
            <div>
              <dt>{tx("失败记录", "Failed runs")}</dt>
              <dd>{failedRuns.length}</dd>
            </div>
            <div>
              <dt>{tx("错误码", "Error code")}</dt>
              <dd>{latestFailedRun.errorCode ?? tx("未记录", "Not recorded")}</dd>
            </div>
            <div>
              <dt>{tx("错误", "Error")}</dt>
              <dd>{latestFailedRun.errorMessage ?? tx("未记录", "Not recorded")}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="feishu-binding-list">
        {sortedRuns.length > 0 ? sortedRuns.map((run) => {
          const previewText = formatRunPreview(run.resultPreview);
          return (
            <article className="feishu-binding-card" key={run.id}>
              <div>
                <strong>{run.operationType}</strong>
                <p>{run.integrationName}</p>
              </div>
              <div className="feishu-binding-card__meta">
                <span>{tx("状态", "Status")}: {translateRunStatus(run.status, tx)}</span>
                <span>{tx("策略", "Policy")}: {run.policyDecision ?? tx("未记录", "Not recorded")}</span>
                <span>{tx("资源", "Resource")}: {run.providerResourceReference}</span>
                <span>{tx("Actor", "Actor")}: {run.actorId || run.actorType}</span>
                <span>{tx("来源", "Source")}: {formatGovernanceActor(run, tx)}</span>
                {run.governanceContext?.channelName ? (
                  <span>{tx("频道", "Channel")}: {run.governanceContext.channelName}</span>
                ) : null}
                {run.governanceContext?.botBindingId ? (
                  <span>{tx("Bot 绑定", "Bot binding")}: {run.governanceContext.botBindingId}</span>
                ) : null}
                <span>{tx("创建时间", "Created")}: {run.createdAt}</span>
                {run.errorCode ? <span>{tx("错误码", "Error code")}: {run.errorCode}</span> : null}
                {run.errorMessage ? <span>{tx("错误", "Error")}: {run.errorMessage}</span> : null}
              </div>
              {run.responseSummary || previewText ? (
                <div className="feishu-operation-run-preview">
                  {run.responseSummary ? (
                    <p>
                      <span>{tx("响应摘要", "Response Summary")}</span>
                      {run.responseSummary}
                    </p>
                  ) : null}
                  {previewText ? (
                    <pre aria-label={tx("结果预览", "Result preview")}>{previewText}</pre>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        }) : (
          <p className="settings-empty">{tx("暂无飞书数据操作记录。", "No Feishu data operation runs yet.")}</p>
        )}
      </div>
    </section>
  );
}

function formatGovernanceActor(run: FeishuOperationRunWithIntegration, tx: SettingsTx): string {
  const context = run.governanceContext;
  if (!context?.actorType) {
    return run.actorId || run.actorType;
  }
  if (context.actorType === "external_guest") {
    return [
      tx("外部访客", "External guest"),
      context.externalActorReference,
      context.externalGuestPermissionProfile,
    ].filter(Boolean).join(" · ");
  }
  if (context.actorType === "user") {
    return [
      tx("用户", "User"),
      context.actorUserId,
    ].filter(Boolean).join(" · ");
  }
  if (context.actorType === "agent") {
    return [
      tx("Agent", "Agent"),
      context.agentId ?? run.actorId,
    ].filter(Boolean).join(" · ");
  }
  return tx("系统", "System");
}

function compareRunsByCreatedAtDesc(left: FeishuOperationRunWithIntegration, right: FeishuOperationRunWithIntegration): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function classifyDataOperationFailure(errorCode: string | undefined, tx: SettingsTx): string {
  if (!errorCode) {
    return tx("执行失败，缺少错误码", "Execution failed without an error code");
  }
  if (errorCode.includes("scope_missing")) {
    return tx("缺少飞书 API scope", "Missing Feishu API scope");
  }
  if (
    errorCode.includes("permission")
    || errorCode.includes("access_denied")
    || errorCode.includes("read_denied")
    || errorCode.includes("channel_access_denied")
    || errorCode.includes("channel_document_access_denied")
  ) {
    return tx("资源权限不足", "Insufficient resource permission");
  }
  if (errorCode.includes("resource") || errorCode.includes("binding")) {
    return tx("资源绑定异常", "Resource binding issue");
  }
  return tx("执行失败", "Execution failed");
}

function translateRunStatus(status: FeishuIntegrationSettingsItem["operationRuns"][number]["status"], tx: SettingsTx): string {
  switch (status) {
    case "pending":
      return tx("待执行", "Pending");
    case "running":
      return tx("执行中", "Running");
    case "succeeded":
      return tx("成功", "Succeeded");
    case "failed":
      return tx("失败", "Failed");
    case "cancelled":
      return tx("已取消", "Cancelled");
  }
}

function formatRunPreview(preview: Record<string, unknown> | undefined): string | undefined {
  if (!preview) {
    return undefined;
  }
  try {
    const text = JSON.stringify(preview, null, 2);
    return text.length > MAX_RUN_PREVIEW_CHARS
      ? `${text.slice(0, MAX_RUN_PREVIEW_CHARS)}...`
      : text;
  } catch {
    return undefined;
  }
}
