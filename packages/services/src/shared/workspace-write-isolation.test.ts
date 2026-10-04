import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { before, beforeEach } from "node:test";
import {
  listStoredChannelsSync,
  getDatabase,
  readWorkspaceStateRecordSync,
  WorkspaceStateConflictError,
  listStoredAgentKnowledgePageAssignmentsSync,
  listStoredAgentSkillAssignmentsSync,
  listStoredKnowledgeAssignmentPoliciesSync,
  listStoredWorkspaceSkillsSync,
  readEmployeeRuntimeBindingSync,
  registerDaemonRuntimesSync,
} from "@agent-space/db";
import {
  createApprovalRequestSync,
  createAutomationRuleSync,
  createChannelDocumentSync,
  bindEmployeeRuntimeSync,
  createEmployeeSync,
  createKnowledgePageSync,
  createScheduledTaskSync,
  createTaskSync,
  createDataTableSync,
  exportChannelDocumentAsAttachmentSync,
  createTemplateSync,
  createWorkspaceSkillSync,
  listEmployeeKnowledgePageIdsSync,
  readWorkspaceStateSync,
  resetWorkspaceStateSync,
  sendChannelHumanMessageSync,
  sendContactMessageForHumanWithAttachmentsSync,
  setKnowledgePageAssignedEmployeesSync,
  setKnowledgePageAssignmentModeSync,
  setEmployeeSkillIdsSync,
  updateEmployeeRemarkNameSync,
  writeWorkspaceStateSync,
} from "../index.ts";

const originalCwd = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "agent-space-workspace-write-isolation-"));
const WORKSPACE_ID = "workspace-mars";

before(() => {
  writeFileSync(join(tempRoot, "Target.md"), "# test\n");
  mkdirSync(join(tempRoot, "data"), { recursive: true });
  process.chdir(tempRoot);
});

beforeEach(() => {
  rmSync(join(tempRoot, "data", "workspaces"), { recursive: true, force: true });
  seedWorkspace("default", "Northstar Labs", "north-ops");
  seedWorkspace(WORKSPACE_ID, "Mars Labs", "mars-ops");
});

test("a stale workspace write cannot replace relational rows before its version check", () => {
  const stale = readWorkspaceStateSync(WORKSPACE_ID);
  const current = readWorkspaceStateSync(WORKSPACE_ID);
  current.channels.push({ name: "new-channel", humanMembers: 1, employeeNames: [] });
  writeWorkspaceStateSync(current, WORKSPACE_ID);

  assert.throws(() => writeWorkspaceStateSync(stale, WORKSPACE_ID), WorkspaceStateConflictError);
  assert.ok(listStoredChannelsSync(WORKSPACE_ID).some((channel) => channel.name === "new-channel"));
  assert.ok(readWorkspaceStateSync(WORKSPACE_ID).channels.some((channel) => channel.name === "new-channel"));
});

test("a failed relational write rolls back the snapshot and earlier table changes", () => {
  const state = readWorkspaceStateSync(WORKSPACE_ID);
  state.organizationName = "Pending update";
  state.channels.push({ name: "pending-channel", humanMembers: 1, employeeNames: [] });
  const db = getDatabase();
  const originalPrepare = db.prepare;
  db.prepare = (sql) => {
    if (sql.startsWith("DELETE FROM attachment")) {
      throw new Error("simulated attachment write failure");
    }
    return originalPrepare(sql);
  };
  try {
    assert.throws(() => writeWorkspaceStateSync(state, WORKSPACE_ID), /simulated attachment write failure/);
  } finally {
    db.prepare = originalPrepare;
  }
  assert.equal(readWorkspaceStateRecordSync(WORKSPACE_ID)?.organizationName, "Mars Labs");
  assert.equal(listStoredChannelsSync(WORKSPACE_ID).some((channel) => channel.name === "pending-channel"), false);
  assert.equal(writeWorkspaceStateSync(state, WORKSPACE_ID).organizationName, "Pending update");
});

test("channel, contact, and task writes stay inside the target workspace", () => {
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    summary: "Mars workspace planner",
  }, WORKSPACE_ID);
  attachEmployeeToChannel(WORKSPACE_ID, "Atlas", "mars-ops");

  sendChannelHumanMessageSync("mars-ops", "Mina", "Mars update", undefined, undefined, WORKSPACE_ID);
  sendContactMessageForHumanWithAttachmentsSync("Mina", "Atlas", "Private ping", undefined, WORKSPACE_ID);
  createTaskSync({
    title: "Inspect Mars queue",
    channel: "mars-ops",
    assignee: "Atlas",
    priority: "medium",
  }, WORKSPACE_ID);

  const defaultState = readWorkspaceStateSync();
  const marsState = readWorkspaceStateSync(WORKSPACE_ID);

  assert.equal(defaultState.messages.length, 0);
  assert.equal(defaultState.directConversations.length, 0);
  assert.equal(defaultState.tasks.length, 0);

  assert.ok(marsState.messages.some((message) => message.summary === "Mars update"));
  assert.ok(marsState.channels.some((channel) => channel.kind === "direct" && channel.employeeNames.includes("Atlas")));
  assert.equal(marsState.tasks[0]?.title, "Inspect Mars queue");

  const workspaceHistoryPath = join(
    tempRoot,
    "data",
    "workspaces",
    WORKSPACE_ID,
    "channel-history",
    "mars-ops.md",
  );
  const defaultHistoryPath = join(
    tempRoot,
    "data",
    "workspaces",
    "default",
    "channel-history",
    "mars-ops.md",
  );
  assert.equal(existsSync(workspaceHistoryPath), true);
  assert.equal(existsSync(defaultHistoryPath), false);
});

test("channel document creation and export stay inside the target workspace", () => {
  const created = createChannelDocumentSync({
    channelName: "mars-ops",
    title: "Mars plan",
    contentMarkdown: "# Mars\n\nPlan",
    createdBy: "Mina",
    createdByType: "human",
  }, WORKSPACE_ID);

  exportChannelDocumentAsAttachmentSync({
    documentId: created.document.id,
    exportedBy: "Mina",
  }, WORKSPACE_ID);

  const defaultState = readWorkspaceStateSync();
  const marsState = readWorkspaceStateSync(WORKSPACE_ID);

  assert.equal(defaultState.channelDocuments.length, 0);
  assert.equal(defaultState.messages.length, 0);
  assert.equal(marsState.channelDocuments[0]?.title, "Mars plan");
  assert.ok(
    marsState.messages[0]?.attachments?.[0]?.storedPath.includes(join("workspaces", WORKSPACE_ID, "attachments")),
  );
});

test("approval, automation, schedule, knowledge, table, and template writes stay inside the target workspace", () => {
  createEmployeeSync({
    name: "Atlas",
    role: "Planner",
    summary: "Mars workspace planner",
  }, WORKSPACE_ID);
  attachEmployeeToChannel(WORKSPACE_ID, "Atlas", "mars-ops");

  createApprovalRequestSync({
    type: "message_draft",
    sourceId: "draft-1",
    agentId: "Atlas",
    channelName: "mars-ops",
    contentPreview: "Need approval",
  }, WORKSPACE_ID);
  createAutomationRuleSync({
    name: "mars-automation",
    trigger: { type: "channel_message" },
    actions: [{ type: "create_task", config: { assignee: "Atlas" } }],
  }, WORKSPACE_ID);
  createScheduledTaskSync({
    title: "Mars standup",
    repeat: "daily",
    scheduledAt: "2026-04-23T09:00:00.000Z",
  }, WORKSPACE_ID);
  createKnowledgePageSync({
    title: "Mars handbook",
    contentMarkdown: "Hello Mars",
  }, WORKSPACE_ID);
  createDataTableSync({
    name: "Mars table",
    columns: [{ name: "Name", type: "text" }],
  }, WORKSPACE_ID);
  createTemplateSync({
    category: "task",
    name: "Mars template",
    configJson: "{\"steps\":[]}",
  }, WORKSPACE_ID);

  const defaultState = readWorkspaceStateSync();
  const marsState = readWorkspaceStateSync(WORKSPACE_ID);

  assert.equal(defaultState.approvals.length, 0);
  assert.equal(defaultState.automationRules.length, 0);
  assert.equal(defaultState.scheduledTasks.length, 0);
  assert.equal(defaultState.knowledgePages.length, 0);
  assert.equal(defaultState.dataTables.length, 0);
  assert.equal(defaultState.templates.length, 0);

  assert.equal(marsState.approvals[0]?.sourceId, "draft-1");
  assert.equal(marsState.automationRules[0]?.name, "mars-automation");
  assert.equal(marsState.scheduledTasks[0]?.title, "Mars standup");
  assert.equal(marsState.knowledgePages[0]?.title, "Mars handbook");
  assert.equal(marsState.dataTables[0]?.name, "Mars table");
  assert.equal(marsState.templates[0]?.name, "Mars template");
});

test("skill assignments and runtime bindings stay inside the target workspace", () => {
  createEmployeeSync({ name: "Planner" }, WORKSPACE_ID);
  const skill = createWorkspaceSkillSync({
    name: "research-pack",
    description: "Mars research helper",
  }, WORKSPACE_ID);
  setEmployeeSkillIdsSync("Planner", [skill.id], WORKSPACE_ID);

  const runtimeSnapshot = registerDaemonRuntimesSync({
    workspaceId: WORKSPACE_ID,
    daemonKey: "mars-box",
    deviceName: "Mars Box",
    runtimes: [{ provider: "codex", name: "Mars Runtime" }],
  });
  const runtimeId = runtimeSnapshot.runtimes[0]?.id;
  assert.ok(runtimeId);

  bindEmployeeRuntimeSync("Planner", runtimeId!, WORKSPACE_ID);

  assert.equal(
    listStoredWorkspaceSkillsSync(WORKSPACE_ID).some((item) => item.id === skill.id),
    true,
  );
  assert.equal(
    listStoredWorkspaceSkillsSync().some((item) => item.id === skill.id),
    false,
  );
  assert.equal(
    listStoredAgentSkillAssignmentsSync(WORKSPACE_ID).some(
      (assignment) => assignment.employeeName === "Planner" && assignment.skillId === skill.id,
    ),
    true,
  );
  assert.equal(
    listStoredAgentSkillAssignmentsSync().some((assignment) => assignment.employeeName === "Planner"),
    false,
  );
  assert.equal(readEmployeeRuntimeBindingSync("Planner", WORKSPACE_ID)?.runtimeId, runtimeId);
  assert.equal(readEmployeeRuntimeBindingSync("Planner"), null);

  createEmployeeSync({ name: "Planner" });
  assert.throws(
    () => bindEmployeeRuntimeSync("Planner", runtimeId!),
    /Runtime ".*" does not exist\./,
  );
});

test("knowledge assignments stay inside the target workspace and survive display name changes", () => {
  createEmployeeSync({ name: "Planner" }, WORKSPACE_ID);
  createEmployeeSync({ name: "Planner" });

  createKnowledgePageSync({
    title: "Mars handbook",
    contentMarkdown: "Mars only",
  }, WORKSPACE_ID);
  createKnowledgePageSync({
    title: "Default handbook",
    contentMarkdown: "Default only",
  });

  const marsPage = readWorkspaceStateSync(WORKSPACE_ID).knowledgePages.find((page) => page.title === "Mars handbook");
  assert.ok(marsPage);

  setKnowledgePageAssignmentModeSync(marsPage.id, "selected_agents", "Mina", WORKSPACE_ID);
  setKnowledgePageAssignedEmployeesSync(marsPage.id, ["Planner"], "Mina", WORKSPACE_ID);

  assert.deepEqual(listEmployeeKnowledgePageIdsSync("Planner", WORKSPACE_ID), [marsPage.id]);
  assert.equal(listEmployeeKnowledgePageIdsSync("Planner").includes(marsPage.id), false);
  assert.equal(
    listStoredKnowledgeAssignmentPoliciesSync(WORKSPACE_ID).some((policy) => policy.knowledgePageId === marsPage.id),
    true,
  );
  assert.equal(
    listStoredKnowledgeAssignmentPoliciesSync().some((policy) => policy.knowledgePageId === marsPage.id),
    false,
  );
  assert.equal(
    listStoredAgentKnowledgePageAssignmentsSync(WORKSPACE_ID).some(
      (assignment) => assignment.employeeName === "Planner" && assignment.knowledgePageId === marsPage.id,
    ),
    true,
  );
  assert.equal(
    listStoredAgentKnowledgePageAssignmentsSync().some((assignment) => assignment.knowledgePageId === marsPage.id),
    false,
  );

  updateEmployeeRemarkNameSync("Planner", "Strategy Lead", WORKSPACE_ID);
  assert.deepEqual(listEmployeeKnowledgePageIdsSync("Planner", WORKSPACE_ID), [marsPage.id]);
});

test.after(() => {
  process.chdir(originalCwd);
  rmSync(tempRoot, { recursive: true, force: true });
});

function seedWorkspace(workspaceId: string, organizationName: string, channelName: string): void {
  const state = resetWorkspaceStateSync(workspaceId);
  writeWorkspaceStateSync({
    ...state,
    organizationName,
    humanMembers: [{ name: "Mina", role: "Founder" }],
    channels: [
      {
        name: channelName,
        humanMembers: 1,
        employeeNames: [],
      },
    ],
    messages: [],
    directConversations: [],
    tasks: [],
    approvals: [],
    ledger: [],
  }, workspaceId);
}

function attachEmployeeToChannel(workspaceId: string, employeeName: string, channelName: string): void {
  const state = readWorkspaceStateSync(workspaceId);
  state.activeEmployees = state.activeEmployees.map((employee) =>
    employee.name === employeeName
      ? {
          ...employee,
          channels: [channelName],
        }
      : employee,
  );
  state.channels = state.channels.map((channel) =>
    channel.name === channelName
      ? {
          ...channel,
          employeeNames: Array.from(new Set([...channel.employeeNames, employeeName])),
        }
      : channel,
  );
  writeWorkspaceStateSync(state, workspaceId);
}
