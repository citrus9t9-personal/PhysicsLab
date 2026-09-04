import assert from "node:assert/strict";
import test from "node:test";

import {
  GROUND_Y,
  WORLD_SCALE,
  createSandboxItem,
  getSandboxAnalysis,
} from "../app/sandbox-physics.mjs";
import {
  decodeSandboxProject,
  encodeSandboxProject,
  getSandboxRulerAnchors,
  measureSandboxPoints,
  resolveSandboxRulerPoint,
} from "../app/sandbox-project.mjs";

test("project codes use only letters and numbers and restore all experiment values", () => {
  const block = createSandboxItem("block", "sandbox-block-12", 40, 80);
  block.mass = 7.5;
  block.initialVx = 3.25;
  block.vx = 3.25;
  block.friction = 0.42;
  const pulley = createSandboxItem("pulley", "sandbox-pulley-13", 80, 40);
  const ball = createSandboxItem("ball", "sandbox-ball-14", 100, 90);
  const rope = {
    id: "sandbox-link-15",
    type: "rope",
    a: block.id,
    b: ball.id,
    naturalLength: 14.5,
    springConstant: 18,
    verticalSnap: true,
    pulleys: [{ id: pulley.id, direction: -1 }],
  };

  const code = encodeSandboxProject([block, pulley, ball], [rope]);
  const restored = decodeSandboxProject(code);

  assert.match(code, /^[a-zA-Z0-9]+$/);
  assert.ok(code.startsWith("PHY1"));
  assert.equal(restored.items[0].mass, 7.5);
  assert.equal(restored.items[0].initialVx, 3.25);
  assert.equal(restored.items[0].friction, 0.42);
  assert.equal(restored.links[0].naturalLength, 14.5);
  assert.equal(restored.links[0].verticalSnap, true);
  assert.equal(restored.links[0].pulleys[0].direction, -1);
});

test("project codes reject damage instead of loading partial experiments", () => {
  assert.throws(() => decodeSandboxProject("PHY1abc"), /incomplete|damaged/i);
  assert.throws(() => decodeSandboxProject("NOTAPHYSICSLABCODE"), /not a PhysicsLab/i);
});

test("the ruler measures named corners, sides, and grid intersections", () => {
  const first = createSandboxItem("block", "first", 20, 50);
  const second = createSandboxItem("block", "second", 40, 50);
  const measurement = measureSandboxPoints(
    [first, second],
    { kind: "object", itemId: first.id, anchor: "east" },
    { kind: "grid", x: second.x, y: second.y },
  );
  const anchors = getSandboxRulerAnchors(first);

  assert.equal(anchors.length, 9);
  assert.equal(anchors.find((anchor) => anchor.id === "east").x, first.x + WORLD_SCALE / 2);
  assert.equal(anchors.find((anchor) => anchor.id === "north-west").y, first.y - WORLD_SCALE / 2);
  assert.equal(measurement.distance, 3.5);
  assert.equal(measurement.start.x, first.x + WORLD_SCALE / 2);
  assert.equal(measurement.end.x, second.x);
});

test("object ruler points stay attached while an object moves", () => {
  const block = createSandboxItem("block", "moving", 20, 50);
  const reference = { kind: "object", itemId: block.id, anchor: "south-east" };
  const before = resolveSandboxRulerPoint([block], reference);
  const after = resolveSandboxRulerPoint([{ ...block, x: 35, y: 65 }], reference);

  assert.equal(after.x - before.x, 15);
  assert.equal(after.y - before.y, 15);
});

test("inclines and pendulums expose their physical endpoints", () => {
  const incline = createSandboxItem("incline", "slope", 80, 100);
  const pendulum = createSandboxItem("pendulum", "pendulum", 120, 40);
  pendulum.length = 4;
  const inclineAnchors = getSandboxRulerAnchors(incline);
  const pendulumAnchors = getSandboxRulerAnchors(pendulum);

  assert.ok(inclineAnchors.some((anchor) => anchor.id === "low-end"));
  assert.ok(inclineAnchors.some((anchor) => anchor.id === "high-end"));
  assert.ok(inclineAnchors.some((anchor) => anchor.id === "right-angle"));
  assert.equal(pendulumAnchors.find((anchor) => anchor.id === "pivot").y, pendulum.y);
  assert.equal(pendulumAnchors.find((anchor) => anchor.id === "bob-center").y, pendulum.y + pendulum.length * WORLD_SCALE);
});

test("paused analysis reports force, acceleration, momentum, and energy", () => {
  const block = createSandboxItem("block", "block", 200, 100);
  block.mass = 2;
  block.vx = 3;
  const analysis = getSandboxAnalysis([block], [], block.id);
  const weight = analysis.forces.find((force) => force.label === "Weight");

  assert.ok(Math.abs(analysis.acceleration.y - 9.81) < 1e-6);
  assert.ok(Math.abs(analysis.netForce.magnitude - 19.62) < 1e-6);
  assert.ok(Math.abs(weight.magnitude - 19.62) < 1e-6);
  assert.equal(analysis.momentum.x, 6);
  assert.equal(analysis.kineticEnergy, 9);
});

test("a resting supported block shows balanced weight and normal force", () => {
  const block = createSandboxItem("block", "block", 200, GROUND_Y - WORLD_SCALE / 2);
  block.supportSurfaceId = "world-ground";
  block.supportSurfaceAngle = 0;
  const analysis = getSandboxAnalysis([block], [], block.id);

  assert.ok(analysis.forces.some((force) => force.label === "Weight"));
  assert.ok(analysis.forces.some((force) => force.label === "Normal"));
  assert.ok(analysis.netForce.magnitude < 1e-6);
});
