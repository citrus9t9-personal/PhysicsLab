import assert from "node:assert/strict";
import test from "node:test";

import { getFixedGraphScale, getGraphGridStep, revealGraphSamples } from "../app/graph.mjs";

const samples = [
  { time: 0, position: 0, velocity: 0, acceleration: 10 },
  { time: 1, position: 10, velocity: 4, acceleration: 10 },
  { time: 2, position: 0, velocity: -2, acceleration: 10 },
];

test("graph reveals only the motion that has happened", () => {
  const revealed = revealGraphSamples(samples, "position", 0.5);

  assert.deepEqual(revealed, [
    { time: 0, value: 0 },
    { time: 0.5, value: 5 },
  ]);
  assert.equal(revealGraphSamples(samples, "position", 2).length, samples.length);
});

test("graph scale is based on the full experiment, not revealed progress", () => {
  const scale = getFixedGraphScale(samples, "position");
  const earlyValues = revealGraphSamples(samples, "position", 0.5).map((sample) => sample.value);

  assert.ok(scale.max > Math.max(...earlyValues));
  assert.deepEqual(scale, { min: -1.2, max: 11.2 });
});

test("constant data still receives a stable visible range", () => {
  assert.deepEqual(getFixedGraphScale(samples, "acceleration"), { min: -1.2, max: 11.2 });
});

test("interactive graph grids choose readable one-two-five intervals", () => {
  assert.equal(getGraphGridStep(9), 1);
  assert.equal(getGraphGridStep(28), 5);
  assert.equal(getGraphGridStep(0.8), 0.1);
  assert.equal(getGraphGridStep(120), 20);
});
