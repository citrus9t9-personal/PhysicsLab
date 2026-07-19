/**
 * @typedef {"elastic" | "inelastic"} CollisionMode
 * @typedef {{ position: number, velocity: number, mass: number }} CollisionBody
 */

const EPSILON = 1e-9;

function assertFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function assertMass(mass) {
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new RangeError("Mass must be a positive finite number.");
  }
}

/**
 * Resolve a one-dimensional collision between two bodies.
 *
 * @param {CollisionBody} bodyA
 * @param {CollisionBody} bodyB
 * @param {CollisionMode} mode
 * @returns {{ velocityA: number, velocityB: number, joined: boolean }}
 */
export function resolveBlockCollision(bodyA, bodyB, mode) {
  assertMass(bodyA.mass);
  assertMass(bodyB.mass);

  if (mode === "inelastic") {
    const sharedVelocity =
      (bodyA.mass * bodyA.velocity + bodyB.mass * bodyB.velocity) /
      (bodyA.mass + bodyB.mass);

    return {
      velocityA: sharedVelocity,
      velocityB: sharedVelocity,
      joined: true,
    };
  }

  if (mode !== "elastic") {
    throw new TypeError("Unknown collision mode.");
  }

  const totalMass = bodyA.mass + bodyB.mass;
  const velocityA =
    ((bodyA.mass - bodyB.mass) / totalMass) * bodyA.velocity +
    ((2 * bodyB.mass) / totalMass) * bodyB.velocity;
  const velocityB =
    ((2 * bodyA.mass) / totalMass) * bodyA.velocity +
    ((bodyB.mass - bodyA.mass) / totalMass) * bodyB.velocity;

  return { velocityA, velocityB, joined: false };
}

/**
 * A perfectly rigid wall reverses velocity without changing speed.
 *
 * @param {number} velocity
 * @returns {number}
 */
export function resolveWallCollision(velocity) {
  if (!Number.isFinite(velocity)) {
    throw new TypeError("Velocity must be finite.");
  }

  return Math.abs(velocity) < EPSILON ? 0 : -velocity;
}

/**
 * Contact should only resolve when the left body is overlapping and catching
 * the right body. This prevents a resting overlap from resolving repeatedly.
 *
 * @param {CollisionBody} leftBody
 * @param {CollisionBody} rightBody
 * @param {number} bodyWidth
 * @returns {boolean}
 */
export function isClosingCollision(leftBody, rightBody, bodyWidth) {
  return (
    leftBody.position <= rightBody.position &&
    rightBody.position - leftBody.position <= bodyWidth + EPSILON &&
    leftBody.velocity > rightBody.velocity + EPSILON
  );
}

/**
 * Place two overlapping equal-width bodies back at exact edge contact.
 *
 * @param {number} leftPosition
 * @param {number} rightPosition
 * @param {number} bodyWidth
 * @returns {{ leftPosition: number, rightPosition: number }}
 */
export function separateBodies(leftPosition, rightPosition, bodyWidth) {
  const midpoint = (leftPosition + rightPosition) / 2;

  return {
    leftPosition: midpoint - bodyWidth / 2,
    rightPosition: midpoint + bodyWidth / 2,
  };
}

/** @param {CollisionBody[]} bodies */
export function totalMomentum(bodies) {
  return bodies.reduce(
    (sum, body) => sum + body.mass * body.velocity,
    0,
  );
}

/** @param {CollisionBody[]} bodies */
export function totalKineticEnergy(bodies) {
  return bodies.reduce(
    (sum, body) => sum + 0.5 * body.mass * body.velocity ** 2,
    0,
  );
}

/**
 * Snapshot of ideal projectile motion launched from ground level.
 */
export function projectileMotion(
  { speed, angleDegrees, mass, gravity = 9.81 },
  time,
) {
  assertFinite(speed, "Speed");
  assertFinite(angleDegrees, "Angle");
  assertFinite(time, "Time");
  assertMass(mass);
  assertMass(gravity);

  const angle = toRadians(angleDegrees);
  const velocityX = speed * Math.cos(angle);
  const initialVelocityY = speed * Math.sin(angle);
  const flightTime = Math.max(0, (2 * initialVelocityY) / gravity);
  const clampedTime = Math.min(Math.max(time, 0), flightTime);
  const velocityY = initialVelocityY - gravity * clampedTime;
  const positionX = velocityX * clampedTime;
  const positionY = Math.max(
    0,
    initialVelocityY * clampedTime - 0.5 * gravity * clampedTime ** 2,
  );
  const speedNow = Math.hypot(velocityX, velocityY);

  return {
    time: clampedTime,
    flightTime,
    positionX,
    positionY,
    velocityX,
    velocityY,
    speed: speedNow,
    acceleration: gravity,
    netForce: mass * gravity,
    kineticEnergy: 0.5 * mass * speedNow ** 2,
    potentialEnergy: mass * gravity * positionY,
  };
}

/**
 * Snapshot of a block sliding down an incline with kinetic friction.
 */
export function inclineMotion(
  { angleDegrees, friction, mass, gravity = 9.81 },
  time,
) {
  assertFinite(angleDegrees, "Angle");
  assertFinite(friction, "Friction coefficient");
  assertFinite(time, "Time");
  assertMass(mass);
  assertMass(gravity);

  if (friction < 0) {
    throw new RangeError("Friction coefficient cannot be negative.");
  }

  const angle = toRadians(angleDegrees);
  const gravityAlongSlope = gravity * Math.sin(angle);
  const frictionAcceleration = friction * gravity * Math.cos(angle);
  const acceleration = Math.max(0, gravityAlongSlope - frictionAcceleration);
  const clampedTime = Math.max(time, 0);
  const velocity = acceleration * clampedTime;
  const position = 0.5 * acceleration * clampedTime ** 2;
  const normalForce = mass * gravity * Math.cos(angle);
  const frictionForce = friction * normalForce;

  return {
    time: clampedTime,
    position,
    velocity,
    acceleration,
    netForce: mass * acceleration,
    normalForce,
    frictionForce,
    kineticEnergy: 0.5 * mass * velocity ** 2,
  };
}

/**
 * Snapshot of an ideal Atwood machine. Positive displacement means mass B
 * moves downward and mass A moves upward.
 */
export function atwoodMotion(
  { massA, massB, gravity = 9.81 },
  time,
) {
  assertMass(massA);
  assertMass(massB);
  assertMass(gravity);
  assertFinite(time, "Time");

  const acceleration = ((massB - massA) * gravity) / (massA + massB);
  const clampedTime = Math.max(time, 0);
  const velocity = acceleration * clampedTime;
  const displacement = 0.5 * acceleration * clampedTime ** 2;
  const tension =
    massA * (gravity + acceleration);

  return {
    time: clampedTime,
    acceleration,
    velocity,
    displacement,
    tension,
    netForceA: massA * acceleration,
    netForceB: -massB * acceleration,
    kineticEnergy:
      0.5 * massA * velocity ** 2 + 0.5 * massB * velocity ** 2,
  };
}

/**
 * Snapshot of ideal horizontal simple harmonic motion, beginning at maximum
 * positive displacement.
 */
export function springMotion({ mass, springConstant, amplitude }, time) {
  assertMass(mass);
  assertMass(springConstant);
  assertFinite(amplitude, "Amplitude");
  assertFinite(time, "Time");

  if (amplitude < 0) {
    throw new RangeError("Amplitude cannot be negative.");
  }

  const angularFrequency = Math.sqrt(springConstant / mass);
  const period = (2 * Math.PI) / angularFrequency;
  const clampedTime = Math.max(time, 0);
  const phase = angularFrequency * clampedTime;
  const position = amplitude * Math.cos(phase);
  const velocity = -amplitude * angularFrequency * Math.sin(phase);
  const acceleration = -(angularFrequency ** 2) * position;
  const springForce = -springConstant * position;
  const kineticEnergy = 0.5 * mass * velocity ** 2;
  const potentialEnergy = 0.5 * springConstant * position ** 2;

  return {
    time: clampedTime,
    position,
    velocity,
    acceleration,
    springForce,
    netForce: springForce,
    angularFrequency,
    period,
    kineticEnergy,
    potentialEnergy,
    totalEnergy: kineticEnergy + potentialEnergy,
  };
}
