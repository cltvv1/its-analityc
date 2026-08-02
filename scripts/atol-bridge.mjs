import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { chromium } from "playwright-core";
import { parseAssignmentWorkbook } from "./assignment-export.mjs";
import {
  isAnnualItsPurchase,
} from "./atol-rules.mjs";
import { resolvePurchaseQuantity } from "./purchase-quantity.mjs";
import {
  migrateLegacyState,
  readServerState,
  storeEngineerOrganization,
  storeSyncedData,
} from "./server-state.mjs";

const envPath = resolve(".env.local");
if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const HOST = "127.0.0.1";
const PORT = Number(process.env.ATOL_BRIDGE_PORT || 4317);
const PROFILE_DIR = resolve(".atol-browser-profile");
const HEADLESS = process.env.ATOL_HEADLESS !== "false";
const ATOL_LOGIN = process.env.ATOL_LOGIN?.trim() || "";
const ATOL_PASSWORD = process.env.ATOL_PASSWORD || "";
const PRODUCT_CODE = "59600";
const ORGANIZATIONS = [
  { id: 4201, organization: "vitma-s", name: "ВИТМА-С" },
  { id: 3171, organization: "vitma-climate", name: "ВИТМА-КЛИМАТ" },
];
const PAGE_SIZE = 100;

const browserCandidates = [
  process.env.ATOL_BROWSER_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

let context;
let lkpPage;
let acPage;
let launching;
let syncInProgress = false;
let lastSync = null;
const accessTokens = { lkp: null, ac: null };

function executablePath() {
  const found = browserCandidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "Не найден Chrome или Microsoft Edge. Укажите путь в ATOL_BROWSER_PATH.",
    );
  }
  return found;
}

function isAllowedOrigin(origin) {
  return (
    !origin ||
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)
  );
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function sendJson(response, status, payload, origin) {
  response.writeHead(status, {
    ...corsHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function recordAuthorization(request) {
  const authorization = request.headers().authorization;
  if (!authorization?.toLowerCase().startsWith("bearer ")) return;

  const hostname = new URL(request.url()).hostname;
  if (hostname === "lkp.atol.ru") accessTokens.lkp = authorization;
  if (hostname === "ac.atol.ru") accessTokens.ac = authorization;
}

async function ensureContext() {
  if (context) return context;
  if (launching) return launching;

  launching = (async () => {
    mkdirSync(PROFILE_DIR, { recursive: true });
    const nextContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      executablePath: executablePath(),
      headless: HEADLESS,
      viewport: HEADLESS ? { width: 1440, height: 1000 } : null,
      args: HEADLESS ? [] : ["--start-maximized"],
    });
    nextContext.on("request", recordAuthorization);
    nextContext.on("close", () => {
      context = undefined;
      lkpPage = undefined;
      acPage = undefined;
      accessTokens.lkp = null;
      accessTokens.ac = null;
    });
    context = nextContext;
    const [initialPage] = nextContext.pages();
    if (initialPage && !initialPage.isClosed()) {
      lkpPage = initialPage;
    }
    return nextContext;
  })().finally(() => {
    launching = undefined;
  });

  return launching;
}

async function getPage(kind) {
  const browserContext = await ensureContext();
  const existing = kind === "lkp" ? lkpPage : acPage;
  if (existing && !existing.isClosed()) return existing;

  const page = await browserContext.newPage();
  if (kind === "lkp") lkpPage = page;
  else acPage = page;
  return page;
}

async function waitForToken(kind, timeoutMs = 12_000) {
  const started = Date.now();
  while (!accessTokens[kind] && Date.now() - started < timeoutMs) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  return accessTokens[kind];
}

async function prepareAuthenticatedPage(kind) {
  const page = await getPage(kind);
  const target =
    kind === "lkp"
      ? "https://lkp.atol.ru/reports/orders"
      : "https://ac.atol.ru/app/v2/subscriptions/CCT/assignment?offset=0&limit=10";

  accessTokens[kind] = null;
  await page.goto(target, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });

  let token = await waitForToken(kind);
  const currentUrl = page.url();
  if (
    !token ||
    currentUrl.includes("id.atol.ru") ||
    currentUrl.includes("/auth/")
  ) {
    if (!ATOL_LOGIN || !ATOL_PASSWORD) {
      throw new AuthenticationError(
        "Сессия АТОЛ истекла. Укажите ATOL_LOGIN и ATOL_PASSWORD в файле .env.local на сервере.",
        true,
      );
    }
    await authenticateWithCredentials(page);
    accessTokens[kind] = null;
    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    token = await waitForToken(kind, 20_000);
    if (!token) {
      throw new AuthenticationError(
        "АТОЛ не принял учетные данные или запросил дополнительное подтверждение входа.",
      );
    }
  }
  return { page, token };
}

async function firstVisible(page, selector) {
  const candidates = page.locator(selector);
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function clickLoginSubmit(page) {
  const submit = await firstVisible(
    page,
    'button[type="submit"], input[type="submit"]',
  );
  if (!submit) throw new Error("Не найдена кнопка входа АТОЛ");
  await submit.click();
}

async function authenticateWithCredentials(page) {
  await page
    .waitForSelector(
      'input[name="username"], input[type="tel"], input[type="email"], input[type="password"]',
      { timeout: 20_000 },
    )
    .catch(() => {});

  const loginInput = await firstVisible(
    page,
    'input[name="username"], input[type="tel"], input[type="email"], input[autocomplete="username"]',
  );
  let passwordInput = await firstVisible(
    page,
    'input[name="password"], input[type="password"], input[autocomplete="current-password"]',
  );

  if (loginInput) await loginInput.fill(ATOL_LOGIN);
  if (!passwordInput && loginInput) {
    await clickLoginSubmit(page);
    await page
      .waitForSelector(
        'input[name="password"], input[type="password"], input[autocomplete="current-password"]',
        { state: "visible", timeout: 20_000 },
      )
      .catch(() => {});
    passwordInput = await firstVisible(
      page,
      'input[name="password"], input[type="password"], input[autocomplete="current-password"]',
    );
  }

  if (!passwordInput) throw new Error("Не найдено поле пароля АТОЛ");
  await passwordInput.fill(ATOL_PASSWORD);
  await clickLoginSubmit(page);
  await page
    .waitForURL(
      (url) =>
        !url.hostname.includes("id.atol.ru") &&
        !url.pathname.includes("/auth/"),
      { timeout: 35_000 },
    )
    .catch(() => {});
}

async function apiJson(page, url, authorization) {
  const result = await page.evaluate(
    async ({ requestUrl, auth }) => {
      const response = await fetch(requestUrl, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: auth,
        },
      });
      return {
        status: response.status,
        text: await response.text(),
      };
    },
    { requestUrl: url, auth: authorization },
  );

  if (result.status === 401 || result.status === 403) {
    throw new AuthenticationError();
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`АТОЛ вернул HTTP ${result.status}`);
  }

  try {
    return JSON.parse(result.text);
  } catch {
    throw new Error("АТОЛ вернул ответ в неизвестном формате");
  }
}

async function apiFile(page, url, authorization) {
  const result = await page.evaluate(
    async ({ requestUrl, auth }) => {
      const response = await fetch(requestUrl, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream",
          Authorization: auth,
        },
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      const chunkSize = 32_768;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        base64: btoa(binary),
      };
    },
    { requestUrl: url, auth: authorization },
  );

  if (result.status === 401 || result.status === 403) {
    throw new AuthenticationError();
  }
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`АТОЛ вернул HTTP ${result.status} при выгрузке истории`);
  }

  const buffer = Buffer.from(result.base64, "base64");
  if (buffer.length < 4 || buffer.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error(
      `АТОЛ вернул вместо Excel файл типа ${result.contentType || "неизвестного формата"}`,
    );
  }
  return buffer;
}

class AuthenticationError extends Error {
  constructor(
    message = "Требуется вход в АТОЛ",
    credentialsRequired = false,
  ) {
    super(message);
    this.name = "AuthenticationError";
    this.credentialsRequired = credentialsRequired;
  }
}

async function fetchAssignments(page, token) {
  const workbook = await apiFile(
    page,
    "https://ac.atol.ru/api/cct/product/association_history/export",
    token,
  );
  return parseAssignmentWorkbook(workbook);
}

function orderFilters(organizationId) {
  return {
    date: [],
    organization_ids: [organizationId],
    delivery_types: null,
    delivery_address_ids: null,
    contracts: null,
    warehouses_ids: null,
    cancel_reasons_ids: null,
    order_numbers: null,
    type: "shipped",
  };
}

async function fetchOrganizationPurchases(page, token, organization) {
  const purchases = [];
  let pageNumber = 1;
  let totalPages = 1;

  while (pageNumber <= totalPages && pageNumber <= 10_000) {
    const url = new URL("https://lkp.atol.ru/api/v1/reports/orders");
    url.searchParams.set(
      "filters",
      JSON.stringify(orderFilters(organization.id)),
    );
    url.searchParams.set("filters_exist", "true");
    url.searchParams.set("total_exist", "false");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("page", String(pageNumber));
    url.searchParams.set("sort", "shipment_at");
    url.searchParams.set("sort_type", "desc");

    const payload = await apiJson(page, url.toString(), token);
    const items = payload.data?.items ?? [];
    totalPages = Number(payload.meta?.total_pages ?? 1);

    for (const item of items) {
      const productCode = String(item.product_code ?? "").trim();
      if (
        productCode !== PRODUCT_CODE &&
        !isAnnualItsPurchase(item.product_nomenclature)
      ) {
        continue;
      }

      const quantity = resolvePurchaseQuantity(item);
      if (!quantity) continue;
      purchases.push({
        id:
          item.id ??
          `${organization.id}-${item.order_external_number}-${item.number_realization}-${item.shipment_at}`,
        date: item.shipment_at ?? null,
        quantity: quantity.quantity,
        reportedQuantity: quantity.reportedQuantity,
        quantitySource: quantity.quantitySource,
        unitPrice: quantity.unitPrice,
        unitPriceField: quantity.unitPriceField,
        amount: quantity.amount,
        amountField: quantity.amountField,
        organization: organization.organization,
        rawOrganization: organization.name,
      });
    }

    pageNumber += 1;
  }

  return purchases;
}

async function synchronize() {
  if (syncInProgress) {
    throw new Error("Синхронизация уже выполняется");
  }
  syncInProgress = true;

  try {
    const lkp = await prepareAuthenticatedPage("lkp");
    if (!lkp.token) throw new AuthenticationError();

    const ac = await prepareAuthenticatedPage("ac");
    if (!ac.token) throw new AuthenticationError();

    const [{ assignments, total }, purchaseGroups] = await Promise.all([
      fetchAssignments(ac.page, ac.token),
      Promise.all(
        ORGANIZATIONS.map((organization) =>
          fetchOrganizationPurchases(lkp.page, lkp.token, organization),
        ),
      ),
    ]);

    const purchases = purchaseGroups.flat();
    lastSync = new Date().toISOString();
    const payload = {
      assignments,
      purchases,
      meta: {
        syncedAt: lastSync,
        assignmentRows: total,
        itsAssignments: assignments.length,
        itsPurchases: purchases.length,
      },
    };
    await storeSyncedData(payload);
    return payload;
  } finally {
    syncInProgress = false;
    const activeContext = context;
    if (activeContext) {
      try {
        await activeContext.close();
      } catch {
        // Closing the auxiliary browser is best-effort.
      }
    }
  }
}

async function openLogin() {
  if (HEADLESS) {
    throw new AuthenticationError(
      "На сервере включен режим без окна. Укажите ATOL_LOGIN и ATOL_PASSWORD в файле .env.local.",
      true,
    );
  }
  const page = await getPage("lkp");
  await page.goto("https://lkp.atol.ru/", {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.bringToFront();
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  if (!isAllowedOrigin(origin)) {
    sendJson(response, 403, { error: "Недопустимый источник запроса" }, origin);
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      const state = await readServerState();
      sendJson(
        response,
        200,
        {
          ready: true,
          browserOpen: Boolean(context),
          syncInProgress,
          lastSync: state.syncedData?.meta?.syncedAt ?? lastSync,
          headless: HEADLESS,
          credentialsConfigured: Boolean(ATOL_LOGIN && ATOL_PASSWORD),
        },
        origin,
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/state") {
      sendJson(response, 200, await readServerState(), origin);
      return;
    }

    if (request.method === "POST" && url.pathname === "/state") {
      const body = await readJsonBody(request);
      const state =
        body?.migration === true
          ? await migrateLegacyState(body)
          : await storeEngineerOrganization(
              body?.engineer,
              body?.organization,
            );
      sendJson(response, 200, state, origin);
      return;
    }

    if (request.method === "POST" && url.pathname === "/open-login") {
      await openLogin();
      sendJson(
        response,
        202,
        { ok: true, message: "Окно АТОЛ открыто" },
        origin,
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      const payload = await synchronize();
      sendJson(response, 200, payload, origin);
      return;
    }

    sendJson(response, 404, { error: "Маршрут не найден" }, origin);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      sendJson(
        response,
        401,
        {
          error: error.message,
          loginRequired: true,
          credentialsRequired: error.credentialsRequired,
        },
        origin,
      );
      return;
    }

    sendJson(
      response,
      500,
      {
        error: error instanceof Error ? error.message : "Ошибка синхронизации",
      },
      origin,
    );
  }
});

async function readJsonBody(request, maximumBytes = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new Error("Слишком большой запрос");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Некорректный JSON");
  }
}

server.listen(PORT, HOST, () => {
  console.log(`АТОЛ-помощник: http://${HOST}:${PORT}`);
});

async function shutdown() {
  server.close();
  if (context) await context.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
