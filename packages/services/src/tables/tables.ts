import type { AgentSpaceState, DataTable, DataColumn, DataRow } from "@agent-space/domain/workspace";
import { ensureWorkspaceStateSync, writeWorkspaceStateSync } from "../shared/state-io.ts";
import { createOpaqueId } from "../shared/helpers.ts";

export function listDataTablesSync(workspaceId?: string): DataTable[] {
  const state = ensureWorkspaceStateSync(workspaceId);
  return state.dataTables ?? [];
}

export function readDataTableSync(id: string, workspaceId?: string): DataTable | undefined {
  const state = ensureWorkspaceStateSync(workspaceId);
  return (state.dataTables ?? []).find((table) => table.id === id);
}

export function createDataTableSync(input: {
  name: string;
  channelName?: string;
  columns: Array<{
    name: string;
    type: DataColumn["type"];
    options?: string[];
    required?: boolean;
  }>;
  createdBy?: string;
}, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const name = input.name.trim();
  if (!name) {
    throw new Error("Table name is required.");
  }

  const now = new Date().toISOString();
  const columns: DataColumn[] = input.columns.map((col) => ({
    id: createOpaqueId(),
    name: col.name.trim(),
    type: col.type,
    options: col.options,
    required: col.required,
  }));

  const table: DataTable = {
    id: createOpaqueId(),
    name,
    channelName: input.channelName,
    columns,
    rows: [],
    status: "active",
    createdBy: input.createdBy ?? "",
    createdAt: now,
    updatedAt: now,
  };

  if (!state.dataTables) {
    state.dataTables = [];
  }
  state.dataTables.push(table);
  state.ledger.unshift({
    title: "Data table created",
    note: `Created table "${name}" with ${columns.length} columns.`,
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function createExternalDataTableSync(input: {
  name: string;
  channelName?: string;
  columns?: Array<{
    name: string;
    type: DataColumn["type"];
    options?: string[];
    required?: boolean;
  }>;
  rows?: DataRow[];
  createdBy?: string;
  externalProvider: NonNullable<DataTable["externalProvider"]>;
  externalResourceType: string;
  externalResourceToken: string;
  externalUrl?: string;
  externalSyncStatus?: DataTable["externalSyncStatus"];
  externalUpdatedAt?: string;
  externalMetadata?: Record<string, unknown>;
  externalPreview?: DataTable["externalPreview"];
}, workspaceId?: string): DataTable {
  const state = ensureWorkspaceStateSync(workspaceId);
  const name = input.name.trim();
  const externalResourceToken = input.externalResourceToken.trim();
  if (!name) {
    throw new Error("Table name is required.");
  }
  if (!externalResourceToken) {
    throw new Error("External data table resource token is required.");
  }

  const now = new Date().toISOString();
  const table: DataTable = {
    id: createOpaqueId(),
    name,
    channelName: input.channelName?.trim() || undefined,
    columns: (input.columns ?? []).map((col) => ({
      id: createOpaqueId(),
      name: col.name.trim(),
      type: col.type,
      options: col.options,
      required: col.required,
    })),
    rows: input.rows ?? [],
    externalProvider: input.externalProvider,
    externalResourceType: input.externalResourceType.trim(),
    externalResourceToken,
    externalUrl: input.externalUrl?.trim() || undefined,
    externalSyncStatus: input.externalSyncStatus ?? "unknown",
    externalUpdatedAt: input.externalUpdatedAt?.trim() || now,
    externalMetadata: input.externalMetadata,
    externalPreview: input.externalPreview,
    status: "active",
    createdBy: input.createdBy ?? "",
    createdAt: now,
    updatedAt: now,
  };

  state.dataTables ??= [];
  state.dataTables.push(table);
  state.ledger.unshift({
    title: "External data table linked",
    note: `Linked external table "${name}".`,
  });

  const persisted = writeWorkspaceStateSync(state, workspaceId);
  return persisted.dataTables.find((item) => item.id === table.id) ?? table;
}

export function updateDataTableSync(
  id: string,
  input: {
    name?: string;
    channelName?: string;
    columns?: Array<{
      id?: string;
      name: string;
      type: DataColumn["type"];
      options?: string[];
      required?: boolean;
    }>;
  },
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const table = (state.dataTables ?? []).find((t) => t.id === id);
  if (!table) {
    throw new Error(`Table "${id}" does not exist.`);
  }

  if (typeof input.name === "string") {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new Error("Table name is required.");
    }
    table.name = trimmed;
  }

  if (input.channelName !== undefined) {
    table.channelName = input.channelName || undefined;
  }

  if (Array.isArray(input.columns)) {
    table.columns = input.columns.map((col) => ({
      id: col.id ?? createOpaqueId(),
      name: col.name.trim(),
      type: col.type,
      options: col.options,
      required: col.required,
    }));
  }

  table.updatedAt = new Date().toISOString();

  state.ledger.unshift({
    title: "Data table updated",
    note: `Updated table "${table.name}".`,
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function updateExternalDataTableMetadataSync(
  id: string,
  input: {
    name?: string;
    channelName?: string;
    externalProvider?: NonNullable<DataTable["externalProvider"]>;
    externalResourceType?: string;
    externalResourceToken?: string;
    externalUrl?: string;
    externalSyncStatus?: DataTable["externalSyncStatus"];
    externalUpdatedAt?: string;
    externalMetadata?: Record<string, unknown>;
    externalPreview?: DataTable["externalPreview"];
  },
  workspaceId?: string,
): DataTable {
  const state = ensureWorkspaceStateSync(workspaceId);
  const table = (state.dataTables ?? []).find((item) => item.id === id);
  if (!table) {
    throw new Error(`Table "${id}" does not exist.`);
  }

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) {
      throw new Error("Table name is required.");
    }
    table.name = name;
  }
  if (input.channelName !== undefined) {
    table.channelName = input.channelName.trim() || undefined;
  }
  if (input.externalProvider !== undefined) {
    table.externalProvider = input.externalProvider;
  }
  if (input.externalResourceType !== undefined) {
    table.externalResourceType = input.externalResourceType.trim() || undefined;
  }
  if (input.externalResourceToken !== undefined) {
    table.externalResourceToken = input.externalResourceToken.trim() || undefined;
  }
  if (input.externalUrl !== undefined) {
    table.externalUrl = input.externalUrl.trim() || undefined;
  }
  if (input.externalSyncStatus !== undefined) {
    table.externalSyncStatus = input.externalSyncStatus;
  }
  if (input.externalUpdatedAt !== undefined) {
    table.externalUpdatedAt = input.externalUpdatedAt.trim() || undefined;
  }
  if (input.externalMetadata !== undefined) {
    table.externalMetadata = input.externalMetadata;
  }
  if (input.externalPreview !== undefined) {
    table.externalPreview = input.externalPreview;
  }
  table.updatedAt = new Date().toISOString();
  state.ledger.unshift({
    title: "External data table metadata updated",
    note: `Updated external metadata for table "${table.name}".`,
  });

  const persisted = writeWorkspaceStateSync(state, workspaceId);
  return persisted.dataTables.find((item) => item.id === table.id) ?? table;
}

export function deleteDataTableSync(id: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const table = (state.dataTables ?? []).find((t) => t.id === id);
  if (!table) {
    throw new Error(`Table "${id}" does not exist.`);
  }

  state.dataTables = (state.dataTables ?? []).filter((t) => t.id !== id);

  state.ledger.unshift({
    title: "Data table deleted",
    note: `Deleted table "${table.name}".`,
  });

  return writeWorkspaceStateSync(state, workspaceId);
}

export function addDataRowSync(
  tableId: string,
  input: {
    cells: Record<string, unknown>;
    createdBy?: string;
  },
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const table = (state.dataTables ?? []).find((t) => t.id === tableId);
  if (!table) {
    throw new Error(`Table "${tableId}" does not exist.`);
  }

  const now = new Date().toISOString();
  const row: DataRow = {
    id: createOpaqueId(),
    cells: input.cells,
    createdBy: input.createdBy ?? "",
    createdAt: now,
    updatedAt: now,
  };

  table.rows.push(row);
  table.updatedAt = now;

  return writeWorkspaceStateSync(state, workspaceId);
}

export function updateDataRowSync(
  tableId: string,
  rowId: string,
  cells: Record<string, unknown>,
  workspaceId?: string,
): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const table = (state.dataTables ?? []).find((t) => t.id === tableId);
  if (!table) {
    throw new Error(`Table "${tableId}" does not exist.`);
  }

  const row = table.rows.find((r) => r.id === rowId);
  if (!row) {
    throw new Error(`Row "${rowId}" does not exist in table "${table.name}".`);
  }

  row.cells = { ...row.cells, ...cells };
  row.updatedAt = new Date().toISOString();
  table.updatedAt = row.updatedAt;

  return writeWorkspaceStateSync(state, workspaceId);
}

export function deleteDataRowSync(tableId: string, rowId: string, workspaceId?: string): AgentSpaceState {
  const state = ensureWorkspaceStateSync(workspaceId);
  const table = (state.dataTables ?? []).find((t) => t.id === tableId);
  if (!table) {
    throw new Error(`Table "${tableId}" does not exist.`);
  }

  table.rows = table.rows.filter((r) => r.id !== rowId);
  table.updatedAt = new Date().toISOString();

  return writeWorkspaceStateSync(state, workspaceId);
}
