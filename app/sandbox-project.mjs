import {
  WORLD_SCALE,
  createSandboxItem,
  getConnectionAnchor,
  getInclineGeometry,
  getItemHitbox,
  getRodAnchorPoint,
} from "./sandbox-physics.mjs";

const CODE_PREFIX = "PHY1";
const ITEM_TYPES = new Set([
  "block",
  "ball",
  "cart",
  "rod",
  "wheel",
  "pendulum",
  "platform",
  "incline",
  "pulley",
  "gravity-region",
]);
const NUMBER_FIELDS = [
  "x",
  "y",
  "initialX",
  "initialY",
  "vx",
  "vy",
  "initialVx",
  "initialVy",
  "mass",
  "size",
  "width",
  "height",
  "friction",
  "restitution",
  "angle",
  "initialAngle",
  "angularVelocity",
  "radius",
  "inertia",
  "length",
  "gravityStrength",
  "gravityDirection",
  "anchorPosition",
  "anchorX",
  "anchorY",
  "snapOffsetX",
  "snapOffsetY",
  "snapNormalX",
  "snapNormalY",
  "supportSurfaceAngle",
  "supportAirTime",
];
const BOOLEAN_FIELDS = ["fixed", "anchorEnabled"];

function safeNumber(value, fallback) {
  return Number.isFinite(value) && Math.abs(value) <= 1_000_000 ? value : fallback;
}

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(value);
}

function sanitizeItem(raw, index) {
  if (!raw || typeof raw !== "object" || !ITEM_TYPES.has(raw.type)) {
    throw new TypeError(`Saved object ${index + 1} has an unsupported type.`);
  }
  if (!validId(raw.id)) throw new TypeError(`Saved object ${index + 1} has an invalid ID.`);
  const base = createSandboxItem(raw.type, raw.id, safeNumber(raw.x, 50), safeNumber(raw.y, 50));
  const item = { ...base };
  for (const field of NUMBER_FIELDS) item[field] = safeNumber(raw[field], base[field]);
  for (const field of BOOLEAN_FIELDS) item[field] = typeof raw[field] === "boolean" ? raw[field] : base[field];
  item.snapTargetId = validId(raw.snapTargetId) ? raw.snapTargetId : null;
  item.supportSurfaceId = validId(raw.supportSurfaceId) || raw.supportSurfaceId === "world-ground"
    ? raw.supportSurfaceId
    : null;
  return item;
}

function sanitizeLink(raw, index, itemIds) {
  if (!raw || typeof raw !== "object" || !["rope", "spring"].includes(raw.type)) {
    throw new TypeError(`Saved connection ${index + 1} has an unsupported type.`);
  }
  if (!validId(raw.id) || !itemIds.has(raw.a) || !itemIds.has(raw.b) || raw.a === raw.b) {
    throw new TypeError(`Saved connection ${index + 1} has invalid endpoints.`);
  }
  const pulleys = raw.type === "rope" && Array.isArray(raw.pulleys)
    ? raw.pulleys.slice(0, 50)
      .map((entry) => typeof entry === "string" ? { id: entry, direction: 0 } : entry)
      .filter((entry) => entry && itemIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        direction: [-1, 0, 1].includes(entry.direction) ? entry.direction : 0,
      }))
    : [];
  return {
    id: raw.id,
    type: raw.type,
    a: raw.a,
    b: raw.b,
    naturalLength: Math.max(0.01, safeNumber(raw.naturalLength, 1)),
    springConstant: Math.max(0, safeNumber(raw.springConstant, 18)),
    verticalSnap: Boolean(raw.verticalSnap),
    pulleys,
  };
}

function bytesToCode(bytes) {
  let code = CODE_PREFIX;
  for (const byte of bytes) code += byte.toString(36).padStart(2, "0");
  return code;
}

function codeToBytes(code) {
  const normalized = code.replace(/\s+/g, "");
  if (!normalized.startsWith(CODE_PREFIX)) throw new TypeError("That is not a PhysicsLab project code.");
  const encoded = normalized.slice(CODE_PREFIX.length);
  if (!encoded.length || encoded.length % 2 !== 0 || encoded.length > 400_000) {
    throw new TypeError("The PhysicsLab project code is incomplete or too large.");
  }
  const bytes = new Uint8Array(encoded.length / 2);
  for (let index = 0; index < encoded.length; index += 2) {
    const value = Number.parseInt(encoded.slice(index, index + 2), 36);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new TypeError("The PhysicsLab project code contains invalid characters.");
    }
    bytes[index / 2] = value;
  }
  return bytes;
}

export function encodeSandboxProject(items, links) {
  const payload = JSON.stringify({ version: 1, items, links });
  return bytesToCode(new TextEncoder().encode(payload));
}

export function decodeSandboxProject(code) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(codeToBytes(code)));
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("PhysicsLab")) throw error;
    throw new TypeError("The project code is damaged or incomplete.");
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.links)) {
    throw new TypeError("This project code uses an unsupported format.");
  }
  if (parsed.items.length > 200 || parsed.links.length > 400) {
    throw new TypeError("This project is larger than the sandbox can safely load.");
  }
  const items = parsed.items.map(sanitizeItem);
  const itemIds = new Set(items.map((item) => item.id));
  if (itemIds.size !== items.length) throw new TypeError("The project code contains duplicate object IDs.");
  const links = parsed.links.map((link, index) => sanitizeLink(link, index, itemIds));
  return { items, links };
}

export function measureSandboxItems(items, firstId, secondId, basis = "center") {
  const first = items.find((item) => item.id === firstId);
  const second = items.find((item) => item.id === secondId);
  if (!first || !second || first.id === second.id) return null;
  const start = basis === "edge" ? getConnectionAnchor(first, second) : { x: first.x, y: first.y };
  const end = basis === "edge" ? getConnectionAnchor(second, first) : { x: second.x, y: second.y };
  return {
    start,
    end,
    distance: Math.hypot(end.x - start.x, end.y - start.y) / WORLD_SCALE,
  };
}

function rotateRulerOffset(x, y, angle = 0) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine,
  };
}

function rulerAnchor(item, id, label, shortLabel, x, y) {
  return {
    id,
    label: `${item.label} ${label}`,
    shortLabel,
    x,
    y,
  };
}

function rectangleRulerAnchors(item, shape) {
  const points = [
    ["north-west", "top-left corner", "NW", -shape.halfWidth, -shape.halfHeight],
    ["north", "top side", "N", 0, -shape.halfHeight],
    ["north-east", "top-right corner", "NE", shape.halfWidth, -shape.halfHeight],
    ["east", item.type === "rod" || item.type === "platform" ? "right endpoint" : "right side", "E", shape.halfWidth, 0],
    ["south-east", "bottom-right corner", "SE", shape.halfWidth, shape.halfHeight],
    ["south", "bottom side", "S", 0, shape.halfHeight],
    ["south-west", "bottom-left corner", "SW", -shape.halfWidth, shape.halfHeight],
    ["west", item.type === "rod" || item.type === "platform" ? "left endpoint" : "left side", "W", -shape.halfWidth, 0],
  ];
  return [rulerAnchor(item, "center", "center", "C", shape.x, shape.y), ...points.map(([id, label, shortLabel, x, y]) => {
    const offset = rotateRulerOffset(x, y, shape.angle);
    return rulerAnchor(item, id, label, shortLabel, shape.x + offset.x, shape.y + offset.y);
  })];
}

/**
 * Returns stable, named ruler points for an item. The point ID is stored by the
 * UI so the measurement follows the same physical feature while the item moves.
 */
export function getSandboxRulerAnchors(item) {
  if (!item) return [];

  if (item.type === "incline") {
    const { width, height } = getInclineGeometry(item);
    const leftBottom = { x: item.x - width / 2, y: item.y + height / 2 };
    const rightBottom = { x: item.x + width / 2, y: item.y + height / 2 };
    const high = item.angle < 0
      ? { x: item.x - width / 2, y: item.y - height / 2 }
      : { x: item.x + width / 2, y: item.y - height / 2 };
    const low = item.angle < 0 ? rightBottom : leftBottom;
    const corner = item.angle < 0 ? leftBottom : rightBottom;
    return [
      rulerAnchor(item, "center", "center", "C", item.x, item.y),
      rulerAnchor(item, "low-end", "low endpoint", "L", low.x, low.y),
      rulerAnchor(item, "slope-midpoint", "slope midpoint", "M", (low.x + high.x) / 2, (low.y + high.y) / 2),
      rulerAnchor(item, "high-end", "high endpoint", "H", high.x, high.y),
      rulerAnchor(item, "right-angle", "right-angle corner", "90", corner.x, corner.y),
    ];
  }

  if (item.type === "pendulum") {
    const theta = (item.angle * Math.PI) / 180;
    const armLength = Math.max(item.length * WORLD_SCALE, 2);
    const bob = {
      x: item.x - Math.sin(theta) * armLength,
      y: item.y + Math.cos(theta) * armLength,
    };
    const radius = (item.size * WORLD_SCALE) / 2;
    return [
      rulerAnchor(item, "pivot", "pivot", "P", item.x, item.y),
      rulerAnchor(item, "arm-midpoint", "arm midpoint", "M", (item.x + bob.x) / 2, (item.y + bob.y) / 2),
      rulerAnchor(item, "bob-center", "bob center", "B", bob.x, bob.y),
      rulerAnchor(item, "bob-north", "bob top", "N", bob.x, bob.y - radius),
      rulerAnchor(item, "bob-east", "bob right side", "E", bob.x + radius, bob.y),
      rulerAnchor(item, "bob-south", "bob bottom", "S", bob.x, bob.y + radius),
      rulerAnchor(item, "bob-west", "bob left side", "W", bob.x - radius, bob.y),
    ];
  }

  const shape = getItemHitbox(item);
  if (!shape) return [];
  if (shape.kind === "circle") {
    return [
      rulerAnchor(item, "center", "center", "C", shape.x, shape.y),
      rulerAnchor(item, "north", "top side", "N", shape.x, shape.y - shape.radius),
      rulerAnchor(item, "east", "right side", "E", shape.x + shape.radius, shape.y),
      rulerAnchor(item, "south", "bottom side", "S", shape.x, shape.y + shape.radius),
      rulerAnchor(item, "west", "left side", "W", shape.x - shape.radius, shape.y),
    ];
  }

  const anchors = rectangleRulerAnchors(item, shape);
  if (item.type === "rod" && item.anchorEnabled) {
    const hinge = getRodAnchorPoint(item);
    anchors.push(rulerAnchor(item, "hinge", "hinge", "A", hinge.x, hinge.y));
  }
  return anchors;
}

export function resolveSandboxRulerPoint(items, reference) {
  if (!reference || typeof reference !== "object") return null;
  if (reference.kind === "grid") {
    if (!Number.isFinite(reference.x) || !Number.isFinite(reference.y)) return null;
    return {
      x: reference.x,
      y: reference.y,
      label: `Grid (${(reference.x / WORLD_SCALE).toFixed(1)}, ${(reference.y / WORLD_SCALE).toFixed(1)}) m`,
      shortLabel: "G",
    };
  }
  if (reference.kind !== "object") return null;
  const item = items.find((candidate) => candidate.id === reference.itemId);
  if (!item) return null;
  return getSandboxRulerAnchors(item).find((anchor) => anchor.id === reference.anchor) ?? null;
}

export function measureSandboxPoints(items, firstReference, secondReference) {
  const start = resolveSandboxRulerPoint(items, firstReference);
  const end = resolveSandboxRulerPoint(items, secondReference);
  if (!start || !end) return null;
  return {
    start,
    end,
    distance: Math.hypot(end.x - start.x, end.y - start.y) / WORLD_SCALE,
  };
}
