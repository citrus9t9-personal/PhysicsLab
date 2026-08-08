export const GRID_STEP = 5;
export const WORLD_SCALE = GRID_STEP;
export const SANDBOX_WORLD_WIDTH = 500;
export const SANDBOX_WORLD_HEIGHT = 500;
export const CANVAS_PIXELS_PER_UNIT = 6;
export const WALL_THICKNESS = GRID_STEP * 2;
export const LEFT_WALL_X = WALL_THICKNESS;
export const RIGHT_WALL_X = SANDBOX_WORLD_WIDTH - WALL_THICKNESS;
export const GROUND_Y = SANDBOX_WORLD_HEIGHT - WALL_THICKNESS;

export const SANDBOX_TOOLS = [
  { type: "block", label: "Block", category: "Objects", description: "Adjustable mass, size, velocity, and friction." },
  { type: "ball", label: "Ball", category: "Objects", description: "Projectiles, collisions, rolling, and circular motion." },
  { type: "cart", label: "Cart", category: "Objects", description: "Constrained to move horizontally along a track." },
  { type: "rod", label: "Rod / beam", category: "Objects", description: "Torque, equilibrium, and rotational setups." },
  { type: "wheel", label: "Wheel / disk", category: "Objects", description: "Adjustable radius, mass, and rotational inertia." },
  { type: "pendulum", label: "Pendulum", category: "Objects", description: "A mass attached to a string or rigid rod." },
  { type: "platform", label: "Fixed platform", category: "Structures", description: "Creates floors, walls, ledges, and obstacles." },
  { type: "incline", label: "Inclined plane", category: "Structures", description: "Adjustable angle, length, and friction." },
  { type: "pulley", label: "Pulley", category: "Structures", description: "A fixed or movable wheel for connected systems." },
  { type: "gravity-region", label: "Gravity region", category: "Fields", description: "Drag its corners to resize a gravity field." },
  { type: "rope", label: "Rope / string", category: "Connections", description: "Choose two endpoints, then route the rope around pulleys." },
  { type: "spring", label: "Spring", category: "Connections", description: "Connects two objects with adjustable stiffness and length." },
];

const DYNAMIC_TYPES = new Set(["block", "ball", "cart", "rod", "wheel"]);
const HANGING_ROPE_TYPES = new Set(["block", "ball", "wheel"]);
const STATIC_COLLIDER_TYPES = new Set(["platform", "incline", "pulley", "pendulum"]);
const TAU = Math.PI * 2;
const CONTACT_EPSILON = 1e-9;

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

export function isFixedItem(item) {
  return !isDynamicItem(item) || (item.type === "rod" && item.anchorEnabled);
}

export function snapToGrid(value, step = GRID_STEP) {
  return Math.round(value / step) * step;
}

function snapCenterForGridSpan(value, span) {
  const gridSquares = Math.round(span / GRID_STEP);
  const offset = gridSquares % 2 === 0 ? 0 : GRID_STEP / 2;
  return snapToGrid(value - offset) + offset;
}

export function getInclineGeometry(item) {
  const width = item.size * WORLD_SCALE;
  const angle = Math.abs(radians(item.angle));
  const cosine = Math.max(Math.cos(angle), 0.01);
  return {
    width,
    height: Math.tan(angle) * width,
    diagonal: width / cosine,
  };
}

export function snapSandboxItemPosition(item, x = item.x, y = item.y) {
  if (item.type === "block") {
    const span = item.size * WORLD_SCALE;
    return {
      x: snapCenterForGridSpan(x, span),
      y: snapCenterForGridSpan(y, span),
    };
  }
  if ((item.type === "platform" || item.type === "gravity-region") && Math.abs(item.angle % 180) < 0.001) {
    return {
      x: snapCenterForGridSpan(x, (item.width ?? item.size) * WORLD_SCALE),
      y: snapCenterForGridSpan(
        y,
        (item.type === "platform" ? item.height ?? 1 : item.height ?? item.size) * WORLD_SCALE,
      ),
    };
  }
  if (item.type === "incline") {
    const geometry = getInclineGeometry(item);
    return {
      x: snapCenterForGridSpan(x, geometry.width),
      y: snapToGrid(y + geometry.height / 2) - geometry.height / 2,
    };
  }
  return { x: snapToGrid(x), y: snapToGrid(y) };
}

export function resizeSquareFromCorner(item, handle, x, y) {
  if (!["nw", "ne", "sw", "se"].includes(handle)) return { ...item };
  const horizontal = rotate({ x: 1, y: 0 }, radians(item.angle ?? 0));
  const vertical = rotate({ x: 0, y: 1 }, radians(item.angle ?? 0));
  const signX = handle.includes("e") ? 1 : -1;
  const signY = handle.includes("s") ? 1 : -1;
  const originalSide = item.size * WORLD_SCALE;
  const fixed = {
    x: item.x - horizontal.x * signX * originalSide / 2 - vertical.x * signY * originalSide / 2,
    y: item.y - horizontal.y * signX * originalSide / 2 - vertical.y * signY * originalSide / 2,
  };
  const delta = { x: x - fixed.x, y: y - fixed.y };
  const horizontalLength = signX * dot(delta, horizontal);
  const verticalLength = signY * dot(delta, vertical);
  const side = Math.max(GRID_STEP, snapToGrid(Math.max(horizontalLength, verticalLength)));
  const moving = {
    x: fixed.x + horizontal.x * signX * side + vertical.x * signY * side,
    y: fixed.y + horizontal.y * signX * side + vertical.y * signY * side,
  };
  return {
    ...item,
    x: (fixed.x + moving.x) / 2,
    y: (fixed.y + moving.y) / 2,
    size: side / WORLD_SCALE,
  };
}

export function resizePendulumFromBob(item, x, y) {
  const length = Math.max(GRID_STEP, snapToGrid(Math.hypot(x - item.x, y - item.y)));
  return { ...item, length: length / WORLD_SCALE };
}

export function createSandboxItem(type, id, x = SANDBOX_WORLD_WIDTH / 2, y = GROUND_Y - 80) {
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
    size: 1,
    width: 5,
    height: 5,
    friction: 0,
    restitution: 0.25,
    angle: 0,
    initialAngle: 0,
    angularVelocity: 0,
    radius: 1,
    inertia: 1,
    length: 3,
    gravityStrength: 9.81,
    gravityDirection: 90,
    fixed: !DYNAMIC_TYPES.has(type),
    anchorEnabled: false,
    anchorPosition: 0,
    anchorX: x,
    anchorY: y,
    snapTargetId: null,
    snapOffsetX: 0,
    snapOffsetY: 0,
    snapNormalX: 0,
    snapNormalY: -1,
    supportSurfaceId: null,
    supportSurfaceAngle: 0,
    supportAirTime: 1,
  };

  if (type === "ball") return { ...base, mass: 1, size: 1, restitution: 0.72 };
  if (type === "cart") return { ...base, mass: 3, size: 2, restitution: 0.1 };
  if (type === "platform") return { ...base, size: 5, width: 5, height: 1, restitution: 1 };
  if (type === "incline") return { ...base, size: 5, angle: 28, initialAngle: 28, restitution: 1 };
  if (type === "pulley") return { ...base, size: 2, radius: 1 };
  if (type === "rod") return { ...base, size: 3, inertia: 2, restitution: 1 };
  if (type === "wheel") return { ...base, mass: 2, size: 2, radius: 1, inertia: 0.56, restitution: 0.4 };
  if (type === "pendulum") return { ...base, mass: 1, size: 1, length: 3 };
  if (type === "gravity-region") return { ...base, size: 5, width: 8, height: 5, gravityStrength: 9.81, gravityDirection: 90 };
  return base;
}

export function createStarterSandbox() {
  const incline = createSandboxItem("incline", "starter-incline", 108, 0);
  incline.y = GROUND_Y - getInclineGeometry(incline).height / 2;
  return [
    createSandboxItem("gravity-region", "starter-gravity", 70, GROUND_Y - 50),
    createSandboxItem("platform", "starter-platform", 70, GROUND_Y - 2.5),
    incline,
    createSandboxItem("block", "starter-block", 50, GROUND_Y - 40),
    createSandboxItem("ball", "starter-ball", 75, GROUND_Y - 40),
  ].map((item) => {
    const aligned = { ...item, ...snapSandboxItemPosition(item) };
    return { ...aligned, initialX: aligned.x, initialY: aligned.y };
  });
}

export function getItemHitboxes(item) {
  const circle = (radius, x = item.x, y = item.y, part = "body") => ({
    kind: "circle",
    x,
    y,
    radius: Math.max(radius, 0.35),
    part,
  });
  const box = (halfWidth, halfHeight, angle = item.angle, x = item.x, y = item.y, part = "body") => ({
    kind: "box",
    x,
    y,
    halfWidth: Math.max(halfWidth, 0.35),
    halfHeight: Math.max(halfHeight, 0.35),
    angle: radians(angle),
    part,
  });

  if (item.type === "ball") return [circle((item.size * WORLD_SCALE) / 2)];
  if (item.type === "wheel" || item.type === "pulley") return [circle(item.radius * WORLD_SCALE)];
  if (item.type === "cart") return [box((item.size * WORLD_SCALE) / 2, item.size * WORLD_SCALE * 0.31)];
  if (item.type === "rod") return [box((item.size * WORLD_SCALE) / 2, WORLD_SCALE * 0.18)];
  if (item.type === "platform") {
    return [box(
      ((item.width ?? item.size) * WORLD_SCALE) / 2,
      ((item.height ?? 1) * WORLD_SCALE) / 2,
    )];
  }
  if (item.type === "incline") {
    return [box(getInclineGeometry(item).diagonal / 2, WORLD_SCALE * 0.18, -item.angle)];
  }
  if (item.type === "gravity-region") {
    return [box(
      ((item.width ?? item.size) * WORLD_SCALE) / 2,
      ((item.height ?? item.size) * WORLD_SCALE) / 2,
      0,
      item.x,
      item.y,
      "field",
    )];
  }
  if (item.type === "pendulum") {
    const theta = radians(item.angle);
    const armLength = Math.max(item.length * WORLD_SCALE, 2);
    const dx = -Math.sin(theta) * armLength;
    const dy = Math.cos(theta) * armLength;
    const bobX = item.x + dx;
    const bobY = item.y + dy;
    return [
      circle((item.size * WORLD_SCALE) / 2, bobX, bobY, "bob"),
      box(armLength / 2, WORLD_SCALE * 0.11, (Math.atan2(dy, dx) * 180) / Math.PI, item.x + dx / 2, item.y + dy / 2, "arm"),
      circle(WORLD_SCALE * 0.28, item.x, item.y, "pivot"),
    ];
  }
  return [box((item.size * WORLD_SCALE) / 2, (item.size * WORLD_SCALE) / 2)];
}

export function getItemHitbox(item) {
  return getItemHitboxes(item)[0];
}

function boxAxes(box) {
  const horizontal = { x: Math.cos(box.angle), y: Math.sin(box.angle) };
  return [horizontal, { x: -horizontal.y, y: horizontal.x }];
}

function projectionRadius(box, axis) {
  const [horizontal, vertical] = boxAxes(box);
  return box.halfWidth * Math.abs(dot(horizontal, axis)) + box.halfHeight * Math.abs(dot(vertical, axis));
}

export function getItemBounds(item) {
  if (item.type === "incline") {
    const geometry = getInclineGeometry(item);
    return {
      left: item.x - geometry.width / 2,
      right: item.x + geometry.width / 2,
      top: item.y - geometry.height / 2,
      bottom: item.y + geometry.height / 2,
    };
  }
  return getItemHitboxes(item).reduce((bounds, shape) => {
    const extentX = shape.kind === "circle" ? shape.radius : projectionRadius(shape, { x: 1, y: 0 });
    const extentY = shape.kind === "circle" ? shape.radius : projectionRadius(shape, { x: 0, y: 1 });
    return {
      left: Math.min(bounds.left, shape.x - extentX),
      right: Math.max(bounds.right, shape.x + extentX),
      top: Math.min(bounds.top, shape.y - extentY),
      bottom: Math.max(bounds.bottom, shape.y + extentY),
    };
  }, { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
}

export function clampItemToWorkspace(item) {
  const next = { ...item };
  const bounds = getItemBounds(next);
  if (bounds.left < LEFT_WALL_X) next.x += LEFT_WALL_X - bounds.left;
  if (bounds.right > RIGHT_WALL_X) next.x -= bounds.right - RIGHT_WALL_X;
  if (bounds.top < 0) next.y -= bounds.top;
  if (bounds.bottom > GROUND_Y) next.y -= bounds.bottom - GROUND_Y;
  return next;
}

function placementFitsWorkspace(item) {
  const bounds = getItemBounds(item);
  const epsilon = 0.000001;
  return bounds.left >= LEFT_WALL_X - epsilon &&
    bounds.right <= RIGHT_WALL_X + epsilon &&
    bounds.top >= -epsilon &&
    bounds.bottom <= GROUND_Y + epsilon;
}

function circleCircleManifold(a, b) {
  const offset = { x: b.x - a.x, y: b.y - a.y };
  const centerDistance = Math.hypot(offset.x, offset.y);
  const overlap = a.radius + b.radius - centerDistance;
  if (overlap <= CONTACT_EPSILON) return null;
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
    if (penetration <= CONTACT_EPSILON) return null;
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
    if (overlap <= CONTACT_EPSILON) return null;
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

function shapeSupport(shape, axis) {
  if (shape.kind === "circle") return shape.radius;
  return projectionRadius(shape, axis);
}

function snapToCircle(item, draggedShape, targetShape) {
  const normal = normalize({ x: draggedShape.x - targetShape.x, y: draggedShape.y - targetShape.y });
  const support = shapeSupport(draggedShape, normal);
  const desiredShape = {
    x: targetShape.x + normal.x * (targetShape.radius + support),
    y: targetShape.y + normal.y * (targetShape.radius + support),
  };
  const shift = { x: desiredShape.x - draggedShape.x, y: desiredShape.y - draggedShape.y };
  return {
    x: item.x + shift.x,
    y: item.y + shift.y,
    normal,
    distance: Math.hypot(shift.x, shift.y),
    part: targetShape.part,
  };
}

function snapToBox(item, draggedShape, targetShape) {
  const relative = rotate({ x: draggedShape.x - targetShape.x, y: draggedShape.y - targetShape.y }, -targetShape.angle);
  const inside =
    Math.abs(relative.x) <= targetShape.halfWidth &&
    Math.abs(relative.y) <= targetShape.halfHeight;
  let localSurface;
  let localNormal;

  if (inside) {
    const gapX = targetShape.halfWidth - Math.abs(relative.x);
    const gapY = targetShape.halfHeight - Math.abs(relative.y);
    if (gapX < gapY) {
      localNormal = { x: relative.x >= 0 ? 1 : -1, y: 0 };
      localSurface = { x: localNormal.x * targetShape.halfWidth, y: relative.y };
    } else {
      localNormal = { x: 0, y: relative.y >= 0 ? 1 : -1 };
      localSurface = { x: relative.x, y: localNormal.y * targetShape.halfHeight };
    }
  } else {
    localSurface = {
      x: clamp(relative.x, -targetShape.halfWidth, targetShape.halfWidth),
      y: clamp(relative.y, -targetShape.halfHeight, targetShape.halfHeight),
    };
    localNormal = normalize({ x: relative.x - localSurface.x, y: relative.y - localSurface.y });
  }

  const normal = rotate(localNormal, targetShape.angle);
  const surfaceOffset = rotate(localSurface, targetShape.angle);
  const support = shapeSupport(draggedShape, normal);
  const desiredShape = {
    x: targetShape.x + surfaceOffset.x + normal.x * support,
    y: targetShape.y + surfaceOffset.y + normal.y * support,
  };
  const shift = { x: desiredShape.x - draggedShape.x, y: desiredShape.y - draggedShape.y };
  return {
    x: item.x + shift.x,
    y: item.y + shift.y,
    normal,
    distance: Math.hypot(shift.x, shift.y),
    part: targetShape.part,
  };
}

export function findSnapPlacement(item, items, threshold = 4.2) {
  const draggedShapes = getItemHitboxes(item);
  let best = null;
  for (const target of items) {
    if (target.id === item.id || target.type === "gravity-region") continue;
    const targetShapes = getItemHitboxes(target);
    for (const draggedShape of draggedShapes) {
      for (const targetShape of targetShapes) {
        const candidate = targetShape.kind === "circle"
          ? snapToCircle(item, draggedShape, targetShape)
          : snapToBox(item, draggedShape, targetShape);
        if (candidate.distance > threshold) continue;

        const placedItem = { ...item, x: candidate.x, y: candidate.y };
        if (!placementFitsWorkspace(placedItem)) continue;
        const placedShapes = getItemHitboxes(placedItem);
        const overlapsTarget = placedShapes.some((placedShape) =>
          targetShapes.some((shape) => collisionManifold(placedShape, shape)?.penetration > 0.000001));
        if (overlapsTarget) continue;

        const score = candidate.distance + (isDynamicItem(target) ? 0.35 : 0);
        if (!best || score < best.score) {
          best = {
            ...candidate,
            score,
            targetId: target.id,
            targetLabel: target.label,
            persistent: isFixedItem(item),
          };
        }
      }
    }
  }
  return best;
}

export function findSmoothSurfaceJoin(item, items, threshold = GRID_STEP * 2) {
  if (!["incline", "platform"].includes(item.type)) return null;
  let best = null;

  for (const target of items) {
    if (target.id === item.id) continue;
    const pair = new Set([item.type, target.type]);
    if (!pair.has("incline") || !pair.has("platform")) continue;
    const incline = item.type === "incline" ? item : target;
    const platform = item.type === "platform" ? item : target;
    if (Math.abs(platform.angle % 180) > 0.001) continue;

    const inclineGeometry = getInclineGeometry(incline);
    const risesRight = incline.angle >= 0;
    const inclineEndpoints = [
      {
        name: "low",
        x: incline.x + (risesRight ? -1 : 1) * inclineGeometry.width / 2,
        y: incline.y + inclineGeometry.height / 2,
      },
      {
        name: "high",
        x: incline.x + (risesRight ? 1 : -1) * inclineGeometry.width / 2,
        y: incline.y - inclineGeometry.height / 2,
      },
    ];
    const platformHalfWidth = ((platform.width ?? platform.size) * WORLD_SCALE) / 2;
    const platformTop = platform.y - ((platform.height ?? 1) * WORLD_SCALE) / 2;
    const platformCorners = [
      { x: platform.x - platformHalfWidth, y: platformTop },
      { x: platform.x + platformHalfWidth, y: platformTop },
    ];

    for (const endpoint of inclineEndpoints) {
      for (const corner of platformCorners) {
        const shift = item.type === "incline"
          ? { x: corner.x - endpoint.x, y: corner.y - endpoint.y }
          : { x: endpoint.x - corner.x, y: endpoint.y - corner.y };
        const joinDistance = Math.hypot(shift.x, shift.y);
        if (joinDistance > threshold || (best && joinDistance >= best.distance)) continue;
        const placedItem = { ...item, x: item.x + shift.x, y: item.y + shift.y };
        if (!placementFitsWorkspace(placedItem)) continue;
        best = {
          x: placedItem.x,
          y: placedItem.y,
          normal: { x: 0, y: -1 },
          distance: joinDistance,
          part: `${endpoint.name} smooth join`,
          score: joinDistance,
          targetId: target.id,
          targetLabel: target.label,
          persistent: true,
          smooth: true,
        };
      }
    }
  }
  return best;
}

function gravityFor(item, items) {
  const region = [...items].reverse().find((candidate) => {
    if (candidate.type !== "gravity-region") return false;
    const halfWidth = ((candidate.width ?? candidate.size) * WORLD_SCALE) / 2;
    const halfHeight = ((candidate.height ?? candidate.size) * WORLD_SCALE) / 2;
    return Math.abs(item.x - candidate.x) <= halfWidth && Math.abs(item.y - candidate.y) <= halfHeight;
  });
  const strength = region?.gravityStrength ?? 9.81;
  const direction = radians(region?.gravityDirection ?? 90);
  return { x: strength * Math.cos(direction), y: strength * Math.sin(direction) };
}

function resolveStaticCollision(item, surface) {
  let manifold = null;
  for (const itemShape of getItemHitboxes(item)) {
    for (const surfaceShape of getItemHitboxes(surface)) {
      const candidate = collisionManifold(itemShape, surfaceShape);
      if (candidate && (!manifold || candidate.penetration > manifold.penetration)) {
        manifold = candidate;
      }
    }
  }
  if (!manifold) return null;
  const { normal, penetration } = manifold;
  item.x -= normal.x * penetration;
  item.y -= normal.y * penetration;

  const normalVelocity = item.vx * normal.x + item.vy * normal.y;
  if (normalVelocity > 0) {
    const supportedBlock =
      item.type === "block" &&
      normal.y > 0.35 &&
      ["platform", "incline", "rod"].includes(surface.type);
    const bounce = supportedBlock ? 0 : Math.max(item.restitution, surface.restitution ?? 0);
    item.vx -= (1 + bounce) * normalVelocity * normal.x;
    item.vy -= (1 + bounce) * normalVelocity * normal.y;
  }

  const tangent = { x: -normal.y, y: normal.x };
  const tangentVelocity = item.vx * tangent.x + item.vy * tangent.y;
  const friction = clamp((item.friction + (surface.friction ?? 0)) * 0.035, 0, 0.18);
  item.vx -= tangentVelocity * friction * tangent.x;
  item.vy -= tangentVelocity * friction * tangent.y;
  return manifold;
}

export function getConnectionAnchor(item, target) {
  if (item.type === "pulley") return { x: item.x, y: item.y };
  const shape = getItemHitbox(item);
  const direction = { x: target.x - shape.x, y: target.y - shape.y };
  const unit = normalize(direction);
  if (shape.kind === "circle") {
    return { x: shape.x + unit.x * shape.radius, y: shape.y + unit.y * shape.radius };
  }

  const localDirection = rotate(direction, -shape.angle);
  const scaleX = Math.abs(localDirection.x) > 0.000001 ? shape.halfWidth / Math.abs(localDirection.x) : Infinity;
  const scaleY = Math.abs(localDirection.y) > 0.000001 ? shape.halfHeight / Math.abs(localDirection.y) : Infinity;
  const localPoint = { x: localDirection.x * Math.min(scaleX, scaleY), y: localDirection.y * Math.min(scaleX, scaleY) };
  const worldPoint = rotate(localPoint, shape.angle);
  return { x: shape.x + worldPoint.x, y: shape.y + worldPoint.y };
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

function getPulleyRopeGuide(item, pulley, fallbackSide) {
  if (
    !item ||
    !pulley ||
    pulley.type !== "pulley" ||
    !HANGING_ROPE_TYPES.has(item.type) ||
    item.y <= pulley.y + getItemHitbox(pulley).radius
  ) {
    return null;
  }
  const radius = getItemHitbox(pulley).radius + 0.18;
  const side = Math.sign(item.x - pulley.x) || fallbackSide;
  return { x: pulley.x + side * radius, side };
}

function ropeEndpointAnchor(item, pulley, fallbackSide) {
  const guide = getPulleyRopeGuide(item, pulley, fallbackSide);
  if (!guide) return getConnectionAnchor(item, pulley);
  const shape = getItemHitbox(item);
  if (shape.kind === "circle") {
    return { x: item.x, y: shape.y - shape.radius };
  }
  const topCenter = rotate({ x: 0, y: -shape.halfHeight }, shape.angle);
  return { x: shape.x + topCenter.x, y: shape.y + topCenter.y };
}

export function applyPulleyRopeGuides(items, links) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const link of links) {
    if (link.type !== "rope" || !link.verticalSnap) continue;
    const stops = pulleyStops(link);
    if (!stops.length) continue;
    const guides = [
      { item: byId.get(link.a), pulley: byId.get(stops[0].id), fallbackSide: -1 },
      { item: byId.get(link.b), pulley: byId.get(stops.at(-1).id), fallbackSide: 1 },
    ];
    for (const entry of guides) {
      const guide = getPulleyRopeGuide(entry.item, entry.pulley, entry.fallbackSide);
      if (!guide || isFixedItem(entry.item)) continue;
      entry.item.x = guide.x;
      entry.item.vx = 0;
    }
  }
  return items;
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
  const startGuide = stops.length ? getPulleyRopeGuide(startItem, firstTarget, -1) : null;
  const endGuide = stops.length ? getPulleyRopeGuide(endItem, lastTarget, 1) : null;
  const startIsVertical = Boolean(link.verticalSnap || (startGuide && Math.abs(startItem.x - startGuide.x) < 0.05));
  const endIsVertical = Boolean(link.verticalSnap || (endGuide && Math.abs(endItem.x - endGuide.x) < 0.05));
  const start = stops.length && startIsVertical
    ? ropeEndpointAnchor(startItem, firstTarget, -1)
    : getConnectionAnchor(startItem, firstTarget);
  const end = stops.length && endIsVertical
    ? ropeEndpointAnchor(endItem, lastTarget, 1)
    : getConnectionAnchor(endItem, lastTarget);
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
    const aPoint = getConnectionAnchor(a, b);
    const bPoint = getConnectionAnchor(b, a);
    const dx = bPoint.x - aPoint.x;
    const dy = bPoint.y - aPoint.y;
    const centerDistance = Math.max(Math.hypot(dx, dy), 0.001);
    const stretch = centerDistance / WORLD_SCALE - link.naturalLength;
    const force = link.springConstant * stretch;
    const direction = { x: dx / centerDistance, y: dy / centerDistance };
    if (!isFixedItem(a)) {
      a.vx += (force / a.mass) * direction.x * delta;
      a.vy += (force / a.mass) * direction.y * delta;
    }
    if (!isFixedItem(b)) {
      b.vx -= (force / b.mass) * direction.x * delta;
      b.vy -= (force / b.mass) * direction.y * delta;
    }
  }
}

function ropeParticipants(items, link) {
  const ids = [link.a, link.b, ...pulleyStops(link).map((stop) => stop.id)];
  return [...new Set(ids)]
    .map((id) => items.find((item) => item.id === id))
    .filter((item) => item && !isFixedItem(item));
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
  applyPulleyRopeGuides(items, ropeLinks);
  for (let iteration = 0; iteration < 8; iteration += 1) {
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
      applyPulleyRopeGuides(items, [link]);
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
  applyPulleyRopeGuides(items, ropeLinks);
}

function solveBodyCollisions(items) {
  const bodies = items.filter((item) => isDynamicItem(item) && !isFixedItem(item));
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
  const bounds = getItemBounds(item);
  const contacts = { left: false, right: false, top: false, ground: false };
  if (bounds.left < LEFT_WALL_X) {
    item.x += LEFT_WALL_X - bounds.left;
    item.vx = Math.abs(item.vx);
    contacts.left = true;
  }
  if (bounds.right > RIGHT_WALL_X) {
    item.x -= bounds.right - RIGHT_WALL_X;
    item.vx = -Math.abs(item.vx);
    contacts.right = true;
  }
  if (bounds.top < 0) {
    item.y -= bounds.top;
    item.vy = Math.abs(item.vy);
    contacts.top = true;
  }
  if (bounds.bottom > GROUND_Y) {
    item.y -= bounds.bottom - GROUND_Y;
    item.vy = item.type === "block" ? 0 : -Math.abs(item.vy);
    contacts.ground = true;
  }
  return contacts;
}

function supportAngleFor(surface) {
  if (surface.type === "incline") return -surface.angle;
  if (surface.type === "platform" || surface.type === "rod") return surface.angle ?? 0;
  return null;
}

function resolveEnvironment(item, items) {
  const environmentIncomingSpeed = Math.hypot(item.vx, item.vy);
  const boundary = keepInsideStage(item);
  let support = boundary.ground
    ? { id: "world-ground", angle: 0, strength: 1, incomingSpeed: environmentIncomingSpeed }
    : null;
  for (const surface of items) {
    if (surface.id === item.id) continue;
    if (surface.snapTargetId === item.id || item.snapTargetId === surface.id) continue;
    if (!STATIC_COLLIDER_TYPES.has(surface.type) && !(surface.type === "rod" && surface.anchorEnabled)) continue;
    if (surface.type === "pulley" && !surface.fixed) continue;
    const manifold = resolveStaticCollision(item, surface);
    const surfaceAngle = supportAngleFor(surface);
    if (!manifold || manifold.normal.y <= 0.35 || surfaceAngle === null) continue;
    if (item.type === "block" && Math.abs(item.angle - surfaceAngle) > 0.001) {
      item.angle = surfaceAngle;
      resolveStaticCollision(item, surface);
    }
    if (!support || manifold.normal.y > support.strength) {
      support = {
        id: surface.id,
        angle: surfaceAngle,
        strength: manifold.normal.y,
        incomingSpeed: environmentIncomingSpeed,
      };
    }
  }
  return support;
}

function updateBlockSupport(item, support, delta) {
  if (item.type !== "block") return;
  const previousAngle = item.supportSurfaceAngle ?? 0;
  const previousAirTime = item.supportAirTime ?? 1;
  if (support) {
    const arrivingOnFlat =
      Math.abs(support.angle) < 0.001 &&
      Math.abs(previousAngle) > 0.001 &&
      previousAirTime <= 0.08;
    if (arrivingOnFlat) {
      const speed = support.incomingSpeed ?? Math.hypot(item.vx, item.vy);
      const direction = Math.sign(item.vx) || Math.sign(Math.cos(radians(previousAngle))) || 1;
      item.vx = direction * speed;
      item.vy = 0;
    }
    item.angle = support.angle;
    item.supportSurfaceId = support.id;
    item.supportSurfaceAngle = support.angle;
    item.supportAirTime = 0;
    return;
  }

  item.supportAirTime = previousAirTime + delta;
  if (item.supportAirTime > 0.08) {
    item.angle = 0;
    item.supportSurfaceId = null;
    item.supportSurfaceAngle = 0;
  }
}

function getSimpleAtwoodSystems(items, links) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const used = new Set();
  const systems = [];
  for (const link of links) {
    if (link.type !== "rope") continue;
    const stops = pulleyStops(link);
    if (stops.length !== 1 || used.has(link.a) || used.has(link.b)) continue;
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    const pulley = byId.get(stops[0].id);
    const guideA = getPulleyRopeGuide(a, pulley, -1);
    const guideB = getPulleyRopeGuide(b, pulley, 1);
    const routeLength = getRopeRoute(items, link).length;
    const ropeLimit = link.naturalLength * WORLD_SCALE;
    if (
      !a ||
      !b ||
      !pulley?.fixed ||
      routeLength < ropeLimit - 0.0001 ||
      isFixedItem(a) ||
      isFixedItem(b) ||
      !guideA ||
      !guideB ||
      (!link.verticalSnap && (
        Math.abs(a.x - guideA.x) >= 0.05 ||
        Math.abs(b.x - guideB.x) >= 0.05
      ))
    ) {
      continue;
    }
    systems.push({ a, b, link });
    used.add(a.id);
    used.add(b.id);
  }
  return systems;
}

function prepareAtwoodMotion(items, systems, delta) {
  const participants = new Set();
  for (const system of systems) {
    const { a, b } = system;
    const gravityA = gravityFor(a, items).y;
    const gravityB = gravityFor(b, items).y;
    const totalMass = Math.max(a.mass + b.mass, 0.01);
    const acceleration = (b.mass * gravityB - a.mass * gravityA) / totalMass;
    const sharedVelocity = (b.vy - a.vy) / 2;
    let nextVelocity = sharedVelocity + acceleration * delta;
    if (Math.abs(acceleration) < 1e-10 && Math.abs(sharedVelocity) < 1e-10) nextVelocity = 0;

    const aOnGround = getItemBounds(a).bottom >= GROUND_Y - 0.000001;
    const bOnGround = getItemBounds(b).bottom >= GROUND_Y - 0.000001;
    if ((nextVelocity < 0 && aOnGround) || (nextVelocity > 0 && bOnGround)) nextVelocity = 0;

    a.vx = 0;
    b.vx = 0;
    a.vy = nextVelocity === 0 ? 0 : -nextVelocity;
    b.vy = nextVelocity;
    participants.add(a.id);
    participants.add(b.id);
  }
  return participants;
}

function syncAtwoodAfterContacts(systems) {
  for (const { a, b } of systems) {
    const aStopped = Math.abs(a.vy) < 1e-10;
    const bStopped = Math.abs(b.vy) < 1e-10;
    if (aStopped !== bStopped) {
      a.vy = 0;
      b.vy = 0;
      continue;
    }
    const measuredVelocity = (b.vy - a.vy) / 2;
    const sharedVelocity = Math.abs(measuredVelocity) < 1e-12 ? 0 : measuredVelocity;
    a.vy = sharedVelocity === 0 ? 0 : -sharedVelocity;
    b.vy = sharedVelocity;
  }
}

function syncSnapAttachments(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (let pass = 0; pass < items.length; pass += 1) {
    for (const item of items) {
      if (!item.snapTargetId || !isFixedItem(item)) continue;
      const target = byId.get(item.snapTargetId);
      if (!target) {
        item.snapTargetId = null;
        continue;
      }
      const previousX = item.x;
      const previousY = item.y;
      item.x = target.x + (item.snapOffsetX ?? 0);
      item.y = target.y + (item.snapOffsetY ?? 0);
      if (item.anchorEnabled) {
        item.anchorX += item.x - previousX;
        item.anchorY += item.y - previousY;
      }
    }
  }
}

export function getRodAnchorPoint(item) {
  const angle = radians(item.angle);
  const offset = (item.anchorPosition ?? 0) * (item.size * WORLD_SCALE) / 2;
  return {
    x: item.x + Math.cos(angle) * offset,
    y: item.y + Math.sin(angle) * offset,
  };
}

function stepAnchoredRod(item, items, delta) {
  if (item.type !== "rod" || !item.anchorEnabled) return false;
  const anchor = {
    x: Number.isFinite(item.anchorX) ? item.anchorX : getRodAnchorPoint(item).x,
    y: Number.isFinite(item.anchorY) ? item.anchorY : getRodAnchorPoint(item).y,
  };
  const theta = radians(item.angle);
  const centerOffset = -(item.anchorPosition ?? 0) * (item.size * WORLD_SCALE) / 2;
  const centerFromAnchor = {
    x: Math.cos(theta) * centerOffset,
    y: Math.sin(theta) * centerOffset,
  };
  const gravity = gravityFor(item, items);
  const force = { x: item.mass * gravity.x, y: item.mass * gravity.y };
  const torqueWorld = centerFromAnchor.x * force.y - centerFromAnchor.y * force.x;
  const torqueMeters = torqueWorld / WORLD_SCALE;
  const angularAcceleration = torqueMeters / Math.max(item.inertia, 0.1);
  item.angularVelocity += angularAcceleration * delta;
  item.angle += item.angularVelocity * delta * (180 / Math.PI);

  const nextTheta = radians(item.angle);
  const nextOffset = -(item.anchorPosition ?? 0) * (item.size * WORLD_SCALE) / 2;
  item.x = anchor.x + Math.cos(nextTheta) * nextOffset;
  item.y = anchor.y + Math.sin(nextTheta) * nextOffset;
  item.anchorX = anchor.x;
  item.anchorY = anchor.y;
  item.vx = 0;
  item.vy = 0;
  return true;
}

export function stepSandbox(items, links, deltaSeconds) {
  const delta = Math.min(Math.max(deltaSeconds, 0), 0.04);
  const next = items.map((item) => ({ ...item }));
  const supportById = new Map();
  syncSnapAttachments(next);
  applyPulleyRopeGuides(next, links);
  const atwoodSystems = getSimpleAtwoodSystems(next, links);
  const atwoodParticipants = prepareAtwoodMotion(next, atwoodSystems, delta);
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
    if (stepAnchoredRod(item, next, delta)) continue;
    if (!isDynamicItem(item)) continue;

    if (atwoodParticipants.has(item.id)) {
      item.x += item.vx * WORLD_SCALE * delta;
      item.y += item.vy * WORLD_SCALE * delta;
      const support = resolveEnvironment(item, next);
      if (support) supportById.set(item.id, support);
      continue;
    }

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
    const support = resolveEnvironment(item, next);
    if (support) supportById.set(item.id, support);
  }

  applyPulleyRopeGuides(next, links);
  syncAtwoodAfterContacts(atwoodSystems);
  solveBodyCollisions(next);
  const atwoodLinks = new Set(atwoodSystems.map((system) => system.link));
  solveRopes(next, links.filter((link) => !atwoodLinks.has(link)));
  for (const item of next.filter((candidate) => isDynamicItem(candidate) && !isFixedItem(candidate))) {
    const support = resolveEnvironment(item, next) ?? supportById.get(item.id) ?? null;
    updateBlockSupport(item, support, delta);
  }
  applyPulleyRopeGuides(next, links);
  syncSnapAttachments(next);
  return next;
}

export function resetSandbox(items) {
  const next = items.map((item) => ({
    ...item,
    x: item.initialX,
    y: item.initialY,
    vx: item.initialVx,
    vy: item.initialVy,
    angle: item.initialAngle,
    angularVelocity: 0,
    supportSurfaceId: null,
    supportSurfaceAngle: 0,
    supportAirTime: 1,
  }));
  for (const item of next) {
    if (item.type === "rod" && item.anchorEnabled) {
      const anchor = getRodAnchorPoint(item);
      item.anchorX = anchor.x;
      item.anchorY = anchor.y;
    }
  }
  syncSnapAttachments(next);
  return next;
}
