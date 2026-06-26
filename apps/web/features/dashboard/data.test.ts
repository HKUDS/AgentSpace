import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import {
  completeQueuedTaskSync,
  createDaemonApiTokenSync,
  createExternalIntegrationSync,
  createUserSync,
  createWorkspaceSync,
  createWorkspaceMembershipSync,
  enqueueNativeTaskSync,
  getDatabase,
  listQueuedTasksSync,
  readWorkspaceStateRecordSync,
  readWorkspaceSync,
  recordTokenUsageSync,
  registerDaemonRuntimesSync,
  upsertBudgetSync,
  upsertExternalChannelBindingSync,
  upsertExternalResourceBindingSync,
  writeWorkspaceStateRecordSync,
} from "@agent-space/db";
import {
  bindEmployeeRuntimeSync,
  createChannelSync,
  createChannelDocumentFromAttachmentSync,
  createChannelDocumentSync,
  createEmployeeSync,
  createTaskSync,
  createKnowledgePageFromSharedDocumentSync,
  createWorkspaceSkillSync,
  grantRuntimeUseToUserForActorSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
  setEmployeeSkillIdsSync,
  writeWorkspaceStateSync,
} from "@agent-space/services";
import {
  getAgentsPageData,
  getAutomationsPageData,
  getBudgetPageData,
  getChannelDetailData,
  getChannelListPageData,
  getChannelsPageData,
  getCostPageData,
  getInboxPageData,
  getKnowledgePageData,
  getSkillsPageData,
  getTaskBoardPageData,
} from "./data.ts";
import { getWorkspaceShellData } from "./workspace-shell-data";

const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-dashboard-data-"));

beforeAll(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

afterAll(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  ensureTestWorkspace("default", "default", "Agent Space");
  ensureTestWorkspace("workspace-mars", "workspace-mars", "Mars Labs");
  clearWorkspaceScopedTestRows();
  resetWorkspaceStateSync();
  resetWorkspaceStateSync("workspace-mars");
});

function ensureTestWorkspace(id: string, slug: string, name: string): void {
  if (readWorkspaceSync(id)) {
    return;
  }
  createWorkspaceSync({
    id,
    slug,
    name,
    createdBy: "test",
  });
}

function clearWorkspaceScopedTestRows(): void {
  getDatabase().exec(`
    DELETE FROM external_thread_binding WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_data_operation_run WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_message_outbox WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_message_mapping WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_resource_binding WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_channel_binding WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_user_binding WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_integration_event WHERE workspace_id IN ('default', 'workspace-mars');
    DELETE FROM external_integration WHERE workspace_id IN ('default', 'workspace-mars');
  `);
  getDatabase()
    .prepare("DELETE FROM daemon_api_token WHERE workspace_id IN (?, ?)")
    .run("default", "workspace-mars");
}

function createAttachment(id: string, fileName: string, mediaType: string, content: string): MessageAttachment {
  const attachmentsDir = join(tempRoot, "data", "workspaces", "default", "attachments");
  mkdirSync(attachmentsDir, { recursive: true });
  const storedPath = join(attachmentsDir, `${id}-${basename(fileName.replace(/\\/g, "/"))}`);
  writeFileSync(storedPath, content, "utf8");
  return {
    id,
    fileName,
    mediaType,
    sizeBytes: Buffer.byteLength(content),
    kind: mediaType.startsWith("image/") ? "image" : "file",
    storedPath,
  };
}

describe("dashboard data", () => {
  it("builds shell human contacts from active workspace memberships", () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = createUserSync({
      displayName: `Tianyu ${suffix}`,
      primaryEmail: `tianyu-${suffix}@example.com`,
    });
    const member = createUserSync({
      displayName: `Tianyu_TW ${suffix}`,
      primaryEmail: `tianyu-tw-${suffix}@example.com`,
    });
    const workspaceId = `workspace-shell-${suffix}`;
    createWorkspaceSync({
      id: workspaceId,
      slug: workspaceId,
      name: "Shell Contacts",
      createdBy: owner.id,
    });
    createWorkspaceMembershipSync({
      workspaceId,
      userId: owner.id,
      role: "owner",
    });
    createWorkspaceMembershipSync({
      workspaceId,
      userId: member.id,
      role: "member",
    });
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(workspaceId),
      humanMembers: [{ name: owner.displayName, role: "Founder" }],
    }, workspaceId);

    const ownerShell = getWorkspaceShellData(owner.displayName, workspaceId, owner.id, "owner");
    const memberShell = getWorkspaceShellData(member.displayName, workspaceId, member.id, "member");

    expect(ownerShell.humanContacts.map((contact) => contact.name)).toEqual([member.displayName]);
    expect(memberShell.humanContacts.map((contact) => contact.name)).toEqual([owner.displayName]);
    expect(ownerShell.humanMembers).toBe(2);
    expect(ownerShell.channelMemberCandidates.map((candidate) => candidate.label)).toEqual([
      owner.displayName,
      member.displayName,
    ]);
  });

  it("prefers stored agent_skill assignments over stale employee.skillIds", () => {
  createEmployeeSync({ name: "Planner" });
  const skill = createWorkspaceSkillSync({
    name: "research-pack",
    description: "Research helper",
  });
  setEmployeeSkillIdsSync("Planner", [skill.id]);

  const persisted = readWorkspaceStateRecordSync();
  assert.ok(persisted);
  writeWorkspaceStateRecordSync({
    ...persisted!,
    activeEmployees: persisted!.activeEmployees.map((employee) =>
      employee.name === "Planner"
        ? {
            ...employee,
            skillIds: [],
          }
        : employee,
    ),
  });

  const skillsPage = getSkillsPageData();
  expect(skillsPage.assignedSkillCount).toBe(1);
  expect(
    skillsPage.agents.find((agent) => agent.internalName === "Planner")?.skillIds,
  ).toEqual([skill.id]);

  const agentsPage = getAgentsPageData();
  expect(agentsPage.workspaceSkills.some((item) => item.id === skill.id)).toBe(true);
  expect(
    agentsPage.agents.find((agent) => agent.internalName === "Planner")?.skills.map((item) => item.id),
  ).toEqual([skill.id]);
  });

  it("filters daemon snapshots and tokens by workspace", () => {
    registerDaemonRuntimesSync({
      daemonKey: "mars-box",
      deviceName: "Mars Box",
      workspaceId: "workspace-mars",
      runtimes: [
        {
          provider: "codex",
          name: "Mars Runtime",
          version: "1.0.0",
        },
      ],
    });
    createDaemonApiTokenSync({
      workspaceId: "workspace-mars",
      label: "Mars Token",
      createdBy: "tester",
    });

    const defaultAgentsPage = getAgentsPageData();
    expect(defaultAgentsPage.containerCount).toBe(0);
    expect(defaultAgentsPage.daemonSnapshots).toHaveLength(0);
    expect(defaultAgentsPage.daemonTokens).toHaveLength(0);

    const marsAgentsPage = getAgentsPageData("workspace-mars");
    expect(marsAgentsPage.containerCount).toBe(1);
    expect(marsAgentsPage.daemonSnapshots).toHaveLength(1);
    expect(marsAgentsPage.daemonSnapshots[0]?.daemonKey).toBe("mars-box");
    expect(marsAgentsPage.daemonTokens).toHaveLength(1);
    expect(marsAgentsPage.daemonTokens[0]?.label).toBe("Mars Token");
  });

  it("exposes provider usability separately from runtime online state", () => {
    createEmployeeSync({ name: "Claw Agent", remarkName: "Claw Agent" });
    const runtime = registerDaemonRuntimesSync({
      daemonKey: "health-box",
      deviceName: "Health Box",
      runtimes: [
        {
          provider: "openclaw",
          name: "OpenClaw Runtime",
          version: "1.0.0",
          metadata: {
            providerHealth: {
              status: "broken",
              reason: "Authentication failed.",
              checkedAt: "2026-04-30T08:00:00.000Z",
              error: {
                code: "provider.auth_invalid",
                message: "Token expired.",
              },
            },
          },
        },
      ],
    }).runtimes[0];

    expect(runtime?.id).toBeTruthy();
    bindEmployeeRuntimeSync("Claw Agent", runtime!.id);

    const agentsPage = getAgentsPageData();
    const container = agentsPage.containers.find((item) => item.runtimeId === runtime!.id);
    const agent = agentsPage.agents.find((item) => item.internalName === "Claw Agent");
    const option = agentsPage.containerOptions.find((item) => item.id === runtime!.id);
    const snapshotRuntime = agentsPage.daemonSnapshots[0]?.runtimes.find((item) => item.id === runtime!.id);

    expect(container?.status).toBe("linked");
    expect(container?.runtimeStatus).toBe("online");
    expect(container?.providerHealth).toMatchObject({
      providerHealth: "broken",
      providerUsable: "unusable",
      lastProviderErrorCode: "provider.auth_invalid",
      lastProviderErrorMessage: "Token expired.",
    });
    expect(agent?.boundContainerStatus).toBe("online");
    expect(agent?.boundProviderHealth?.providerUsable).toBe("unusable");
    expect(option?.providerHealth?.providerUsable).toBe("unusable");
    expect(snapshotRuntime?.providerHealth?.providerHealth).toBe("broken");
  });

  it("exposes conversation execution workspaces on channel inbox items and agent work areas", () => {
    createEmployeeSync({ name: "Planner", remarkName: "Planner" });
    createChannelSync({
      name: "travel",
      humanMemberNames: [],
      employeeNames: ["Planner"],
      kind: "group",
    });

    const runtime = registerDaemonRuntimesSync({
      daemonKey: "travel-box",
      deviceName: "Build Box 1",
      runtimes: [{ provider: "codex", name: "Remote Codex", version: "1.0.0" }],
    }).runtimes[0];

    expect(runtime?.id).toBeTruthy();
    bindEmployeeRuntimeSync("Planner", runtime!.id);

    const queued = enqueueNativeTaskSync({
      assignee: "Planner",
      title: "旅行计划",
      channel: "travel",
      priority: "medium",
      triggerType: "mention_chat",
      metadata: {
        channelName: "travel",
      },
    });

    expect(queued?.id).toBeTruthy();

    const state = readWorkspaceStateSync();
    state.messages.unshift({
      id: "message-travel-1",
      channel: "travel",
      speaker: "Planner",
      role: "agent",
      time: "10:00",
      summary: "我会继续处理。",
      status: "completed",
      kind: "message",
    });
    state.conversationExecutionWorkspaces = [
      {
        conversationKey: "channel:travel",
        conversationKind: "group",
        channelName: "travel",
        agentId: "Planner",
        updatedAt: "2026-04-28T00:00:00.000Z",
        lastTaskQueueId: queued!.id,
        sessionId: "sess-travel-1",
        workDir: "/tmp/travel-workdir",
        lastError: "上一次失败",
      },
    ];
    writeWorkspaceStateSync(state);

    const inboxPage = getInboxPageData();
    const channelItem = inboxPage.items.find((item) => item.id === "channel:travel");
    expect(channelItem?.execution?.sessionId).toBe("sess-travel-1");
    expect(channelItem?.execution?.workDir).toBe("/tmp/travel-workdir");
    expect(channelItem?.execution?.errorText).toBe("上一次失败");

    const agentsPage = getAgentsPageData();
    const planner = agentsPage.agents.find((agent) => agent.internalName === "Planner");
    expect(planner?.workAreas).toHaveLength(1);
    expect(planner?.workAreas[0]?.channel).toBe("travel");
    expect(planner?.workAreas[0]?.workDir).toBe("/tmp/travel-workdir");
    expect(planner?.workAreas[0]?.sessionId).toBe("sess-travel-1");
  });

  it("adds Feishu group binding summaries to channel page data for workspace managers", () => {
    createEmployeeSync({ name: "Codex", remarkName: "Codex" });
    createChannelSync({
      name: "launch",
      humanMemberNames: [],
      employeeNames: ["Codex"],
      kind: "group",
    });
    const integration = createExternalIntegrationSync({
      workspaceId: "default",
      provider: "feishu",
      displayName: "Codex Feishu Bot",
      transportMode: "websocket_worker",
      agentId: "Codex",
      appId: `cli_feishu_${Date.now()}`,
      encryptedCredentialsJson: {
        appSecret: "encrypted-secret",
      },
      configJson: {
        externalGuestPolicy: {
          unboundUserMode: "reply_on_mention",
          guestPermissionProfile: "channel_context_only",
          requireIdentityFor: ["writes", "approvals"],
        },
      },
      capabilitiesJson: {},
      scopesJson: ["im:message"],
    });
    upsertExternalChannelBindingSync({
      workspaceId: "default",
      integrationId: integration.id,
      channelName: "launch",
      externalChatId: "oc_launch_secret",
      externalChatType: "group",
      externalChatName: "Launch Room",
      syncMode: "mirror",
      metadataJson: {
        provisionSource: "bot_added",
        reviewStatus: "approved",
        agentId: "Codex",
        botBindingId: integration.id,
      },
    });
    upsertExternalResourceBindingSync({
      workspaceId: "default",
      integrationId: integration.id,
      providerResourceType: "doc",
      providerResourceToken: "doc_secret_token",
      agentSpaceResourceType: "channel_document",
      agentSpaceResourceId: "doc-1",
      channelName: "launch",
      displayName: "Launch Doc",
      permissionsJson: {
        canWrite: true,
        guestReadable: true,
      },
    });

    const channelsPage = getChannelsPageData("Tianyu");
    const launch = channelsPage.channels.find((channel) => channel.id === "launch");

    expect(launch?.feishu).toMatchObject({
      bindingCount: 1,
      externalChatName: "Launch Room",
      externalChatReference: expect.stringMatching(/^chat [0-9a-f]{8}$/),
      provisionSource: "bot_added",
      reviewStatus: "approved",
      connectedAgentBots: [
        {
          integrationId: integration.id,
          displayName: "Codex Feishu Bot",
          agentId: "Codex",
          status: "active",
          unboundUserMode: "reply_on_mention",
          guestPermissionProfile: "channel_context_only",
        },
      ],
      resourceBindings: [
        {
          integrationId: integration.id,
          integrationDisplayName: "Codex Feishu Bot",
          providerResourceType: "doc",
          displayName: "Launch Doc",
          canWrite: true,
          guestReadable: true,
          status: "active",
        },
      ],
    });
  });

  it("marks channel rows unread for the mentioned current human until they OK or reply", () => {
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      humanMembers: [
        { name: "Tianyu", role: "Founder" },
        { name: "Mina", role: "Operator" },
      ],
      channels: [
        {
          name: "ops",
          humanMemberNames: ["Tianyu", "Mina"],
          humanMembers: 2,
          employeeNames: [],
        },
      ],
      messages: [
        {
          id: "message-mention-mina",
          channel: "ops",
          speaker: "Tianyu",
          role: "human",
          time: "2026-04-30T09:00:00.000Z",
          summary: "@Mina 看一下这个安排",
          status: "completed",
          mentions: [
            {
              humanId: "Mina",
              label: "Mina",
              token: "Mina",
              mentionType: "human" as const,
              inChannel: true,
            },
          ],
        },
      ],
    });

    const minaInbox = getInboxPageData("default", {
      id: "",
      displayName: "Mina",
    });
    const minaInboxChannel = minaInbox.items.find((item) => item.id === "channel:ops");
    expect(minaInboxChannel?.unread).toBe(true);
    expect(minaInbox.unreadCount).toBe(1);

    const minaChannels = getChannelsPageData("Mina");
    expect(minaChannels.channels.find((channel) => channel.id === "ops")?.unread).toBe(true);

    const acknowledgedState = readWorkspaceStateSync();
    writeWorkspaceStateSync({
      ...acknowledgedState,
      messages: acknowledgedState.messages.map((message) =>
        message.id === "message-mention-mina"
          ? {
              ...message,
              acknowledgements: [
                {
                  label: "Mina",
                  acknowledgedAt: "2026-04-30T09:00:30.000Z",
                },
              ],
            }
          : message,
      ),
    });

    const acknowledgedInbox = getInboxPageData("default", {
      id: "",
      displayName: "Mina",
    });
    expect(acknowledgedInbox.items.find((item) => item.id === "channel:ops")?.unread).toBe(false);
    expect(getChannelsPageData("Mina").channels.find((channel) => channel.id === "ops")?.unread).toBe(false);

    const mentionedAgainState = readWorkspaceStateSync();
    writeWorkspaceStateSync({
      ...mentionedAgainState,
      messages: [
        {
          id: "message-mina-reply",
          channel: "ops",
          speaker: "Mina",
          role: "human",
          time: "2026-04-30T09:01:00.000Z",
          summary: "我看到了",
          status: "completed",
        },
        {
          id: "message-mention-mina-2",
          channel: "ops",
          speaker: "Tianyu",
          role: "human",
          time: "2026-04-30T09:00:45.000Z",
          summary: "@Mina 再确认一下",
          status: "completed",
          mentions: [
            {
              humanId: "Mina",
              label: "Mina",
              token: "Mina",
              mentionType: "human" as const,
              inChannel: true,
            },
          ],
        },
        ...mentionedAgainState.messages,
      ],
    });

    const repliedInbox = getInboxPageData("default", {
      id: "",
      displayName: "Mina",
    });
    expect(repliedInbox.items.find((item) => item.id === "channel:ops")?.unread).toBe(false);
    expect(getChannelsPageData("Mina").channels.find((channel) => channel.id === "ops")?.unread).toBe(false);
  });

  it("does not show unrelated direct-channel notifications to workspace owners", () => {
    const owner = createUserSync({
      displayName: "Tianyu",
      primaryEmail: `tianyu-direct-owner-${Date.now()}@example.com`,
    });
    const directMember = createUserSync({
      displayName: "Wu",
      primaryEmail: `wu-direct-member-${Date.now()}@example.com`,
    });
    createWorkspaceMembershipSync({
      workspaceId: "default",
      userId: owner.id,
      role: "owner",
    });
    createWorkspaceMembershipSync({
      workspaceId: "default",
      userId: directMember.id,
      role: "member",
    });

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [
        { name: owner.displayName, role: "Founder" },
        { name: directMember.displayName, role: "Member" },
      ],
      activeEmployees: [
        {
          name: "finance-analyst",
          role: "Finance",
          remarkName: "Finance Analyst",
          origin: "manual",
          summary: "Finance analyst",
          traits: [],
          fit: "Ready",
          skillIds: [],
          channels: ["direct-finance"],
          status: "active",
        },
      ],
      channels: [
        {
          name: "direct-finance",
          kind: "direct",
          humanMemberNames: [directMember.displayName],
          humanMembers: 1,
          employeeNames: ["finance-analyst"],
        },
        {
          name: "ops",
          kind: "group",
          humanMemberNames: [directMember.displayName],
          humanMembers: 1,
          employeeNames: ["finance-analyst"],
        },
      ],
      messages: [
        {
          id: "message-direct-private",
          channel: "direct-finance",
          speaker: "finance-analyst",
          role: "agent",
          time: "2026-05-01T09:00:00.000Z",
          summary: "private finance note",
          status: "completed",
        },
        {
          id: "message-group-manager-visible",
          channel: "ops",
          speaker: "finance-analyst",
          role: "agent",
          time: "2026-05-01T09:05:00.000Z",
          summary: "group ops note",
          status: "completed",
        },
      ],
      tasks: [
        {
          id: "task-direct-private",
          title: "Private direct task",
          channel: "direct-finance",
          assignee: "finance-analyst",
          priority: "medium",
          status: "todo",
        },
        {
          id: "task-group-visible",
          title: "Group visible task",
          channel: "ops",
          assignee: "finance-analyst",
          priority: "medium",
          status: "todo",
        },
      ],
      ledger: [
        {
          title: "Private direct activity",
          note: "private finance activity",
          data: { channel_name: "direct-finance" },
        },
        {
          title: "Group activity",
          note: "group ops activity",
          data: { channel_name: "ops" },
        },
      ],
    });

    const ownerInbox = getInboxPageData("default", {
      id: owner.id,
      displayName: owner.displayName,
      role: "owner",
    });
    expect(ownerInbox.items.map((item) => item.title)).not.toContain("direct-finance");
    expect(ownerInbox.items.map((item) => item.title)).not.toContain("Private direct task");
    expect(ownerInbox.items.map((item) => item.title)).not.toContain("Private direct activity");
    expect(ownerInbox.items.map((item) => item.title)).toContain("#ops");
    expect(ownerInbox.items.map((item) => item.title)).toContain("Group visible task");
    expect(ownerInbox.items.map((item) => item.title)).toContain("Group activity");

    const memberInbox = getInboxPageData("default", {
      id: directMember.id,
      displayName: directMember.displayName,
      role: "member",
    });
    expect(memberInbox.items.map((item) => item.channelName)).toContain("direct-finance");
  });

  it("shows a personal agent direct thread to the agent owner even without legacy human membership", () => {
    const owner = createUserSync({
      displayName: "Agent Owner",
      primaryEmail: `agent-owner-direct-${Date.now()}@example.com`,
    });
    createWorkspaceMembershipSync({
      workspaceId: "default",
      userId: owner.id,
      role: "member",
    });

    createEmployeeSync({
      name: "Owner Agent",
      remarkName: "Owner Agent",
      ownerUserId: owner.id,
      channelMemberAccess: "disabled",
    });
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      humanMembers: [{ name: owner.displayName, role: "Member" }],
      activeEmployees: readWorkspaceStateSync().activeEmployees.map((employee) =>
        employee.name === "Owner Agent"
          ? {
              ...employee,
              channels: ["direct-owner-agent"],
            }
          : employee,
      ),
      channels: [
        {
          name: "direct-owner-agent",
          kind: "direct",
          humanMemberNames: [],
          humanMembers: 0,
          employeeNames: ["Owner Agent"],
        },
      ],
      messages: [
        {
          id: "message-owner-agent-direct",
          channel: "direct-owner-agent",
          speaker: "Owner Agent",
          role: "agent",
          time: "2026-05-01T11:00:00.000Z",
          summary: "owner-visible direct note",
          status: "completed",
        },
      ],
    });

    const channelsPage = getChannelsPageData(owner.displayName, "default", owner.id, "member");
    expect(channelsPage.channels.find((channel) => channel.contactId === "Owner Agent")?.channelName)
      .toBe("direct-owner-agent");
    expect(channelsPage.threads.find((thread) => thread.channelName === "contact:Owner Agent")?.messages[0]?.summary)
      .toBe("owner-visible direct note");
  });

  it("limits runtime-granted member views to owned agents plus channel-enabled agents and redacts execution diagnostics", () => {
    const owner = createUserSync({
      displayName: "Owner",
      primaryEmail: `owner-${Date.now()}@example.com`,
    });
    const member = createUserSync({
      displayName: "Mina",
      primaryEmail: `mina-${Date.now()}@example.com`,
    });
    createWorkspaceMembershipSync({
      workspaceId: "default",
      userId: owner.id,
      role: "owner",
    });
    createWorkspaceMembershipSync({
      workspaceId: "default",
      userId: member.id,
      role: "member",
    });

    createEmployeeSync({ name: "Workspace Agent", remarkName: "Workspace Agent" });
    createEmployeeSync({
      name: "Restricted Agent",
      remarkName: "Restricted Agent",
      channelMemberAccess: "disabled",
    });
    createEmployeeSync({
      name: "Owner Shared Agent",
      remarkName: "Owner Shared Agent",
      ownerUserId: owner.id,
      channelMemberAccess: "enabled",
    });
    createEmployeeSync({
      name: "Mina Agent",
      remarkName: "Mina Agent",
      ownerUserId: member.id,
    });
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      humanMembers: [{ name: "Mina", role: "Member" }],
    });
    createChannelSync({
      name: "runtime-sharing-ops",
      humanMemberNames: ["Mina"],
      employeeNames: ["Workspace Agent", "Restricted Agent", "Owner Shared Agent", "Mina Agent"],
      kind: "group",
    });

    const runtime = registerDaemonRuntimesSync({
      daemonKey: "runtime-share-box",
      deviceName: "Runtime Share Box",
      runtimes: [{ provider: "codex", name: "Shared Codex", version: "1.0.0" }],
    }).runtimes[0];
    expect(runtime?.id).toBeTruthy();

    grantRuntimeUseToUserForActorSync({
      workspaceId: "default",
      runtimeId: runtime!.id,
      userId: member.id,
      actorUserId: owner.id,
    });
    bindEmployeeRuntimeSync("Mina Agent", runtime!.id);

    createTaskSync({
      title: "Workspace-only task",
      channel: "runtime-sharing-ops",
      assignee: "Workspace Agent",
      priority: "medium",
    });
    createTaskSync({
      title: "Restricted workspace task",
      channel: "runtime-sharing-ops",
      assignee: "Restricted Agent",
      priority: "medium",
    });
    createTaskSync({
      title: "Owner shared task",
      channel: "runtime-sharing-ops",
      assignee: "Owner Shared Agent",
      priority: "medium",
    });
    const stateAfterMemberTask = createTaskSync({
      title: "Member-owned task",
      channel: "runtime-sharing-ops",
      assignee: "Mina Agent",
      priority: "medium",
      requestedByUserId: member.id,
      requestedByDisplayName: "Mina",
    });
    const memberTask = stateAfterMemberTask.tasks.find((task) => task.title === "Member-owned task");
    expect(memberTask?.id).toBeTruthy();
    const queued = listQueuedTasksSync({ workspaceId: "default" }).find((task) => task.issueId === memberTask!.id);
    expect(queued?.id).toBeTruthy();
    completeQueuedTaskSync({
      taskId: queued!.id,
      sessionId: "sess-member-runtime",
      workDir: "/tmp/member-runtime-workdir",
    });

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      conversationExecutionWorkspaces: [
        {
          conversationKey: "channel:runtime-sharing-ops",
          conversationKind: "group",
          channelName: "runtime-sharing-ops",
          agentId: "Mina Agent",
          updatedAt: "2026-04-29T00:00:00.000Z",
          lastTaskQueueId: queued!.id,
          sessionId: "sess-member-runtime",
          workDir: "/tmp/member-runtime-workdir",
        },
      ],
    });

    const ownerAgentsPage = getAgentsPageData({
      workspaceId: "default",
      currentUserId: owner.id,
      currentMembershipRole: "owner",
    });
    expect(ownerAgentsPage.canManageRuntimes).toBe(true);
    expect(ownerAgentsPage.canConnectRuntimes).toBe(true);
    expect(ownerAgentsPage.containerOptions[0]?.daemonKey).toBe("runtime-share-box");
    expect(ownerAgentsPage.agents.map((agent) => agent.internalName).sort()).toEqual([
      "Mina Agent",
      "Owner Shared Agent",
      "Restricted Agent",
      "Workspace Agent",
    ]);
    expect(ownerAgentsPage.agents.find((agent) => agent.internalName === "Mina Agent")?.workAreas[0]?.workDir).toBe("/tmp/member-runtime-workdir");

    const memberAgentsPage = getAgentsPageData({
      workspaceId: "default",
      currentUserId: member.id,
      currentMembershipRole: "member",
    });
    expect(memberAgentsPage.canManageRuntimes).toBe(false);
    expect(memberAgentsPage.canConnectRuntimes).toBe(true);
    expect(memberAgentsPage.daemonSnapshots).toEqual([]);
    expect(memberAgentsPage.daemonTokens).toEqual([]);
    expect(memberAgentsPage.containerOptions).toMatchObject([
      {
        id: runtime!.id,
        daemonKey: "",
      },
    ]);
    expect(memberAgentsPage.agents.map((agent) => agent.internalName)).toEqual(["Mina Agent"]);
    const memberAgent = memberAgentsPage.agents[0];
    expect(memberAgent?.ownerDisplayName).toBe("Mina");
    expect(memberAgent?.canManageChannelMemberAccess).toBe(true);
    expect(memberAgent?.workAreas[0]?.sessionId).toBeUndefined();
    expect(memberAgent?.workAreas[0]?.workDir).toBeUndefined();
    expect(memberAgent?.workAreas[0]?.workDirHostLabel).toBeUndefined();

    const memberChannelsPage = getChannelsPageData("Mina", "default", member.id, "member");
    expect(
      memberChannelsPage.mentionCandidates
        .filter((candidate) => candidate.kind === "agent")
        .map((candidate) => candidate.label)
        .sort(),
    ).toEqual(["Mina Agent", "Owner Shared Agent", "Workspace Agent"]);

    const memberInbox = getInboxPageData("default", {
      id: member.id,
      displayName: "Mina",
      role: "member",
    });
    expect(memberInbox.items.some((item) => item.title === "Workspace-only task")).toBe(true);
    expect(memberInbox.items.some((item) => item.title === "Owner shared task")).toBe(true);
    expect(memberInbox.items.some((item) => item.title === "Restricted workspace task")).toBe(false);
    const memberTaskItem = memberInbox.items.find((item) => item.title === "Member-owned task");
    expect(memberTaskItem?.execution?.sessionId).toBeUndefined();
    expect(memberTaskItem?.execution?.workDir).toBeUndefined();
    expect(memberTaskItem?.execution?.workDirHostLabel).toBeUndefined();

    const memberShell = getWorkspaceShellData("Mina", "default", member.id, "member");
    expect(memberShell.directMessages.map((item) => item.id)).toEqual([runtime!.id]);
    expect(memberShell.remoteAgentCount).toBe(1);

    const memberTaskBoard = getTaskBoardPageData("status", "default", {
      id: member.id,
      displayName: "Mina",
      role: "member",
    });
    expect(memberTaskBoard.tasks.map((task) => task.title).sort()).toEqual([
      "Member-owned task",
      "Owner shared task",
      "Workspace-only task",
    ]);
  });

  it("filters cost summaries and budgets by workspace", () => {
    createEmployeeSync({ name: "Planner", remarkName: "Default Planner" });
    createEmployeeSync({ name: "Planner", remarkName: "Mars Planner" }, "workspace-mars");

    const defaultRuntime = registerDaemonRuntimesSync({
      daemonKey: "default-box",
      deviceName: "Default Box",
      runtimes: [{ provider: "codex", name: "Default Runtime", version: "1.0.0" }],
    }).runtimes[0];
    const marsRuntime = registerDaemonRuntimesSync({
      workspaceId: "workspace-mars",
      daemonKey: "mars-box",
      deviceName: "Mars Box",
      runtimes: [{ provider: "codex", name: "Mars Runtime", version: "1.0.0" }],
    }).runtimes[0];

    expect(defaultRuntime?.id).toBeTruthy();
    expect(marsRuntime?.id).toBeTruthy();

    bindEmployeeRuntimeSync("Planner", defaultRuntime!.id);
    bindEmployeeRuntimeSync("Planner", marsRuntime!.id, "workspace-mars");

    const defaultTask = enqueueNativeTaskSync({
      assignee: "Planner",
      title: "Default task",
      priority: "medium",
    });
    const marsTask = enqueueNativeTaskSync({
      workspaceId: "workspace-mars",
      assignee: "Planner",
      title: "Mars task",
      priority: "medium",
    });

    expect(defaultTask?.id).toBeTruthy();
    expect(marsTask?.id).toBeTruthy();

    recordTokenUsageSync({
      taskQueueId: defaultTask!.id,
      agentId: "Planner",
      modelId: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      channelName: "default-ops",
    });
    recordTokenUsageSync({
      taskQueueId: marsTask!.id,
      agentId: "Planner",
      modelId: "gpt-4o",
      inputTokens: 4000,
      outputTokens: 1000,
      channelName: "mars-ops",
      workspaceId: "workspace-mars",
    });

    upsertBudgetSync({
      workspaceId: "default",
      scope: "workspace",
      scopeId: "ignored-default",
      limitUsd: 10,
      period: "monthly",
      action: "warn",
      warningThreshold: 0.5,
    });
    upsertBudgetSync({
      workspaceId: "workspace-mars",
      scope: "workspace",
      scopeId: "ignored-mars",
      limitUsd: 20,
      period: "monthly",
      action: "pause",
      warningThreshold: 0.5,
    });

    const defaultCosts = getCostPageData("monthly", "default");
    const marsCosts = getCostPageData("monthly", "workspace-mars");
    const defaultBudgets = getBudgetPageData("default");
    const marsBudgets = getBudgetPageData("workspace-mars");

    expect(defaultCosts.agents).toHaveLength(1);
    expect(defaultCosts.agents[0]?.displayName).toBe("Default Planner");
    expect(defaultCosts.recentUsage[0]?.channelName).toBe("default-ops");

    expect(marsCosts.agents).toHaveLength(1);
    expect(marsCosts.agents[0]?.displayName).toBe("Mars Planner");
    expect(marsCosts.recentUsage[0]?.channelName).toBe("mars-ops");
    expect(marsCosts.totalCostUsd).toBeGreaterThan(defaultCosts.totalCostUsd);

    expect(defaultBudgets.budgets).toHaveLength(1);
    expect(defaultBudgets.budgets[0]?.limitUsd).toBe(10);
    expect(marsBudgets.budgets).toHaveLength(1);
    expect(marsBudgets.budgets[0]?.limitUsd).toBe(20);
    expect(marsBudgets.budgets[0]?.spentUsd).toBeGreaterThan(defaultBudgets.budgets[0]?.spentUsd ?? 0);
  });

  it("lists active employees in direct view before any direct channel exists", () => {
    createEmployeeSync({
      name: "Atlas",
      remarkName: "Atlas",
      summary: "Planning agent",
    });

    const channelsPage = getChannelsPageData("Tianyu");
    const directContact = channelsPage.channels.find((channel) => channel.contactId === "Atlas");

    expect(directContact).toMatchObject({
      id: "contact:Atlas",
      contactId: "Atlas",
      kind: "direct",
      displayName: "Atlas",
    });
    expect(directContact?.channelName).toBeUndefined();
    expect(
      channelsPage.threads.find((thread) => thread.channelName === "contact:Atlas")?.messages,
    ).toEqual([]);
    expect(channelsPage.channelMemberCandidates?.find((candidate) => candidate.id === "Atlas")).toMatchObject({
      label: "Atlas",
      kind: "agent",
      meta: "Atlas",
    });
  });

  it("includes channel document runs in automations page data", () => {
    const now = "2026-04-29T10:00:00.000Z";
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      channels: [
        {
          name: "planning",
          humanMembers: 1,
          humanMemberNames: ["Tianyu"],
          employeeNames: ["Atlas", "Nova"],
        },
      ],
      channelDocumentRuns: [
        {
          id: "run-planning-1",
          channelName: "planning",
          sourceMessageId: "msg-1",
          sourceSummary: "@Atlas 先整理计划，然后 @Nova 继续完善",
          mode: "sequential",
          status: "running",
          createdAt: now,
          updatedAt: now,
        },
      ],
      channelDocumentRunSteps: [
        {
          id: "run-step-1",
          runId: "run-planning-1",
          agentId: "Atlas",
          agentLabel: "Atlas",
          instruction: "@Atlas 先整理计划",
          dependsOnStepIds: [],
          handoffKind: "document",
          status: "completed",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "run-step-2",
          runId: "run-planning-1",
          agentId: "Nova",
          agentLabel: "Nova",
          instruction: "@Nova 继续完善",
          dependsOnStepIds: ["run-step-1"],
          handoffKind: "document",
          status: "running",
          createdAt: "2026-04-29T10:01:00.000Z",
          updatedAt: "2026-04-29T10:01:00.000Z",
        },
      ],
    });

    const automationsPage = getAutomationsPageData();

    expect(automationsPage.totalCount).toBe(2);
    expect(automationsPage.enabledCount).toBe(2);
    expect(automationsPage.documentRunCount).toBe(1);
    expect(automationsPage.documentRuns[0]).toMatchObject({
      id: "run-planning-1",
      channelName: "planning",
      sourceSummary: "@Atlas 先整理计划，然后 @Nova 继续完善",
      status: "running",
    });
    expect(automationsPage.documentRuns[0]?.steps.map((step) => step.agentLabel)).toEqual(["Atlas", "Nova"]);
  });

  it("includes auto continuation runs in automations page data", () => {
    const now = "2026-04-29T10:00:00.000Z";
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      conversationExecutionWorkspaces: [
        {
          conversationKey: "group:planning:Atlas",
          conversationKind: "group",
          channelName: "planning",
          agentId: "Atlas",
          updatedAt: now,
          lastTaskQueueId: "queue-auto-1",
          sessionId: "session-auto",
          workDir: "/tmp/auto-work",
          autoContinuation: {
            mode: "until",
            status: "active",
            startedAt: now,
            until: "2026-04-29T22:00:00.000Z",
            instruction: "继续往下收尾",
            iteration: 2,
            lastContinuedAt: "2026-04-29T10:30:00.000Z",
          },
        },
      ],
    });

    const automationsPage = getAutomationsPageData();

    expect(automationsPage.totalCount).toBe(2);
    expect(automationsPage.enabledCount).toBe(2);
    expect(automationsPage.autoContinuationRunCount).toBe(1);
    expect(automationsPage.autoContinuationRuns[0]).toMatchObject({
      channelName: "planning",
      agentId: "Atlas",
      status: "active",
      instruction: "继续往下收尾",
      iteration: 2,
      until: "2026-04-29T22:00:00.000Z",
    });
  });

  it("hides channel documents when the current user lacks document access even if the channel is visible", () => {
    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [{ name: "Tianyu", role: "Founder" }],
      channels: [
        {
          name: "tour visit",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
      ],
    });

    const created = createChannelDocumentSync({
      channelName: "tour visit",
      title: "Restricted plan",
      contentMarkdown: "hidden plan",
      createdBy: "Tianyu",
      createdByType: "human",
      triggerType: "manual",
    });

    const state = readWorkspaceStateSync();
    writeWorkspaceStateSync({
      ...state,
      humanMembers: [
        ...state.humanMembers,
        { name: "Mina", role: "Operator" },
      ],
      channels: state.channels.map((channel) =>
        channel.name === "tour visit"
          ? {
              ...channel,
              humanMemberNames: ["Tianyu", "Mina"],
              humanMembers: 2,
            }
          : channel,
      ),
    });

    const channelsPage = getChannelsPageData("Mina");
    expect(channelsPage.documents).toEqual([]);
    expect(channelsPage.documentConflicts).toEqual([]);
    expect(channelsPage.documentRuns.every((run) => run.steps.every((step) => !step.documentId || step.documentId !== created.document.id))).toBe(true);
  });

  it("builds knowledge document pages from shared attachments and visible shared documents", () => {
    const attachment = createAttachment(
      "att-itinerary",
      "shared/itinerary.md",
      "text/markdown",
      "# Osaka Trip\n\nDay 1",
    );

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [
        { name: "Tianyu", role: "Founder" },
      ],
      channels: [
        {
          name: "tour visit",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
      ],
      messages: [
        {
          id: "message-1",
          channel: "tour visit",
          speaker: "Tianyu",
          role: "human",
          time: "2026-04-18T09:00:00.000Z",
          summary: "Shared itinerary",
          status: "completed",
          attachments: [attachment],
        },
      ],
    });

    const created = createChannelDocumentFromAttachmentSync({
      channelName: "tour visit",
      attachmentId: attachment.id,
      title: "Trip notes",
      createdBy: "Tianyu",
      createdByType: "human",
    });

    createKnowledgePageFromSharedDocumentSync({
      sourceType: "attachment",
      sourceId: attachment.id,
      createdBy: "Tianyu",
      createdByType: "human",
    });
    createKnowledgePageFromSharedDocumentSync({
      sourceType: "channelDocument",
      sourceId: created.document.id,
      createdBy: "Tianyu",
      createdByType: "human",
    });

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      humanMembers: [
        { name: "Tianyu", role: "Founder" },
        { name: "Mina", role: "Operator" },
      ],
      channels: [
        {
          name: "tour visit",
          humanMemberNames: ["Tianyu", "Mina"],
          humanMembers: 2,
          employeeNames: [],
        },
      ],
    });

    const tianyuKnowledge = getKnowledgePageData("Tianyu");
    const attachmentDocument = tianyuKnowledge.documentPages.find(
      (document) => document.sourceType === "attachment" && document.sourceId === attachment.id,
    );
    const sharedDocument = tianyuKnowledge.documentPages.find(
      (document) => document.sourceType === "channelDocument" && document.sourceId === created.document.id,
    );

    expect(attachmentDocument?.linkedKnowledgePages.map((page) => page.title)).toContain("itinerary");
    expect(attachmentDocument?.linkedChannelDocuments.map((document) => document.title)).toContain("Trip notes");
    expect(attachmentDocument?.previewText).toBe("# Osaka Trip\n\nDay 1");
    expect(sharedDocument?.linkedKnowledgePages.map((page) => page.title)).toContain("Trip notes");
    expect(sharedDocument?.sourceAttachmentId).toBe(attachment.id);
    expect(tianyuKnowledge.linkedDocumentCount).toBe(2);

    const minaKnowledge = getKnowledgePageData("Mina");
    expect(
      minaKnowledge.documentPages.some((document) => document.sourceType === "attachment" && document.sourceId === attachment.id),
    ).toBe(true);
    expect(
      minaKnowledge.documentPages.some((document) => document.sourceType === "channelDocument" && document.sourceId === created.document.id),
    ).toBe(false);
  });

  it("hides soft-deleted attachments from channel file records", () => {
    const activeAttachment = createAttachment("att-active", "shared/active.md", "text/markdown", "# Active");
    const deletedAttachment = {
      ...createAttachment("att-deleted", "shared/deleted.md", "text/markdown", "# Deleted"),
      deletedAt: "2026-05-01T00:00:00.000Z",
      deletedByUserId: "user-1",
      deletedByDisplayName: "Tianyu",
    };

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [
        { name: "Tianyu", role: "Founder" },
      ],
      channels: [
        {
          name: "tour visit",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
      ],
      messages: [
        {
          id: "message-1",
          channel: "tour visit",
          speaker: "Tianyu",
          role: "human",
          time: "2026-05-01T09:00:00.000Z",
          summary: "Shared files",
          status: "completed",
          attachments: [activeAttachment, deletedAttachment],
        },
      ],
    });

    const channelsPage = getChannelsPageData("Tianyu");

    expect(channelsPage.channelFiles.map((file) => file.id)).toEqual(["att-active"]);
  });

  it("limits split channel detail payloads while preserving conversation list summaries", () => {
    const planningAttachment = createAttachment("att-planning", "shared/planning.md", "text/markdown", "# Planning");
    const randomAttachment = createAttachment("att-random", "shared/random.md", "text/markdown", "# Random");

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [{ name: "Tianyu", role: "Founder" }],
      channels: [
        {
          name: "planning",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
        {
          name: "random",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
      ],
      messages: [
        {
          id: "message-planning",
          channel: "planning",
          speaker: "Tianyu",
          role: "human",
          time: "2026-05-01T09:00:00.000Z",
          summary: "Planning detail",
          status: "completed",
          attachments: [planningAttachment],
        },
        {
          id: "message-random",
          channel: "random",
          speaker: "Tianyu",
          role: "human",
          time: "2026-05-01T09:01:00.000Z",
          summary: "Random summary",
          status: "completed",
          attachments: [randomAttachment],
        },
      ],
    });

    createChannelDocumentSync({
      channelName: "planning",
      title: "Planning doc",
      contentMarkdown: "visible detail",
      createdBy: "Tianyu",
      createdByType: "human",
      triggerType: "manual",
    });
    createChannelDocumentSync({
      channelName: "random",
      title: "Random doc",
      contentMarkdown: "withheld detail",
      createdBy: "Tianyu",
      createdByType: "human",
      triggerType: "manual",
    });

    const channelsPage = getChannelsPageData("Tianyu", "default", undefined, undefined, {
      detailChannelNames: ["planning"],
    });

    expect(channelsPage.detailScope).toEqual(["planning"]);
    expect(channelsPage.channels.find((channel) => channel.id === "random")?.lastMessage).toBeTruthy();
    const planningMessages = channelsPage.threads.find((thread) => thread.channelName === "planning")?.messages ?? [];
    expect(planningMessages.map((message) => message.id)).toContain("message-planning");
    expect(planningMessages.every((message) => message.channel === "planning")).toBe(true);
    expect(channelsPage.threads.find((thread) => thread.channelName === "random")?.messages).toEqual([]);
    expect(channelsPage.documents.map((document) => document.channelName)).toEqual(["planning"]);
    expect(channelsPage.channelFiles.map((file) => file.id)).toEqual(["att-planning"]);
  });

  it("exposes split list and detail contracts for IM without loading every channel detail", () => {
    const planningAttachment = createAttachment("att-contract-planning", "shared/planning-contract.md", "text/markdown", "# Planning");
    const randomAttachment = createAttachment("att-contract-random", "shared/random-contract.md", "text/markdown", "# Random");

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [{ name: "Tianyu", role: "Founder" }],
      channels: [
        {
          name: "planning",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
        {
          name: "random",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
      ],
      messages: [
        {
          id: "message-planning-contract",
          channel: "planning",
          speaker: "Tianyu",
          role: "human",
          time: "2026-05-01T09:00:00.000Z",
          summary: "Planning detail",
          status: "completed",
          attachments: [planningAttachment],
        },
        {
          id: "message-random-contract",
          channel: "random",
          speaker: "Tianyu",
          role: "human",
          time: "2026-05-01T09:01:00.000Z",
          summary: "Random summary",
          status: "completed",
          attachments: [randomAttachment],
        },
      ],
    });

    createChannelDocumentSync({
      channelName: "planning",
      title: "Planning doc",
      contentMarkdown: "visible detail",
      createdBy: "Tianyu",
      createdByType: "human",
      triggerType: "manual",
    });
    createChannelDocumentSync({
      channelName: "random",
      title: "Random doc",
      contentMarkdown: "withheld detail",
      createdBy: "Tianyu",
      createdByType: "human",
      triggerType: "manual",
    });

    const listPage = getChannelListPageData("Tianyu", "default", undefined, undefined, {
      initialDetailChannelNames: ["planning"],
    });
    const randomDetail = getChannelDetailData({
      channelName: "random",
      currentUserDisplayName: "Tianyu",
      workspaceId: "default",
    });

    expect(listPage.detailScope).toEqual(["planning"]);
    expect(listPage.channels.map((channel) => channel.id).sort()).toEqual(["planning", "random"]);
    expect(listPage.channels.find((channel) => channel.id === "random")?.lastMessage).toBeTruthy();
    expect(listPage.threads.find((thread) => thread.channelName === "planning")?.messages.map((message) => message.id)).toContain(
      "message-planning-contract",
    );
    expect(listPage.threads.find((thread) => thread.channelName === "random")?.messages).toEqual([]);
    expect(listPage.documents.map((document) => document.channelName)).toEqual(["planning"]);
    expect(listPage.channelFiles.map((file) => file.id)).toEqual(["att-contract-planning"]);

    expect(randomDetail.detailScope).toEqual(["random"]);
    expect(randomDetail.threads.map((thread) => thread.channelName)).toEqual(["random"]);
    expect(randomDetail.threads[0]?.messages.every((message) => message.channel === "random")).toBe(true);
    expect(randomDetail.threads[0]?.messages.map((message) => message.id)).toContain("message-random-contract");
    expect(randomDetail.documents.map((document) => document.channelName)).toEqual(["random"]);
    expect(randomDetail.channelFiles.map((file) => file.id)).toEqual(["att-contract-random"]);
  });

  it("keeps attachment-backed document pages visible after the source message is removed when knowledge or shared docs still reference them", () => {
    const attachment = createAttachment(
      "att-orphaned",
      "shared/orphaned.md",
      "text/markdown",
      "# Preserved",
    );

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      organizationName: "Northstar Labs",
      humanMembers: [{ name: "Tianyu", role: "Founder" }],
      channels: [
        {
          name: "tour visit",
          humanMemberNames: ["Tianyu"],
          humanMembers: 1,
          employeeNames: [],
        },
      ],
      messages: [
        {
          id: "message-1",
          channel: "tour visit",
          speaker: "Tianyu",
          role: "human",
          time: "2026-04-18T09:00:00.000Z",
          summary: "Shared orphaned file",
          status: "completed",
          attachments: [attachment],
        },
      ],
    });

    createKnowledgePageFromSharedDocumentSync({
      sourceType: "attachment",
      sourceId: attachment.id,
      createdBy: "Tianyu",
      createdByType: "human",
    });
    createChannelDocumentFromAttachmentSync({
      channelName: "tour visit",
      attachmentId: attachment.id,
      createdBy: "Tianyu",
      createdByType: "human",
    });

    writeWorkspaceStateSync({
      ...readWorkspaceStateSync(),
      messages: [],
    });

    const knowledgeData = getKnowledgePageData("Tianyu");
    const preservedDocument = knowledgeData.documentPages.find(
      (document) => document.sourceType === "attachment" && document.sourceId === attachment.id,
    );

    expect(preservedDocument).toMatchObject({
      title: "orphaned.md",
      isMarkdown: true,
      previewText: "# Preserved",
    });
    expect(preservedDocument?.linkedKnowledgePages.length).toBe(1);
    expect(preservedDocument?.linkedChannelDocuments.length).toBe(1);
  });
});
