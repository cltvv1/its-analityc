import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ИТС subscription dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ИТС Баланс — учёт подписок<\/title>/i);
  assert.match(html, /Актуализация данных/);
  assert.match(html, /Баланс за период/);
  assert.match(html, /Обновить данные/);
  assert.match(html, /Период отчёта/);
  assert.match(html, /Точка отсчёта/);
  assert.match(html, /Общий остаток AC/);
  assert.match(html, /Фактический остаток AC/);
  assert.match(html, /Включить тёмную тему/);
  assert.match(html, /Инженеры и организации/);
  assert.match(html, /ВИТМА-С/);
  assert.match(html, /ВИТМА-КЛИМАТ/);
  assert.doesNotMatch(
    html,
    /Резервная загрузка Excel|codex-preview|react-loading-skeleton/,
  );
});
