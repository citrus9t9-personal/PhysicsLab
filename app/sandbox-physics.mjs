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
  { type: "rope", label: "Rope / string", category: "Connections", description: "Choose two endpoints, then route the rope around pulleys." },
  { type: "spring", label: "Spring", category: "Connections", description: "Connects two objects with adjustable stiffness and length." },
];

const DYNAMIC_TYPES = new Set(["block", "ball", "cart", "rod", "wheel"]);
const STATIC_COLLIDER_TYPES = new Set(["platform", "incline", "collision-target", "pulley"]);
const TAU = Math.PI * 2;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const radians = (degrees) => (degrees * Math.PI) / 180;
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const dot = (a, b) => a.x * b.x + a.y * b.y;
const normalizeAngle = (angle) => ((angle % TAU) + TAU) % TAU;

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.000001) return { x: 1, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function rotate(vector, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: vector.x * cosine - vector.y * sine,
    y: vector.x * sine + vector.y * cosine,
  };
}

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

export function getItemHitbox(item) {
  const circle = (radius) => ({
    kind: "circle",
    x: item.x,
    y: item.y,
    radius: Math.max(radius, 0.35),
  });
  const box = (halfWidth, halfHeight, angle = item.angle) => ({
    kind: "box",
    x: item.x,
    y: item.y,
    halfWidth: Math.max(halfWidth, 0.35),
    halfHeight: Math.max(halfHeight, 0.35),
    angle: radians(angle),
  });

  if (item.type === "ball") return circle((item.size * WORLD_SCALE) / 2);
  if (item.type === "wheel" || item.type === "pulley") return circle(item.radius * WORLD_SCALE);
  if (item.type === "collision-target") return circle((item.size * WORLD_SCALE) / 2);
  if (item.type === "pivot") return circle((item.size * WORLD_SCALE) / 2);
  if (item.type === "cart") return box((item.size * WORLD_SCALE) / 2, item.size * WORLD_SCALE * 0.31, 0);
  if (item.type === "rod") return box((item.size * WORLD_SCALE) / 2, WORLD_SCALE * 0.18);
  if (item.type === "platform") return box((item.size * WORLD_SCALE) / 2, WORLD_SCALE * 0.18);
  if (item.type === "incline") return box((item.size * WORLD_SCALE) / 2, WORLD_SCALE * 0.18, -item.angle);
  return box((item.size * WORLD_SCALE) / 2, (item.size * WORLD_SCALE) / 2);
}

function boxAxes(box) {
  const horizontal = { x: Math.cos(box.angle), y: Math.sin(box.angle) };
  return [horizontal, { x: -horizontal.y, y: horizontal.x }];
}

function projectionRadius(box, axis) {
  const [horizontal, vertical] = boxAxes(box);
  return box.halfWidth * Math.abs(dot(horizontal, axis)) + box.halfHeight * Math.abs(dot(vertical, axis));
}

function circleCircleManifold(a, b) {
  const offset = { x: b.x - a.x, y: b.y - a.y };
  const centerDistance = Math.hypot(offset.x, offset.y);
  const overlap = a.radius + b.radius - centerDistance;
  if (overlap <= 0) return null;
  return {
    normal: centerDistance > 0.000001 ? { x: offset.x / centerDistance, y: offset.y / centerDistance } : { x: 1, y: 0 },
    penetration: overlap,
  };
}

function circleBoxManifold(circle, box) {
  const relative = rotate({ x: circle.x - box.x, y: circle.y - box.y }, -box.angle);
  const closest = {
    x: clamp(relative.x, -box.halfWidth, box.halfWidth),
    y: clamp(relative.y, -box.halfHeight, box.halfHeight),
  };
  const localOffset = { x: closest.x - relative.x, y: closest.y - relative.y };
  const separation = Math.hypot(localOffset.x, localOffset.y);

  if (separation > 0.000001) {
    const penetration = circle.radius - separation;
    if (penetration <= 0) return null;
    return {
      normal: rotate({ x: localOffset.x / separation, y: localOffset.y / separation }, box.angle),
      penetration,
    };
  }

  const gapX = box.halfWidth - Math.abs(relative.x);
  const gapY = box.halfHeight - Math.abs(relative.y);
  const outward = gapX < gapY
    ? { x: relative.x >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: relative.y >= 0 ? 1 : -1 };
  return {
    normal: rotate({ x: -outward.x, y: -outward.y }, box.angle),
    penetration: circle.radius + Math.min(gapX, gapY),
  };
}

function boxBoxManifold(a, b) {
  const centerOffset = { x: b.x - a.x, y: b.y - a.y };
  const axes = [...boxAxes(a), ...boxAxes(b)];
  let shallowest = null;

  for (const axis of axes) {
    const signedDistance = dot(centerOffset, axis);
    const overlap = projectionRadius(a, axis) + projectionRadius(b, axis) - Math.abs(signedDistance);
    if (overlap <= 0) return null;
    if (!shallowest || overlap < shallowest.penetration) {
      shallowest = {
        normal: signedDistance >= 0 ? axis : { x: -axis.x, y: -axis.y },
        penetration: overlap,
      };
    }
  }
  return shallowest;
}

export function collisionManifold(first, second) {
  const a = first.kind ? first : getItemHitbox(first);
  const b = second.kind ? second : getItemHitbox(second);
  if (a.kind === "circle" && b.kind === "circle") return circleCircleManifold(a, b);
  if (a.kind === "circle" && b.kind === "box") return circleBoxManifold(a, b);
  if (a.kind === "box" && b.kind === "circle") {
    const manifold = circleBoxManifold(b, a);
    return manifold
      ? { normal: { x: -manifold.normal.x, y: -manifold.normal.y }, penetration: manifold.penetration }
      : null;
  }
  return boxBoxManifold(a, b);
}

function shapeExtent(item, axis) {
  const shape = getItemHitbox(item);
  return shape.kind === "circle" ? shape.radius : projectionRadius(shape, axis);
}

function gravityFor(item, items) {
  const region = [...items].reverse().find((candidate) => {
    if (candidate.type !== "gravity-region") return false;
    const half = candidate.size * 4.2;
    return Math.abs(item.x - candidate.x) <= half && Math.abs(item.y - candidate.y) <= half;
  });
  const strength = region?.gravityStrength ?? 9.81;
  const direction = radians(region?.gravityDirection ?? 90);
  return { x: strength * Math.cos(direction), y: strength * Math.sin(direction) };
}

function resolveStaticCollision(item, surface) {
  const manifold = collisionManifold(item, surface);
  if (!manifold) return;
  const { normal, penetration } = manifold;
  item.x -= normal.x * penetration;
  item.y -= normal.y * penetration;

  const normalVelocity = item.vx * normal.x + item.vy * normal.y;
  if (normalVelocity > 0) {
    const bounce = Math.max(item.restitution, surface.restitution ?? 0);
    item.vx -= (1 + bounce) * normalVelocity * normal.x;
    item.vy -= (1 + bounce) * normalVelocity * normal.y;
  }

  const tangent = { x: -normal.y, y: normal.x };
  const tangentVelocity = item.vx * tangent.x + item.vy * tangent.y;
  const friction = clamp((item.friction + (surface.friction ?? 0)) * 0.035, 0, 0.18);
  item.vx -= tangentVelocity * friction * tangent.x;
  item.vy -= tangentVelocity * friction * tangent.y;
}

function collideWithCircularTrack(item, track) {
  const dx = item.x - track.x;
  const dy = item.y - track.y;
  const centerDistance = Math.max(Math.hypot(dx, dy), 0.001);
  const bodyExtent = Math.max(shapeExtent(item, { x: 1, y: 0 }), shapeExtent(item, { x: 0, y: 1 }));
  const innerRadius = Math.max(4, track.radius * WORLD_SCALE) - bodyExtent;
  if (centerDistance < innerRadius || centerDistance > innerRadius + bodyExtent * 1.8) return;
  const normal = { x: dx / centerDistance, y: dy / centerDistance };
  item.x = track.x + normal.x * innerRadius;
  item.y = track.y + normal.y * innerRadius;
  const outwardVelocity = item.vx * normal.x + item.vy * normal.y;
  if (outwardVelocity > 0) {
    item.vx -= (1 + item.restitution) * outwardVelocity * normal.x;
    item.vy -= (1 + item.restitution) * outwardVelocity * normal.y;
  }
}

function attachmentPoint(item, target) {
  const shape = getItemHitbox(item);
  const direction = { x: target.x - item.x, y: target.y - item.y };
  const unit = normalize(direction);
  if (shape.kind === "circle") {
    return { x: item.x + unit.x * shape.radius, y: item.y + unit.y * shape.radius };
  }

  const localDirection = rotate(direction, -shape.angle);
  const scaleX = Math.abs(localDirection.x) > 0.000001 ? shape.halfWidth / Math.abs(localDirection.x) : Infinity;
  const scaleY = Math.abs(localDirection.y) > 0.000001 ? shape.halfHeight / Math.abs(localDirection.y) : Infinity;
  const localPoint = { x: localDirection.x * Math.min(scaleX, scaleY), y: localDirection.y * Math.min(scaleX, scaleY) };
  const worldPoint = rotate(localPoint, shape.angle);
  return { x: item.x + worldPoint.x, y: item.y + worldPoint.y };
}

function tangentPoints(point, center, radius) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const pointDistance = Math.hypot(dx, dy);
  if (pointDistance <= radius + 0.001) {
    const direction = normalize({ x: dx, y: dy });
    return [{ x: center.x + direction.x * radius, y: center.y + direction.y * radius }];
  }
  const base = Math.atan2(dy, dx);
  const offset = Math.acos(radius / pointDistance);
  return [base + offset, base - offset].map((angle) => ({
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }));
}

function wrapCandidate(previous, pulley, next, direction, radius) {
  const entries = tangentPoints(previous, pulley, radius);
  const exits = tangentPoints(next, pulley, radius);
  let best = null;

  for (const entry of entries) {
    for (const exit of exits) {
      const entryAngle = Math.atan2(entry.y - pulley.y, entry.x - pulley.x);
      const exitAngle = Math.atan2(exit.y - pulley.y, exit.x - pulley.x);
      const sweep = direction > 0
        ? normalizeAngle(exitAngle - entryAngle)
        : -normalizeAngle(entryAngle - exitAngle);
      const tangentAtEntry = direction > 0
        ? { x: -Math.sin(entryAngle), y: Math.cos(entryAngle) }
        : { x: Math.sin(entryAngle), y: -Math.cos(entryAngle) };
      const tangentAtExit = direction > 0
        ? { x: -Math.sin(exitAngle), y: Math.cos(exitAngle) }
        : { x: Math.sin(exitAngle), y: -Math.cos(exitAngle) };
      const incoming = normalize({ x: entry.x - previous.x, y: entry.y - previous.y });
      const outgoing = normalize({ x: next.x - exit.x, y: next.y - exit.y });
      const continuity = dot(incoming, tangentAtEntry) + dot(outgoing, tangentAtExit);
      if (continuity < 1.65) continue;

      const midpointAngle = entryAngle + sweep / 2;
      const averageTarget = normalize({
        x: (previous.x + next.x) / 2 - pulley.x,
        y: (previous.y + next.y) / 2 - pulley.y,
      });
      const awayScore = dot({ x: Math.cos(midpointAngle), y: Math.sin(midpointAngle) }, averageTarget);
      const length = distance(previous, entry) + Math.abs(sweep) * radius + distance(exit, next);
      const candidate = { entry, exit, entryAngle, sweep, direction, radius, length, awayScore };
      if (!best || length < best.length) best = candidate;
    }
  }
  return best;
}

function choosePulleyWrap(previous, pulley, next, radius, preferredDirection = 0) {
  const directions = preferredDirection ? [preferredDirection] : [1, -1];
  const candidates = directions
    .map((direction) => wrapCandidate(previous, pulley, next, direction, radius))
    .filter(Boolean);
  if (!candidates.length) {
    const entryDirection = normalize({ x: previous.x - pulley.x, y: previous.y - pulley.y });
    const exitDirection = normalize({ x: next.x - pulley.x, y: next.y - pulley.y });
    const entry = { x: pulley.x + entryDirection.x * radius, y: pulley.y + entryDirection.y * radius };
    const exit = { x: pulley.x + exitDirection.x * radius, y: pulley.y + exitDirection.y * radius };
    const entryAngle = Math.atan2(entry.y - pulley.y, entry.x - pulley.x);
    const exitAngle = Math.atan2(exit.y - pulley.y, exit.x - pulley.x);
    const direction = preferredDirection || 1;
    const sweep = direction > 0
      ? normalizeAngle(exitAngle - entryAngle)
      : -normalizeAngle(entryAngle - exitAngle);
    return {
      entry,
      exit,
      entryAngle,
      sweep,
      radius,
      direction,
      length: distance(previous, entry) + Math.abs(sweep) * radius + distance(exit, next),
    };
  }
  if (preferredDirection) return candidates[0];
  return candidates.sort((a, b) => a.awayScore - b.awayScore || a.length - b.length)[0];
}

function pulleyStops(link) {
  return (link.pulleys ?? []).map((entry) => (
    typeof entry === "string" ? { id: entry, direction: 0 } : { id: entry.id, direction: entry.direction ?? 0 }
  ));
}

export function getRopeRoute(items, link) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const startItem = byId.get(link.a);
  const endItem = byId.get(link.b);
  if (!startItem || !endItem) return { points: [], wraps: [], length: 0, lengthMeters: 0 };

  const stops = pulleyStops(link)
    .map((stop) => ({ ...stop, item: byId.get(stop.id) }))
    .filter((stop) => stop.item?.type === "pulley");
  const firstTarget = stops[0]?.item ?? endItem;
  const lastTarget = stops.at(-1)?.item ?? startItem;
  const start = attachmentPoint(startItem, firstTarget);
  const end = attachmentPoint(endItem, lastTarget);
  const wraps = stops.map((stop, index) => {
    const previous = index === 0 ? start : stops[index - 1].item;
    const next = index === stops.length - 1 ? end : stops[index + 1].item;
    const radius = getItemHitbox(stop.item).radius + 0.18;
    return {
      id: stop.id,
      ...choosePulleyWrap(previous, stop.item, next, radius, stop.direction),
    };
  });

  const points = [start];
  let length = 0;
  let cursor = start;
  for (const wrap of wraps) {
    length += distance(cursor, wrap.entry);
    points.push(wrap.entry);
    const samples = Math.max(4, Math.ceil((Math.abs(wrap.sweep) * wrap.radius) / 1.2));
    for (let index = 1; index <= samples; index += 1) {
      const angle = wrap.entryAngle + wrap.sweep * (index / samples);
      points.push({
        x: (byId.get(wrap.id)?.x ?? 0) + Math.cos(angle) * wrap.radius,
        y: (byId.get(wrap.id)?.y ?? 0) + Math.sin(angle) * wrap.radius,
      });
    }
    length += Math.abs(wrap.sweep) * wrap.radius;
    cursor = wrap.exit;
  }
  length += distance(cursor, end);
  points.push(end);
  return { points, wraps, length, lengthMeters: length / WORLD_SCALE };
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
    const centerDistance = Math.max(Math.hypot(dx, dy), 0.001);
    const stretch = centerDistance / WORLD_SCALE - link.naturalLength;
    const force = link.springConstant * stretch;
    const direction = { x: dx / centerDistance, y: dy / centerDistance };
    if (isDynamicItem(a)) {
      a.vx += (force / a.mass) * direction.x * delta;
      a.vy += (force / a.mass) * direction.y * delta;
    }
    if (isDynamicItem(b)) {
      b.vx -= (force / b.mass) * direction.x * delta;
      b.vy -= (force / b.mass) * direction.y * delta;
    }
  }
}

function ropeParticipants(items, link) {
  const ids = [link.a, link.b, ...pulleyStops(link).map((stop) => stop.id)];
  return [...new Set(ids)]
    .map((id) => items.find((item) => item.id === id))
    .filter((item) => item && isDynamicItem(item));
}

function ropeGradients(items, link, participants) {
  const epsilon = 0.02;
  return participants.map((item) => {
    const originalX = item.x;
    item.x = originalX + epsilon;
    const right = getRopeRoute(items, link).length;
    item.x = originalX - epsilon;
    const left = getRopeRoute(items, link).length;
    item.x = originalX;

    const originalY = item.y;
    item.y = originalY + epsilon;
    const down = getRopeRoute(items, link).length;
    item.y = originalY - epsilon;
    const up = getRopeRoute(items, link).length;
    item.y = originalY;
    return { item, x: (right - left) / (2 * epsilon), y: (down - up) / (2 * epsilon) };
  });
}

function solveRopes(items, links) {
  const ropeLinks = links.filter((link) => link.type === "rope");
  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (const link of ropeLinks) {
      const route = getRopeRoute(items, link);
      const limit = link.naturalLength * WORLD_SCALE;
      const extension = route.length - limit;
      if (extension <= 0.0001) continue;
      const participants = ropeParticipants(items, link);
      const gradients = ropeGradients(items, link, participants);
      const denominator = gradients.reduce(
        (sum, gradient) => sum + (gradient.x ** 2 + gradient.y ** 2) / Math.max(gradient.item.mass, 0.01),
        0,
      );
      if (denominator <= 0.000001) continue;
      const multiplier = extension / denominator;
      for (const gradient of gradients) {
        const inverseMass = 1 / Math.max(gradient.item.mass, 0.01);
        gradient.item.x -= inverseMass * multiplier * gradient.x;
        gradient.item.y -= inverseMass * multiplier * gradient.y;
      }
    }
  }

  for (const link of ropeLinks) {
    const participants = ropeParticipants(items, link);
    const gradients = ropeGradients(items, link, participants);
    const denominator = gradients.reduce(
      (sum, gradient) => sum + (gradient.x ** 2 + gradient.y ** 2) / Math.max(gradient.item.mass, 0.01),
      0,
    );
    const lengtheningSpeed = gradients.reduce(
      (sum, gradient) => sum + gradient.x * gradient.item.vx + gradient.y * gradient.item.vy,
      0,
    );
    if (denominator <= 0.000001 || lengtheningSpeed <= 0) continue;
    const impulse = lengtheningSpeed / denominator;
    for (const gradient of gradients) {
      const inverseMass = 1 / Math.max(gradient.item.mass, 0.01);
      gradient.item.vx -= inverseMass * impulse * gradient.x;
      gradient.item.vy -= inverseMass * impulse * gradient.y;
    }
  }
}

function solveBodyCollisions(items) {
  const bodies = items.filter(isDynamicItem);
  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      const a = bodies[first];
      const b = bodies[second];
      const manifold = collisionManifold(a, b);
      if (!manifold) continue;
      const inverseA = 1 / Math.max(a.mass, 0.01);
      const inverseB = 1 / Math.max(b.mass, 0.01);
      const inverseTotal = inverseA + inverseB;
      a.x -= manifold.normal.x * manifold.penetration * (inverseA / inverseTotal);
      a.y -= manifold.normal.y * manifold.penetration * (inverseA / inverseTotal);
      b.x += manifold.normal.x * manifold.penetration * (inverseB / inverseTotal);
      b.y += manifold.normal.y * manifold.penetration * (inverseB / inverseTotal);

      const relativeVelocity =
        (b.vx - a.vx) * manifold.normal.x +
        (b.vy - a.vy) * manifold.normal.y;
      if (relativeVelocity >= 0) continue;
      const restitution = Math.min(a.restitution, b.restitution);
      const impulse = (-(1 + restitution) * relativeVelocity) / inverseTotal;
      a.vx -= impulse * inverseA * manifold.normal.x;
      a.vy -= impulse * inverseA * manifold.normal.y;
      b.vx += impulse * inverseB * manifold.normal.x;
      b.vy += impulse * inverseB * manifold.normal.y;
    }
  }
}

function keepInsideStage(item) {
  const horizontal = shapeExtent(item, { x: 1, y: 0 });
  const vertical = shapeExtent(item, { x: 0, y: 1 });
  if (item.x < horizontal) { item.x = horizontal; item.vx = Math.abs(item.vx) * item.restitution; }
  if (item.x > 100 - horizontal) { item.x = 100 - horizontal; item.vx = -Math.abs(item.vx) * item.restitution; }
  if (item.y < vertical) { item.y = vertical; item.vy = Math.abs(item.vy) * item.restitution; }
  if (item.y > 94 - vertical) {
    item.y = 94 - vertical;
    item.vy = Math.abs(item.vy) < 0.35 ? 0 : -Math.abs(item.vy) * item.restitution;
    item.vx *= Math.max(0, 1 - item.friction * 0.12);
  }
}

function resolveEnvironment(item, items) {
  keepInsideStage(item);
  for (const surface of items) {
    if (surface.id === item.id) continue;
    if (surface.type === "circular-track") collideWithCircularTrack(item, surface);
    if (!STATIC_COLLIDER_TYPES.has(surface.type)) continue;
    if (surface.type === "pulley" && !surface.fixed) continue;
    resolveStaticCollision(item, surface);
  }
}

export function stepSandbox(items, links, deltaSeconds) {
  const delta = Math.min(Math.max(deltaSeconds, 0), 0.04);
  const next = items.map((item) => ({ ...item }));
  applySpringForces(next, links, delta);

  for (const item of next) {
    if (item.type === "pendulum") {
      const gravity = gravityFor(item, next).y;
      const theta = radians(item.angle);
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
    resolveEnvironment(item, next);
  }

  solveBodyCollisions(next);
  solveRopes(next, links);
  for (const item of next.filter(isDynamicItem)) resolveEnvironment(item, next);
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
