import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveFeishuResourceDescriptor,
  resolveFeishuResourceDescriptorForType,
  validateFeishuResourceDescriptorForBinding,
} from "../resource-resolver.ts";

test("resolves Feishu Docs, Wiki, Sheets, and Base URLs into resource descriptors", () => {
  assert.deepEqual(
    resolveFeishuResourceDescriptor(" https://northstar.feishu.cn/docx/docx_token-123?from=copy "),
    {
      providerResourceType: "doc",
      providerResourceToken: "docx_token-123",
      providerResourceUrl: "https://northstar.feishu.cn/docx/docx_token-123?from=copy",
      metadata: {
        docType: "docx",
      },
    },
  );

  assert.deepEqual(
    resolveFeishuResourceDescriptor("https://northstar.larksuite.com/wiki/wiki_node-456"),
    {
      providerResourceType: "doc",
      providerResourceToken: "wiki_node-456",
      providerResourceUrl: "https://northstar.larksuite.com/wiki/wiki_node-456",
      metadata: {
        docType: "wiki",
      },
    },
  );

  assert.deepEqual(
    resolveFeishuResourceDescriptor("https://northstar.feishu.cn/docs/doc_legacy-456"),
    {
      providerResourceType: "doc",
      providerResourceToken: "doc_legacy-456",
      providerResourceUrl: "https://northstar.feishu.cn/docs/doc_legacy-456",
      metadata: {
        docType: "doc",
      },
    },
  );

  assert.deepEqual(
    resolveFeishuResourceDescriptor("https://northstar.feishu.cn/sheets/sht_token-789?sheet=Sheet1"),
    {
      providerResourceType: "sheet",
      providerResourceToken: "sht_token-789",
      providerResourceUrl: "https://northstar.feishu.cn/sheets/sht_token-789?sheet=Sheet1",
    },
  );

  assert.deepEqual(
    resolveFeishuResourceDescriptor("https://northstar.feishu.cn/bitable/app_token-abc?table=tbl123&view=vew456"),
    {
      providerResourceType: "base",
      providerResourceToken: "app_token-abc",
      providerResourceUrl: "https://northstar.feishu.cn/bitable/app_token-abc?table=tbl123&view=vew456",
    },
  );
});

test("resolves typed Feishu resource tokens without treating them as URLs", () => {
  assert.deepEqual(resolveFeishuResourceDescriptorForType("doc", " docx_token-123 "), {
    providerResourceType: "doc",
    providerResourceToken: "docx_token-123",
    providerResourceUrl: undefined,
    metadata: {
      docType: "docx",
    },
  });

  assert.deepEqual(resolveFeishuResourceDescriptorForType("sheet", " sht_token-789 "), {
    providerResourceType: "sheet",
    providerResourceToken: "sht_token-789",
    providerResourceUrl: undefined,
  });

  assert.deepEqual(resolveFeishuResourceDescriptorForType("base", " app_token-abc "), {
    providerResourceType: "base",
    providerResourceToken: "app_token-abc",
    providerResourceUrl: undefined,
  });
});

test("resolves scoped Feishu Base table and view resources from URLs or raw ids", () => {
  assert.deepEqual(
    resolveFeishuResourceDescriptorForType(
      "base_table",
      "https://northstar.feishu.cn/base/app_token-abc?table=tbl123&view=vew456",
    ),
    {
      providerResourceType: "base_table",
      providerResourceToken: "tbl123",
      providerResourceUrl: "https://northstar.feishu.cn/base/app_token-abc?table=tbl123&view=vew456",
      metadata: {
        appToken: "app_token-abc",
        tableId: "tbl123",
        viewId: "vew456",
      },
    },
  );

  assert.deepEqual(resolveFeishuResourceDescriptorForType("base_view", " vew456 "), {
    providerResourceType: "base_view",
    providerResourceToken: "vew456",
    providerResourceUrl: undefined,
    metadata: {
      appToken: undefined,
      tableId: undefined,
      viewId: "vew456",
    },
  });
});

test("validates Feishu Base scoped resources before creating bindings", () => {
  const tableFromUrl = resolveFeishuResourceDescriptorForType(
    "base_table",
    "https://northstar.feishu.cn/base/app_token-abc?table=tbl123&view=vew456",
  );
  assert.ok(tableFromUrl);
  assert.deepEqual(validateFeishuResourceDescriptorForBinding(tableFromUrl), {
    ok: true,
  });

  const rawTable = resolveFeishuResourceDescriptorForType("base_table", " tbl123 ");
  assert.ok(rawTable);
  const missingAppToken = validateFeishuResourceDescriptorForBinding(rawTable);
  assert.equal(missingAppToken.ok, false);
  if (!missingAppToken.ok) {
    assert.equal(missingAppToken.errorCode, "feishu.resource_binding.base_app_token_missing");
    assert.equal(missingAppToken.data?.missing, "appToken");
  }

  const viewWithoutTable = resolveFeishuResourceDescriptorForType(
    "base_view",
    "https://northstar.feishu.cn/base/app_token-abc?view=vew456",
  );
  assert.ok(viewWithoutTable);
  const missingTable = validateFeishuResourceDescriptorForBinding(viewWithoutTable);
  assert.equal(missingTable.ok, false);
  if (!missingTable.ok) {
    assert.equal(missingTable.errorCode, "feishu.resource_binding.base_table_id_missing");
    assert.equal(missingTable.data?.missing, "tableId");
  }
});

test("returns null for unsupported Feishu resource values and types", () => {
  assert.equal(resolveFeishuResourceDescriptor("https://northstar.feishu.cn/messenger/oc_123"), null);
  assert.equal(resolveFeishuResourceDescriptorForType("calendar", "cal_123456"), null);
  assert.equal(resolveFeishuResourceDescriptorForType("doc", "bad"), null);
});
