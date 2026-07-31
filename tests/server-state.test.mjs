import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const statePath = resolve(
  "work",
  `server-state-test-${process.pid}-${Date.now()}.json`,
);
process.env.ITS_STATE_PATH = statePath;

const {
  migrateLegacyState,
  readServerState,
  storeEngineerOrganization,
  storeSyncedData,
} = await import("../scripts/server-state.mjs");

test.after(async () => {
  await fs.rm(statePath, { force: true });
});

test("server state persists shared data and merges legacy engineers", async () => {
  const syncedData = {
    assignments: [],
    purchases: [],
    meta: {
      syncedAt: "2026-07-31T04:07:00.000Z",
      assignmentRows: 0,
      itsAssignments: 0,
      itsPurchases: 0,
    },
  };

  await storeEngineerOrganization("ATOL", "ignored");
  await migrateLegacyState({
    syncedData,
    engineerOrganizations: {
      ATOL: "vitma-s",
      "Иван Иванов": "vitma-climate",
      Invalid: "unknown",
    },
  });
  await storeSyncedData(syncedData);

  const state = await readServerState();
  assert.deepEqual(state.syncedData, syncedData);
  assert.deepEqual(state.engineerOrganizations, {
    ATOL: "ignored",
    "Иван Иванов": "vitma-climate",
  });
  assert.match(state.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
