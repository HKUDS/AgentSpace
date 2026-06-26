export const POSTGRES_SCHEMA_VERSION = "20";

export const POSTGRES_TABLE_NAMES = [
  "app_metadata",
  "workspace",
  "users",
  "auth_identity",
  "session",
  "workspace_membership",
  "workspace_invitation",
  "google_oauth_credential",
  "agent_google_workspace_delegation",
  "external_integration",
  "external_user_binding",
  "external_channel_binding",
  "external_resource_binding",
  "external_message_mapping",
  "external_message_outbox",
  "external_data_operation_run",
  "external_integration_event",
  "workspace_snapshot",
  "workspace_channel",
  "channel_participant",
  "channel_access_request",
  "channel_invitation",
  "workspace_employee",
  "agent_fork_invitation",
  "agent_fork_snapshot",
  "workspace_task",
  "daemon_connection",
  "daemon_api_token",
  "agent_runtime",
  "workspace_runtime_display_name",
  "workspace_runtime_grant",
  "document_agent_access",
  "document_permission_request",
  "agent_access_request",
  "workspace_notification",
  "employee_runtime_binding",
  "runtime_app_catalog_item",
  "runtime_installed_app",
  "runtime_app_operation",
  "skill",
  "skill_file",
  "runtime_app_skill_binding",
  "skill_import_event",
  "agent_skill",
  "knowledge_page_assignment_policy",
  "agent_knowledge_page",
  "knowledge_proposal",
  "agent_router_session",
  "agent_router_provider_session",
  "agent_task_queue",
  "agent_task_attempt",
  "agent_router_event",
  "agent_router_context_snapshot",
  "task_execution_event",
  "task_message",
  "model_pricing",
  "token_usage",
  "budget",
  "attachment",
  "audit_log",
] as const;

export type PostgresTableName = (typeof POSTGRES_TABLE_NAMES)[number];

export function getPostgresSchemaStatements(): string[] {
  return [
    `
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        archived_at TIMESTAMPTZ,
        join_code TEXT,
        join_code_updated_at TIMESTAMPTZ,
        join_code_updated_by TEXT
      )
    `,
    `
      ALTER TABLE workspace
        ADD COLUMN IF NOT EXISTS join_code TEXT
    `,
    `
      ALTER TABLE workspace
        ADD COLUMN IF NOT EXISTS join_code_updated_at TIMESTAMPTZ
    `,
    `
      ALTER TABLE workspace
        ADD COLUMN IF NOT EXISTS join_code_updated_by TEXT
    `,
    `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        avatar_url TEXT,
        primary_email TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        last_login_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS auth_identity (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        email TEXT,
        email_verified INTEGER NOT NULL DEFAULT 0,
        profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(provider, provider_subject)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        revoked_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_membership (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        joined_at TIMESTAMPTZ NOT NULL,
        invited_by TEXT,
        UNIQUE(workspace_id, user_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_invitation (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        invited_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS google_oauth_credential (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_subject TEXT,
        google_email TEXT,
        scopes TEXT NOT NULL,
        access_token_encrypted TEXT,
        refresh_token_encrypted TEXT,
        expires_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        UNIQUE(workspace_id, user_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_google_workspace_delegation (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        employee_name TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_oauth_credential_id TEXT NOT NULL REFERENCES google_oauth_credential(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        scopes TEXT NOT NULL,
        google_email TEXT,
        granted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        UNIQUE(workspace_id, employee_name, user_id)
      )
    `,
    // external_* bindings reference workspace_channel, so create it before those tables.
    `
      CREATE TABLE IF NOT EXISTS workspace_channel (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'group',
        human_member_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        human_member_count INTEGER NOT NULL DEFAULT 0,
        employee_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(workspace_id, name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_integration (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        transport_mode TEXT NOT NULL,
        app_id TEXT,
        tenant_key TEXT,
        encrypted_credentials_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        disabled_at TIMESTAMPTZ,
        last_health_status TEXT,
        last_health_checked_at TIMESTAMPTZ,
        last_error TEXT,
        UNIQUE(workspace_id, provider, display_name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_user_binding (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES external_integration(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_user_id TEXT NOT NULL,
        external_union_id TEXT,
        external_open_id TEXT,
        external_email TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ,
        UNIQUE(integration_id, user_id),
        UNIQUE(integration_id, external_user_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_channel_binding (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES external_integration(id) ON DELETE CASCADE,
        channel_name TEXT NOT NULL,
        external_chat_id TEXT NOT NULL,
        external_chat_type TEXT,
        external_chat_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        sync_mode TEXT NOT NULL DEFAULT 'mirror',
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        disabled_at TIMESTAMPTZ,
        FOREIGN KEY (workspace_id, channel_name)
          REFERENCES workspace_channel(workspace_id, name)
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        UNIQUE(integration_id, channel_name),
        UNIQUE(integration_id, external_chat_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_resource_binding (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES external_integration(id) ON DELETE CASCADE,
        provider_resource_type TEXT NOT NULL,
        provider_resource_token TEXT NOT NULL,
        provider_resource_url TEXT,
        agent_space_resource_type TEXT NOT NULL,
        agent_space_resource_id TEXT NOT NULL,
        channel_name TEXT,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        permissions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        archived_at TIMESTAMPTZ,
        FOREIGN KEY (workspace_id, channel_name)
          REFERENCES workspace_channel(workspace_id, name)
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        UNIQUE(integration_id, provider_resource_type, provider_resource_token)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_message_mapping (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES external_integration(id) ON DELETE CASCADE,
        channel_binding_id TEXT REFERENCES external_channel_binding(id) ON DELETE SET NULL,
        direction TEXT NOT NULL,
        external_message_id TEXT NOT NULL,
        external_thread_id TEXT,
        external_sender_id TEXT,
        external_event_id TEXT,
        agent_space_message_id TEXT,
        task_queue_id TEXT,
        router_session_id TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        UNIQUE(integration_id, external_message_id),
        UNIQUE(integration_id, external_event_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_message_outbox (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES external_integration(id) ON DELETE CASCADE,
        channel_binding_id TEXT REFERENCES external_channel_binding(id) ON DELETE SET NULL,
        target_external_chat_id TEXT NOT NULL,
        target_external_thread_id TEXT,
        agent_space_message_id TEXT,
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        locked_at TIMESTAMPTZ,
        locked_by TEXT,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        sent_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_data_operation_run (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT NOT NULL REFERENCES external_integration(id) ON DELETE CASCADE,
        resource_binding_id TEXT REFERENCES external_resource_binding(id) ON DELETE SET NULL,
        operation_type TEXT NOT NULL,
        provider_resource_type TEXT NOT NULL,
        provider_resource_token TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_code TEXT,
        error_message TEXT,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS external_integration_event (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        integration_id TEXT REFERENCES external_integration(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        received_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,
        UNIQUE(workspace_id, provider, external_event_id)
      )
    `,
    `
      DO $$
      BEGIN
        IF to_regclass('public.legacy_workspace') IS NOT NULL
          AND to_regclass('public.workspace_snapshot') IS NULL THEN
          ALTER TABLE legacy_workspace RENAME TO workspace_snapshot;
        END IF;
      END $$;
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_snapshot (
        id TEXT PRIMARY KEY,
        organization_name TEXT NOT NULL,
        pending_handoffs INTEGER NOT NULL DEFAULT 0,
        state_json JSONB NOT NULL,
        state_version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_channel (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'group',
        human_member_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        human_member_count INTEGER NOT NULL DEFAULT 0,
        employee_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(workspace_id, name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS channel_participant (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'active',
        added_by TEXT,
        joined_at TIMESTAMPTZ NOT NULL,
        removed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL,
        FOREIGN KEY (workspace_id, channel_name)
          REFERENCES workspace_channel(workspace_id, name)
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        UNIQUE(workspace_id, channel_name, user_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS channel_access_request (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TIMESTAMPTZ NOT NULL,
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        note TEXT,
        FOREIGN KEY (workspace_id, channel_name)
          REFERENCES workspace_channel(workspace_id, name)
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS channel_invitation (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        invitee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        invitee_email TEXT,
        invited_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        responded_at TIMESTAMPTZ,
        responded_by TEXT,
        FOREIGN KEY (workspace_id, channel_name)
          REFERENCES workspace_channel(workspace_id, name)
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_employee (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Agent',
        remark_name TEXT,
        origin TEXT NOT NULL DEFAULT 'manual',
        summary TEXT NOT NULL DEFAULT '',
        traits_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        fit TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        instructions TEXT NOT NULL DEFAULT '',
        owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        channel_member_access TEXT NOT NULL DEFAULT 'disabled',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_fork_invitation (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        source_agent_name TEXT NOT NULL,
        target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        accepted_agent_name TEXT,
        accepted_runtime_id TEXT
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_fork_snapshot (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        invitation_id TEXT NOT NULL REFERENCES agent_fork_invitation(id) ON DELETE CASCADE,
        source_agent_name TEXT NOT NULL,
        snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      ALTER TABLE workspace_employee
        ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    `,
    `
      ALTER TABLE workspace_employee
        ADD COLUMN IF NOT EXISTS channel_member_access TEXT NOT NULL DEFAULT 'disabled'
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_task (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        assignee TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        sort_order INTEGER,
        labels_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS daemon_connection (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        daemon_key TEXT NOT NULL UNIQUE,
        device_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'offline',
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_heartbeat_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS daemon_api_token (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_by TEXT NOT NULL DEFAULT '',
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_runtime (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        daemon_connection_id TEXT REFERENCES daemon_connection(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'offline',
        device_info TEXT NOT NULL DEFAULT '',
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        connected_at TIMESTAMPTZ,
        last_heartbeat_at TIMESTAMPTZ,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_runtime_display_name (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, runtime_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_runtime_grant (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission TEXT NOT NULL DEFAULT 'use',
        status TEXT NOT NULL DEFAULT 'active',
        granted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        UNIQUE(workspace_id, runtime_id, user_id, permission)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS document_agent_access (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        document_id TEXT NOT NULL,
        subject_type TEXT NOT NULL DEFAULT 'agent',
        subject_id TEXT NOT NULL,
        role TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'document',
        granted_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        UNIQUE(workspace_id, document_id, subject_type, subject_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS document_permission_request (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        document_id TEXT,
        external_provider TEXT,
        external_file_id TEXT,
        external_url TEXT,
        requested_role TEXT NOT NULL,
        requested_by_agent_name TEXT NOT NULL,
        requested_for_channel_name TEXT,
        triggered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decided_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        decision_note TEXT,
        source_task_id TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        decided_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_access_request (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        source_agent_name TEXT NOT NULL,
        requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_type TEXT NOT NULL,
        target_channel_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reason TEXT NOT NULL DEFAULT '',
        resolver_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        fork_invitation_id TEXT REFERENCES agent_fork_invitation(id) ON DELETE SET NULL,
        audit_data_json JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS workspace_notification (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        recipient_type TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        actor_type TEXT,
        actor_id TEXT,
        type TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        channel_name TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        action_href TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        status TEXT NOT NULL DEFAULT 'unread',
        dedupe_key TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        read_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS employee_runtime_binding (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        employee_name TEXT NOT NULL,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, employee_name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS runtime_app_catalog_item (
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        entry_point TEXT NOT NULL DEFAULT '',
        install_strategy TEXT NOT NULL DEFAULT '',
        install_cmd TEXT,
        uninstall_cmd TEXT,
        update_cmd TEXT,
        skill_md TEXT,
        requires_text TEXT,
        homepage TEXT,
        registry_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        synced_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (source, name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS runtime_installed_app (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        entry_point TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        install_strategy TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        installed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        installed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL,
        last_checked_at TIMESTAMPTZ,
        last_error TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(workspace_id, runtime_id, source, name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS runtime_app_operation (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        app_source TEXT NOT NULL,
        app_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        command_plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        safe_stdout_tail TEXT,
        safe_stderr_tail TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS skill (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_url TEXT,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(workspace_id, name)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS skill_file (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(skill_id, path)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS runtime_app_skill_binding (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        runtime_app_id TEXT NOT NULL REFERENCES runtime_installed_app(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, runtime_app_id, skill_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS skill_import_event (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        skill_id TEXT REFERENCES skill(id) ON DELETE SET NULL,
        skill_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        import_mode TEXT NOT NULL DEFAULT 'created',
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        imported_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_skill (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_id TEXT,
        employee_name TEXT NOT NULL,
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, employee_name, skill_id)
      )
    `,
    `
      ALTER TABLE agent_skill
      ADD COLUMN IF NOT EXISTS agent_id TEXT
    `,
    `
      CREATE TABLE IF NOT EXISTS knowledge_page_assignment_policy (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        knowledge_page_id TEXT NOT NULL,
        assignment_mode TEXT NOT NULL DEFAULT 'all_agents',
        updated_at TIMESTAMPTZ NOT NULL,
        updated_by TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (workspace_id, knowledge_page_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_knowledge_page (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_id TEXT,
        employee_name TEXT NOT NULL,
        knowledge_page_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        created_by TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (workspace_id, employee_name, knowledge_page_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS knowledge_proposal (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        source_task_queue_id TEXT NOT NULL,
        source_channel_name TEXT,
        source_agent_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        title TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        summary TEXT,
        reason TEXT,
        tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        parent_id TEXT,
        assignment_mode TEXT NOT NULL DEFAULT 'selected_agents',
        assigned_employee_names_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        target_knowledge_page_id TEXT,
        base_updated_at TIMESTAMPTZ,
        created_knowledge_page_id TEXT,
        approval_id TEXT,
        decided_by_user_id TEXT,
        decided_at TIMESTAMPTZ,
        reviewer_comment TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_task_queue (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        router_session_id TEXT,
        issue_id TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        priority INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        requested_by_user_id TEXT,
        requested_by_display_name TEXT,
        result_json JSONB,
        error_text TEXT,
        session_id TEXT,
        work_dir TEXT,
        queued_at TIMESTAMPTZ NOT NULL,
        claimed_at TIMESTAMPTZ,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_router_session (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        conversation_key TEXT,
        source_type TEXT NOT NULL DEFAULT 'task',
        status TEXT NOT NULL DEFAULT 'active',
        title TEXT,
        summary TEXT,
        memory_summary TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        closed_at TIMESTAMPTZ,
        UNIQUE(workspace_id, agent_id, conversation_key)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_router_provider_session (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        router_session_id TEXT NOT NULL REFERENCES agent_router_session(id) ON DELETE CASCADE,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        last_used_at TIMESTAMPTZ,
        last_error TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        UNIQUE(workspace_id, router_session_id, runtime_id, provider)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_task_attempt (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        task_queue_id TEXT NOT NULL REFERENCES agent_task_queue(id) ON DELETE CASCADE,
        router_session_id TEXT NOT NULL REFERENCES agent_router_session(id) ON DELETE CASCADE,
        runtime_id TEXT NOT NULL REFERENCES agent_runtime(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_session_id TEXT,
        status TEXT NOT NULL,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ,
        error_text TEXT,
        handoff_snapshot_id TEXT,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_router_event (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        router_session_id TEXT NOT NULL REFERENCES agent_router_session(id) ON DELETE CASCADE,
        task_queue_id TEXT REFERENCES agent_task_queue(id) ON DELETE SET NULL,
        attempt_id TEXT REFERENCES agent_task_attempt(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        runtime_id TEXT,
        provider TEXT,
        summary TEXT,
        data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS agent_router_context_snapshot (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        router_session_id TEXT NOT NULL REFERENCES agent_router_session(id) ON DELETE CASCADE,
        task_queue_id TEXT REFERENCES agent_task_queue(id) ON DELETE SET NULL,
        snapshot_type TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        source_event_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      ALTER TABLE agent_task_queue
        ADD COLUMN IF NOT EXISTS requested_by_user_id TEXT
    `,
    `
      ALTER TABLE agent_task_queue
        ADD COLUMN IF NOT EXISTS requested_by_display_name TEXT
    `,
    `
      ALTER TABLE agent_task_queue
        ADD COLUMN IF NOT EXISTS router_session_id TEXT
    `,
    `
      CREATE TABLE IF NOT EXISTS task_execution_event (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES agent_task_queue(id) ON DELETE CASCADE,
        channel_name TEXT NOT NULL DEFAULT '',
        agent_id TEXT NOT NULL,
        runtime_id TEXT,
        run_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        status TEXT,
        data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS task_message (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_task_queue(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        tool TEXT,
        content TEXT,
        input_json JSONB,
        output TEXT,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS model_pricing (
        model_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        input_per_1m DOUBLE PRECISION NOT NULL,
        output_per_1m DOUBLE PRECISION NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        task_queue_id TEXT NOT NULL REFERENCES agent_task_queue(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        channel_name TEXT,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS budget (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        limit_usd DOUBLE PRECISION NOT NULL,
        period TEXT NOT NULL DEFAULT 'monthly',
        action TEXT NOT NULL DEFAULT 'warn',
        warning_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.8,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS attachment (
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        message_id TEXT,
        channel_name TEXT,
        speaker TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        kind TEXT NOT NULL,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        stored_path TEXT NOT NULL,
        storage_provider TEXT NOT NULL DEFAULT 'local',
        storage_bucket TEXT,
        storage_region TEXT,
        storage_endpoint TEXT,
        storage_key TEXT,
        storage_url TEXT,
        sha256 TEXT,
        source_message_time TEXT,
        source_message_index INTEGER NOT NULL DEFAULT 0,
        source_summary TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (workspace_id, id)
      )
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'local'
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS storage_bucket TEXT
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS storage_region TEXT
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS storage_endpoint TEXT
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS storage_key TEXT
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS storage_url TEXT
    `,
    `
      ALTER TABLE attachment
        ADD COLUMN IF NOT EXISTS sha256 TEXT
    `,
    `
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        note TEXT NOT NULL,
        code TEXT,
        data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        source TEXT NOT NULL DEFAULT 'workspace_snapshot_ledger',
        source_index INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL
      )
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_slug
        ON workspace(slug)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_membership_user
        ON workspace_membership(user_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_membership_workspace
        ON workspace_membership(workspace_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_invitation_workspace_status
        ON workspace_invitation(workspace_id, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_invitation_email
        ON workspace_invitation(workspace_id, email, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_google_oauth_credential_workspace_user
        ON google_oauth_credential(workspace_id, user_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_google_workspace_delegation_agent
        ON agent_google_workspace_delegation(workspace_id, employee_name, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_channel_workspace
        ON workspace_channel(workspace_id, name)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_participant_channel_status
        ON channel_participant(workspace_id, channel_name, status, joined_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_participant_user_status
        ON channel_participant(workspace_id, user_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_access_request_channel_status
        ON channel_access_request(workspace_id, channel_name, status, requested_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_access_request_user_status
        ON channel_access_request(workspace_id, user_id, status)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_access_request_pending_user
        ON channel_access_request(workspace_id, channel_name, user_id)
        WHERE status = 'pending'
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_invitation_channel_status
        ON channel_invitation(workspace_id, channel_name, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_invitation_user_status
        ON channel_invitation(workspace_id, invitee_user_id, status)
        WHERE invitee_user_id IS NOT NULL
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_invitation_pending_user
        ON channel_invitation(workspace_id, channel_name, invitee_user_id)
        WHERE status = 'pending' AND invitee_user_id IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_channel_invitation_email_status
        ON channel_invitation(workspace_id, invitee_email, status)
        WHERE invitee_email IS NOT NULL
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_invitation_pending_email
        ON channel_invitation(workspace_id, channel_name, invitee_email)
        WHERE status = 'pending' AND invitee_email IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_employee_workspace
        ON workspace_employee(workspace_id, name)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_fork_invitation_target_status
        ON agent_fork_invitation(workspace_id, target_user_id, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_fork_invitation_source_status
        ON agent_fork_invitation(workspace_id, source_agent_name, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_fork_invitation_creator_status
        ON agent_fork_invitation(workspace_id, created_by_user_id, status, created_at DESC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_fork_invitation_pending_unique
        ON agent_fork_invitation(workspace_id, source_agent_name, target_user_id)
        WHERE status = 'pending'
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_fork_snapshot_invitation
        ON agent_fork_snapshot(workspace_id, invitation_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_task_workspace
        ON workspace_task(workspace_id, status, updated_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_auth_identity_user
        ON auth_identity(user_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_session_user
        ON session(user_id)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runtime_workspace_daemon_provider
        ON agent_runtime(workspace_id, daemon_connection_id, provider)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_runtime_status
        ON agent_runtime(workspace_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_daemon_api_token_workspace
        ON daemon_api_token(workspace_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_runtime_grant_user
        ON workspace_runtime_grant(workspace_id, user_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_runtime_grant_runtime
        ON workspace_runtime_grant(workspace_id, runtime_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_document_agent_access_subject
        ON document_agent_access(workspace_id, subject_type, subject_id, revoked_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_document_agent_access_document
        ON document_agent_access(workspace_id, document_id, revoked_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_document_permission_request_workspace_status
        ON document_permission_request(workspace_id, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_document_permission_request_agent
        ON document_permission_request(workspace_id, requested_by_agent_name, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_access_request_source_status
        ON agent_access_request(workspace_id, source_agent_name, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_access_request_requester_status
        ON agent_access_request(workspace_id, requester_user_id, status, created_at DESC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_access_request_pending_unique
        ON agent_access_request(workspace_id, source_agent_name, requester_user_id, request_type, COALESCE(target_channel_name, ''))
        WHERE status = 'pending'
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_notification_recipient_status_created
        ON workspace_notification(workspace_id, recipient_type, recipient_id, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_workspace_notification_resource
        ON workspace_notification(workspace_id, resource_type, resource_id, created_at DESC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_notification_dedupe
        ON workspace_notification(workspace_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_document_permission_request_pending_agent_document
        ON document_permission_request(workspace_id, requested_by_agent_name, requested_role, document_id, requested_for_channel_name)
        WHERE status = 'pending' AND document_id IS NOT NULL
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_document_permission_request_pending_agent_external
        ON document_permission_request(workspace_id, requested_by_agent_name, requested_role, external_provider, external_file_id, requested_for_channel_name)
        WHERE status = 'pending' AND external_file_id IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_employee_runtime_binding_runtime
        ON employee_runtime_binding(runtime_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_runtime_app_catalog_category
        ON runtime_app_catalog_item(source, category, name)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_runtime_installed_app_runtime
        ON runtime_installed_app(workspace_id, runtime_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_runtime_app_operation_runtime_status
        ON runtime_app_operation(workspace_id, runtime_id, status, created_at ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_runtime_app_operation_app
        ON runtime_app_operation(workspace_id, app_source, app_name, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_runtime_app_skill_binding_skill
        ON runtime_app_skill_binding(workspace_id, skill_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_skill_workspace_name
        ON skill(workspace_id, name)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_skill_file_skill
        ON skill_file(skill_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_skill_import_event_workspace_imported
        ON skill_import_event(workspace_id, imported_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_skill_employee
        ON agent_skill(workspace_id, employee_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_knowledge_assignment_policy_page
        ON knowledge_page_assignment_policy(workspace_id, knowledge_page_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_knowledge_page_employee
        ON agent_knowledge_page(workspace_id, employee_name)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_knowledge_page_page
        ON agent_knowledge_page(workspace_id, knowledge_page_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_knowledge_proposal_workspace_status_created
        ON knowledge_proposal(workspace_id, status, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_knowledge_proposal_source_task
        ON knowledge_proposal(workspace_id, source_task_queue_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_knowledge_proposal_approval
        ON knowledge_proposal(workspace_id, approval_id)
        WHERE approval_id IS NOT NULL
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_router_session_conversation
        ON agent_router_session(workspace_id, agent_id, conversation_key)
        WHERE conversation_key IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_router_session_agent_updated
        ON agent_router_session(workspace_id, agent_id, updated_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_router_provider_session_router
        ON agent_router_provider_session(workspace_id, router_session_id, status, updated_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_task_attempt_task_created
        ON agent_task_attempt(task_queue_id, created_at ASC, id ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_task_attempt_router_created
        ON agent_task_attempt(workspace_id, router_session_id, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_router_event_router_created
        ON agent_router_event(workspace_id, router_session_id, created_at ASC, id ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_router_event_task_created
        ON agent_router_event(task_queue_id, created_at ASC, id ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_router_context_snapshot_router_created
        ON agent_router_context_snapshot(workspace_id, router_session_id, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_task_queue_runtime_status_priority
        ON agent_task_queue(runtime_id, status, priority DESC, created_at ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_agent_task_queue_router_session
        ON agent_task_queue(workspace_id, router_session_id, created_at DESC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_message_task_seq
        ON task_message(task_id, seq)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_task_execution_event_workspace_created
        ON task_execution_event(workspace_id, created_at DESC, id DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_task_execution_event_task_created
        ON task_execution_event(task_id, created_at ASC, id ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_task_execution_event_runtime_created
        ON task_execution_event(workspace_id, runtime_id, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_task_execution_event_channel_created
        ON task_execution_event(workspace_id, channel_name, created_at DESC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_workspace_scope
        ON budget(workspace_id, scope, scope_id)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_created
        ON token_usage(workspace_id, created_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_token_usage_agent
        ON token_usage(workspace_id, agent_id, created_at)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_attachment_workspace_message
        ON attachment(workspace_id, message_id, source_message_index)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_attachment_storage_key
        ON attachment(storage_provider, storage_bucket, storage_key)
        WHERE storage_key IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_created
        ON audit_log(workspace_id, created_at DESC, source_index DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_integration_workspace_provider
        ON external_integration(workspace_id, provider, status, updated_at DESC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_external_integration_provider_app_tenant
        ON external_integration(workspace_id, provider, app_id, COALESCE(tenant_key, ''))
        WHERE app_id IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_user_binding_user
        ON external_user_binding(workspace_id, user_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_user_binding_external_open
        ON external_user_binding(integration_id, external_open_id)
        WHERE external_open_id IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_channel_binding_workspace_channel
        ON external_channel_binding(workspace_id, channel_name, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_resource_binding_workspace_resource
        ON external_resource_binding(workspace_id, agent_space_resource_type, agent_space_resource_id, status)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_resource_binding_channel
        ON external_resource_binding(workspace_id, channel_name, status)
        WHERE channel_name IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_message_mapping_task
        ON external_message_mapping(workspace_id, task_queue_id)
        WHERE task_queue_id IS NOT NULL
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_message_outbox_due
        ON external_message_outbox(status, next_attempt_at, created_at ASC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_data_operation_run_resource_created
        ON external_data_operation_run(workspace_id, resource_binding_id, created_at DESC)
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_external_integration_event_status
        ON external_integration_event(workspace_id, provider, status, received_at ASC)
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_join_code
        ON workspace(join_code)
        WHERE join_code IS NOT NULL
    `,
    `
      INSERT INTO app_metadata (key, value)
      VALUES ('schema_version', '${POSTGRES_SCHEMA_VERSION}')
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
    `,
  ].map((statement) => statement.trim());
}
