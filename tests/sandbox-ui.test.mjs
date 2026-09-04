import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("sandbox exposes the initialized playback, save, ruler, inspection, and graph controls", async () => {
  const source = await readFile(new URL("../app/sandbox.tsx", import.meta.url), "utf8");
  const graphSource = await readFile(new URL("../app/sandbox-graph.tsx", import.meta.url), "utf8");

  assert.match(source, /Run \/ Initialize/);
  assert.match(source, /Ⅱ Pause/);
  assert.match(source, /▶ Play/);
  assert.match(source, /Reset returns to the Run baseline/);
  assert.match(source, /Save \/ Load code/);
  assert.match(source, /Ruler/);
  assert.match(source, /Free-body diagram/);
  assert.match(source, /Live graph/);
  assert.match(graphSource, /Drag to highlight/);
  assert.match(graphSource, /Clear highlight/);
});
