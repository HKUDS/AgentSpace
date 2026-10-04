"use client";

import { useMemo, useState, useTransition } from "react";
import type { CSSProperties, TransitionStartFunction } from "react";
import type {
  PermissionActorSummary,
  PermissionBinding,
  PermissionCenterData,
  PermissionDiagnostic,
  PermissionTreeNode,
} from "@agent-space/services";
import type { WorkspaceRole } from "@agent-space/db";
import { SettingsSectionShell } from "@/features/settings/components/settings-chrome";
import type { SettingsSectionMeta } from "@/features/settings/settings-meta";
import type { SettingsTx } from "@/features/settings/settings-types";
import { translateSettingsActionError, translateWorkspaceRole } from "@/features/settings/settings-utils";
import {
  permissionsAddChannelDocumentCollaboratorAction,
  permissionsAddWorkspaceMemberToChannelAction,
  permissionsApproveAgentAccessRequestAction,
  permissionsApproveChannelAccessRequestAction,
  permissionsBindAgentRuntimeAction,
  permissionsCreateDaemonApiTokenAction,
  permissionsCreateWorkspaceInvitationAction,
  permissionsDisconnectGoogleWorkspaceAction,
  permissionsApproveDocumentPermissionRequestAction,
  permissionsGrantRuntimeUseAction,
  permissionsGrantDocumentAgentAccessAction,
  permissionsRejectChannelAccessRequestAction,
  permissionsRejectAgentAccessRequestAction,
  permissionsRejectDocumentPermissionRequestAction,
  permissionsReissueWorkspaceInvitationAction,
  permissionsRemoveChannelDocumentCollaboratorAction,
  permissionsRevokeDocumentAgentAccessAction,
  permissionsRemoveWorkspaceMemberAction,
  permissionsRemoveWorkspaceMemberFromChannelAction,
  permissionsRevokeAgentGoogleWorkspaceDelegationAction,
  permissionsRevokeChannelInvitationAction,
  permissionsRevokeDaemonApiTokenAction,
  permissionsRevokeRuntimeUseAction,
  permissionsRevokeWorkspaceInvitationAction,
  permissionsSetAgentChannelMemberAccessAction,
  permissionsSetAgentKnowledgeAssignmentsAction,
  permissionsSetAgentSkillAssignmentsAction,
  permissionsSyncExternalGoogleSheetPermissionsAction,
  permissionsUnbindAgentRuntimeAction,
  permissionsUpdateChannelDocumentAccessRoleAction,
  permissionsUpdateWorkspaceMemberRoleAction,
} from "@/features/permissions/actions";
import { EmptyState } from "@/shared/ui/empty-state";

type PermissionViewMode = "resources" | "actors";
type DocumentRole = "owner" | "forwarder" | "editor" | "viewer";
type AgentDocumentRole = "forwarder" | "editor" | "viewer";

interface FlatPermissionNode {
  node: PermissionTreeNode;
  depth: number;
}

export function PermissionsCenterSection({
  currentMembershipRole,
  currentUserDisplayName,
  permissions,
  meta,
  tx,
}: {
  currentMembershipRole: WorkspaceRole;
  currentUserDisplayName: string;
  permissions?: PermissionCenterData;
  meta: SettingsSectionMeta;
  tx: SettingsTx;
}) {
  const [viewMode, setViewMode] = useState<PermissionViewMode>("resources");
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedActorKey, setSelectedActorKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const flatNodes = useMemo(() => flattenPermissionTree(permissions?.tree ?? []), [permissions]);
  const filteredNodes = useMemo(
    () => filterNodes(flatNodes, query),
    [flatNodes, query],
  );
  const filteredActors = useMemo(
    () => filterActors(permissions?.actors ?? [], query),
    [permissions, query],
  );
  const selectedNode = selectedNodeId
    ? flatNodes.find((item) => item.node.id === selectedNodeId)?.node
    : filteredNodes[0]?.node;
  const selectedActor = selectedActorKey
    ? filteredActors.find((actor) => actorKey(actor) === selectedActorKey)
    : filteredActors[0];
  const canManageWorkspace = currentMembershipRole === "owner" || currentMembershipRole === "admin";

  if (!permissions) {
    return (
      <SettingsSectionShell meta={meta}>
        <section className="page-panel permissions-center-panel">
          <EmptyState title={tx("权限数据尚未加载。", "Permission data is not loaded yet.")} />
        </section>
      </SettingsSectionShell>
    );
  }

  return (
    <SettingsSectionShell meta={meta}>
      <section className="page-panel permissions-center-panel">
        <div className="panel-header">
          <div>
            <h3>{tx("权限地图", "Permission map")}</h3>
            <p className="settings-panel-note">
              {tx("按资源或 Actor 查看直接授权、继承授权、运行时授权和外部委托。", "Inspect direct grants, inherited grants, runtime grants, and external delegations by resource or actor.")}
            </p>
          </div>
          <div className="permissions-center-summary" aria-label={tx("权限摘要", "Permission summary")}>
            <span>{tx(`${flatNodes.length} 个资源`, `${flatNodes.length} resources`)}</span>
            <span>{tx(`${permissions.actors.length} 个 Actor`, `${permissions.actors.length} actors`)}</span>
            <span>{tx(`${permissions.diagnostics.length} 条诊断`, `${permissions.diagnostics.length} diagnostics`)}</span>
          </div>
        </div>

        <div className="permissions-center-toolbar">
          <div className="permissions-center-tabs" role="tablist" aria-label={tx("权限视图", "Permission view")}>
            <button
              className={`filter-pill${viewMode === "resources" ? " filter-pill--active" : ""}`}
              onClick={() => setViewMode("resources")}
              type="button"
            >
              {tx("资源树", "Resources")}
            </button>
            <button
              className={`filter-pill${viewMode === "actors" ? " filter-pill--active" : ""}`}
              onClick={() => setViewMode("actors")}
              type="button"
            >
              {tx("Actor 反查", "Actors")}
            </button>
          </div>
          <label className="permissions-center-search">
            <span>{tx("筛选", "Filter")}</span>
            <input
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={tx("搜索资源、Actor、权限来源", "Search resources, actors, or sources")}
              value={query}
            />
          </label>
        </div>

        {feedback ? <p aria-live="polite" className="settings-feedback" role="status">{feedback}</p> : null}
        {createdSecret ? (
          <div className="settings-token-secret">
            <strong>{tx("一次性 daemon token", "One-time daemon token")}</strong>
            <code>{createdSecret}</code>
            <p>{tx("离开此页面后不会再次显示。", "It will not be shown again after you leave this page.")}</p>
          </div>
        ) : null}

        <div className="permissions-center-grid">
          <div className="permissions-center-list">
            {viewMode === "resources" ? (
              filteredNodes.length > 0 ? (
                filteredNodes.map(({ node, depth }) => (
                  <button
                    className={`permissions-resource-row${selectedNode?.id === node.id ? " permissions-resource-row--active" : ""}`}
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    style={{ "--permission-depth": depth } as CSSProperties}
                    type="button"
                  >
                    <span className={`permissions-status-dot permissions-status-dot--${node.status ?? "active"}`} />
                    <span>
                      <strong>{node.label}</strong>
                      <small>{formatResourceType(node.resourceType, tx)} · {formatStatus(node.status ?? "active", tx)}</small>
                    </span>
                    <em>{node.bindings.length}</em>
                  </button>
                ))
              ) : (
                <EmptyState title={tx("没有匹配资源。", "No matching resources.")} />
              )
            ) : (
              filteredActors.length > 0 ? (
                filteredActors.map((actor) => (
                  <button
                    className={`permissions-resource-row${actorKey(actor) === actorKey(selectedActor) ? " permissions-resource-row--active" : ""}`}
                    key={actorKey(actor)}
                    onClick={() => setSelectedActorKey(actorKey(actor))}
                    type="button"
                  >
                    <span className={`permissions-status-dot permissions-status-dot--${actor.status}`} />
                    <span>
                      <strong>{actor.subjectLabel}</strong>
                      <small>{formatSubjectType(actor.subjectType, tx)} · {actor.permissions.length} permissions</small>
                    </span>
                    <em>{actor.diagnostics.length}</em>
                  </button>
                ))
              ) : (
                <EmptyState title={tx("没有匹配 Actor。", "No matching actors.")} />
              )
            )}
          </div>

          <div className="permissions-inspector">
            {viewMode === "resources" && selectedNode ? (
              <ResourceInspector
                key={selectedNode.id}
                canManageWorkspace={canManageWorkspace}
                currentMembershipRole={currentMembershipRole}
                currentUserDisplayName={currentUserDisplayName}
                isPending={isPending}
                node={selectedNode}
                permissions={permissions}
                setCreatedSecret={setCreatedSecret}
                setFeedback={setFeedback}
                startTransition={startTransition}
                tx={tx}
              />
            ) : null}

            {viewMode === "actors" && selectedActor ? (
              <ActorInspector actor={selectedActor} tx={tx} />
            ) : null}
          </div>
        </div>

        <DiagnosticsPanel diagnostics={permissions.diagnostics} tx={tx} />
      </section>
    </SettingsSectionShell>
  );
}

function ResourceInspector({
  canManageWorkspace,
  currentMembershipRole,
  currentUserDisplayName,
  isPending,
  node,
  permissions,
  setCreatedSecret,
  setFeedback,
  startTransition,
  tx,
}: {
  canManageWorkspace: boolean;
  currentMembershipRole: WorkspaceRole;
  currentUserDisplayName: string;
  isPending: boolean;
  node: PermissionTreeNode;
  permissions: PermissionCenterData;
  setCreatedSecret: (value: string | null) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  return (
    <>
      <div className="permissions-inspector__header">
        <div>
          <span className="permissions-inspector__eyebrow">{formatResourceType(node.resourceType, tx)}</span>
          <h3>{node.label}</h3>
        </div>
        <span className={`status-chip ${node.status === "error" ? "status-chip--danger" : node.status === "pending" ? "status-chip--warning" : "status-chip--positive"}`}>
          {formatStatus(node.status ?? "active", tx)}
        </span>
      </div>

      <NodeOperationPanel
        canManageWorkspace={canManageWorkspace}
        currentMembershipRole={currentMembershipRole}
        currentUserDisplayName={currentUserDisplayName}
        isPending={isPending}
        node={node}
        permissions={permissions}
        setCreatedSecret={setCreatedSecret}
        setFeedback={setFeedback}
        startTransition={startTransition}
        tx={tx}
      />

      {node.diagnostics && node.diagnostics.length > 0 ? (
        <div className="permissions-diagnostic-list permissions-diagnostic-list--compact">
          {node.diagnostics.map((diagnostic) => (
            <DiagnosticCard diagnostic={diagnostic} key={diagnostic.id} tx={tx} />
          ))}
        </div>
      ) : null}

      <div className="permissions-binding-list">
        <div className="permissions-binding-list__header">
          <strong>{tx("授权关系", "Bindings")}</strong>
          <span>{node.bindings.length}</span>
        </div>
        {node.bindings.length > 0 ? (
          node.bindings.map((binding, index) => (
            <BindingCard
              binding={binding}
              currentMembershipRole={currentMembershipRole}
              isPending={isPending}
              key={`${binding.subjectType}:${binding.subjectId}:${binding.permission}:${index}`}
              setFeedback={setFeedback}
              startTransition={startTransition}
              tx={tx}
            />
          ))
        ) : (
          <EmptyState title={tx("此资源暂无显式授权。", "This resource has no explicit bindings.")} />
        )}
      </div>
    </>
  );
}

function NodeOperationPanel({
  canManageWorkspace,
  currentMembershipRole,
  currentUserDisplayName,
  isPending,
  node,
  permissions,
  setCreatedSecret,
  setFeedback,
  startTransition,
  tx,
}: {
  canManageWorkspace: boolean;
  currentMembershipRole: WorkspaceRole;
  currentUserDisplayName: string;
  isPending: boolean;
  node: PermissionTreeNode;
  permissions: PermissionCenterData;
  setCreatedSecret: (value: string | null) => void;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("member");
  const [daemonLabel, setDaemonLabel] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(permissions.catalog.members[0]?.userId ?? "");
  const [documentActorId, setDocumentActorId] = useState("");
  const [documentActorType, setDocumentActorType] = useState<"human" | "agent">("human");
  const [documentRole, setDocumentRole] = useState<DocumentRole>("viewer");
  const [agentDocumentRole, setAgentDocumentRole] = useState<AgentDocumentRole>("viewer");
  const [agentSkillIds, setAgentSkillIds] = useState(() => metadataStringList(node, "assignedSkillIds"));
  const [agentKnowledgePageIds, setAgentKnowledgePageIds] = useState(() => metadataStringList(node, "selectedKnowledgePageIds"));
  const channelName = metadataString(node, "channelName");
  const runtimeId = metadataString(node, "runtimeId");
  const documentId = metadataString(node, "documentId");
  const employeeName = metadataString(node, "employeeName");
  const selectedKnowledgePages = permissions.catalog.knowledgePages.filter((page) => page.assignmentMode === "selected_agents");

  if (!canManageWorkspace && node.resourceType !== "agent" && node.resourceType !== "oauth_credential") {
    return null;
  }

  return (
    <div className="permissions-operation-panel">
      {node.resourceType === "workspace" && canManageWorkspace ? (
        <>
          <div className="permissions-operation-row">
            <label className="form-field">
              <span>{tx("邀请邮箱", "Invite email")}</span>
              <input
                onChange={(event) => setInviteEmail(event.currentTarget.value)}
                placeholder="name@example.com"
                type="email"
                value={inviteEmail}
              />
            </label>
            <label className="form-field">
              <span>{tx("角色", "Role")}</span>
              <select onChange={(event) => setInviteRole(event.currentTarget.value as WorkspaceRole)} value={inviteRole}>
                {assignableRoles(currentMembershipRole).map((role) => (
                  <option key={role} value={role}>{translateWorkspaceRole(role, tx)}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              disabled={isPending || inviteEmail.trim().length === 0}
              onClick={() => runPermissionAction({
                startTransition,
                setFeedback,
                tx,
                success: tx("邀请已创建。", "Invitation created."),
                action: async () => {
                  await permissionsCreateWorkspaceInvitationAction({ email: inviteEmail, role: inviteRole });
                  setInviteEmail("");
                },
              })}
              type="button"
            >
              {tx("创建邀请", "Create invite")}
            </button>
          </div>
          <div className="permissions-operation-row">
            <label className="form-field">
              <span>{tx("daemon token 标签", "Daemon token label")}</span>
              <input
                onChange={(event) => setDaemonLabel(event.currentTarget.value)}
                placeholder={tx("远程 daemon 名称", "Remote daemon name")}
                value={daemonLabel}
              />
            </label>
            <button
              className="secondary-button"
              disabled={isPending || daemonLabel.trim().length === 0}
              onClick={() => runPermissionAction({
                startTransition,
                setFeedback,
                tx,
                success: tx("daemon token 已创建。", "Daemon token created."),
                action: async () => {
                  const result = await permissionsCreateDaemonApiTokenAction({
                    label: daemonLabel,
                    createdBy: currentUserDisplayName || "system",
                  });
                  setCreatedSecret(result.data.token);
                  setDaemonLabel("");
                },
              })}
              type="button"
            >
              {tx("创建 daemon token", "Create daemon token")}
            </button>
          </div>
        </>
      ) : null}

      {node.resourceType === "channel" && canManageWorkspace && channelName ? (
        <div className="permissions-operation-row">
          <label className="form-field">
            <span>{tx("添加成员", "Add member")}</span>
            <select onChange={(event) => setSelectedMemberId(event.currentTarget.value)} value={selectedMemberId}>
              {permissions.catalog.members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.displayName}</option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            disabled={isPending || !selectedMemberId}
            onClick={() => runPermissionAction({
              startTransition,
              setFeedback,
              tx,
              success: tx("频道成员已添加。", "Channel member added."),
              action: () => permissionsAddWorkspaceMemberToChannelAction({ channelName, userId: selectedMemberId }),
            })}
            type="button"
          >
            {tx("添加到频道", "Add to channel")}
          </button>
        </div>
      ) : null}

      {node.resourceType === "runtime" && canManageWorkspace && runtimeId ? (
        <div className="permissions-operation-row">
          <label className="form-field">
            <span>{tx("授予成员", "Grant member")}</span>
            <select onChange={(event) => setSelectedMemberId(event.currentTarget.value)} value={selectedMemberId}>
              {permissions.catalog.members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.displayName}</option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            disabled={isPending || !selectedMemberId}
            onClick={() => runPermissionAction({
              startTransition,
              setFeedback,
              tx,
              success: tx("Runtime 使用权已授予。", "Runtime use granted."),
              action: () => permissionsGrantRuntimeUseAction({ runtimeId, userId: selectedMemberId }),
            })}
            type="button"
          >
            {tx("授予 use", "Grant use")}
          </button>
        </div>
      ) : null}

      {node.resourceType === "agent" && employeeName ? (
        <>
          <div className="permissions-operation-row">
            <label className="form-field">
              <span>{tx("群成员调用", "Channel member access")}</span>
              <select
                defaultValue={metadataString(node, "channelMemberAccess") || "enabled"}
                disabled={isPending}
                onChange={(event) => runPermissionAction({
                  startTransition,
                  setFeedback,
                  tx,
                  success: tx("Agent 群成员调用权限已保存。", "Agent channel access saved."),
                  action: () => permissionsSetAgentChannelMemberAccessAction({
                    employeeName,
                    channelMemberAccess: event.currentTarget.value as "enabled" | "disabled",
                  }),
                })}
              >
                <option value="enabled">{tx("允许频道成员使用", "Enabled for channel members")}</option>
                <option value="disabled">{tx("仅 owner / manager", "Owner / manager only")}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{tx("绑定 runtime", "Bind runtime")}</span>
              <select
                disabled={isPending}
                onChange={(event) => {
                  const nextRuntimeId = event.currentTarget.value;
                  if (!nextRuntimeId) {
                    return;
                  }
                  runPermissionAction({
                    startTransition,
                    setFeedback,
                    tx,
                    success: tx("Agent runtime 已绑定。", "Agent runtime bound."),
                    action: () => permissionsBindAgentRuntimeAction({ employeeName, runtimeId: nextRuntimeId }),
                  });
                }}
                value=""
              >
                <option value="">{tx("选择 runtime", "Select runtime")}</option>
                {flattenPermissionTree(permissions.tree)
                  .filter((item) => item.node.resourceType === "runtime")
                  .map((item) => (
                    <option key={item.node.id} value={metadataString(item.node, "runtimeId")}>{item.node.label}</option>
                  ))}
              </select>
            </label>
          </div>
          <AssignmentCheckboxGroup
            disabled={isPending}
            heading={tx("Skill 分配", "Skill assignments")}
            options={permissions.catalog.skills.map((skill) => ({ id: skill.id, label: skill.name }))}
            selectedIds={agentSkillIds}
            setSelectedIds={setAgentSkillIds}
          />
          <button
            className="secondary-button"
            disabled={isPending}
            onClick={() => runPermissionAction({
              startTransition,
              setFeedback,
              tx,
              success: tx("Skill 分配已保存。", "Skill assignments saved."),
              action: () => permissionsSetAgentSkillAssignmentsAction({ employeeName, skillIds: agentSkillIds }),
            })}
            type="button"
          >
            {tx("保存 Skill", "Save skills")}
          </button>
          <AssignmentCheckboxGroup
            disabled={isPending}
            heading={tx("选定知识页", "Selected knowledge")}
            options={selectedKnowledgePages.map((page) => ({ id: page.id, label: page.title }))}
            selectedIds={agentKnowledgePageIds}
            setSelectedIds={setAgentKnowledgePageIds}
          />
          <button
            className="secondary-button"
            disabled={isPending}
            onClick={() => runPermissionAction({
              startTransition,
              setFeedback,
              tx,
              success: tx("知识分配已保存。", "Knowledge assignments saved."),
              action: () => permissionsSetAgentKnowledgeAssignmentsAction({ employeeName, knowledgePageIds: agentKnowledgePageIds }),
            })}
            type="button"
          >
            {tx("保存知识页", "Save knowledge")}
          </button>
        </>
      ) : null}

      {node.resourceType === "document" && documentId ? (
        <div className="permissions-operation-row">
          <label className="form-field">
            <span>{tx("Actor 类型", "Actor type")}</span>
            <select onChange={(event) => setDocumentActorType(event.currentTarget.value as "human" | "agent")} value={documentActorType}>
              <option value="human">{tx("成员", "Human")}</option>
              <option value="agent">Agent</option>
            </select>
          </label>
          <label className="form-field">
            <span>{tx("Actor", "Actor")}</span>
            <select onChange={(event) => setDocumentActorId(event.currentTarget.value)} value={documentActorId}>
              <option value="">{tx("选择 Actor", "Select actor")}</option>
              {(documentActorType === "human"
                ? permissions.catalog.members.map((member) => ({ id: member.displayName, label: member.displayName }))
                : permissions.catalog.agents.map((agent) => ({ id: agent.employeeName, label: agent.label }))
              ).map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.label}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{tx("角色", "Role")}</span>
            <select onChange={(event) => setDocumentRole(event.currentTarget.value as DocumentRole)} value={documentRole}>
              <option value="viewer">viewer</option>
              <option value="editor">editor</option>
              <option value="forwarder">forwarder</option>
              <option value="owner">owner</option>
            </select>
          </label>
          <button
            className="primary-button"
            disabled={isPending || !documentActorId}
            onClick={() => runPermissionAction({
              startTransition,
              setFeedback,
              tx,
              success: tx("文档 collaborator 已添加。", "Document collaborator added."),
              action: () => permissionsAddChannelDocumentCollaboratorAction({
                documentId,
                actorId: documentActorId,
                actorType: documentActorType,
                role: documentRole,
              }),
            })}
            type="button"
          >
            {tx("添加 collaborator", "Add collaborator")}
          </button>
          {documentActorType === "agent" ? (
            <>
              <label className="form-field">
                <span>{tx("Agent 显式权限", "Agent grant")}</span>
                <select onChange={(event) => setAgentDocumentRole(event.currentTarget.value as AgentDocumentRole)} value={agentDocumentRole}>
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="forwarder">forwarder</option>
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={isPending || !documentActorId}
                onClick={() => runPermissionAction({
                  startTransition,
                  setFeedback,
                  tx,
                  success: tx("Agent 文档权限已授予。", "Agent document access granted."),
                  action: () => permissionsGrantDocumentAgentAccessAction({
                    documentId,
                    agentName: documentActorId,
                    role: agentDocumentRole,
                  }),
                })}
                type="button"
              >
                {tx("授予 Agent 权限", "Grant agent access")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {node.resourceType === "external_document" && documentId ? (
        <button
          className="primary-button"
          disabled={isPending}
          onClick={() => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("外部权限同步已触发。", "External permission sync started."),
            action: () => permissionsSyncExternalGoogleSheetPermissionsAction(documentId),
          })}
          type="button"
        >
          {tx("同步 Google Drive 权限", "Sync Google Drive permissions")}
        </button>
      ) : null}
    </div>
  );
}

function AssignmentCheckboxGroup({
  disabled,
  heading,
  options,
  selectedIds,
  setSelectedIds,
}: {
  disabled: boolean;
  heading: string;
  options: Array<{ id: string; label: string }>;
  selectedIds: string[];
  setSelectedIds: (value: string[]) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <fieldset className="permissions-checkbox-group">
      <legend>{heading}</legend>
      {options.map((option) => {
        const checked = selectedIds.includes(option.id);
        return (
          <label key={option.id}>
            <input
              checked={checked}
              disabled={disabled}
              onChange={(event) => {
                setSelectedIds(event.currentTarget.checked
                  ? [...selectedIds, option.id]
                  : selectedIds.filter((id) => id !== option.id));
              }}
              type="checkbox"
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function BindingCard({
  binding,
  currentMembershipRole,
  isPending,
  setFeedback,
  startTransition,
  tx,
}: {
  binding: PermissionBinding;
  currentMembershipRole: WorkspaceRole;
  isPending: boolean;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  return (
    <article className="permissions-binding-card">
      <div className="permissions-binding-card__main">
        <strong>{binding.subjectLabel}</strong>
        <span>{formatSubjectType(binding.subjectType, tx)} · {binding.permission}</span>
      </div>
      <div className="permissions-binding-card__meta">
        <span className="status-chip">{formatSource(binding.source, tx)}</span>
        <span className={`status-chip ${binding.status === "revoked" ? "status-chip--danger" : binding.status === "pending" ? "status-chip--warning" : ""}`}>
          {formatStatus(binding.status, tx)}
        </span>
      </div>
      <BindingActions
        binding={binding}
        currentMembershipRole={currentMembershipRole}
        isPending={isPending}
        setFeedback={setFeedback}
        startTransition={startTransition}
        tx={tx}
      />
    </article>
  );
}

function BindingActions({
  binding,
  currentMembershipRole,
  isPending,
  setFeedback,
  startTransition,
  tx,
}: {
  binding: PermissionBinding;
  currentMembershipRole: WorkspaceRole;
  isPending: boolean;
  setFeedback: (value: string | null) => void;
  startTransition: TransitionStartFunction;
  tx: SettingsTx;
}) {
  const metadata = binding.metadata ?? {};
  const userId = valueAsString(metadata.userId);
  const invitationId = valueAsString(metadata.invitationId);
  const requestId = valueAsString(metadata.requestId);
  const channelName = valueAsString(metadata.channelName);
  const runtimeId = valueAsString(metadata.runtimeId);
  const tokenId = valueAsString(metadata.tokenId);
  const employeeName = valueAsString(metadata.employeeName);
  const documentId = valueAsString(metadata.documentId);
  const actorId = valueAsString(metadata.actorId);
  const actorType = valueAsString(metadata.actorType) as "human" | "agent" | "";
  const googleCredentialId = valueAsString(metadata.googleOAuthCredentialId);

  return (
    <div className="permissions-binding-card__actions">
      {binding.updateAction === "workspace_member_role" && userId ? (
        <select
          defaultValue={valueAsString(metadata.role)}
          disabled={isPending}
          onChange={(event) => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("成员角色已更新。", "Member role updated."),
            action: () => permissionsUpdateWorkspaceMemberRoleAction({
              userId,
              role: event.currentTarget.value as WorkspaceRole,
            }),
          })}
        >
          {assignableRoles(currentMembershipRole).map((role) => (
            <option key={role} value={role}>{translateWorkspaceRole(role, tx)}</option>
          ))}
        </select>
      ) : null}

      {binding.updateAction === "workspace_invitation_reissue" && invitationId ? (
        <button
          className="action-button"
          disabled={isPending}
          onClick={() => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("邀请已重新签发。", "Invitation reissued."),
            action: () => permissionsReissueWorkspaceInvitationAction(invitationId),
          })}
          type="button"
        >
          {tx("重新签发", "Reissue")}
        </button>
      ) : null}

      {binding.updateAction === "channel_access_request_approve" && requestId ? (
        <button
          className="action-button"
          disabled={isPending}
          onClick={() => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("访问申请已批准。", "Access request approved."),
            action: () => permissionsApproveChannelAccessRequestAction(requestId),
          })}
          type="button"
        >
          {tx("批准", "Approve")}
        </button>
      ) : null}

      {binding.updateAction === "document_permission_request_approve" && requestId ? (
        <button
          className="action-button"
          disabled={isPending}
          onClick={() => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("文档权限申请已批准。", "Document request approved."),
            action: () => permissionsApproveDocumentPermissionRequestAction(requestId),
          })}
          type="button"
        >
          {tx("批准", "Approve")}
        </button>
      ) : null}

      {binding.updateAction === "agent_access_request_approve" && requestId ? (
        <button
          className="action-button"
          disabled={isPending}
          onClick={() => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("Agent 权限申请已批准。", "Agent access request approved."),
            action: () => permissionsApproveAgentAccessRequestAction(requestId),
          })}
          type="button"
        >
          {tx("批准", "Approve")}
        </button>
      ) : null}

      {binding.updateAction === "document_collaborator_role" && documentId && actorId && actorType ? (
        <select
          defaultValue={valueAsString(metadata.role)}
          disabled={isPending}
          onChange={(event) => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("文档权限已更新。", "Document permission updated."),
            action: () => permissionsUpdateChannelDocumentAccessRoleAction({
              documentId,
              actorId,
              actorType,
              role: event.currentTarget.value as DocumentRole,
            }),
          })}
        >
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="forwarder">forwarder</option>
          <option value="owner">owner</option>
        </select>
      ) : null}

      {binding.updateAction === "document_agent_access_role" && documentId && actorId ? (
        <select
          defaultValue={valueAsString(metadata.role)}
          disabled={isPending}
          onChange={(event) => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("Agent 文档权限已更新。", "Agent document access updated."),
            action: () => permissionsGrantDocumentAgentAccessAction({
              documentId,
              agentName: actorId,
              role: event.currentTarget.value as AgentDocumentRole,
            }),
          })}
        >
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
          <option value="forwarder">forwarder</option>
        </select>
      ) : null}

      {binding.revokeAction ? (
        <button
          className="action-button action-button--danger"
          disabled={isPending}
          onClick={() => runPermissionAction({
            startTransition,
            setFeedback,
            tx,
            success: tx("权限变更已完成。", "Permission change completed."),
            action: () => runRevokeAction({
              action: binding.revokeAction,
              userId,
              invitationId,
              requestId,
              channelName,
              runtimeId,
              tokenId,
              employeeName,
              documentId,
              actorId,
              actorType,
              googleCredentialId,
            }),
          })}
          type="button"
        >
          {revokeLabel(binding.revokeAction, tx)}
        </button>
      ) : null}
    </div>
  );
}

async function runRevokeAction(input: {
  action?: string;
  userId: string;
  invitationId: string;
  requestId: string;
  channelName: string;
  runtimeId: string;
  tokenId: string;
  employeeName: string;
  documentId: string;
  actorId: string;
  actorType: "human" | "agent" | "";
  googleCredentialId: string;
}): Promise<void> {
  switch (input.action) {
    case "workspace_member_remove":
      return permissionsRemoveWorkspaceMemberAction(input.userId);
    case "workspace_invitation_revoke":
      return permissionsRevokeWorkspaceInvitationAction(input.invitationId);
    case "channel_access_request_reject":
      return permissionsRejectChannelAccessRequestAction(input.requestId);
    case "channel_invitation_revoke":
      return permissionsRevokeChannelInvitationAction(input.invitationId);
    case "channel_participant_remove":
      return permissionsRemoveWorkspaceMemberFromChannelAction({
        channelName: input.channelName,
        userId: input.userId,
      });
    case "runtime_grant_revoke":
      return void await permissionsRevokeRuntimeUseAction({
        runtimeId: input.runtimeId,
        userId: input.userId,
      });
    case "daemon_token_revoke":
      return void await permissionsRevokeDaemonApiTokenAction(input.tokenId);
    case "agent_runtime_unbind":
      return void await permissionsUnbindAgentRuntimeAction(input.employeeName);
    case "agent_google_delegation_revoke":
      return void await permissionsRevokeAgentGoogleWorkspaceDelegationAction({
        employeeName: input.employeeName,
      });
    case "document_collaborator_remove":
      if (!input.actorType) {
        return;
      }
      return permissionsRemoveChannelDocumentCollaboratorAction({
        documentId: input.documentId,
        actorId: input.actorId,
        actorType: input.actorType,
      });
    case "document_permission_request_reject":
      return permissionsRejectDocumentPermissionRequestAction(input.requestId);
    case "agent_access_request_reject":
      return permissionsRejectAgentAccessRequestAction(input.requestId);
    case "document_agent_access_revoke":
      return permissionsRevokeDocumentAgentAccessAction({
        documentId: input.documentId,
        agentName: input.actorId || input.employeeName,
      });
    case "oauth_credential_revoke":
      return permissionsDisconnectGoogleWorkspaceAction();
    default:
      return;
  }
}

function ActorInspector({ actor, tx }: { actor: PermissionActorSummary; tx: SettingsTx }) {
  return (
    <>
      <div className="permissions-inspector__header">
        <div>
          <span className="permissions-inspector__eyebrow">{formatSubjectType(actor.subjectType, tx)}</span>
          <h3>{actor.subjectLabel}</h3>
        </div>
        <span className="status-chip">{actor.permissions.length}</span>
      </div>
      {actor.diagnostics.length > 0 ? (
        <div className="permissions-diagnostic-list permissions-diagnostic-list--compact">
          {actor.diagnostics.map((diagnostic) => (
            <DiagnosticCard diagnostic={diagnostic} key={diagnostic.id} tx={tx} />
          ))}
        </div>
      ) : null}
      <div className="permissions-binding-list">
        {actor.permissions.map((permission) => (
          <article className="permissions-actor-permission" key={`${permission.nodeId}:${permission.permission}`}>
            <strong>{permission.resourceLabel}</strong>
            <span>{formatResourceType(permission.resourceType, tx)} · {permission.permission}</span>
            <small>{formatSource(permission.source, tx)} · {formatStatus(permission.status, tx)}</small>
          </article>
        ))}
      </div>
    </>
  );
}

function DiagnosticsPanel({ diagnostics, tx }: { diagnostics: PermissionDiagnostic[]; tx: SettingsTx }) {
  return (
    <div className="permissions-diagnostics">
      <div className="permissions-binding-list__header">
        <strong>{tx("权限诊断", "Permission diagnostics")}</strong>
        <span>{diagnostics.length}</span>
      </div>
      {diagnostics.length > 0 ? (
        <div className="permissions-diagnostic-list">
          {diagnostics.map((diagnostic) => (
            <DiagnosticCard diagnostic={diagnostic} key={diagnostic.id} tx={tx} />
          ))}
        </div>
      ) : (
        <EmptyState title={tx("暂无权限诊断。", "No permission diagnostics.")} />
      )}
    </div>
  );
}

function DiagnosticCard({ diagnostic, tx }: { diagnostic: PermissionDiagnostic; tx: SettingsTx }) {
  return (
    <article className={`permissions-diagnostic-card permissions-diagnostic-card--${diagnostic.severity}`}>
      <strong>{diagnostic.title}</strong>
      <p>{diagnostic.description}</p>
      <span>{formatSource(diagnostic.source === "system" ? "derived" : diagnostic.source, tx)}</span>
    </article>
  );
}

function flattenPermissionTree(tree: PermissionTreeNode[]): FlatPermissionNode[] {
  const result: FlatPermissionNode[] = [];
  function visit(node: PermissionTreeNode, depth: number): void {
    result.push({ node, depth });
    for (const child of node.children ?? []) {
      visit(child, depth + 1);
    }
  }
  for (const node of tree) {
    visit(node, 0);
  }
  return result;
}

function filterNodes(nodes: FlatPermissionNode[], query: string): FlatPermissionNode[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) {
    return nodes;
  }
  return nodes.filter(({ node }) => [
    node.label,
    node.resourceType,
    node.source ?? "",
    ...node.bindings.map((binding) => `${binding.subjectLabel} ${binding.permission} ${binding.source}`),
  ].join(" ").toLocaleLowerCase("zh-CN").includes(normalized));
}

function filterActors(actors: PermissionActorSummary[], query: string): PermissionActorSummary[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) {
    return actors;
  }
  return actors.filter((actor) => [
    actor.subjectLabel,
    actor.subjectType,
    ...actor.permissions.map((permission) => `${permission.resourceLabel} ${permission.permission} ${permission.source}`),
  ].join(" ").toLocaleLowerCase("zh-CN").includes(normalized));
}

function runPermissionAction(input: {
  startTransition: TransitionStartFunction;
  setFeedback: (value: string | null) => void;
  tx: SettingsTx;
  success: string;
  action: () => Promise<unknown>;
}): void {
  input.startTransition(async () => {
    try {
      await input.action();
      input.setFeedback(input.success);
    } catch (error) {
      input.setFeedback(translateSettingsActionError(error, input.tx));
    }
  });
}

function metadataString(node: PermissionTreeNode, key: string): string {
  return valueAsString(node.metadata?.[key]);
}

function metadataStringList(node: PermissionTreeNode, key: string): string[] {
  const value = node.metadata?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function valueAsString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function actorKey(actor: PermissionActorSummary | undefined): string {
  return actor ? `${actor.subjectType}:${actor.subjectId}` : "";
}

function assignableRoles(currentMembershipRole: WorkspaceRole): WorkspaceRole[] {
  return currentMembershipRole === "owner" ? ["member", "admin", "owner"] : ["member", "admin"];
}

function revokeLabel(action: string, tx: SettingsTx): string {
  switch (action) {
    case "workspace_member_remove":
      return tx("移除成员", "Remove member");
    case "workspace_invitation_revoke":
    case "channel_invitation_revoke":
      return tx("撤销邀请", "Revoke invite");
    case "channel_access_request_reject":
    case "agent_access_request_reject":
      return tx("拒绝", "Reject");
    case "runtime_grant_revoke":
      return tx("撤销 use", "Revoke use");
    case "daemon_token_revoke":
      return tx("吊销 token", "Revoke token");
    case "agent_runtime_unbind":
      return tx("解绑 runtime", "Unbind runtime");
    case "agent_google_delegation_revoke":
      return tx("撤销委托", "Revoke delegation");
    case "document_collaborator_remove":
      return tx("移除 collaborator", "Remove collaborator");
    case "oauth_credential_revoke":
      return tx("断开 Google", "Disconnect Google");
    default:
      return tx("撤销", "Revoke");
  }
}

function formatResourceType(type: string, tx: SettingsTx): string {
  switch (type) {
    case "workspace":
      return tx("工作区", "Workspace");
    case "workspace_invitation":
      return tx("工作区邀请", "Workspace invitation");
    case "channel":
      return tx("频道", "Channel");
    case "channel_invitation":
      return tx("频道邀请", "Channel invitation");
    case "channel_access_request":
      return tx("访问申请", "Access request");
    case "agent":
      return "Agent";
    case "agent_fork_invitation":
      return tx("Agent 复制邀请", "Agent copy invitation");
    case "agent_access_request":
      return tx("Agent 权限申请", "Agent access request");
    case "runtime":
      return "Runtime";
    case "daemon":
      return "Daemon";
    case "file":
      return tx("文件", "File");
    case "document":
      return tx("文档", "Document");
    case "external_document":
      return tx("外部文档", "External document");
    case "skill":
      return "Skill";
    case "knowledge_page":
      return tx("知识页", "Knowledge page");
    case "oauth_credential":
      return tx("OAuth 凭据", "OAuth credential");
    case "external_identity_policy":
      return tx("外部身份策略", "External identity policy");
    default:
      return type;
  }
}

function formatSubjectType(type: string, tx: SettingsTx): string {
  switch (type) {
    case "human":
      return tx("真人", "Human");
    case "agent":
      return "Agent";
    case "daemon_token":
      return "Daemon token";
    case "oauth_credential":
      return "OAuth";
    case "external_guest":
      return tx("外部访客", "External guest");
    case "system":
      return tx("系统", "System");
    default:
      return type;
  }
}

function formatStatus(status: string, tx: SettingsTx): string {
  switch (status) {
    case "active":
      return tx("有效", "Active");
    case "pending":
      return tx("待处理", "Pending");
    case "revoked":
      return tx("已撤销", "Revoked");
    case "error":
      return tx("异常", "Error");
    case "inherited":
      return tx("继承", "Inherited");
    case "external":
      return tx("外部", "External");
    default:
      return status;
  }
}

function formatSource(source: string, tx: SettingsTx): string {
  switch (source) {
    case "workspace_role":
      return tx("工作区角色", "Workspace role");
    case "direct_grant":
      return tx("直接授权", "Direct grant");
    case "channel_participant":
      return tx("频道成员", "Channel participant");
    case "document_collaborator":
      return tx("文档 collaborator", "Document collaborator");
    case "runtime_grant":
      return "Runtime grant";
    case "agent_owner":
      return "Agent owner";
    case "agent_fork":
      return tx("Agent 复制", "Agent copy");
    case "agent_channel_member_access":
      return tx("频道成员调用", "Channel member access");
    case "knowledge_assignment":
      return tx("知识分配", "Knowledge assignment");
    case "skill_assignment":
      return "Skill assignment";
    case "oauth_delegation":
      return "OAuth delegation";
    case "external_drive_permission":
      return "Google Drive";
    case "external_guest_policy":
      return tx("外部访客策略", "External guest policy");
    case "derived":
      return tx("推导", "Derived");
    default:
      return source;
  }
}
