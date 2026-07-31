import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";

const STATE_PATH = resolve(
  process.env.ITS_STATE_PATH || "server-data/runtime-state.json",
);
const VALID_ORGANIZATIONS = new Set([
  "vitma-s",
  "vitma-climate",
  "unassigned",
  "ignored",
]);

const EMPTY_STATE = {
  syncedData: null,
  engineerOrganizations: {},
  updatedAt: null,
};

let writeQueue = Promise.resolve();

function normalizeOrganizations(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([engineer, organization]) =>
        typeof engineer === "string" &&
        engineer.trim() &&
        VALID_ORGANIZATIONS.has(organization),
    ),
  );
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(EMPTY_STATE);
  }
  return {
    syncedData:
      value.syncedData && typeof value.syncedData === "object"
        ? value.syncedData
        : null,
    engineerOrganizations: normalizeOrganizations(
      value.engineerOrganizations,
    ),
    updatedAt:
      typeof value.updatedAt === "string" ? value.updatedAt : null,
  };
}

export async function readServerState() {
  try {
    return normalizeState(JSON.parse(await fs.readFile(STATE_PATH, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return structuredClone(EMPTY_STATE);
    }
    throw error;
  }
}

async function writeServerState(state) {
  const directory = dirname(STATE_PATH);
  const temporaryPath = `${STATE_PATH}.${process.pid}.tmp`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporaryPath, STATE_PATH);
  return state;
}

export function updateServerState(updater) {
  const operation = writeQueue.then(async () => {
    const current = await readServerState();
    const next = normalizeState(await updater(structuredClone(current)));
    next.updatedAt = new Date().toISOString();
    return writeServerState(next);
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export function storeSyncedData(syncedData) {
  return updateServerState((state) => ({ ...state, syncedData }));
}

export function storeEngineerOrganization(engineer, organization) {
  const normalizedEngineer = String(engineer ?? "").trim();
  if (!normalizedEngineer || !VALID_ORGANIZATIONS.has(organization)) {
    throw new Error("Некорректное распределение инженера");
  }
  return updateServerState((state) => ({
    ...state,
    engineerOrganizations: {
      ...state.engineerOrganizations,
      [normalizedEngineer]: organization,
    },
  }));
}

export function migrateLegacyState({ syncedData, engineerOrganizations }) {
  return updateServerState((state) => ({
    ...state,
    syncedData: state.syncedData ?? syncedData ?? null,
    engineerOrganizations: {
      ...normalizeOrganizations(engineerOrganizations),
      ...state.engineerOrganizations,
    },
  }));
}

export { STATE_PATH };
