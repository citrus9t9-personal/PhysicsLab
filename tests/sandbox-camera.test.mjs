import assert from "node:assert/strict";
import test from "node:test";

import {
  bottomLeftSandboxCamera,
  cameraForZoomAtPoint,
  clampSandboxZoom,
  constrainSandboxCamera,
  minimumSandboxZoom,
  screenPointToWorld,
} from "../app/sandbox-camera.mjs";

test("sandbox zoom keeps the world point under the cursor stationary", () => {
  const camera = { x: -420, y: -760 };
  const point = { x: 320, y: 240 };
  const before = screenPointToWorld(point, camera, 0.75, 6);
  const result = cameraForZoomAtPoint(camera, 0.75, 1.4, point, 6);
  const after = screenPointToWorld(point, result.camera, result.zoom, 6);

  assert.ok(Math.abs(after.x - before.x) < 1e-9);
  assert.ok(Math.abs(after.y - before.y) < 1e-9);
});

test("sandbox zoom cannot reveal space outside the rigid world", () => {
  assert.equal(clampSandboxZoom(0.01), 0.2);
  assert.equal(clampSandboxZoom(8), 2.5);
  assert.deepEqual(
    constrainSandboxCamera(
      { x: 9000, y: -9000 },
      { width: 800, height: 600 },
      { width: 3000, height: 3000 },
      1,
    ),
    { x: 0, y: -2400 },
  );
  assert.deepEqual(
    constrainSandboxCamera(
      { x: -9000, y: 9000 },
      { width: 800, height: 600 },
      { width: 3000, height: 3000 },
      1,
    ),
    { x: -2200, y: 0 },
  );
});

test("the minimum zoom fills the viewport and the default camera shows the bottom-left wall", () => {
  const viewport = { width: 900, height: 750 };
  const world = { width: 3000, height: 3000 };
  const minimum = minimumSandboxZoom(viewport, world);

  assert.equal(minimum, 0.3);
  assert.equal(clampSandboxZoom(0.1, minimum), minimum);
  assert.deepEqual(
    bottomLeftSandboxCamera(viewport, world, 0.75),
    { x: 0, y: -1500 },
  );
});
