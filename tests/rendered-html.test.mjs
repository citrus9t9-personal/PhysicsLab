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

test("server-renders the complete MotionLab simulator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MotionLab — Interactive AP Physics Simulator<\/title>/i);
  assert.doesNotMatch(html, /Build the motion|Read every change|Drop an object anywhere/i);
  assert.match(html, /Kinematics/);
  assert.match(html, /Pulleys/);
  assert.match(html, /Collisions/);
  assert.match(html, /Springs/);
  assert.match(html, /Sandbox mode/);
  assert.match(html, /Drag, connect, and build freely/);
  assert.match(html, /Run experiment/);
  assert.match(html, /past position/);
  assert.match(html, /apex · vᵧ = 0/);
  assert.match(html, /Live analysis/);
  assert.match(html, /Free-body diagram/);
  assert.match(html, /Graphs/);
  assert.doesNotMatch(html, /See the forces|behind the motion|Capture this moment|Experiment notebook/);
  assert.doesNotMatch(html, /Codex is working|Your site is taking shape/);
});

test("renders accessible controls with the planned projectile defaults", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(
    html,
    /<input(?=[^>]*id="launch-speed")(?=[^>]*min="4")(?=[^>]*max="30")(?=[^>]*step="0\.5")(?=[^>]*value="18")[^>]*>/i,
  );
  assert.match(
    html,
    /<input(?=[^>]*id="launch-angle")(?=[^>]*min="10")(?=[^>]*max="80")(?=[^>]*step="1")(?=[^>]*value="42")[^>]*>/i,
  );
  assert.match(
    html,
    /<input(?=[^>]*id="projectile-mass")(?=[^>]*min="0\.5")(?=[^>]*max="8")(?=[^>]*step="0\.5")(?=[^>]*value="1\.5")[^>]*>/i,
  );
  assert.match(html, /aria-label="Simulation timeline"/i);
  assert.match(html, /aria-label="Playback speed"/i);
  assert.match(html, /aria-pressed="true">0\.5(?:<!-- -->)?×<\/button>/i);
  assert.doesNotMatch(html, /<select\b|<option\b/i);
  assert.match(html, /aria-live="polite"/i);
  assert.match(html, /Reset current experiment/);
});
