import assert from "node:assert/strict";
import test from "node:test";
import { getDatabase, withTransaction } from "./database.ts";

test("an outer rollback also undoes a successful nested transaction", () => {
  const db = getDatabase();
  const key = `nested-rollback-${Date.now()}`;
  assert.throws(() => withTransaction(db, () => {
    withTransaction(db, () => {
      db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?)").run(key, "nested");
    });
    throw new Error("outer failure");
  }), /outer failure/);
  assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(key), undefined);
});

test("a handled nested failure does not abort the outer transaction", () => {
  const db = getDatabase();
  const outerKey = `nested-outer-${Date.now()}`;
  const innerKey = `${outerKey}-inner`;
  try {
    withTransaction(db, () => {
      db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?)").run(outerKey, "outer");
      assert.throws(() => withTransaction(db, () => {
        db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?)").run(innerKey, "inner");
        throw new Error("inner failure");
      }), /inner failure/);
    });
    assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(outerKey)?.value, "outer");
    assert.equal(db.prepare("SELECT value FROM app_metadata WHERE key = ?").get(innerKey), undefined);
  } finally {
    db.prepare("DELETE FROM app_metadata WHERE key IN (?, ?)").run(outerKey, innerKey);
  }
});
