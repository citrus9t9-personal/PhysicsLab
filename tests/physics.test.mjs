import assert from "node:assert/strict";
import test from "node:test";

import {
  atwoodMotion,
  inclineMotion,
  isClosingCollision,
  projectileMotion,
  resolveBlockCollision,
  resolveWallCollision,
  separateBodies,
  springMotion,
  totalKineticEnergy,
  totalMomentum,
} from "../app/physics.mjs";

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test("equal-mass elastic collisions exchange velocities", () => {
  const result = resolveBlockCollision(
    { position: 2, velocity: 3, mass: 2 },
    { position: 3, velocity: -1, mass: 2 },
    "elastic",
  );

  closeTo(result.velocityA, -1);
  closeTo(result.velocityB, 3);
  assert.equal(result.joined, false);
});

test("unequal elastic collisions conserve momentum and kinetic energy", () => {
  const before = [
    { position: 2.5, velocity: 4, mass: 2 },
    { position: 8, velocity: 0, mass: 4 },
  ];
  const result = resolveBlockCollision(before[0], before[1], "elastic");
  const after = [
    { ...before[0], velocity: result.velocityA },
    { ...before[1], velocity: result.velocityB },
  ];

  closeTo(result.velocityA, -4 / 3);
  closeTo(result.velocityB, 8 / 3);
  closeTo(totalMomentum(after), totalMomentum(before));
  closeTo(totalKineticEnergy(after), totalKineticEnergy(before));
});

test("fully inelastic collisions share velocity and lose kinetic energy", () => {
  const before = [
    { position: 2.5, velocity: 4, mass: 2 },
    { position: 8, velocity: 0, mass: 4 },
  ];
  const result = resolveBlockCollision(before[0], before[1], "inelastic");
  const after = [
    { ...before[0], velocity: result.velocityA },
    { ...before[1], velocity: result.velocityB },
  ];

  closeTo(result.velocityA, 4 / 3);
  closeTo(result.velocityB, 4 / 3);
  assert.equal(result.joined, true);
  closeTo(totalMomentum(after), totalMomentum(before));
  assert.ok(totalKineticEnergy(after) < totalKineticEnergy(before));
});

test("a perfectly rigid wall preserves speed", () => {
  assert.equal(resolveWallCollision(4.5), -4.5);
  assert.equal(resolveWallCollision(-2.25), 2.25);

  const joinedVelocity = resolveWallCollision(4 / 3);
  closeTo(joinedVelocity, -4 / 3);
});

test("only overlapping bodies moving toward one another resolve", () => {
  const left = { position: 5, velocity: -1, mass: 2 };
  const right = { position: 5.8, velocity: 1, mass: 4 };

  assert.equal(isClosingCollision(left, right, 1), false);
  assert.equal(
    isClosingCollision(
      { ...left, velocity: 2 },
      { ...right, velocity: -1 },
      1,
    ),
    true,
  );
  assert.equal(
    isClosingCollision(
      { ...left, position: 3, velocity: 2 },
      { ...right, position: 5, velocity: -1 },
      1,
    ),
    false,
  );
});

test("overlap correction restores exact edge contact", () => {
  const separated = separateBodies(4.8, 5.4, 1.2);

  closeTo(separated.rightPosition - separated.leftPosition, 1.2);
  closeTo(
    (separated.leftPosition + separated.rightPosition) / 2,
    5.1,
  );
});

test("projectile motion returns to launch height and conserves mechanical energy", () => {
  const setup = { speed: 18, angleDegrees: 42, mass: 1.5, gravity: 9.81 };
  const launch = projectileMotion(setup, 0);
  const apex = projectileMotion(setup, launch.flightTime / 2);
  const landing = projectileMotion(setup, launch.flightTime);

  closeTo(apex.velocityY, 0);
  closeTo(landing.positionY, 0);
  closeTo(landing.velocityY, -launch.velocityY);
  closeTo(
    apex.kineticEnergy + apex.potentialEnergy,
    launch.kineticEnergy + launch.potentialEnergy,
  );
});

test("incline motion subtracts kinetic friction from gravity along the slope", () => {
  const state = inclineMotion(
    { angleDegrees: 30, friction: 0.2, mass: 4, gravity: 9.81 },
    2,
  );
  const expectedAcceleration =
    9.81 * Math.sin(Math.PI / 6) -
    0.2 * 9.81 * Math.cos(Math.PI / 6);

  closeTo(state.acceleration, expectedAcceleration);
  closeTo(state.velocity, expectedAcceleration * 2);
  closeTo(state.netForce, 4 * expectedAcceleration);
});

test("ideal Atwood machine shares acceleration and rope tension", () => {
  const state = atwoodMotion({ massA: 3, massB: 5, gravity: 9.81 }, 1.25);
  const expectedAcceleration = (2 * 9.81) / 8;

  closeTo(state.acceleration, expectedAcceleration);
  closeTo(state.velocity, expectedAcceleration * 1.25);
  closeTo(state.tension, 3 * (9.81 + expectedAcceleration));
});

test("spring motion exchanges kinetic and elastic energy", () => {
  const setup = { mass: 2, springConstant: 18, amplitude: 1.4 };
  const start = springMotion(setup, 0);
  const quarterPeriod = springMotion(setup, start.period / 4);

  closeTo(start.velocity, 0);
  closeTo(quarterPeriod.position, 0);
  closeTo(quarterPeriod.totalEnergy, start.totalEnergy);
  closeTo(quarterPeriod.kineticEnergy, start.totalEnergy);
});
