"use client";

import { type TransitionStartFunction, useEffect, useState } from "react";
import type { WorkspaceRole } from "@agent-space/db";
import { SettingsSectionShell } from "@/features/settings/components/settings-chrome";
import { IntegrationMetricGrid } from "@/features/integrations/integration-settings-cards";
import type { SettingsSectionMeta } from "@/features/settings/settings-meta";
import type { SettingsTx } from "@/features/settings/settings-types";
import { SlackIntegrationSettingsPanel } from "@/features/integrations/slack/slack-integration-settings-panel";
import type {
  SlackAvailableChannelItem,
  SlackAvailableUserItem,
  SlackIntegrationCreationGuide,
  SlackIntegrationSettingsItem,
} from "@/features/integrations/slack/slack-types";
import { FeishuAgentBotsPanel } from "./feishu-agent-bots-panel";
import { FeishuChannelBindingsPanel } from "./feishu-channel-bindings-panel";
import { FeishuCreateIntegrationDialog } from "./feishu-create-integration-dialog";
import { FeishuHealthPanel } from "./feishu-health-panel";
import { FeishuOperationRunsPanel } from "./feishu-operation-runs-panel";
import { FeishuResourceBindingsPanel } from "./feishu-resource-bindings-panel";
import { FeishuUserBindingsPanel } from "./feishu-user-bindings-panel";
import type {
  FeishuAvailableChannelItem,
  FeishuAvailableAgentItem,
  FeishuAvailableUserItem,
  FeishuIntegrationCreationGuide,
  FeishuIntegrationSettingsItem,
} from "./feishu-types";

export function SettingsIntegrationsSection({
  availableChannels,
  availableAgents,
  availableUsers,
  currentMembershipRole,
  currentUserId,
  feishuIntegrationCreationGuide,
  feishuIntegrations,
  isPending,
  meta,
  refreshSettingsData,
  slackAvailableChannels,
  slackAvailableUsers,
  slackIntegrationCreationGuide,
  slackIntegrations,
  startTransition,
  tx,
}: {
  availableChannels: FeishuAvailableChannelItem[];
  availableAgents: FeishuAvailableAgentItem[];
  availableUsers: FeishuAvailableUserItem[];
  currentMembershipRole: WorkspaceRole;
  currentUserId?: string;
  feishuIntegrationCreationGuide?: FeishuIntegrationCreationGuide;
  feishuIntegrations: FeishuIntegrationSettingsItem[];
  isPending: boolean;
  meta: SettingsSectionMeta;
  refreshSettingsData: () => void;
  slackAvailableChannels: SlackAvailableChannelItem[];
  slackAvailableUsers: SlackAvailableUserItem[];
  slackIntegrationCreationGuide?: SlackIntegrationCreationGuide;
  slackIntegrations: SlackIntegrationSettingsItem[];
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const [integrations, setIntegrations] = useState(feishuIntegrations);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setIntegrations(feishuIntegrations);
  }, [feishuIntegrations]);

  const totalChannelBindings = integrations.reduce((sum, integration) => sum + integration.channelBindingCount, 0);
  const totalResourceBindings = integrations.reduce((sum, integration) => sum + integration.resourceBindingCount, 0);
  const totalUserBindings = integrations.reduce((sum, integration) => sum + integration.userBindingCount, 0);
  const totalOperationRuns = integrations.reduce((sum, integration) => sum + integration.operationRunCount, 0);
  const totalOutboxFailures = integrations.reduce((sum, integration) => sum + integration.outboxFailureCount, 0);
  const canManageIntegrations = currentMembershipRole === "owner" || currentMembershipRole === "admin";
  const shouldRenderSlackPanel = Boolean(slackIntegrationCreationGuide) ||
    slackIntegrations.length > 0 ||
    slackAvailableChannels.length > 0 ||
    slackAvailableUsers.length > 0;

  function mergeIntegration(nextIntegration: FeishuIntegrationSettingsItem): void {
    setIntegrations((current) => [
      nextIntegration,
      ...current.filter((integration) => integration.id !== nextIntegration.id),
    ]);
    refreshSettingsData();
  }

  function removeIntegration(integrationId: string): void {
    setIntegrations((current) => current.filter((integration) => integration.id !== integrationId));
    refreshSettingsData();
  }

  return (
    <SettingsSectionShell meta={meta}>
      {shouldRenderSlackPanel ? (
        <SlackIntegrationSettingsPanel
          availableChannels={slackAvailableChannels}
          availableUsers={slackAvailableUsers}
          currentMembershipRole={currentMembershipRole}
          currentUserId={currentUserId}
          isPending={isPending}
          refreshSettingsData={refreshSettingsData}
          slackIntegrationCreationGuide={slackIntegrationCreationGuide}
          slackIntegrations={slackIntegrations}
          startTransition={startTransition}
          tx={tx}
        />
      ) : null}

      <IntegrationMetricGrid
        items={[
          {
            label: canManageIntegrations ? tx("用户绑定", "User Bindings") : tx("我的飞书绑定", "My Feishu Binding"),
            value: totalUserBindings,
          },
          ...(canManageIntegrations
            ? [
              {
                label: tx("会话映射", "Chat Mappings"),
                value: totalChannelBindings,
              },
              {
                label: tx("Docs / Sheets / Base", "Docs / Sheets / Base"),
                value: totalResourceBindings,
              },
              {
                label: tx("数据操作", "Data Operations"),
                value: totalOperationRuns,
              },
              {
                label: tx("出站失败", "Outbound Failures"),
                value: totalOutboxFailures,
              },
            ]
            : [
              {
                label: tx("可用集成", "Available Integrations"),
                value: integrations.filter((integration) => integration.status !== "disabled").length,
              },
            ]),
        ]}
      />

      {canManageIntegrations ? (
        <>
          <FeishuAgentBotsPanel
            availableAgents={availableAgents}
            integrations={integrations}
            isPending={isPending}
            onUpdated={mergeIntegration}
            setFeedback={setFeedback}
            startTransition={startTransition}
            tx={tx}
          />

          <FeishuCreateIntegrationDialog
            creationGuide={feishuIntegrationCreationGuide}
            isPending={isPending}
            onCreated={mergeIntegration}
            setFeedback={setFeedback}
            startTransition={startTransition}
            tx={tx}
          />
        </>
      ) : null}

      {feedback ? <p aria-live="polite" className="settings-feedback" role="status">{feedback}</p> : null}

      {canManageIntegrations ? (
        <FeishuHealthPanel
          integrations={integrations}
          isPending={isPending}
          onDeleted={removeIntegration}
          onUpdated={mergeIntegration}
          setFeedback={setFeedback}
          startTransition={startTransition}
          tx={tx}
        />
      ) : null}

      <FeishuUserBindingsPanel
        availableUsers={availableUsers}
        currentMembershipRole={currentMembershipRole}
        currentUserId={currentUserId}
        integrations={integrations}
        isPending={isPending}
        onUpdated={mergeIntegration}
        setFeedback={setFeedback}
        startTransition={startTransition}
        tx={tx}
      />

      {canManageIntegrations ? (
        <>
          <FeishuChannelBindingsPanel
            availableChannels={availableChannels}
            integrations={integrations}
            isPending={isPending}
            onUpdated={mergeIntegration}
            setFeedback={setFeedback}
            startTransition={startTransition}
            tx={tx}
          />

          <FeishuResourceBindingsPanel
            availableChannels={availableChannels}
            integrations={integrations}
            isPending={isPending}
            onUpdated={mergeIntegration}
            setFeedback={setFeedback}
            startTransition={startTransition}
            tx={tx}
          />

          <FeishuOperationRunsPanel integrations={integrations} tx={tx} />
        </>
      ) : null}
    </SettingsSectionShell>
  );
}
