import assert from "node:assert/strict";
import test from "node:test";

import {
  CANVAS_PIXELS_PER_UNIT,
  GRID_STEP,
  GROUND_Y,
  LEFT_WALL_X,
  RIGHT_WALL_X,
  SANDBOX_WORLD_HEIGHT,
  SANDBOX_WORLD_WIDTH,
  SANDBOX_TOOLS,
  WALL_THICKNESS,
  WORLD_SCALE,
  applyPulleyRopeGuides,
  clampItemToWorkspace,
  cloneSandboxExperiment,
  collisionManifold,
  createSandboxItem,
  createStarterSandbox,
  findSnapPlacement,
  findSmoothSurfaceJoin,
  getConnectionAnchor,
  getInclineGeometry,
  getItemBounds,
  getItemHitbox,
  getItemHitboxes,
  getRodAnchorPoint,
  getRopeRoute,
  resetSandbox,
  resizePendulumFromBob,
  resizeSquareFromCorner,
  snapSandboxItemPosition,
  snapToGrid,
  stepSandbox,
} from "../app/sandbox-physics.mjs";

test("sandbox exposes every requested object and connector", () => {
  assert.deepEqual(
    SANDBOX_TOOLS.map((tool) => tool.type),
    ["block", "ball", "cart", "rod", "wheel", "pendulum", "platform", "incline", "pulley", "gravity-region", "rope", "spring"],
  );
});

test("new objects start with zero motion, friction, and optional rotation", () => {
  for (const type of ["block", "ball", "cart", "rod", "wheel", "pendulum"]) {
    const item = createSandboxItem(type, type);
    assert.equal(item.vx, 0);
    assert.equal(item.vy, 0);
    assert.equal(item.initialVx, 0);
    assert.equal(item.initialVy, 0);
    assert.equal(item.friction, 0);
    assert.equal(item.angle, 0);
    assert.equal(item.initialAngle, 0);
  }
});

test("the click grid rounds placement and resize coordinates consistently", () => {
  assert.equal(GRID_STEP, 5);
  assert.equal(WORLD_SCALE, GRID_STEP);
  assert.equal(SANDBOX_WORLD_WIDTH, 500);
  assert.equal(SANDBOX_WORLD_HEIGHT, 500);
  assert.equal(WALL_THICKNESS, GRID_STEP * 2);
  assert.equal(LEFT_WALL_X, 10);
  assert.equal(RIGHT_WALL_X, 490);
  assert.equal(GROUND_Y, 490);
  assert.equal(CANVAS_PIXELS_PER_UNIT, 6);
  assert.equal(snapToGrid(12), 10);
  assert.equal(snapToGrid(13), 15);
  assert.equal(snapToGrid(31, 10), 30);
});

test("blocks, platforms, and incline boundaries sit flush with grid lines", () => {
  const block = createSandboxItem("block", "block", 12, 18);
  const position = snapSandboxItemPosition(block);
  const halfSize = (block.size * WORLD_SCALE) / 2;

  assert.equal(position.x, 12.5);
  assert.equal(position.y, 17.5);
  assert.equal((position.x - halfSize) % GRID_STEP, 0);
  assert.equal((position.x + halfSize) % GRID_STEP, 0);
  assert.equal((position.y - halfSize) % GRID_STEP, 0);
  assert.equal((position.y + halfSize) % GRID_STEP, 0);

  const platform = createSandboxItem("platform", "platform", 12, 18);
  const platformPosition = snapSandboxItemPosition(platform);
  const halfWidth = (platform.width * WORLD_SCALE) / 2;
  const halfHeight = (platform.height * WORLD_SCALE) / 2;
  assert.equal((platformPosition.x - halfWidth) % GRID_STEP, 0);
  assert.equal((platformPosition.x + halfWidth) % GRID_STEP, 0);
  assert.equal((platformPosition.y - halfHeight) % GRID_STEP, 0);
  assert.equal((platformPosition.y + halfHeight) % GRID_STEP, 0);

  const incline = createSandboxItem("incline", "incline", 12, 18);
  incline.angle = 30;
  const inclinePosition = snapSandboxItemPosition(incline);
  const geometry = getInclineGeometry(incline);
  assert.equal((inclinePosition.x - geometry.width / 2) % GRID_STEP, 0);
  assert.equal((inclinePosition.x + geometry.width / 2) % GRID_STEP, 0);
  assert.ok(Math.abs((inclinePosition.y + geometry.height / 2) % GRID_STEP) < 1e-9);
  assert.ok(Math.abs(getItemHitbox(incline).halfWidth * Math.cos(Math.PI / 6) - geometry.width / 2) < 1e-9);

  const region = createSandboxItem("gravity-region", "region", 12, 18);
  const regionPosition = snapSandboxItemPosition(region);
  const regionHalfWidth = (region.width * WORLD_SCALE) / 2;
  const regionHalfHeight = (region.height * WORLD_SCALE) / 2;
  assert.ok(Math.abs((regionPosition.x - regionHalfWidth) % GRID_STEP) < 1e-9);
  assert.ok(Math.abs((regionPosition.x + regionHalfWidth) % GRID_STEP) < 1e-9);
  assert.ok(Math.abs((regionPosition.y - regionHalfHeight) % GRID_STEP) < 1e-9);
  assert.ok(Math.abs((regionPosition.y + regionHalfHeight) % GRID_STEP) < 1e-9);
  assert.equal(createStarterSandbox().find((item) => item.id === "starter-block").type, "block");
});

test("flipping an incline reverses its physical slope without changing its grid footprint", () => {
  const incline = createSandboxItem("incline", "incline", 60, 60);
  incline.angle = 30;
  const forwardGeometry = getInclineGeometry(incline);
  const forwardHitbox = getItemHitbox(incline);

  incline.angle = -30;
  const flippedGeometry = getInclineGeometry(incline);
  const flippedHitbox = getItemHitbox(incline);

  assert.deepEqual(flippedGeometry, forwardGeometry);
  assert.equal(flippedHitbox.angle, -forwardHitbox.angle);
  assert.equal(flippedHitbox.x, forwardHitbox.x);
  assert.equal(flippedHitbox.y, forwardHitbox.y);
});

test("block corner resizing keeps the opposite corner fixed", () => {
  const block = createSandboxItem("block", "block", 12.5, 12.5);
  const resized = resizeSquareFromCorner(block, "se", 20, 20);

  assert.equal(block.size, 1);
  assert.equal(resized.size, 2);
  assert.equal(resized.x, 15);
  assert.equal(resized.y, 15);
  assert.equal(resized.x - resized.size * WORLD_SCALE / 2, 10);
  assert.equal(resized.y - resized.size * WORLD_SCALE / 2, 10);
});

test("connection anchors use pulley centers and rectangular object edges", () => {
  const pulley = createSandboxItem("pulley", "pulley", 50, 50);
  const block = createSandboxItem("block", "block", 80, 50);
  const pulleyAnchor = getConnectionAnchor(pulley, block);
  const blockAnchor = getConnectionAnchor(block, pulley);

  assert.deepEqual(pulleyAnchor, { x: 50, y: 50 });
  assert.equal(blockAnchor.x, 80 - (block.size * WORLD_SCALE) / 2);
  assert.equal(blockAnchor.y, 50);
});

test("inclines snap their low endpoint to a platform top without a gap", () => {
  const platform = createSandboxItem("platform", "platform", 100, 200);
  const incline = createSandboxItem("incline", "incline", 130, 185);
  incline.angle = 30;
  const join = findSmoothSurfaceJoin(incline, [platform], 30);
  assert.ok(join);

  const placed = { ...incline, x: join.x, y: join.y };
  const geometry = getInclineGeometry(placed);
  const lowEndpoint = {
    x: placed.x - geometry.width / 2,
    y: placed.y + geometry.height / 2,
  };
  const platformTop = platform.y - (platform.height * WORLD_SCALE) / 2;
  const platformLeft = platform.x - (platform.width * WORLD_SCALE) / 2;
  const platformRight = platform.x + (platform.width * WORLD_SCALE) / 2;

  assert.equal(lowEndpoint.y, platformTop);
  assert.notEqual(lowEndpoint.x, platformLeft);
  assert.equal(lowEndpoint.x, platformRight);
  assert.equal(join.smooth, true);
});

test("inclines can join either platform height and sit flush on the ground", () => {
  const platform = createSandboxItem("platform", "platform", 150, 150);
  const incline = createSandboxItem("incline", "incline", 110, 170);
  incline.angle = 30;
  const geometry = getInclineGeometry(incline);
  incline.x = platform.x - platform.width * WORLD_SCALE / 2 - geometry.width / 2 + 2;
  incline.y = platform.y - platform.height * WORLD_SCALE / 2 + geometry.height / 2 + 2;
  const join = findSmoothSurfaceJoin(incline, [platform], 10);
  const placed = { ...incline, x: join.x, y: join.y };
  const placedGeometry = getInclineGeometry(placed);
  const high = {
    x: placed.x + placedGeometry.width / 2,
    y: placed.y - placedGeometry.height / 2,
  };
  const platformLeft = platform.x - platform.width * WORLD_SCALE / 2;
  const platformTop = platform.y - platform.height * WORLD_SCALE / 2;

  assert.equal(high.x, platformLeft);
  assert.equal(high.y, platformTop);

  const nearGround = { ...incline, y: GROUND_Y - geometry.height / 2 - 2 };
  const groundJoin = findSmoothSurfaceJoin(nearGround, [], 10);
  const grounded = { ...nearGround, x: groundJoin.x, y: groundJoin.y };
  assert.equal(groundJoin.targetId, "world-ground");
  assert.equal(groundJoin.smooth, true);
  assert.ok(Math.abs(getItemBounds(grounded).bottom - GROUND_Y) < 1e-9);
});

test("dynamic bodies advance under gravity while carts stay on their track", () => {
  const block = createSandboxItem("block", "block", 30, 20);
  const cart = createSandboxItem("cart", "cart", 30, 50);
  cart.vx = 2;
  const [nextBlock, nextCart] = stepSandbox([block, cart], [], 0.04);

  assert.ok(nextBlock.y > block.y);
  assert.ok(nextBlock.vy > block.vy);
  assert.equal(nextCart.y, cart.y);
  assert.ok(nextCart.x > cart.x);
});

test("sandbox motion is independent of common display frame rates", () => {
  const simulate = (delta, frames) => {
    let items = [createSandboxItem("ball", "ball", 250, 100)];
    items[0].vx = 3;
    items[0].vy = -2;
    for (let frame = 0; frame < frames; frame += 1) {
      items = stepSandbox(items, [], delta);
    }
    return items[0];
  };

  const atThirtyFps = simulate(1 / 30, 30);
  const atSixtyFps = simulate(1 / 60, 60);
  const atOneTwentyFps = simulate(1 / 120, 120);

  for (const property of ["x", "y", "vx", "vy"]) {
    assert.ok(Math.abs(atThirtyFps[property] - atSixtyFps[property]) < 1e-9, property);
    assert.ok(Math.abs(atSixtyFps[property] - atOneTwentyFps[property]) < 1e-9, property);
  }
});

test("a long rendered frame advances the full requested simulation time", () => {
  const cart = createSandboxItem("cart", "cart", 100, 100);
  cart.vx = 2;

  const next = stepSandbox([cart], [], 0.08)[0];

  assert.ok(Math.abs(next.x - (cart.x + cart.vx * WORLD_SCALE * 0.08)) < 1e-9);
});

test("ground friction uses physical elapsed time instead of frame count", () => {
  const simulate = (delta, frames) => {
    const block = createSandboxItem("block", "block", 250, GROUND_Y - WORLD_SCALE / 2);
    block.vx = 5;
    block.friction = 0.2;
    let items = [block];
    for (let frame = 0; frame < frames; frame += 1) {
      items = stepSandbox(items, [], delta);
    }
    return items[0];
  };

  const atThirtyFps = simulate(1 / 30, 30);
  const atOneTwentyFps = simulate(1 / 120, 120);
  const expectedVelocity = 5 - 0.2 * 9.81;

  assert.ok(Math.abs(atThirtyFps.vx - atOneTwentyFps.vx) < 1e-9);
  assert.ok(Math.abs(atOneTwentyFps.vx - expectedVelocity) < 1e-9);
});

test("gravity regions override gravity direction inside their bounds", () => {
  const region = createSandboxItem("gravity-region", "region", 50, 50);
  region.gravityDirection = 0;
  const block = createSandboxItem("block", "block", 50, 50);
  const next = stepSandbox([region, block], [], 0.04).find((item) => item.id === "block");

  assert.ok(next.vx > 0);
  assert.ok(Math.abs(next.vy) < 1e-9);
});

test("gravity regions use independently resizable width and height", () => {
  const region = createSandboxItem("gravity-region", "region", 50, 50);
  region.width = 1;
  region.height = 8;
  region.gravityDirection = 0;
  const inside = createSandboxItem("block", "inside", 52, 50);
  const outside = createSandboxItem("block", "outside", 54, 50);
  const next = stepSandbox([region, inside, outside], [], 0.04);

  assert.ok(next.find((item) => item.id === "inside").vx > 0);
  assert.ok(next.find((item) => item.id === "outside").vy > 0);
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

test("platform hitboxes resize as full rectangles while inclines keep a sloped surface", () => {
  const platform = createSandboxItem("platform", "platform", 40, 50);
  platform.width = 6;
  platform.height = 2;
  const platformBox = getItemHitbox(platform);
  const incline = createSandboxItem("incline", "incline", 60, 50);
  const inclineBox = getItemHitbox(incline);

  assert.equal(platformBox.halfWidth, 15);
  assert.equal(platformBox.halfHeight, 5);
  assert.equal(inclineBox.angle, (-incline.angle * Math.PI) / 180);
  assert.ok(inclineBox.halfWidth > inclineBox.halfHeight * 10);
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
  assert.ok(route.points[0].x < pulley.x);
  assert.ok(route.points[0].y < start.y);
  assert.ok(route.points.at(-1).x < end.x);
  assert.ok(route.points.at(-1).x > pulley.x);
  assert.ok(route.points.at(-1).y < end.y);
  assert.equal(route.wraps.length, 1);
  assert.ok(route.points.some((point) => point.y < pulley.y - pulleyRadius));
  for (const point of route.points.slice(1, -1)) {
    const rimDistance = Math.hypot(point.x - pulley.x, point.y - pulley.y);
    if (Math.abs(point.x - pulley.x) < pulleyRadius + 1 && point.y < pulley.y) {
      assert.ok(rimDistance >= pulleyRadius - 0.01);
    }
  }
});

test("pulley-guided hanging blocks stay on straight vertical rope segments", () => {
  const left = createSandboxItem("block", "left", 30, 80);
  const right = createSandboxItem("block", "right", 70, 80);
  right.mass = 2;
  const pulley = createSandboxItem("pulley", "pulley", 50, 35);
  const link = {
    type: "rope",
    a: "left",
    b: "right",
    naturalLength: 20,
    verticalSnap: true,
    pulleys: [{ id: "pulley", direction: 0 }],
  };
  const items = [left, right, pulley];
  applyPulleyRopeGuides(items, [link]);
  const leftX = left.x;
  const rightX = right.x;
  const route = getRopeRoute(items, link);

  assert.ok(Math.abs(route.points[0].x - route.wraps[0].entry.x) < 1e-6);
  assert.ok(Math.abs(route.points.at(-1).x - route.wraps[0].exit.x) < 1e-6);

  let next = items;
  for (let frame = 0; frame < 20; frame += 1) next = stepSandbox(next, [link], 0.04);
  assert.ok(Math.abs(next.find((item) => item.id === "left").x - leftX) < 1e-9);
  assert.ok(Math.abs(next.find((item) => item.id === "right").x - rightX) < 1e-9);
  assert.equal(next.find((item) => item.id === "left").vx, 0);
  assert.equal(next.find((item) => item.id === "right").vx, 0);
});

test("vertical pulley guides only move endpoints when auto-snap is enabled", () => {
  const left = createSandboxItem("block", "left", 30, 80);
  const right = createSandboxItem("block", "right", 70, 80);
  const pulley = createSandboxItem("pulley", "pulley", 50, 35);
  const link = {
    type: "rope",
    a: "left",
    b: "right",
    naturalLength: 20,
    verticalSnap: false,
    pulleys: [{ id: "pulley", direction: 0 }],
  };
  const items = [left, right, pulley];
  const originalX = [left.x, right.x];

  applyPulleyRopeGuides(items, [link]);
  assert.deepEqual([left.x, right.x], originalX);

  link.verticalSnap = true;
  applyPulleyRopeGuides(items, [link]);
  assert.notDeepEqual([left.x, right.x], originalX);
});

test("balanced Atwood masses remain at rest even when one is on the ground", () => {
  const left = createSandboxItem("block", "left", 30, 80);
  const right = createSandboxItem("block", "right", 70, GROUND_Y - 2.5);
  const pulley = createSandboxItem("pulley", "pulley", 50, 35);
  const link = {
    type: "rope",
    a: "left",
    b: "right",
    naturalLength: 1,
    verticalSnap: true,
    pulleys: [{ id: "pulley", direction: 0 }],
  };
  let items = [left, right, pulley];
  applyPulleyRopeGuides(items, [link]);
  link.naturalLength = getRopeRoute(items, link).lengthMeters;
  const leftY = left.y;
  const rightY = right.y;

  for (let frame = 0; frame < 120; frame += 1) items = stepSandbox(items, [link], 0.04);
  const nextLeft = items.find((item) => item.id === "left");
  const nextRight = items.find((item) => item.id === "right");
  assert.equal(nextLeft.y, leftY);
  assert.equal(nextRight.y, rightY);
  assert.equal(nextLeft.vy, 0);
  assert.equal(nextRight.vy, 0);
});

test("an unequal Atwood pair uses the ideal mass-difference acceleration", () => {
  const left = createSandboxItem("block", "left", 30, 80);
  const right = createSandboxItem("block", "right", 70, 80);
  right.mass = 4;
  const pulley = createSandboxItem("pulley", "pulley", 50, 35);
  const link = {
    type: "rope",
    a: "left",
    b: "right",
    naturalLength: 1,
    verticalSnap: true,
    pulleys: [{ id: "pulley", direction: 0 }],
  };
  const items = [left, right, pulley];
  applyPulleyRopeGuides(items, [link]);
  link.naturalLength = getRopeRoute(items, link).lengthMeters;
  const next = stepSandbox(items, [link], 0.04);
  const expectedSpeed = (9.81 / 3) * 0.04;

  assert.ok(Math.abs(next.find((item) => item.id === "left").vy + expectedSpeed) < 1e-9);
  assert.ok(Math.abs(next.find((item) => item.id === "right").vy - expectedSpeed) < 1e-9);
});

test("multi-pulley rope routes preserve the visible start-to-end order", () => {
  const start = createSandboxItem("block", "start", 15, 70);
  const firstPulley = createSandboxItem("pulley", "first", 40, 35);
  const secondPulley = createSandboxItem("pulley", "second", 62, 35);
  const end = createSandboxItem("block", "end", 85, 70);
  const route = getRopeRoute(
    [start, firstPulley, secondPulley, end],
    {
      type: "rope",
      a: "start",
      b: "end",
      naturalLength: 20,
      pulleys: [{ id: "first", direction: 0 }, { id: "second", direction: 0 }],
    },
  );

  assert.deepEqual(route.wraps.map((wrap) => wrap.id), ["first", "second"]);
  assert.ok(route.points[0].x < firstPulley.x);
  assert.ok(route.points.at(-1).x > secondPulley.x);
});

test("a double-pulley rope remains taut under opposing endpoint motion", () => {
  const start = createSandboxItem("block", "start", 20, 70);
  const firstPulley = createSandboxItem("pulley", "first", 40, 30);
  const secondPulley = createSandboxItem("pulley", "second", 70, 30);
  const end = createSandboxItem("block", "end", 90, 70);
  start.vx = -3;
  end.vx = 3;
  let items = [start, firstPulley, secondPulley, end];
  const link = {
    type: "rope",
    a: "start",
    b: "end",
    verticalSnap: false,
    pulleys: [{ id: "first", direction: 0 }, { id: "second", direction: 0 }],
    naturalLength: 1,
  };
  link.naturalLength = getRopeRoute(items, link).lengthMeters;

  for (let frame = 0; frame < 100; frame += 1) items = stepSandbox(items, [link], 0.04);

  assert.ok(getRopeRoute(items, link).lengthMeters <= link.naturalLength + 0.001);
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

test("the set ground and placed surfaces reflect perfectly elastically", () => {
  const platform = createSandboxItem("platform", "platform", 50, 60);
  const incline = createSandboxItem("incline", "incline", 70, 60);
  const ball = createSandboxItem("ball", "ball", 40, GROUND_Y);
  ball.y = GROUND_Y - getItemHitbox(ball).radius + 0.1;
  ball.vx = 0;
  ball.vy = 2;
  const next = stepSandbox([platform, incline, ball], [], 0).find((item) => item.id === "ball");

  assert.equal(platform.restitution, 1);
  assert.equal(incline.restitution, 1);
  assert.equal(next.vy, -2);
});

test("every edge of the sandbox is a rigid elastic wall", () => {
  const reflect = (id, x, y, vx, vy) => {
    const ball = createSandboxItem("ball", id, x, y);
    ball.vx = vx;
    ball.vy = vy;
    return stepSandbox([ball], [], 0)[0];
  };
  const radius = getItemHitbox(createSandboxItem("ball", "measure")).radius;

  assert.ok(reflect("left", LEFT_WALL_X + radius - 0.1, 100, -2, 0).vx > 0);
  assert.ok(reflect("right", RIGHT_WALL_X - radius + 0.1, 100, 2, 0).vx < 0);
  assert.ok(reflect("top", 100, radius - 0.1, 0, -2).vy > 0);
  assert.ok(reflect("bottom", 100, GROUND_Y - radius + 0.1, 0, 2).vy < 0);
});

test("default resizable dimensions occupy whole grid squares", () => {
  const wholeSquares = (value) => Number.isInteger((value * WORLD_SCALE) / GRID_STEP);
  for (const type of ["block", "ball", "cart", "rod", "wheel", "pendulum", "incline", "pulley"]) {
    assert.ok(wholeSquares(createSandboxItem(type, type).size), `${type} size should follow the grid`);
  }
  const platform = createSandboxItem("platform", "platform");
  const region = createSandboxItem("gravity-region", "region");
  const pendulum = createSandboxItem("pendulum", "pendulum");

  assert.ok(wholeSquares(platform.width));
  assert.ok(wholeSquares(platform.height));
  assert.ok(wholeSquares(region.width));
  assert.ok(wholeSquares(region.height));
  assert.ok(wholeSquares(pendulum.length));
});

test("blocks align to an incline when the slope supports them", () => {
  const incline = createSandboxItem("incline", "incline", 200, 200);
  incline.angle = 30;
  const block = createSandboxItem("block", "block", 200, 185);
  const snap = findSnapPlacement(block, [incline], 20);
  assert.ok(snap);
  const touchingBlock = { ...block, x: snap.x, y: snap.y, angle: 0, initialAngle: 0 };
  const next = stepSandbox([incline, touchingBlock], [], 0.04).find((item) => item.id === "block");

  assert.ok(Math.abs(next.angle + incline.angle) < 1e-9);
  assert.equal(next.supportSurfaceId, incline.id);
});

test("a block leaving a slope projects its velocity horizontally on flat ground", () => {
  const block = createSandboxItem("block", "block", 200, 200);
  block.angle = -30;
  const extent = getItemBounds(block).bottom - block.y;
  block.y = GROUND_Y - extent + 0.01;
  block.vx = 3;
  block.vy = 4;
  block.supportSurfaceId = "incline";
  block.supportSurfaceAngle = -30;
  block.supportAirTime = 0.04;
  const next = stepSandbox([block], [], 0)[0];

  assert.ok(Math.abs(next.vx - 5) < 1e-9);
  assert.equal(next.vy, 0);
  assert.equal(next.angle, 0);
});

test("a block crosses a slope-to-ground seam without bouncing or losing speed", () => {
  const incline = createSandboxItem("incline", "incline", 150, 0);
  incline.angle = 30;
  incline.initialAngle = 30;
  const geometry = getInclineGeometry(incline);
  incline.y = GROUND_Y - geometry.height / 2;
  const low = { x: incline.x - geometry.width / 2, y: GROUND_Y };
  const tangent = { x: Math.cos(Math.PI / 6), y: -Math.sin(Math.PI / 6) };
  const upward = { x: tangent.y, y: -tangent.x };
  const surfacePoint = {
    x: low.x + 6,
    y: low.y - Math.tan(Math.PI / 6) * 6,
  };
  const block = createSandboxItem("block", "block", surfacePoint.x, surfacePoint.y);
  const surfaceClearance = getItemHitbox(block).halfHeight + getItemHitbox(incline).halfHeight;
  block.x += upward.x * surfaceClearance;
  block.y += upward.y * surfaceClearance;
  block.angle = -30;
  block.initialAngle = -30;
  block.vx = -4 * tangent.x;
  block.vy = 4 * -tangent.y;
  block.supportSurfaceId = incline.id;
  block.supportSurfaceAngle = -30;
  block.supportAirTime = 0;
  const startingSpeed = Math.hypot(block.vx, block.vy);

  let items = [incline, block];
  for (let frame = 0; frame < 12; frame += 1) items = stepSandbox(items, [], 0.04);
  const next = items.find((item) => item.id === block.id);

  assert.equal(next.supportSurfaceId, "world-ground");
  assert.equal(next.supportSurfaceAngle, 0);
  assert.equal(next.angle, 0);
  assert.equal(next.vy, 0);
  assert.ok(next.vx < 0);
  assert.ok(Math.hypot(next.vx, next.vy) >= startingSpeed);
  assert.ok(Math.abs(getItemBounds(next).bottom - GROUND_Y) < 1e-9);
});

test("a block moves smoothly from flat ground onto a slope at full speed", () => {
  const incline = createSandboxItem("incline", "incline", 150, 0);
  incline.angle = 30;
  incline.initialAngle = 30;
  const geometry = getInclineGeometry(incline);
  incline.y = GROUND_Y - geometry.height / 2;
  const lowX = incline.x - geometry.width / 2;
  const block = createSandboxItem("block", "block", lowX - 2.7, GROUND_Y - 2.5);
  block.vx = 4;
  block.vy = 0;
  block.supportSurfaceId = "world-ground";
  block.supportSurfaceAngle = 0;
  block.supportAirTime = 0;
  const region = createSandboxItem("gravity-region", "region", 150, 450);
  region.width = 100;
  region.height = 100;
  region.gravityStrength = 0;

  let items = [region, incline, block];
  for (let frame = 0; frame < 8; frame += 1) items = stepSandbox(items, [], 0.04);
  const next = items.find((item) => item.id === block.id);

  assert.equal(next.supportSurfaceId, incline.id);
  assert.equal(next.angle, -30);
  assert.ok(next.vx > 0);
  assert.ok(next.vy < 0);
  assert.ok(Math.abs(Math.hypot(next.vx, next.vy) - 4) < 1e-6);
});

test("a block transfers both ways between a slope and its upper platform", () => {
  const incline = createSandboxItem("incline", "incline", 137.5, 0);
  incline.angle = 30;
  incline.initialAngle = 30;
  const geometry = getInclineGeometry(incline);
  incline.y = 200 + geometry.height / 2;
  const platform = createSandboxItem("platform", "platform", 162.5, 202.5);
  const block = createSandboxItem("block", "block", 152.7, 197.5);
  block.vx = -4;
  block.vy = 0;
  block.supportSurfaceId = platform.id;
  block.supportSurfaceAngle = 0;
  block.supportAirTime = 0;
  const region = createSandboxItem("gravity-region", "region", 150, 200);
  region.width = 100;
  region.height = 100;
  region.gravityStrength = 0;

  let items = [region, incline, platform, block];
  items = stepSandbox(items, [], 0.04);
  let next = items.find((item) => item.id === block.id);
  assert.equal(next.supportSurfaceId, incline.id);
  assert.equal(next.angle, -30);
  assert.ok(next.vx < 0);
  assert.ok(next.vy > 0);
  assert.ok(Math.abs(Math.hypot(next.vx, next.vy) - 4) < 1e-6);

  items = items.map((item) => item.id === block.id
    ? { ...item, vx: 4 * Math.cos(Math.PI / 6), vy: -4 * Math.sin(Math.PI / 6) }
    : item);
  items = stepSandbox(items, [], 0.04);
  next = items.find((item) => item.id === block.id);
  assert.equal(next.supportSurfaceId, platform.id);
  assert.equal(next.angle, 0);
  assert.ok(next.vx > 0);
  assert.equal(next.vy, 0);
  assert.ok(Math.abs(next.vx - 4) < 1e-6);
});

test("a block keeps its downward velocity when a slope ends in a drop", () => {
  const block = createSandboxItem("block", "block", 200, 200);
  block.angle = -30;
  block.vx = 3;
  block.vy = 4;
  block.supportSurfaceId = "incline";
  block.supportSurfaceAngle = -30;
  block.supportAirTime = 0;

  const first = stepSandbox([block], [], 0.04)[0];
  const second = stepSandbox([first], [], 0.04)[0];
  const third = stepSandbox([second], [], 0.04)[0];

  assert.ok(first.vy > block.vy);
  assert.ok(third.vy > first.vy);
  assert.equal(third.supportSurfaceId, null);
  assert.equal(third.angle, 0);
});

test("nearby objects snap to the exact surface of another hitbox", () => {
  const platform = createSandboxItem("platform", "platform", 50, 60);
  const block = createSandboxItem("block", "block", 50, 52);
  const snap = findSnapPlacement(block, [platform]);
  const placed = { ...block, x: snap.x, y: snap.y };

  assert.equal(snap.targetId, "platform");
  assert.equal(snap.persistent, false);
  assert.ok(Math.abs(snap.normal.y + 1) < 1e-9);
  assert.equal(collisionManifold(placed, platform), null);
  const pressedIntoSurface = {
    ...placed,
    x: placed.x - snap.normal.x * 0.01,
    y: placed.y - snap.normal.y * 0.01,
  };
  assert.ok(collisionManifold(pressedIntoSurface, platform));
});

test("workspace bounds place visible hitboxes exactly against the ground", () => {
  const ball = createSandboxItem("ball", "ball", SANDBOX_WORLD_WIDTH / 2, GROUND_Y);
  const placed = clampItemToWorkspace(ball);
  const hitbox = getItemHitbox(placed);

  assert.equal(hitbox.y + hitbox.radius, GROUND_Y);
  assert.ok(placed.x > LEFT_WALL_X && placed.x < RIGHT_WALL_X);
});

test("circle and rotated-surface snaps also stop at exact hitbox contact", () => {
  const pulley = createSandboxItem("pulley", "pulley", 100, 100);
  const block = createSandboxItem("block", "block", 112, 100);
  const blockSnap = findSnapPlacement(block, [pulley], 20);
  const placedBlock = { ...block, x: blockSnap.x, y: blockSnap.y };
  assert.equal(collisionManifold(placedBlock, pulley), null);
  assert.ok(collisionManifold({ ...placedBlock, x: placedBlock.x - 0.01 }, pulley));

  const platform = createSandboxItem("platform", "platform", 200, 200);
  platform.angle = 30;
  const normal = { x: 0.5, y: -Math.sqrt(3) / 2 };
  const ball = createSandboxItem("ball", "ball", 200 + normal.x * 10, 200 + normal.y * 10);
  const ballSnap = findSnapPlacement(ball, [platform], 20);
  const placedBall = { ...ball, x: ballSnap.x, y: ballSnap.y };
  assert.equal(collisionManifold(placedBall, platform), null);
  assert.ok(collisionManifold({
    ...placedBall,
    x: placedBall.x - ballSnap.normal.x * 0.01,
    y: placedBall.y - ballSnap.normal.y * 0.01,
  }, platform));
});

test("all snap placements stay independent after the drag ends", () => {
  const platform = createSandboxItem("platform", "platform", 50, 60);
  const ledge = createSandboxItem("platform", "ledge", 50, 56);
  const ball = createSandboxItem("ball", "ball", 50, 52);

  assert.equal(findSnapPlacement(ledge, [platform]).persistent, false);
  assert.equal(findSnapPlacement(ball, [platform]).persistent, false);
});

test("legacy snap metadata cannot group a structure with a moving object", () => {
  const block = createSandboxItem("block", "block", 30, 30);
  block.vx = 2;
  block.vy = 0;
  const platform = createSandboxItem("platform", "platform", 30, 22);
  platform.snapTargetId = "block";
  platform.snapOffsetX = 0;
  platform.snapOffsetY = -8;
  const next = stepSandbox([block, platform], [], 0.04);
  const nextBlock = next.find((item) => item.id === "block");
  const nextPlatform = next.find((item) => item.id === "platform");

  assert.ok(nextBlock.x > block.x);
  assert.equal(nextPlatform.x, platform.x);
  assert.equal(nextPlatform.y, platform.y);
  assert.equal(nextPlatform.snapTargetId, null);
});

test("compound and field objects expose their own hitbox geometry", () => {
  const pendulum = createSandboxItem("pendulum", "pendulum", 40, 20);
  const region = createSandboxItem("gravity-region", "region", 50, 50);

  assert.deepEqual(getItemHitboxes(pendulum).map((shape) => shape.part), ["bob", "arm", "pivot"]);
  assert.equal(getItemHitbox(region).part, "field");
  assert.notEqual(getItemHitbox(region).halfWidth, getItemHitbox(region).halfHeight);
});

test("pendulum bob resizing changes only its grid-based arm length", () => {
  const pendulum = createSandboxItem("pendulum", "pendulum", 50, 50);
  const resized = resizePendulumFromBob(pendulum, 50, 70);

  assert.equal(resized.x, pendulum.x);
  assert.equal(resized.y, pendulum.y);
  assert.equal(resized.size, pendulum.size);
  assert.equal(resized.length, 4);
});

test("stretched springs accelerate connected objects toward each other", () => {
  const a = createSandboxItem("block", "a", 20, 30);
  const b = createSandboxItem("block", "b", 60, 30);
  const [nextA, nextB] = stepSandbox([a, b], [{ type: "spring", a: "a", b: "b", naturalLength: 1, springConstant: 20 }], 0.04);

  assert.ok(nextA.vx > 0);
  assert.ok(nextB.vx < 0);
});

test("rod anchors hold left, center, or right points while allowing rotation", () => {
  const rod = createSandboxItem("rod", "rod", 50, 35);
  rod.angle = 0;
  rod.initialAngle = 0;
  rod.anchorEnabled = true;
  rod.anchorPosition = -1;
  const anchor = getRodAnchorPoint(rod);
  rod.anchorX = anchor.x;
  rod.anchorY = anchor.y;
  const next = stepSandbox([rod], [], 0.04)[0];
  const nextAnchor = getRodAnchorPoint(next);

  assert.ok(Math.abs(next.angularVelocity) > 0);
  assert.ok(Math.abs(nextAnchor.x - anchor.x) < 1e-9);
  assert.ok(Math.abs(nextAnchor.y - anchor.y) < 1e-9);
});

test("reset restores placed positions and initial velocities", () => {
  const ball = createSandboxItem("ball", "ball", 40, 20);
  const moved = { ...ball, x: 75, y: 80, vx: -8, vy: 5 };

  assert.deepEqual(resetSandbox([moved])[0], { ...ball, angularVelocity: 0 });
});

test("experiment snapshots preserve every entity and connection value", () => {
  const block = createSandboxItem("block", "block", 40, 20);
  block.mass = 7.5;
  block.friction = 0.42;
  block.initialVx = 3.25;
  const link = {
    id: "rope",
    type: "rope",
    a: "block",
    b: "other",
    naturalLength: 14.5,
    springConstant: 18,
    verticalSnap: true,
    pulleys: [{ id: "pulley", direction: -1 }],
  };
  const snapshot = cloneSandboxExperiment([block], [link]);

  block.mass = 1;
  block.friction = 0;
  link.naturalLength = 2;
  link.pulleys[0].direction = 1;

  assert.equal(snapshot.items[0].mass, 7.5);
  assert.equal(snapshot.items[0].friction, 0.42);
  assert.equal(snapshot.items[0].initialVx, 3.25);
  assert.equal(snapshot.links[0].naturalLength, 14.5);
  assert.equal(snapshot.links[0].verticalSnap, true);
  assert.equal(snapshot.links[0].pulleys[0].direction, -1);
});
