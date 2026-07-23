import assert from "node:assert/strict";
import test from "node:test";

import {
  SANDBOX_TOOLS,
  collisionManifold,
  createSandboxItem,
  getItemHitbox,
  getRopeRoute,
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
  const link = { type: "rope", a: "a", b: "b", naturalLength: 4, pulleys: [] };
  const next = stepSandbox([a, b], [link], 0);
  const route = getRopeRoute(next, link);

  assert.ok(route.lengthMeters <= 4.001);
});

test("hitboxes follow each object's actual shape instead of one circular approximation", () => {
  const rod = createSandboxItem("rod", "rod", 30, 30);
  rod.angle = 0;
  const block = createSandboxItem("block", "block", 30, 36);
  const cart = createSandboxItem("cart", "cart", 60, 40);
  const ball = createSandboxItem("ball", "ball", 70, 40);

  assert.equal(getItemHitbox(rod).kind, "box");
  assert.ok(getItemHitbox(rod).halfWidth > getItemHitbox(rod).halfHeight * 5);
  assert.ok(getItemHitbox(cart).halfWidth > getItemHitbox(cart).halfHeight);
  assert.equal(getItemHitbox(ball).kind, "circle");
  assert.equal(collisionManifold(rod, block), null);
});

test("ropes attach at object surfaces and wrap around a pulley rim", () => {
  const start = createSandboxItem("block", "start", 20, 70);
  const end = createSandboxItem("block", "end", 80, 70);
  const pulley = createSandboxItem("pulley", "pulley", 50, 35);
  const link = {
    type: "rope",
    a: "start",
    b: "end",
    naturalLength: 14,
    pulleys: [{ id: "pulley", direction: 0 }],
  };
  const route = getRopeRoute([start, end, pulley], link);
  const pulleyRadius = getItemHitbox(pulley).radius;

  assert.ok(route.points[0].x > start.x);
  assert.ok(route.points.at(-1).x < end.x);
  assert.equal(route.wraps.length, 1);
  assert.ok(route.points.some((point) => point.y < pulley.y - pulleyRadius));
  for (const point of route.points.slice(1, -1)) {
    const rimDistance = Math.hypot(point.x - pulley.x, point.y - pulley.y);
    if (Math.abs(point.x - pulley.x) < pulleyRadius + 1 && point.y < pulley.y) {
      assert.ok(rimDistance >= pulleyRadius - 0.01);
    }
  }
});

test("a rotated platform uses its rectangular hitbox as a wall", () => {
  const wall = createSandboxItem("platform", "wall", 52, 50);
  wall.angle = 90;
  const ball = createSandboxItem("ball", "ball", 47, 50);
  ball.vx = 5;
  ball.vy = 0;
  const next = stepSandbox([wall, ball], [], 0.04).find((item) => item.id === "ball");

  assert.ok(next.vx < 0);
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
