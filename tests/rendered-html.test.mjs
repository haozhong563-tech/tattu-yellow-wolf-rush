import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the TATTU game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>TATTU黄狼极速无限消<\/title>/);
  assert.match(html, /能量阵列启动中/);
  assert.match(html, /tattu-logo\.png/);
  assert.match(html, /assets\/Game-[^"']+\.js/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});
