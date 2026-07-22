export const WORLD_SCALE = 7;

export const SANDBOX_TOOLS = [
  { type: "block", label: "Block", category: "Objects", description: "Adjustable mass, size, velocity, and friction." },
  { type: "ball", label: "Ball", category: "Objects", description: "Projectiles, collisions, rolling, and circular motion." },
  { type: "cart", label: "Cart", category: "Objects", description: "Constrained to move horizontally along a track." },
  { type: "rod", label: "Rod / beam", category: "Objects", description: "Torque, equilibrium, and rotational setups." },
  { type: "wheel", label: "Wheel / disk", category: "Objects", description: "Adjustable radius, mass, and rotational inertia." },
  { type: "pendulum", label: "Pendulum", category: "Objects", description: "A mass attached to a string or rigid rod." },
  { type: "collision-target", label: "Collision target", category: "Objects", description: "A fixed target for impact experiments." },
  { type: "platform", label: "Fixed platform", category: "Structures", description: "Creates floors, walls, ledges, and obstacles." },
  { type: "incline", label: "Inclined plane", category: "Structures", description: "Adjustable angle, length, and friction." },
  { type: "pulley", label: "Pulley", category: "Structures", description: "A fixed or movable wheel for connected systems." },
  { type: "pivot", label: "Pivot / hinge", category: "Structures", description: "Marks a point an object can rotate around." },
  { type: "circular-track", label: "Circular track", category: "Structures", description: "Loops, banked curves, and vertical-circle setups." },
  { type: "gravity-region", label: "Gravity region", category: "Fields", description: "Overrides gravitational strength and direction." },
  { type: "rope", label: "Rope / string", category: "Connections", description: "Drag a link handle between two objects to create tension." },
  { type: "spring", label: "Spring", category: "Connections", description: "Connects two objects with adjustable stiffness and length." },
];

const DYNAMIC_TYPES = new Set(["block", "ball", "cart", "rod", "wheel"]);

export function isDynamicItem(item) {
  return DYNAMIC_TYPES.has(item.type) || (item.type === "pulley" && !item.fixed);
}

export function createSandboxItem(type, id, x = 50, y = 35) {
  const definition = SANDBOX_TOOLS.find((tool) => tool.type === type);
  if (!definition || type === "rope" || type === "spring") {
    throw new TypeError(`Unknown placeable sandbox item: ${type}`);
  }

  const base = {
    id,
    type,
    label: definition.label,
    x,
    y,
    initialX: x,
    initialY: y,
    vx: 0,
    vy: 0,
    initialVx: 0,
    initialVy: 0,
    mass: 2,
    size: 1.2,
    friction: 0.2,
    restitution: 0.25,
    angle: 0,
    initialAngle: 0,
    angularVelocity: 0,
    radius: 1,
    inertia: 1,
    length: 2.5,
    gravityStrength: 9.81,
    gravityDirection: 90,
    fixed: !DYNAMIC_TYPES.has(type),
  };

  if (type === "ball") return { ...base, mass: 1, size: 1, vx: 3, vy: -4, initialVx: 3, initialVy: -4, restitution: 0.72 };
  if (type === "cart") return { ...base, mass: 3, size: 1.6, vx: 2, initialVx: 2, friction: 0.05, restitution: 0.1 };
  if (type === "platform") return { ...base, size: 5, friction: 0.25 };
  if (type === "incline") return { ...base, size: 5, angle: 28, initialAngle: 28, friction: 0.18 };
  if (type === "pulley") return { ...base, size: 1.5, radius: 0.75 };
  if (type === "pivot") return { ...base, size: 0.6 };
  if (type === "rod") return { ...base, size: 3, angle: 15, initialAngle: 15, inertia: 2 };
  if (type === "wheel") return { ...base, mass: 2, size: 1.5, radius: 0.75, inertia: 0.56, vx: 2, initialVx: 2, restitution: 0.4 };
  if (type === "pendulum") return { ...base, mass: 1, size: 1, length: 3, angle: 24, initialAngle: 24, angularVelocity: 0 };
  if (type === "circular-track") return { ...base, size: 5, radius: 2.5 };
  if (type === "gravity-region") return { ...base, size: 5, gravityStrength: 9.81, gravityDirection: 90 };
  if (type === "collision-target") return { ...base, size: 1.8, restitution: 0.82 };
  return base;
}

export function createStarterSandbox() {
  return [
    createSandboxItem("gravity-region", "starter-gravity", 51, 45),
    createSandboxItem("platform", "starter-platform", 50, 82),
    createSandboxItem("incline", "starter-incline", 73, 65),
    createSandboxItem("block", "starter-block", 28, 28),
    createSandboxItem("ball", "starter-ball", 46, 27),
  ];
}

function bodyRadius(item) {
  if (item.type === "rod") return Math.max(2, item.size * 2.8);
  if (item.type === "cart") return Math.max(2, item.size * 2.2);
  return Math.max(1.8, item.size * 2.1);
}

function gravityFor(item, items) {
  const region = [...items].reverse().find((candidate) => {
    if (candidate.type !== "gravity-region") return false;
    const half = candidate.size * 4.2;
    return Math.abs(item.x - candidate.x) <= half && Math.abs(item.y - candidate.y) <= half;
  });
  const strength = region?.gravityStrength ?? 9.81;
  const direction = ((region?.gravityDirection ?? 90) * Math.PI) / 180;
  return { x: strength * Math.cos(direction), y: strength * Math.sin(direction) };
}

function collideWithPlatform(item, platform) {
  const radius = bodyRadius(item);
  const halfWidth = platform.size * 5;
  const platformTop = platform.y - 0.8;
  if (
    Math.abs(item.x - platform.x) <= halfWidth + radius &&
    item.y <= platformTop + radius * 1.4 &&
    item.y + radius >= platformTop &&
    item.vy >= 0
  ) {
    item.y = platformTop - radius;
    item.vy = Math.abs(item.vy) < 0.35 ? 0 : -item.vy * item.restitution;
    item.vx *= Math.max(0, 1 - (item.friction + platform.friction) * 0.08);
  }
}

function collideWithIncline(item, incline) {
  const radius = bodyRadius(item);
  const angle = (incline.angle * Math.PI) / 180;
  const halfWidth = incline.size * 4.2;
  const localX = item.x - incline.x;
  if (Math.abs(localX) > halfWidth) return;
  const surfaceY = incline.y - Math.tan(angle) * localX;
  if (item.y <= surfaceY + radius * 1.35 && item.y + radius >= surfaceY && item.vy >= -0.2) {
    item.y = surfaceY - radius;
    const downhillX = -Math.cos(angle);
    const downhillY = Math.sin(angle);
    const speedAlong = item.vx * downhillX + item.vy * downhillY;
    const damped = speedAlong * Math.max(0, 1 - (item.friction + incline.friction) * 0.06);
    item.vx = damped * downhillX;
    item.vy = damped * downhillY;
  }
}

function collideWithTarget(item, target) {
  const dx = item.x - target.x;
  const dy = item.y - target.y;
  const distance = Math.max(Math.hypot(dx, dy), 0.001);
  const minimum = bodyRadius(item) + Math.max(2.5, target.size * 2.1);
  if (distance >= minimum) return;
  const nx = dx / distance;
  const ny = dy / distance;
  item.x = target.x + nx * minimum;
  item.y = target.y + ny * minimum;
  const normalVelocity = item.vx * nx + item.vy * ny;
  if (normalVelocity < 0) {
    const bounce = Math.max(item.restitution, target.restitution);
    item.vx -= (1 + bounce) * normalVelocity * nx;
    item.vy -= (1 + bounce) * normalVelocity * ny;
  }
}

function collideWithCircularTrack(item, track) {
  const dx = item.x - track.x;
  const dy = item.y - track.y;
  const distance = Math.max(Math.hypot(dx, dy), 0.001);
  const innerRadius = Math.max(4, track.radius * 4) - bodyRadius(item);
  if (distance < innerRadius || distance > innerRadius + bodyRadius(item) * 1.8) return;
  const nx = dx / distance;
  const ny = dy / distance;
  item.x = track.x + nx * innerRadius;
  item.y = track.y + ny * innerRadius;
  const outwardVelocity = item.vx * nx + item.vy * ny;
  if (outwardVelocity > 0) {
    item.vx -= (1 + item.restitution) * outwardVelocity * nx;
    item.vy -= (1 + item.restitution) * outwardVelocity * ny;
  }
}

function applySpringForces(items, links, delta) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const link of links) {
    if (link.type !== "spring") continue;
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(Math.hypot(dx, dy), 0.001);
    const stretch = distance / WORLD_SCALE - link.naturalLength;
    const force = link.springConstant * stretch;
    const ux = dx / distance;
    const uy = dy / distance;
    if (isDynamicItem(a)) {
      a.vx += (force / a.mass) * ux * delta;
      a.vy += (force / a.mass) * uy * delta;
    }
    if (isDynamicItem(b)) {
      b.vx -= (force / b.mass) * ux * delta;
      b.vy -= (force / b.mass) * uy * delta;
    }
  }
}

function solveRopes(items, links) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const link of links) {
    if (link.type !== "rope") continue;
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.max(Math.hypot(dx, dy), 0.001);
    const limit = link.naturalLength * WORLD_SCALE;
    if (distance <= limit) continue;
    const correction = distance - limit;
    const ux = dx / distance;
    const uy = dy / distance;
    const aMoves = isDynamicItem(a);
    const bMoves = isDynamicItem(b);
    const divisor = aMoves && bMoves ? 2 : 1;
    if (aMoves) { a.x += (ux * correction) / divisor; a.y += (uy * correction) / divisor; }
    if (bMoves) { b.x -= (ux * correction) / divisor; b.y -= (uy * correction) / divisor; }
  }
}

function solveBodyCollisions(items) {
  const bodies = items.filter(isDynamicItem);
  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      const a = bodies[first];
      const b = bodies[second];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(Math.hypot(dx, dy), 0.001);
      const minimum = bodyRadius(a) + bodyRadius(b);
      if (distance >= minimum) continue;
      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minimum - distance;
      a.x -= (nx * overlap) / 2; a.y -= (ny * overlap) / 2;
      b.x += (nx * overlap) / 2; b.y += (ny * overlap) / 2;
      const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relative >= 0) continue;
      const restitution = Math.min(a.restitution, b.restitution);
      const impulse = (-(1 + restitution) * relative) / (1 / a.mass + 1 / b.mass);
      a.vx -= (impulse / a.mass) * nx; a.vy -= (impulse / a.mass) * ny;
      b.vx += (impulse / b.mass) * nx; b.vy += (impulse / b.mass) * ny;
    }
  }
}

export function stepSandbox(items, links, deltaSeconds) {
  const delta = Math.min(Math.max(deltaSeconds, 0), 0.04);
  const next = items.map((item) => ({ ...item }));
  applySpringForces(next, links, delta);

  for (const item of next) {
    if (item.type === "pendulum") {
      const gravity = gravityFor(item, next).y;
      const theta = (item.angle * Math.PI) / 180;
      const angularAcceleration = -(gravity / Math.max(item.length, 0.2)) * Math.sin(theta);
      item.angularVelocity += angularAcceleration * delta;
      item.angle += item.angularVelocity * delta * (180 / Math.PI);
      continue;
    }
    if (!isDynamicItem(item)) continue;

    if (item.type !== "cart") {
      const gravity = gravityFor(item, next);
      item.vx += gravity.x * delta;
      item.vy += gravity.y * delta;
    } else {
      item.vy = 0;
    }

    item.x += item.vx * WORLD_SCALE * delta;
    item.y += item.vy * WORLD_SCALE * delta;
    if (item.type === "wheel") item.angle += (item.vx / Math.max(item.radius, 0.2)) * delta * (180 / Math.PI);

    const radius = bodyRadius(item);
    if (item.x < radius) { item.x = radius; item.vx = Math.abs(item.vx) * item.restitution; }
    if (item.x > 100 - radius) { item.x = 100 - radius; item.vx = -Math.abs(item.vx) * item.restitution; }
    if (item.y < radius) { item.y = radius; item.vy = Math.abs(item.vy) * item.restitution; }
    if (item.y > 94 - radius) {
      item.y = 94 - radius;
      item.vy = Math.abs(item.vy) < 0.35 ? 0 : -Math.abs(item.vy) * item.restitution;
      item.vx *= Math.max(0, 1 - item.friction * 0.12);
    }

    for (const surface of next) {
      if (surface.type === "platform") collideWithPlatform(item, surface);
      if (surface.type === "incline") collideWithIncline(item, surface);
      if (surface.type === "collision-target") collideWithTarget(item, surface);
      if (surface.type === "circular-track") collideWithCircularTrack(item, surface);
    }
  }

  solveBodyCollisions(next);
  solveRopes(next, links);
  return next;
}

export function resetSandbox(items) {
  return items.map((item) => ({
    ...item,
    x: item.initialX,
    y: item.initialY,
    vx: item.initialVx,
    vy: item.initialVy,
    angle: item.initialAngle,
    angularVelocity: 0,
  }));
}
