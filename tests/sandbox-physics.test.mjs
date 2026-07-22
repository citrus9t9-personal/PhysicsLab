import assert from "node:assert/strict";
import test from "node:test";

import {
  SANDBOX_TOOLS,
  createSandboxItem,
  resetSandbox,
  stepSandbox,
} from "../app/sandbox-physics.mjs";

test("sandbox exposes every requested object and connector", () => {
  assert.deepEqual(
    SANDBOX_TOOLS.map((tool) => tool.type),
    ["block", "ball", "cart", "rod", "wheel", "pendulum", "collision-target", "platform", "incline", "pulley", "pivot", "circular-track", "gravity-region", "rope", "spring"],
  );
});

test("dynamic bodies advance under gravity while carts stay on their track", () => {
  const block = createSandboxItem("block", "block", 30, 20);
  const cart = createSandboxItem("cart", "cart", 30, 50);
  const [nextBlock, nextCart] = stepSandbox([block, cart], [], 0.04);

  assert.ok(nextBlock.y > block.y);
  assert.ok(nextBlock.vy > block.vy);
  assert.equal(nextCart.y, cart.y);
  assert.ok(nextCart.x > cart.x);
});

test("gravity regions override gravity direction inside their bounds", () => {
  const region = createSandboxItem("gravity-region", "region", 50, 50);
  region.gravityDirection = 0;
  const block = createSandboxItem("block", "block", 50, 50);
  const next = stepSandbox([region, block], [], 0.04).find((item) => item.id === "block");

  assert.ok(next.vx > 0);
  assert.ok(Math.abs(next.vy) < 1e-9);
});

test("ropes enforce their maximum length", () => {
  const a = createSandboxItem("block", "a", 20, 30);
  const b = createSandboxItem("block", "b", 80, 30);
  const [nextA, nextB] = stepSandbox([a, b], [{ type: "rope", a: "a", b: "b", naturalLength: 4 }], 0);

  assert.ok(Math.hypot(nextB.x - nextA.x, nextB.y - nextA.y) <= 28.001);
});

test("stretched springs accelerate connected objects toward each other", () => {
  const a = createSandboxItem("block", "a", 20, 30);
  const b = createSandboxItem("block", "b", 60, 30);
  const [nextA, nextB] = stepSandbox([a, b], [{ type: "spring", a: "a", b: "b", naturalLength: 1, springConstant: 20 }], 0.04);

  assert.ok(nextA.vx > 0);
  assert.ok(nextB.vx < 0);
});

test("collision targets reflect approaching bodies", () => {
  const target = createSandboxItem("collision-target", "target", 50, 50);
  const ball = createSandboxItem("ball", "ball", 43, 50);
  ball.vx = 5;
  ball.vy = 0;
  const next = stepSandbox([target, ball], [], 0.04).find((item) => item.id === "ball");

  assert.ok(next.vx < 0);
});

test("reset restores placed positions and initial velocities", () => {
  const ball = createSandboxItem("ball", "ball", 40, 20);
  const moved = { ...ball, x: 75, y: 80, vx: -8, vy: 5 };

  assert.deepEqual(resetSandbox([moved])[0], { ...ball, angularVelocity: 0 });
});
