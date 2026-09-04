"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  CANVAS_PIXELS_PER_UNIT,
  GRID_STEP,
  GROUND_Y,
  SANDBOX_WORLD_HEIGHT,
  SANDBOX_WORLD_WIDTH,
  SANDBOX_TOOLS,
  WALL_THICKNESS,
  WORLD_SCALE,
  applyPulleyRopeGuides,
  clampItemToWorkspace,
  cloneSandboxExperiment,
  createSandboxItem,
  createStarterSandbox,
  findSnapPlacement,
  findSmoothSurfaceJoin,
  getConnectionAnchor,
  getInclineGeometry,
  getRodAnchorPoint,
  getRopeRoute,
  getSandboxAnalysis,
  isDynamicItem,
  isFixedItem,
  resizePendulumFromBob,
  resizeSquareFromCorner,
  snapSandboxItemPosition,
  snapToGrid,
  stepSandbox,
} from "./sandbox-physics.mjs";
import {
  bottomLeftSandboxCamera,
  cameraForZoomAtPoint,
  clampSandboxZoom,
  constrainSandboxCamera,
  minimumSandboxZoom,
  screenPointToWorld,
} from "./sandbox-camera.mjs";
import SandboxGraph, { type SandboxMotionSample } from "./sandbox-graph";
import {
  decodeSandboxProject,
  encodeSandboxProject,
  getSandboxRulerAnchors,
  measureSandboxPoints,
  resolveSandboxRulerPoint,
} from "./sandbox-project.mjs";

type ConnectorType = "rope" | "spring";

interface SandboxItem {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  initialX: number;
  initialY: number;
  vx: number;
  vy: number;
  initialVx: number;
  initialVy: number;
  mass: number;
  size: number;
  width: number;
  height: number;
  friction: number;
  restitution: number;
  angle: number;
  initialAngle: number;
  angularVelocity: number;
  radius: number;
  inertia: number;
  length: number;
  gravityStrength: number;
  gravityDirection: number;
  fixed: boolean;
  anchorEnabled: boolean;
  anchorPosition: number;
  anchorX: number;
  anchorY: number;
  snapTargetId: string | null;
  snapOffsetX: number;
  snapOffsetY: number;
  snapNormalX: number;
  snapNormalY: number;
  supportSurfaceId: string | null;
  supportSurfaceAngle: number;
  supportAirTime: number;
}

interface SandboxLink {
  id: string;
  type: ConnectorType;
  a: string;
  b: string;
  naturalLength: number;
  springConstant: number;
  verticalSnap: boolean;
  pulleys: Array<{ id: string; direction: number }>;
}

interface SnapGuide {
  itemId: string;
  targetId: string;
  targetLabel: string;
  part: string;
  smooth?: boolean;
}

interface ExperimentSnapshot {
  items: SandboxItem[];
  links: SandboxLink[];
}

type RulerPointReference =
  | { kind: "grid"; x: number; y: number }
  | { kind: "object"; itemId: string; anchor: string };

interface RulerAnchor {
  id: string;
  label: string;
  shortLabel: string;
  x: number;
  y: number;
}

interface SandboxAnalysis {
  position: { x: number; height: number };
  velocity: { x: number; y: number; magnitude: number };
  acceleration: { x: number; y: number; magnitude: number };
  momentum: { x: number; y: number; magnitude: number };
  netForce: { x: number; y: number; magnitude: number };
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  forces: Array<{ label: string; x: number; y: number; magnitude: number; tone: string }>;
}

const ICONS: Record<string, string> = {
  block: "▣",
  ball: "●",
  cart: "▱",
  rod: "━",
  wheel: "◉",
  pendulum: "⌁",
  platform: "▬",
  incline: "◢",
  pulley: "◉",
  "gravity-region": "↓",
  rope: "⌇",
  spring: "≋",
};

const CATEGORIES = ["Objects", "Structures", "Fields", "Connections"];
const DEFAULT_SANDBOX_ZOOM = 0.75;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function captureMotionSample(items: SandboxItem[], time: number): SandboxMotionSample {
  const trackedItems = items.filter((item) => (
    (isDynamicItem(item) && !isFixedItem(item)) || item.type === "pendulum" || (item.type === "rod" && item.anchorEnabled)
  ));
  return {
    time,
    objects: Object.fromEntries(trackedItems.map((item) => {
      if (item.type === "pendulum") {
        const theta = (item.angle * Math.PI) / 180;
        const arm = item.length * WORLD_SCALE;
        const x = item.x - Math.sin(theta) * arm;
        const y = item.y + Math.cos(theta) * arm;
        const vx = -Math.cos(theta) * item.length * item.angularVelocity;
        const vy = -Math.sin(theta) * item.length * item.angularVelocity;
        return [item.id, {
          x: x / WORLD_SCALE,
          height: (GROUND_Y - y) / WORLD_SCALE,
          vx,
          vy,
          speed: Math.hypot(vx, vy),
          mass: item.mass,
        }];
      }
      return [item.id, {
        x: item.x / WORLD_SCALE,
        height: (GROUND_Y - item.y) / WORLD_SCALE,
        vx: item.vx,
        vy: item.vy,
        speed: Math.hypot(item.vx, item.vy),
        mass: item.mass,
      }];
    })),
  };
}

function nextProjectCounter(items: SandboxItem[], links: SandboxLink[]) {
  return [...items, ...links].reduce((highest, entry) => {
    const suffix = Number(entry.id.match(/(\d+)$/)?.[1] ?? 0);
    return Math.max(highest, suffix + 1);
  }, 1);
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <label className="sandbox-control">
      <span><span>{label}</span><output>{value.toFixed(decimals)} {unit}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function SandboxForceDiagram({ analysis }: { analysis: SandboxAnalysis }) {
  const largestForce = Math.max(...analysis.forces.map((force) => force.magnitude), 1);
  return (
    <div className="sandbox-fbd" role="img" aria-label={`Free-body diagram with ${analysis.forces.length} force vectors`}>
      <div className="sandbox-fbd-grid" />
      <div className="sandbox-fbd-body">m</div>
      {analysis.forces.map((force, index) => {
        const angle = Math.atan2(force.y, force.x) * 180 / Math.PI;
        const length = 34 + (force.magnitude / largestForce) * 42;
        return <div
          key={`${force.label}-${index}`}
          className={`sandbox-force-vector tone-${force.tone}`}
          style={{ "--force-angle": `${angle}deg`, "--force-counter-angle": `${-angle}deg`, "--force-length": `${length}px` } as CSSProperties}
        ><span>{force.label} {force.magnitude.toFixed(2)} N</span></div>;
      })}
      {analysis.forces.length === 0 && <p>No external force on this object.</p>}
    </div>
  );
}

function LiveObjectInspection({ item, analysis }: { item: SandboxItem; analysis: SandboxAnalysis }) {
  const rows = [
    ["Mass", item.mass, "kg"],
    ["Position x", analysis.position.x, "m"],
    ["Height", analysis.position.height, "m"],
    ["Velocity x", analysis.velocity.x, "m/s"],
    ["Velocity y", analysis.velocity.y, "m/s"],
    ["Speed", analysis.velocity.magnitude, "m/s"],
    ["Acceleration x", analysis.acceleration.x, "m/s²"],
    ["Acceleration y", analysis.acceleration.y, "m/s²"],
    ["Net force", analysis.netForce.magnitude, "N"],
    ["Momentum", analysis.momentum.magnitude, "kg·m/s"],
    ["Kinetic energy", analysis.kineticEnergy, "J"],
    ["Potential energy", analysis.potentialEnergy, "J"],
    ["Total energy", analysis.totalEnergy, "J"],
  ] as const;
  return (
    <div className="sandbox-live-inspection">
      <div className="sandbox-live-state"><i />Paused measurement</div>
      <dl className="sandbox-live-values">
        {rows.map(([label, value, unit]) => <div key={label}><dt>{label}</dt><dd>{value.toFixed(3)} <small>{unit}</small></dd></div>)}
      </dl>
      <h3>Free-body diagram</h3>
      <SandboxForceDiagram analysis={analysis} />
      <p className="sandbox-analysis-note">Vector lengths are scaled relative to the largest force on this object.</p>
    </div>
  );
}

function entityDimensions(item: SandboxItem) {
  if (item.type === "platform") {
    return {
      width: `${Math.max((item.width ?? item.size) * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT, GRID_STEP * CANVAS_PIXELS_PER_UNIT)}px`,
      height: `${Math.max((item.height ?? 1) * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT, GRID_STEP * CANVAS_PIXELS_PER_UNIT)}px`,
    };
  }
  if (item.type === "incline") {
    const geometry = getInclineGeometry(item);
    const width = Math.max(geometry.width * CANVAS_PIXELS_PER_UNIT, GRID_STEP * CANVAS_PIXELS_PER_UNIT);
    const height = Math.max(geometry.height * CANVAS_PIXELS_PER_UNIT, 1);
    return { width: `${width}px`, height: `${height}px` };
  }
  if (item.type === "rod") {
    return {
      width: `${Math.max(item.size * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT, GRID_STEP * CANVAS_PIXELS_PER_UNIT)}px`,
      height: `${WORLD_SCALE * 0.36 * CANVAS_PIXELS_PER_UNIT}px`,
    };
  }
  if (item.type === "gravity-region") {
    return {
      width: `${Math.max((item.width ?? item.size) * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT, GRID_STEP * CANVAS_PIXELS_PER_UNIT)}px`,
      height: `${Math.max((item.height ?? item.size) * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT, GRID_STEP * CANVAS_PIXELS_PER_UNIT)}px`,
    };
  }
  if (item.type === "pendulum") {
    const bob = item.size * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT;
    const arm = item.length * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT;
    return { width: `${bob}px`, height: `${arm + bob / 2}px` };
  }
  const size = Math.max(item.size * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT, 28);
  return { width: `${size}px`, height: `${item.type === "cart" ? size * 0.62 : size}px` };
}

function itemTransform(item: SandboxItem) {
  if (item.type === "pendulum") return "translate(-50%, 0)";
  const angle = item.type === "incline" ? 0 : item.angle;
  return `translate(-50%, -50%) rotate(${angle}deg)`;
}

function linkStyle(a: SandboxItem, b: SandboxItem) {
  const start = getConnectionAnchor(a, b);
  const end = getConnectionAnchor(b, a);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    left: `${start.x * CANVAS_PIXELS_PER_UNIT}px`,
    top: `${start.y * CANVAS_PIXELS_PER_UNIT}px`,
    width: `${Math.hypot(dx, dy) * CANVAS_PIXELS_PER_UNIT}px`,
    transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`,
  } as CSSProperties;
}

function linkLength(a: SandboxItem, b: SandboxItem) {
  const start = getConnectionAnchor(a, b);
  const end = getConnectionAnchor(b, a);
  return Math.max(0.25, Math.hypot(end.x - start.x, end.y - start.y) / WORLD_SCALE);
}

function ropePath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(" ");
}

function snapWithSlopeAlignment(item: SandboxItem, items: SandboxItem[]) {
  let alignedItem = item;
  let snap = findSmoothSurfaceJoin(alignedItem, items) ?? findSnapPlacement(alignedItem, items);
  let target = snap ? items.find((candidate) => candidate.id === snap.targetId) ?? null : null;

  if (item.type === "block" && target?.type === "incline") {
    const slopeAngle = -target.angle;
    const candidate = {
      ...item,
      angle: slopeAngle,
      initialAngle: slopeAngle,
      supportSurfaceId: target.id,
      supportSurfaceAngle: slopeAngle,
      supportAirTime: 0,
    };
    const alignedSnap = findSnapPlacement(candidate, items, GRID_STEP * 1.6);
    if (alignedSnap?.targetId === target.id) {
      alignedItem = candidate;
      snap = alignedSnap;
      target = items.find((surface) => surface.id === alignedSnap.targetId) ?? target;
    }
  }

  return { item: alignedItem, snap, target };
}

export default function SandboxLab() {
  const [items, setItems] = useState<SandboxItem[]>([]);
  const [links, setLinks] = useState<SandboxLink[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [connectorTool, setConnectorTool] = useState<ConnectorType | null>(null);
  const [linkStartId, setLinkStartId] = useState<string | null>(null);
  const [linkPulleyIds, setLinkPulleyIds] = useState<string[]>([]);
  const [pulleyLinkId, setPulleyLinkId] = useState<string | null>(null);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [snapGuide, setSnapGuide] = useState<SnapGuide | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [running, setRunning] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [simulationTime, setSimulationTime] = useState(0);
  const [motionHistory, setMotionHistory] = useState<SandboxMotionSample[]>([]);
  const [showGraph, setShowGraph] = useState(false);
  const [graphObjectId, setGraphObjectId] = useState<string | null>(null);
  const [runGeneration, setRunGeneration] = useState(0);
  const [projectPanelOpen, setProjectPanelOpen] = useState(false);
  const [projectCode, setProjectCode] = useState("");
  const [loadCode, setLoadCode] = useState("");
  const [projectMessage, setProjectMessage] = useState("");
  const [rulerActive, setRulerActive] = useState(false);
  const [rulerPoints, setRulerPoints] = useState<RulerPointReference[]>([]);
  const [zoom, setZoom] = useState(DEFAULT_SANDBOX_ZOOM);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(1);
  const lastFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
    moved: boolean;
    recorded: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    handle: string;
    original: SandboxItem;
    recorded: boolean;
  } | null>(null);
  const connectorClickRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  const linksRef = useRef(links);
  const selectedItemIdRef = useRef(selectedItemId);
  const selectedLinkIdRef = useRef(selectedLinkId);
  const initializedRef = useRef(initialized);
  const runningRef = useRef(running);
  const historyRef = useRef<Array<{ items: SandboxItem[]; links: SandboxLink[] }>>([]);
  const runSnapshotRef = useRef<ExperimentSnapshot | null>(null);
  const simulationTimeRef = useRef(0);
  const lastMotionSampleRef = useRef(0);
  const motionHistoryRef = useRef<SandboxMotionSample[]>([]);
  const zoomRef = useRef(DEFAULT_SANDBOX_ZOOM);
  const cameraRef = useRef({ x: 0, y: 0 });
  const didCenterCameraRef = useRef(false);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    cameraX: number;
    cameraY: number;
  } | null>(null);
  const pinchGestureRef = useRef<{
    distance: number;
    zoom: number;
    worldX: number;
    worldY: number;
  } | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    linksRef.current = links;
  }, [links]);

  useEffect(() => {
    selectedItemIdRef.current = selectedItemId;
    selectedLinkIdRef.current = selectedLinkId;
  }, [selectedItemId, selectedLinkId]);

  useEffect(() => {
    initializedRef.current = initialized;
  }, [initialized]);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const recordHistory = useCallback(() => {
    historyRef.current.push({
      items: itemsRef.current.map((item) => ({ ...item })),
      links: linksRef.current.map((link) => ({
        ...link,
        pulleys: link.pulleys.map((pulley) => ({ ...pulley })),
      })),
    });
    if (historyRef.current.length > 100) historyRef.current.shift();
    setUndoCount(historyRef.current.length);
  }, []);

  const undo = useCallback(() => {
    if (initializedRef.current) return;
    const previous = historyRef.current.pop();
    if (!previous) return;
    itemsRef.current = previous.items;
    linksRef.current = previous.links;
    setItems(previous.items);
    setLinks(previous.links);
    selectedItemIdRef.current = null;
    selectedLinkIdRef.current = null;
    setSelectedItemId(null);
    setSelectedLinkId(null);
    setPulleyLinkId(null);
    setSnapGuide(null);
    setRunning(false);
    setInitialized(false);
    runSnapshotRef.current = null;
    simulationTimeRef.current = 0;
    lastMotionSampleRef.current = 0;
    motionHistoryRef.current = [];
    setSimulationTime(0);
    setMotionHistory([]);
    setUndoCount(historyRef.current.length);
  }, []);

  const deleteSelection = useCallback(() => {
    if (initializedRef.current) return;
    const itemId = selectedItemIdRef.current;
    const linkId = selectedLinkIdRef.current;
    if (!itemId && !linkId) return;
    recordHistory();
    if (itemId) {
      const nextItems = itemsRef.current.filter((item) => item.id !== itemId);
      const nextLinks = linksRef.current
        .filter((link) => link.a !== itemId && link.b !== itemId)
        .map((link) => ({ ...link, pulleys: link.pulleys.filter((pulley) => pulley.id !== itemId) }));
      itemsRef.current = nextItems;
      linksRef.current = nextLinks;
      setItems(nextItems);
      setLinks(nextLinks);
    } else if (linkId) {
      const nextLinks = linksRef.current.filter((link) => link.id !== linkId);
      linksRef.current = nextLinks;
      setLinks(nextLinks);
    }
    selectedItemIdRef.current = null;
    selectedLinkIdRef.current = null;
    setSelectedItemId(null);
    setSelectedLinkId(null);
    setSnapGuide(null);
    setPulleyLinkId(null);
    setRunning(false);
  }, [recordHistory]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!selectedItemIdRef.current && !selectedLinkIdRef.current) return;
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [deleteSelection, undo]);

  useEffect(() => {
    if (didCenterCameraRef.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const viewport = { width: rect.width, height: rect.height };
    const world = {
      width: SANDBOX_WORLD_WIDTH * CANVAS_PIXELS_PER_UNIT,
      height: SANDBOX_WORLD_HEIGHT * CANVAS_PIXELS_PER_UNIT,
    };
    const initialZoom = clampSandboxZoom(
      DEFAULT_SANDBOX_ZOOM,
      minimumSandboxZoom(viewport, world),
    );
    const next = constrainSandboxCamera(
      bottomLeftSandboxCamera(viewport, world, initialZoom),
      viewport,
      world,
      initialZoom,
    );
    didCenterCameraRef.current = true;
    zoomRef.current = initialZoom;
    cameraRef.current = next;
    setZoom(initialZoom);
    setCamera(next);
  }, []);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null;
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const ropeRoutes = useMemo(() => links
    .filter((link) => link.type === "rope")
    .map((link) => ({
      link,
      route: getRopeRoute(items, link),
      a: items.find((item) => item.id === link.a),
      b: items.find((item) => item.id === link.b),
    })), [items, links]);
  const graphableItems = useMemo(() => items.filter((item) => (
    (isDynamicItem(item) && !isFixedItem(item)) || item.type === "pendulum" || (item.type === "rod" && item.anchorEnabled)
  )), [items]);
  const trackedGraphObject = graphableItems.find((item) => item.id === graphObjectId) ?? graphableItems[0] ?? null;
  const rulerAnchors = useMemo(() => items.flatMap((item) => (
    (getSandboxRulerAnchors(item) as RulerAnchor[]).map((anchor) => ({ ...anchor, itemId: item.id }))
  )), [items]);
  const resolvedRulerPoints = useMemo(() => rulerPoints
    .map((point) => resolveSandboxRulerPoint(items, point) as RulerAnchor | null)
    .filter((point): point is RulerAnchor => Boolean(point)), [items, rulerPoints]);
  const rulerMeasurement = useMemo(() => rulerPoints.length === 2
    ? measureSandboxPoints(items, rulerPoints[0], rulerPoints[1])
    : null, [items, rulerPoints]);
  const selectedAnalysis = useMemo(() => initialized && !running && selectedItem
    ? getSandboxAnalysis(items, links, selectedItem.id) as SandboxAnalysis | null
    : null, [initialized, items, links, running, selectedItem]);

  useEffect(() => {
    if (!running) {
      lastFrameRef.current = null;
      return;
    }
    let frame = 0;
    const animate = (timestamp: number) => {
      if (!runningRef.current) return;
      if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
      const delta = Math.min((timestamp - lastFrameRef.current) / 1000, 0.04) * playbackSpeed;
      lastFrameRef.current = timestamp;
      const next = stepSandbox(itemsRef.current, linksRef.current, delta) as SandboxItem[];
      const nextTime = simulationTimeRef.current + delta;
      itemsRef.current = next;
      simulationTimeRef.current = nextTime;
      setItems(next);
      setSimulationTime(nextTime);
      if (nextTime - lastMotionSampleRef.current >= 0.05) {
        lastMotionSampleRef.current = nextTime;
        const sample = captureMotionSample(next, nextTime);
        const nextHistory = [...motionHistoryRef.current, sample].slice(-6000);
        motionHistoryRef.current = nextHistory;
        setMotionHistory(nextHistory);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [running, playbackSpeed]);

  const selectItem = (id: string) => {
    if (initialized && running) return;
    selectedItemIdRef.current = id;
    selectedLinkIdRef.current = null;
    setSelectedItemId(id);
    setSelectedLinkId(null);
    setPulleyLinkId(null);
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (item && ((isDynamicItem(item) && !isFixedItem(item)) || item.type === "pendulum" || (item.type === "rod" && item.anchorEnabled))) {
      setGraphObjectId(id);
    }
  };

  const clearSelection = () => {
    selectedItemIdRef.current = null;
    selectedLinkIdRef.current = null;
    setSelectedItemId(null);
    setSelectedLinkId(null);
    setPulleyLinkId(null);
  };

  const selectLink = (id: string) => {
    if (initialized && running) return;
    const nextId = selectedLinkIdRef.current === id ? null : id;
    selectedItemIdRef.current = null;
    selectedLinkIdRef.current = nextId;
    setSelectedItemId(null);
    setSelectedLinkId(nextId);
    setPulleyLinkId(null);
  };

  const addTool = (type: string, x?: number, y?: number) => {
    if (initialized) return;
    if (type === "rope" || type === "spring") {
      const nextTool = connectorTool === type ? null : type;
      const selected = itemsRef.current.find((item) => item.id === selectedItemIdRef.current);
      const canStartFromSelection = Boolean(
        nextTool &&
        selected &&
        selected.type !== "gravity-region" &&
        (nextTool !== "rope" || selected.type !== "pulley"),
      );
      setConnectorTool(nextTool);
      setLinkStartId(canStartFromSelection ? selected?.id ?? null : null);
      setLinkPulleyIds([]);
      setPulleyLinkId(null);
      setRulerActive(false);
      setRulerPoints([]);
      setRunning(false);
      return;
    }
    const index = counterRef.current;
    counterRef.current += 1;
    const created = createSandboxItem(
      type,
      `sandbox-${type}-${index}`,
      x ?? 75 + (index % 4) * GRID_STEP,
      y ?? GROUND_Y - 75 + (index % 3) * GRID_STEP,
    ) as SandboxItem;
    const gridPosition = snapSandboxItemPosition(created, created.x, created.y);
    const positioned = clampItemToWorkspace({ ...created, ...gridPosition }) as SandboxItem;
    const raw = {
      ...positioned,
      initialX: positioned.x,
      initialY: positioned.y,
    };
    const snapResult = snapWithSlopeAlignment(raw, itemsRef.current);
    const aligned = snapResult.item;
    const snap = snapResult.snap;
    const next = snap ? {
      ...aligned,
      x: snap.x,
      y: snap.y,
      initialX: snap.x,
      initialY: snap.y,
      snapTargetId: null,
      snapOffsetX: 0,
      snapOffsetY: 0,
      snapNormalX: 0,
      snapNormalY: -1,
    } : aligned;
    recordHistory();
    setItems((current) => [...current, next]);
    selectItem(next.id);
    setRunning(false);
  };

  const handlePaletteDrag = (event: DragEvent<HTMLButtonElement>, type: string) => {
    event.dataTransfer.setData("application/x-motionlab-tool", type);
    event.dataTransfer.effectAllowed = "copy";
  };

  const applyCamera = (next: { x: number; y: number }, nextZoom = zoomRef.current) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const constrained = rect
      ? constrainSandboxCamera(
          next,
          { width: rect.width, height: rect.height },
          {
            width: SANDBOX_WORLD_WIDTH * CANVAS_PIXELS_PER_UNIT,
            height: SANDBOX_WORLD_HEIGHT * CANVAS_PIXELS_PER_UNIT,
          },
          nextZoom,
        )
      : next;
    cameraRef.current = constrained;
    setCamera(constrained);
  };

  const resetCameraToBottomLeft = (nextZoom = DEFAULT_SANDBOX_ZOOM) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = { width: rect.width, height: rect.height };
    const world = {
      width: SANDBOX_WORLD_WIDTH * CANVAS_PIXELS_PER_UNIT,
      height: SANDBOX_WORLD_HEIGHT * CANVAS_PIXELS_PER_UNIT,
    };
    const normalizedZoom = clampSandboxZoom(nextZoom, minimumSandboxZoom(viewport, world));
    zoomRef.current = normalizedZoom;
    setZoom(normalizedZoom);
    applyCamera(bottomLeftSandboxCamera(viewport, world, normalizedZoom), normalizedZoom);
  };

  const zoomAtClientPoint = (clientX: number, clientY: number, nextZoom: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    const result = cameraForZoomAtPoint(
      cameraRef.current,
      zoomRef.current,
      nextZoom,
      point,
      CANVAS_PIXELS_PER_UNIT,
      minimumSandboxZoom(
        { width: rect.width, height: rect.height },
        {
          width: SANDBOX_WORLD_WIDTH * CANVAS_PIXELS_PER_UNIT,
          height: SANDBOX_WORLD_HEIGHT * CANVAS_PIXELS_PER_UNIT,
        },
      ),
    );
    zoomRef.current = result.zoom;
    setZoom(result.zoom);
    applyCamera(result.camera, result.zoom);
  };

  const nudgeZoom = (factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, zoomRef.current * factor);
  };

  const stageCoordinates = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: SANDBOX_WORLD_WIDTH / 2, y: GROUND_Y - 80 };
    const point = screenPointToWorld(
      { x: clientX - rect.left, y: clientY - rect.top },
      cameraRef.current,
      zoomRef.current,
      CANVAS_PIXELS_PER_UNIT,
    );
    return {
      x: clamp(point.x, 0, SANDBOX_WORLD_WIDTH),
      y: clamp(point.y, 0, GROUND_Y),
    };
  };

  const handleStageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-motionlab-tool");
    if (!type) return;
    const point = stageCoordinates(event.clientX, event.clientY);
    addTool(type, point.x, point.y);
  };

  const handleStagePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const blocksCamera = Boolean(target.closest(
      ".sandbox-entity, .sandbox-rope, .sandbox-link, .sandbox-connect-note, button, input, label",
    ));

    if (event.pointerType === "touch") {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointersRef.current.size >= 2) {
        const rect = stageRef.current?.getBoundingClientRect();
        const points = [...activePointersRef.current.values()].slice(0, 2);
        if (!rect || points.length < 2) return;
        dragRef.current = null;
        resizeRef.current = null;
        panGestureRef.current = null;
        const center = {
          x: (points[0].x + points[1].x) / 2 - rect.left,
          y: (points[0].y + points[1].y) / 2 - rect.top,
        };
        const world = screenPointToWorld(
          center,
          cameraRef.current,
          zoomRef.current,
          CANVAS_PIXELS_PER_UNIT,
        );
        pinchGestureRef.current = {
          distance: Math.max(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), 1),
          zoom: zoomRef.current,
          worldX: world.x,
          worldY: world.y,
        };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }

    if (blocksCamera) return;
    if (rulerActive) {
      event.preventDefault();
      clearSelection();
      const point = stageCoordinates(event.clientX, event.clientY);
      chooseRulerPoint({
        kind: "grid",
        x: snapToGrid(point.x),
        y: snapToGrid(point.y),
      });
      return;
    }
    clearSelection();
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cameraX: cameraRef.current.x,
      cameraY: cameraRef.current.y,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleStagePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const pinch = pinchGestureRef.current;
    if (pinch && activePointersRef.current.size >= 2) {
      const rect = stageRef.current?.getBoundingClientRect();
      const points = [...activePointersRef.current.values()].slice(0, 2);
      if (!rect || points.length < 2) return;
      const distance = Math.max(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), 1);
      const nextZoom = clampSandboxZoom(
        pinch.zoom * (distance / pinch.distance),
        minimumSandboxZoom(
          { width: rect.width, height: rect.height },
          {
            width: SANDBOX_WORLD_WIDTH * CANVAS_PIXELS_PER_UNIT,
            height: SANDBOX_WORLD_HEIGHT * CANVAS_PIXELS_PER_UNIT,
          },
        ),
      );
      const center = {
        x: (points[0].x + points[1].x) / 2 - rect.left,
        y: (points[0].y + points[1].y) / 2 - rect.top,
      };
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      applyCamera({
        x: center.x - pinch.worldX * CANVAS_PIXELS_PER_UNIT * nextZoom,
        y: center.y - pinch.worldY * CANVAS_PIXELS_PER_UNIT * nextZoom,
      }, nextZoom);
      return;
    }

    const pan = panGestureRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    applyCamera({
      x: pan.cameraX + event.clientX - pan.startX,
      y: pan.cameraY + event.clientY - pan.startY,
    });
  };

  const handleStagePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (pinchGestureRef.current) {
      if (activePointersRef.current.size < 2) pinchGestureRef.current = null;
    }
    if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
    if (!pinchGestureRef.current && !panGestureRef.current) setIsPanning(false);
  };

  const handleStageWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0014);
    zoomAtClientPoint(event.clientX, event.clientY, zoomRef.current * factor);
  };

  const updateItem = (id: string, key: keyof SandboxItem, value: number | boolean) => {
    if (initialized) return;
    recordHistory();
    setRunning(false);
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, [key]: value };
      if (key === "vx") next.initialVx = Number(value);
      if (key === "vy") next.initialVy = Number(value);
      if (key === "angle") next.initialAngle = Number(value);
      if (key === "size" && (item.type === "wheel" || item.type === "pulley")) next.radius = Number(value) / 2;
      if (key === "radius" && (item.type === "wheel" || item.type === "pulley")) next.size = Number(value) * 2;
      if (key === "width" && item.type === "platform") next.size = Number(value);
      if (key === "size" && item.type === "platform") next.width = Number(value);
      const gridGeometryChanged =
        (next.type === "block" && key === "size") ||
        (next.type === "platform" && ["width", "height", "angle"].includes(key)) ||
        (next.type === "incline" && ["size", "angle"].includes(key)) ||
        (next.type === "gravity-region" && ["width", "height"].includes(key));
      if (gridGeometryChanged) {
        const aligned = snapSandboxItemPosition(next, next.x, next.y);
        const positioned = clampItemToWorkspace({ ...next, ...aligned });
        next.x = positioned.x;
        next.y = positioned.y;
        next.initialX = positioned.x;
        next.initialY = positioned.y;
      }
      if (next.type === "rod" && next.anchorEnabled && (key === "angle" || key === "size")) {
        const theta = (next.angle * Math.PI) / 180;
        const offset = next.anchorPosition * (next.size * WORLD_SCALE) / 2;
        next.x = next.anchorX - Math.cos(theta) * offset;
        next.y = next.anchorY - Math.sin(theta) * offset;
        next.initialX = next.x;
        next.initialY = next.y;
      }
      if (key === "fixed" && value === false) {
        next.snapTargetId = null;
        next.snapOffsetX = 0;
        next.snapOffsetY = 0;
      }
      return next;
    }));
  };

  const setRodAnchor = (item: SandboxItem, position: number | null) => {
    if (initialized) return;
    recordHistory();
    setRunning(false);
    setItems((current) => current.map((candidate) => {
      if (candidate.id !== item.id) return candidate;
      if (position === null) {
        return { ...candidate, anchorEnabled: false, angularVelocity: 0 };
      }
      const anchored = { ...candidate, anchorEnabled: true, anchorPosition: position, angularVelocity: 0 };
      const point = getRodAnchorPoint(anchored);
      return {
        ...anchored,
        anchorX: point.x,
        anchorY: point.y,
        snapTargetId: null,
        snapOffsetX: 0,
        snapOffsetY: 0,
      };
    }));
  };

  const removeSelected = deleteSelection;

  const createLink = (sourceId: string, targetId: string, type = connectorTool, pulleyIds = linkPulleyIds) => {
    if (initialized) return;
    if (!type || sourceId === targetId) return;
    const a = itemsRef.current.find((item) => item.id === sourceId);
    const b = itemsRef.current.find((item) => item.id === targetId);
    if (!a || !b) return;
    const id = `sandbox-link-${counterRef.current}`;
    counterRef.current += 1;
    const draft: SandboxLink = {
      id,
      type,
      a: sourceId,
      b: targetId,
      naturalLength: 1,
      springConstant: 18,
      verticalSnap: false,
      pulleys: type === "rope" ? pulleyIds.map((pulleyId) => ({ id: pulleyId, direction: 0 })) : [],
    };
    recordHistory();
    const link = {
      ...draft,
      naturalLength: type === "rope"
        ? Math.max(0.25, getRopeRoute(itemsRef.current, draft).lengthMeters)
        : linkLength(a, b),
    };
    const nextLinks = [...linksRef.current, link];
    linksRef.current = nextLinks;
    setLinks(nextLinks);
    selectedLinkIdRef.current = id;
    selectedItemIdRef.current = null;
    setSelectedLinkId(id);
    setSelectedItemId(null);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
  };

  const chooseEndpoint = (id: string) => {
    if (initialized || !connectorTool) return;
    const item = itemsById.get(id);
    if (!item || item.type === "gravity-region") return;
    if (connectorTool === "rope" && item.type === "pulley") {
      if (linkStartId && !linkPulleyIds.includes(id)) {
        setLinkPulleyIds((current) => [...current, id]);
      }
      return;
    }
    if (!linkStartId) {
      setLinkStartId(id);
      return;
    }
    createLink(linkStartId, id, connectorTool, linkPulleyIds);
  };

  const addPulleyToLink = (linkId: string, pulleyId: string) => {
    if (initialized) return;
    const pulley = itemsById.get(pulleyId);
    if (pulley?.type !== "pulley") return;
    const currentLink = linksRef.current.find((link) => link.id === linkId);
    if (!currentLink || currentLink.type !== "rope" || currentLink.pulleys.some((stop) => stop.id === pulleyId)) return;
    recordHistory();
    let nextItems = itemsRef.current.map((item) => ({ ...item }));
    let routed = {
      ...currentLink,
      pulleys: [...currentLink.pulleys, { id: pulleyId, direction: 0 }],
    };
    if (routed.verticalSnap) {
      applyPulleyRopeGuides(nextItems, [routed]);
      const guidedIds = new Set([routed.a, routed.b]);
      nextItems = nextItems.map((item) => guidedIds.has(item.id)
        ? { ...item, initialX: item.x, initialY: item.y, initialVx: 0, vx: 0 }
        : item);
    }
    routed = {
      ...routed,
      naturalLength: Math.max(0.25, getRopeRoute(nextItems, routed).lengthMeters),
    };
    const nextLinks = linksRef.current.map((link) => link.id === linkId ? routed : link);
    itemsRef.current = nextItems;
    linksRef.current = nextLinks;
    setItems(nextItems);
    setLinks(nextLinks);
    selectedItemIdRef.current = null;
    selectedLinkIdRef.current = linkId;
    setSelectedItemId(null);
    setSelectedLinkId(linkId);
    setPulleyLinkId(linkId);
    setRunning(false);
  };

  const updatePulleyRoute = (linkId: string, action: "earlier" | "later" | "flip" | "remove", routeIndex?: number) => {
    if (initialized) return;
    const currentLink = linksRef.current.find((link) => link.id === linkId);
    if (!currentLink || currentLink.type !== "rope" || currentLink.pulleys.length === 0) return;
    const index = clamp(routeIndex ?? currentLink.pulleys.length - 1, 0, currentLink.pulleys.length - 1);
    recordHistory();
    const pulleys = currentLink.pulleys.slice();
    if (action === "remove") {
      pulleys.splice(index, 1);
    } else if (action === "earlier" && index > 0) {
      [pulleys[index - 1], pulleys[index]] = [pulleys[index], pulleys[index - 1]];
    } else if (action === "later" && index < pulleys.length - 1) {
      [pulleys[index], pulleys[index + 1]] = [pulleys[index + 1], pulleys[index]];
    } else if (action === "flip") {
      const currentDirection = pulleys[index].direction || getRopeRoute(itemsRef.current, currentLink).wraps[index]?.direction || 1;
      pulleys[index] = { ...pulleys[index], direction: -currentDirection };
    }

    let nextItems = itemsRef.current.map((item) => ({ ...item }));
    let routed = { ...currentLink, pulleys };
    if (routed.verticalSnap) applyPulleyRopeGuides(nextItems, [routed]);
    routed = {
      ...routed,
      naturalLength: Math.max(0.25, getRopeRoute(nextItems, routed).lengthMeters),
    };
    nextItems = nextItems.map((item) => item.id === routed.a || item.id === routed.b
      ? { ...item, initialX: item.x, initialY: item.y, initialVx: item.vx }
      : item);
    const nextLinks = linksRef.current.map((link) => link.id === linkId ? routed : link);
    itemsRef.current = nextItems;
    linksRef.current = nextLinks;
    setItems(nextItems);
    setLinks(nextLinks);
    setRunning(false);
  };

  const updateLink = (linkId: string, key: "naturalLength" | "springConstant", value: number) => {
    if (initialized) return;
    recordHistory();
    setLinks((current) => current.map((link) => link.id === linkId ? { ...link, [key]: value } : link));
    setRunning(false);
  };

  const setRopeVerticalSnap = (linkId: string, enabled: boolean) => {
    if (initialized) return;
    const currentLink = linksRef.current.find((link) => link.id === linkId);
    if (!currentLink || currentLink.type !== "rope") return;
    recordHistory();
    setRunning(false);

    let nextItems = itemsRef.current.map((item) => ({ ...item }));
    let nextLink = { ...currentLink, verticalSnap: enabled };
    if (enabled) {
      applyPulleyRopeGuides(nextItems, [nextLink]);
      const guidedIds = new Set([nextLink.a, nextLink.b]);
      nextItems = nextItems.map((item) => guidedIds.has(item.id)
        ? { ...item, initialX: item.x, initialY: item.y, initialVx: 0, vx: 0 }
        : item);
    }
    nextLink = {
      ...nextLink,
      naturalLength: Math.max(0.25, getRopeRoute(nextItems, nextLink).lengthMeters),
    };
    const nextLinks = linksRef.current.map((link) => link.id === linkId ? nextLink : link);
    itemsRef.current = nextItems;
    linksRef.current = nextLinks;
    setItems(nextItems);
    setLinks(nextLinks);
  };

  const beginResize = (event: PointerEvent<HTMLButtonElement>, item: SandboxItem, handle: string) => {
    if (initialized) return;
    event.preventDefault();
    event.stopPropagation();
    setRunning(false);
    selectItem(item.id);
    dragRef.current = null;
    resizeRef.current = { id: item.id, handle, original: { ...item }, recorded: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const resizeItem = (event: PointerEvent<HTMLButtonElement>) => {
    if (pinchGestureRef.current) return;
    const resize = resizeRef.current;
    if (!resize) return;
    if (!resize.recorded) {
      recordHistory();
      resize.recorded = true;
    }
    const point = stageCoordinates(event.clientX, event.clientY);
    const moving = {
      x: clamp(snapToGrid(point.x), 0, SANDBOX_WORLD_WIDTH),
      y: clamp(snapToGrid(point.y), 0, GROUND_Y),
    };
    const original = resize.original;
    let nextItem = { ...original };

    if (original.type === "block") {
      nextItem = resizeSquareFromCorner(original, resize.handle, moving.x, moving.y) as SandboxItem;
    } else if (original.type === "pendulum") {
      nextItem = resizePendulumFromBob(original, moving.x, moving.y) as SandboxItem;
    } else if (original.type === "platform" || original.type === "gravity-region") {
      const originalWidth = (original.type === "platform" ? original.width ?? original.size : original.width ?? original.size) * WORLD_SCALE;
      const originalHeight = (original.type === "platform" ? original.height ?? 1 : original.height ?? original.size) * WORLD_SCALE;
      const theta = original.type === "platform" ? (original.angle * Math.PI) / 180 : 0;
      const horizontal = { x: Math.cos(theta), y: Math.sin(theta) };
      const vertical = { x: -horizontal.y, y: horizontal.x };
      const signX = resize.handle.includes("e") ? 1 : -1;
      const signY = resize.handle.includes("s") ? 1 : -1;
      const fixed = {
        x: original.x - horizontal.x * signX * originalWidth / 2 - vertical.x * signY * originalHeight / 2,
        y: original.y - horizontal.y * signX * originalWidth / 2 - vertical.y * signY * originalHeight / 2,
      };
      const delta = { x: moving.x - fixed.x, y: moving.y - fixed.y };
      const width = Math.max(GRID_STEP, snapToGrid(signX * (delta.x * horizontal.x + delta.y * horizontal.y)));
      const height = Math.max(GRID_STEP, snapToGrid(signY * (delta.x * vertical.x + delta.y * vertical.y)));
      const projectedCorner = {
        x: fixed.x + horizontal.x * signX * width + vertical.x * signY * height,
        y: fixed.y + horizontal.y * signX * width + vertical.y * signY * height,
      };
      nextItem = {
        ...nextItem,
        x: (fixed.x + projectedCorner.x) / 2,
        y: (fixed.y + projectedCorner.y) / 2,
        width: width / WORLD_SCALE,
        height: height / WORLD_SCALE,
      };
      if (original.type === "platform") nextItem.size = nextItem.width;
    } else if (original.type === "incline") {
      const geometry = getInclineGeometry(original);
      const isStart = resize.handle === "start";
      const fixedX = original.x + (isStart ? geometry.width / 2 : -geometry.width / 2);
      const width = Math.max(GRID_STEP, snapToGrid(Math.abs(moving.x - fixedX)));
      const bottom = snapToGrid(original.y + geometry.height / 2);
      const height = Math.tan((Math.abs(original.angle) * Math.PI) / 180) * width;
      nextItem = {
        ...nextItem,
        size: width / WORLD_SCALE,
        x: fixedX + (isStart ? -width / 2 : width / 2),
        y: bottom - height / 2,
      };
    } else if (original.type === "rod") {
      const visualAngle = original.angle;
      const theta = (visualAngle * Math.PI) / 180;
      const axis = { x: Math.cos(theta), y: Math.sin(theta) };
      const halfLength = (original.size * WORLD_SCALE) / 2;
      const isStart = resize.handle === "start";
      const fixed = {
        x: original.x + axis.x * halfLength * (isStart ? 1 : -1),
        y: original.y + axis.y * halfLength * (isStart ? 1 : -1),
      };
      const projected = isStart
        ? (fixed.x - moving.x) * axis.x + (fixed.y - moving.y) * axis.y
        : (moving.x - fixed.x) * axis.x + (moving.y - fixed.y) * axis.y;
      const length = Math.max(GRID_STEP, snapToGrid(projected));
      const center = {
        x: fixed.x + axis.x * length * (isStart ? -0.5 : 0.5),
        y: fixed.y + axis.y * length * (isStart ? -0.5 : 0.5),
      };
      nextItem = {
        ...nextItem,
        size: length / WORLD_SCALE,
        x: center.x,
        y: center.y,
      };
      if (original.anchorEnabled) {
        const anchorOffset = original.anchorPosition * length / 2;
        nextItem.x = original.anchorX - axis.x * anchorOffset;
        nextItem.y = original.anchorY - axis.y * anchorOffset;
        nextItem.anchorX = original.anchorX;
        nextItem.anchorY = original.anchorY;
      }
    } else {
      const radius = Math.max(Math.abs(moving.x - original.x), Math.abs(moving.y - original.y));
      const diameter = Math.max(GRID_STEP, snapToGrid(radius * 2));
      nextItem = { ...nextItem, size: diameter / WORLD_SCALE };
      if (original.type === "wheel" || original.type === "pulley") nextItem.radius = nextItem.size / 2;
    }

    if (["platform", "incline", "gravity-region"].includes(nextItem.type)) {
      const aligned = snapSandboxItemPosition(nextItem, nextItem.x, nextItem.y);
      nextItem = { ...nextItem, ...aligned };
    }

    nextItem = clampItemToWorkspace(nextItem) as SandboxItem;
    nextItem.initialX = nextItem.x;
    nextItem.initialY = nextItem.y;
    itemsRef.current = itemsRef.current.map((item) => item.id === resize.id ? nextItem : item);
    setItems(itemsRef.current);
  };

  const endResize = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const resize = resizeRef.current;
    if (resize?.recorded) {
      const affectedLinks = linksRef.current.filter((link) => link.type === "rope" && (
        link.a === resize.id ||
        link.b === resize.id ||
        link.pulleys.some((pulley) => pulley.id === resize.id)
      ));
      if (affectedLinks.length) {
        const affectedIds = new Set(affectedLinks.flatMap((link) => [
          link.a,
          link.b,
          ...link.pulleys.map((pulley) => pulley.id),
        ]));
        const nextItems = itemsRef.current.map((item) => affectedIds.has(item.id)
          ? { ...item, initialX: item.x, initialY: item.y }
          : item);
        const nextLinks = linksRef.current.map((link) => affectedLinks.some((candidate) => candidate.id === link.id)
          ? { ...link, naturalLength: Math.max(0.25, getRopeRoute(nextItems, link).lengthMeters) }
          : link);
        itemsRef.current = nextItems;
        linksRef.current = nextLinks;
        setItems(nextItems);
        setLinks(nextLinks);
      }
    }
    resizeRef.current = null;
  };

  const toggleRuler = () => {
    runningRef.current = false;
    setRunning(false);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
    setRulerActive((current) => {
      if (current) setRulerPoints([]);
      return !current;
    });
  };

  const chooseRulerPoint = (point: RulerPointReference) => {
    const key = point.kind === "grid"
      ? `grid:${point.x}:${point.y}`
      : `object:${point.itemId}:${point.anchor}`;
    setRulerPoints((current) => {
      const base = current.length >= 2 ? [] : current;
      const duplicate = base.some((candidate) => (
        candidate.kind === "grid"
          ? `grid:${candidate.x}:${candidate.y}`
          : `object:${candidate.itemId}:${candidate.anchor}`
      ) === key);
      return duplicate ? base : [...base, point];
    });
  };

  const beginItemDrag = (event: PointerEvent<HTMLDivElement>, item: SandboxItem) => {
    if (rulerActive) {
      event.preventDefault();
      const point = stageCoordinates(event.clientX, event.clientY);
      const anchors = getSandboxRulerAnchors(item) as RulerAnchor[];
      const nearest = anchors.reduce<RulerAnchor | null>((best, anchor) => {
        if (!best) return anchor;
        const bestDistance = Math.hypot(best.x - point.x, best.y - point.y);
        const anchorDistance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
        return anchorDistance < bestDistance ? anchor : best;
      }, null);
      if (nearest) chooseRulerPoint({ kind: "object", itemId: item.id, anchor: nearest.id });
      return;
    }
    if (initialized) {
      event.preventDefault();
      if (!running) selectItem(item.id);
      return;
    }
    if (pulleyLinkId) {
      event.preventDefault();
      connectorClickRef.current = item.id;
      if (item.type === "pulley") addPulleyToLink(pulleyLinkId, item.id);
      return;
    }
    if (connectorTool) {
      event.preventDefault();
      connectorClickRef.current = item.id;
      chooseEndpoint(item.id);
      return;
    }
    if ((event.target as HTMLElement).closest(".sandbox-link-port, .sandbox-resize-handle")) return;
    setSnapGuide(null);
    selectItem(item.id);
    const point = stageCoordinates(event.clientX, event.clientY);
    dragRef.current = {
      id: item.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: point.x - item.x,
      offsetY: point.y - item.y,
      active: false,
      moved: false,
      recorded: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveItem = (event: PointerEvent<HTMLDivElement>) => {
    if (pinchGestureRef.current) return;
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType !== "touch" && (event.buttons & 1) === 0) {
      dragRef.current = null;
      setSnapGuide(null);
      return;
    }
    if (!drag.active) {
      const heldDistance = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (heldDistance < 6) return;
      drag.active = true;
      setRunning(false);
    }
    const point = stageCoordinates(event.clientX, event.clientY);
    const current = itemsRef.current;
    const dragged = current.find((item) => item.id === drag.id);
    if (!dragged) return;
    const gridPosition = snapSandboxItemPosition(
      dragged,
      point.x - drag.offsetX,
      point.y - drag.offsetY,
    );
    const rawX = clamp(gridPosition.x, 0, SANDBOX_WORLD_WIDTH);
    const rawY = clamp(gridPosition.y, 0, GROUND_Y);
    if (Math.hypot(rawX - dragged.x, rawY - dragged.y) < 0.01) return;
    if (!drag.recorded) {
      recordHistory();
      drag.recorded = true;
    }
    drag.moved = true;

    const provisional = clampItemToWorkspace({
      ...dragged,
      x: rawX,
      y: rawY,
      angle: dragged.type === "block" ? 0 : dragged.angle,
      initialAngle: dragged.type === "block" ? 0 : dragged.initialAngle,
      snapTargetId: null,
      snapOffsetX: 0,
      snapOffsetY: 0,
      supportSurfaceId: null,
      supportSurfaceAngle: 0,
      supportAirTime: 1,
    }) as SandboxItem;
    const snapResult = snapWithSlopeAlignment(
      provisional,
      current.filter((item) => item.id !== drag.id),
    );
    const alignedProvisional = snapResult.item;
    const snap = snapResult.snap;
    const placed = snap ? {
      ...alignedProvisional,
      x: snap.x,
      y: snap.y,
      snapTargetId: null,
      snapOffsetX: 0,
      snapOffsetY: 0,
      snapNormalX: 0,
      snapNormalY: -1,
    } : alignedProvisional;
    const dx = placed.x - dragged.x;
    const dy = placed.y - dragged.y;
    const next = current.map((item) => {
      if (item.id === drag.id) {
        return placed.anchorEnabled
          ? { ...placed, anchorX: placed.anchorX + dx, anchorY: placed.anchorY + dy }
          : placed;
      }
      return item;
    });
    applyPulleyRopeGuides(next, linksRef.current);
    const guide = snap ? {
      itemId: drag.id,
      targetId: snap.targetId,
      targetLabel: snap.targetLabel,
      part: snap.part,
      smooth: Boolean(snap.smooth),
    } : null;
    itemsRef.current = next;
    setItems(next);
    setSnapGuide(guide);
  };

  const endItemDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active || !drag.moved) {
      setSnapGuide(null);
      dragRef.current = null;
      return;
    }
    const current = itemsRef.current;
    const movedIds = new Set([drag.id]);
    const affectedLinks = linksRef.current.filter((link) => link.type === "rope" && (
      movedIds.has(link.a) ||
      movedIds.has(link.b) ||
      link.pulleys.some((pulley) => movedIds.has(pulley.id))
    ));
    const affectedIds = new Set(affectedLinks.flatMap((link) => [
      link.a,
      link.b,
      ...link.pulleys.map((pulley) => pulley.id),
    ]));
    const next = current.map((item) => {
      if (item.id !== drag.id) {
        return affectedIds.has(item.id) ? { ...item, initialX: item.x, initialY: item.y } : item;
      }
      return {
        ...item,
        initialX: item.x,
        initialY: item.y,
        snapTargetId: null,
        snapOffsetX: 0,
        snapOffsetY: 0,
      };
    });
    const nextLinks = linksRef.current.map((link) => affectedLinks.some((candidate) => candidate.id === link.id)
      ? { ...link, naturalLength: Math.max(0.25, getRopeRoute(next, link).lengthMeters) }
      : link);
    itemsRef.current = next;
    linksRef.current = nextLinks;
    setItems(next);
    setLinks(nextLinks);
    setSnapGuide(null);
    dragRef.current = null;
  };

  const resetMotionRecording = (baseItems: SandboxItem[]) => {
    const initialHistory = [captureMotionSample(baseItems, 0)];
    simulationTimeRef.current = 0;
    lastMotionSampleRef.current = 0;
    motionHistoryRef.current = initialHistory;
    setSimulationTime(0);
    setMotionHistory(initialHistory);
    setRunGeneration((current) => current + 1);
  };

  const initializeRun = () => {
    if (running || initialized || itemsRef.current.length === 0) return;
    runSnapshotRef.current = cloneSandboxExperiment(itemsRef.current, linksRef.current) as ExperimentSnapshot;
    initializedRef.current = true;
    runningRef.current = false;
    setInitialized(true);
    setRunning(false);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
    setRulerActive(false);
    setRulerPoints([]);
    resetMotionRecording(itemsRef.current);
    const firstGraphable = itemsRef.current.find((item) => (
      (isDynamicItem(item) && !isFixedItem(item)) || item.type === "pendulum" || (item.type === "rod" && item.anchorEnabled)
    ));
    if (!graphObjectId && firstGraphable) setGraphObjectId(firstGraphable.id);
  };

  const togglePlayback = () => {
    if (!initialized) return;
    setRunning((current) => {
      runningRef.current = !current;
      return !current;
    });
  };

  const stepOnce = () => {
    if (!initialized || running) return;
    runningRef.current = false;
    setRunning(false);
    const delta = 1 / 30;
    const next = stepSandbox(itemsRef.current, linksRef.current, delta) as SandboxItem[];
    const nextTime = simulationTimeRef.current + delta;
    itemsRef.current = next;
    simulationTimeRef.current = nextTime;
    lastMotionSampleRef.current = nextTime;
    const nextHistory = [...motionHistoryRef.current, captureMotionSample(next, nextTime)].slice(-6000);
    motionHistoryRef.current = nextHistory;
    setItems(next);
    setSimulationTime(nextTime);
    setMotionHistory(nextHistory);
  };

  const reset = () => {
    if (!runSnapshotRef.current) return;
    runningRef.current = false;
    const snapshot = cloneSandboxExperiment(runSnapshotRef.current.items, runSnapshotRef.current.links) as ExperimentSnapshot;
    const nextItems = snapshot.items;
    const nextLinks = snapshot.links;
    itemsRef.current = nextItems;
    linksRef.current = nextLinks;
    setItems(nextItems);
    setLinks(nextLinks);
    setSnapGuide(null);
    setRunning(false);
    setRulerActive(false);
    setRulerPoints([]);
    resetMotionRecording(nextItems);
  };

  const editSetup = () => {
    const snapshot = runSnapshotRef.current
      ? cloneSandboxExperiment(runSnapshotRef.current.items, runSnapshotRef.current.links) as ExperimentSnapshot
      : null;
    if (snapshot) {
      itemsRef.current = snapshot.items;
      linksRef.current = snapshot.links;
      setItems(snapshot.items);
      setLinks(snapshot.links);
    }
    initializedRef.current = false;
    runningRef.current = false;
    setInitialized(false);
    setRunning(false);
    runSnapshotRef.current = null;
    simulationTimeRef.current = 0;
    lastMotionSampleRef.current = 0;
    motionHistoryRef.current = [];
    setSimulationTime(0);
    setMotionHistory([]);
    setShowGraph(false);
  };

  const loadStarter = () => {
    if (initialized) return;
    recordHistory();
    const nextItems = createStarterSandbox() as SandboxItem[];
    itemsRef.current = nextItems;
    linksRef.current = [];
    setItems(nextItems);
    setLinks([]);
    setSelectedItemId(null);
    setSelectedLinkId(null);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
    setSnapGuide(null);
    setRunning(false);
    runSnapshotRef.current = null;
    simulationTimeRef.current = 0;
    motionHistoryRef.current = [];
    setSimulationTime(0);
    setMotionHistory([]);
  };

  const clear = () => {
    if (initialized) return;
    if (itemsRef.current.length || linksRef.current.length) recordHistory();
    itemsRef.current = [];
    linksRef.current = [];
    setItems([]);
    setLinks([]);
    setSelectedItemId(null);
    setSelectedLinkId(null);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
    setSnapGuide(null);
    setRunning(false);
    runSnapshotRef.current = null;
    simulationTimeRef.current = 0;
    motionHistoryRef.current = [];
    setSimulationTime(0);
    setMotionHistory([]);
  };

  const generateProjectCode = () => {
    runningRef.current = false;
    setRunning(false);
    const code = encodeSandboxProject(itemsRef.current, linksRef.current);
    setProjectCode(code);
    setProjectMessage("Project code generated from the current sandbox state.");
  };

  const copyProjectCode = async () => {
    if (!projectCode) return;
    try {
      await navigator.clipboard.writeText(projectCode);
      setProjectMessage("Project code copied.");
    } catch {
      setProjectMessage("Copy was blocked. Select the code and copy it manually.");
    }
  };

  const loadProject = () => {
    try {
      const project = decodeSandboxProject(loadCode) as ExperimentSnapshot;
      if (itemsRef.current.length || linksRef.current.length) recordHistory();
      itemsRef.current = project.items;
      linksRef.current = project.links;
      setItems(project.items);
      setLinks(project.links);
      counterRef.current = nextProjectCounter(project.items, project.links);
      selectedItemIdRef.current = null;
      selectedLinkIdRef.current = null;
      setSelectedItemId(null);
      setSelectedLinkId(null);
      setConnectorTool(null);
      setLinkStartId(null);
      setLinkPulleyIds([]);
      setPulleyLinkId(null);
      setRulerActive(false);
      setRulerPoints([]);
      setSnapGuide(null);
      initializedRef.current = false;
      runningRef.current = false;
      setInitialized(false);
      setRunning(false);
      runSnapshotRef.current = null;
      simulationTimeRef.current = 0;
      lastMotionSampleRef.current = 0;
      motionHistoryRef.current = [];
      setSimulationTime(0);
      setMotionHistory([]);
      setShowGraph(false);
      setGraphObjectId(null);
      setProjectMessage(`Loaded ${project.items.length} objects and ${project.links.length} connections.`);
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "This project code could not be loaded.");
    }
  };

  const dynamicCount = items.filter((item) => isDynamicItem(item) && !isFixedItem(item)).length;
  const editedRope = pulleyLinkId ? links.find((link) => link.id === pulleyLinkId && link.type === "rope") ?? null : null;

  return (
    <section className="sandbox-lab" aria-label="Sandbox">
      <div className="sandbox-workspace">
        <aside className="sandbox-palette" aria-label="Sandbox object palette">
          <div className="sandbox-panel-title"><span>Object library</span><small>Drag or tap to add</small></div>
          {CATEGORIES.map((category) => (
            <div className="sandbox-tool-group" key={category}>
              <h3>{category}</h3>
              {SANDBOX_TOOLS.filter((tool) => tool.category === category).map((tool) => (
                <button
                  key={tool.type}
                  type="button"
                  draggable={!initialized}
                  disabled={initialized}
                  className={connectorTool === tool.type ? "active" : ""}
                  onDragStart={(event) => handlePaletteDrag(event, tool.type)}
                  onClick={() => addTool(tool.type)}
                  aria-pressed={connectorTool === tool.type}
                >
                  <span aria-hidden="true">{ICONS[tool.type]}</span>
                  <span><strong>{tool.label}</strong><small>{tool.description}</small></span>
                </button>
              ))}
            </div>
          ))}
          <div className="sandbox-tool-group sandbox-ruler-tools">
            <h3>Measure</h3>
            <button type="button" className={rulerActive ? "active" : ""} onClick={toggleRuler} aria-pressed={rulerActive}>
              <span aria-hidden="true">↔</span>
              <span><strong>Ruler</strong><small>Pick exact object points or grid intersections.</small></span>
            </button>
            {rulerActive && <div className="sandbox-ruler-options">
              <span>Snap points</span>
              <p>Click a blue point on an object, click near a side or corner, or click empty space for the nearest grid intersection.</p>
              <small>{rulerPoints.length === 0 ? "Choose point 1." : rulerPoints.length === 1 ? "Choose point 2." : `${rulerMeasurement?.distance.toFixed(3) ?? "0.000"} m`}</small>
              {resolvedRulerPoints.map((point, index) => <output key={`${index}-${point.label}`}>{index + 1}. {point.label}</output>)}
              {rulerPoints.length > 0 && <button type="button" onClick={() => setRulerPoints([])}>Clear measurement</button>}
            </div>}
          </div>
        </aside>

        <div className="sandbox-center">
          <div className="sandbox-toolbar">
            <div className="sandbox-run-controls">
              <button type="button" className="sandbox-run" onClick={initializeRun} disabled={initialized || running || items.length === 0}>Run / Initialize</button>
              <button type="button" className="sandbox-play" onClick={togglePlayback} disabled={!initialized}>{running ? "Ⅱ Pause" : "▶ Play"}</button>
              <button type="button" onClick={stepOnce} disabled={!initialized || running}>Step</button>
              <button type="button" onClick={reset} disabled={!initialized}>Reset</button>
              <button type="button" onClick={editSetup} disabled={!initialized}>Edit setup</button>
              <button type="button" onClick={undo} disabled={undoCount === 0 || initialized} aria-label="Undo last sandbox edit" aria-keyshortcuts="Control+Z Meta+Z">Undo</button>
            </div>
            <div className="sandbox-toolbar-meta">
              <span className={`sandbox-run-state ${running ? "running" : initialized ? "paused" : "setup"}`}><i />{running ? "Playing" : initialized ? "Paused" : "Setup"}</span>
              <span>{simulationTime.toFixed(2)} s</span>
              <span>{dynamicCount} moving</span>
              <span>{links.length} connected</span>
              <span>{SANDBOX_WORLD_WIDTH}×{SANDBOX_WORLD_HEIGHT} rigid grid</span>
              <span>1 square = 1 m</span>
              <label className="sandbox-hitbox-toggle"><input type="checkbox" checked={showHitboxes} onChange={(event) => setShowHitboxes(event.target.checked)} /> Hitboxes</label>
              <span className="sandbox-speed-buttons" role="group" aria-label="Sandbox playback speed">
                {[0.5, 1, 2].map((speed) => <button key={speed} type="button" className={playbackSpeed === speed ? "active" : ""} onClick={() => setPlaybackSpeed(speed)} aria-pressed={playbackSpeed === speed}>{speed}×</button>)}
              </span>
              <span className="sandbox-zoom-controls" aria-label="Canvas zoom">
                <button type="button" onClick={() => nudgeZoom(0.8)} aria-label="Zoom out">−</button>
                <output>{Math.round(zoom * 100)}%</output>
                <button type="button" onClick={() => nudgeZoom(1.25)} aria-label="Zoom in">+</button>
                <button type="button" onClick={() => resetCameraToBottomLeft()} aria-label="Reset to bottom-left view">◎</button>
              </span>
            </div>
          </div>

          <div
            ref={stageRef}
            className={`sandbox-stage ${isPanning ? "panning" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleStageDrop}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerEnd}
            onPointerCancel={handleStagePointerEnd}
            onWheel={handleStageWheel}
          >
            <div
              className={`sandbox-world ${connectorTool || pulleyLinkId ? "connecting" : ""} ${showHitboxes ? "show-hitboxes" : ""} ${rulerActive ? "measuring" : ""}`}
              style={{
                width: `${SANDBOX_WORLD_WIDTH * CANVAS_PIXELS_PER_UNIT}px`,
                height: `${SANDBOX_WORLD_HEIGHT * CANVAS_PIXELS_PER_UNIT}px`,
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})`,
                "--sandbox-grid-step": `${GRID_STEP * CANVAS_PIXELS_PER_UNIT}px`,
                "--sandbox-major-grid-step": `${GRID_STEP * CANVAS_PIXELS_PER_UNIT * 5}px`,
                "--sandbox-wall-thickness": `${WALL_THICKNESS * CANVAS_PIXELS_PER_UNIT}px`,
                "--sandbox-grid-origin-x": `${WALL_THICKNESS * CANVAS_PIXELS_PER_UNIT}px`,
                "--sandbox-grid-origin-y": `${GROUND_Y * CANVAS_PIXELS_PER_UNIT}px`,
              } as CSSProperties}
              role="application"
              aria-label={`Physics sandbox canvas with a rigid ${SANDBOX_WORLD_WIDTH} by ${SANDBOX_WORLD_HEIGHT} boundary. Each grid square is one meter. Drag empty space to pan within the walls and pinch or use the mouse wheel to zoom.`}
            >
            <div className="sandbox-grid" aria-hidden="true" />
            <div className="sandbox-boundary" aria-hidden="true" />
            <div className="sandbox-left-wall" aria-hidden="true" />
            <div className="sandbox-right-wall" aria-hidden="true" />
            <div className="sandbox-floor" aria-hidden="true" />
            {rulerActive && <div className="sandbox-ruler-anchor-layer" aria-label="Selectable ruler snap points">
              {rulerAnchors.map((anchor) => {
                const selectedIndex = rulerPoints.findIndex((point) => point.kind === "object" && point.itemId === anchor.itemId && point.anchor === anchor.id);
                const selected = selectedIndex >= 0;
                return <button
                  key={`${anchor.itemId}-${anchor.id}`}
                  type="button"
                  className={`sandbox-ruler-anchor ${selected ? "selected" : ""}`}
                  style={{ left: `${anchor.x * CANVAS_PIXELS_PER_UNIT}px`, top: `${anchor.y * CANVAS_PIXELS_PER_UNIT}px` }}
                  data-label={anchor.label}
                  title={anchor.label}
                  aria-label={`Use ${anchor.label} as ruler point`}
                  aria-pressed={selected}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    chooseRulerPoint({ kind: "object", itemId: anchor.itemId, anchor: anchor.id });
                  }}
                ><span aria-hidden="true">{selected ? selectedIndex + 1 : anchor.shortLabel}</span></button>;
              })}
              {rulerPoints.map((reference, index) => {
                if (reference.kind !== "grid") return null;
                const point = resolveSandboxRulerPoint(items, reference) as RulerAnchor | null;
                return point ? <span
                  key={`grid-${point.x}-${point.y}-${index}`}
                  className="sandbox-ruler-grid-point"
                  style={{ left: `${point.x * CANVAS_PIXELS_PER_UNIT}px`, top: `${point.y * CANVAS_PIXELS_PER_UNIT}px` }}
                  aria-hidden="true"
                >{index + 1}</span> : null;
              })}
            </div>}
            {rulerMeasurement && <svg className="sandbox-ruler-layer" viewBox={`0 0 ${SANDBOX_WORLD_WIDTH} ${SANDBOX_WORLD_HEIGHT}`} preserveAspectRatio="none" aria-label={`${rulerMeasurement.distance.toFixed(3)} meter ruler measurement`}>
              <line x1={rulerMeasurement.start.x} y1={rulerMeasurement.start.y} x2={rulerMeasurement.end.x} y2={rulerMeasurement.end.y} />
              <circle cx={rulerMeasurement.start.x} cy={rulerMeasurement.start.y} r="1.4" />
              <circle cx={rulerMeasurement.end.x} cy={rulerMeasurement.end.y} r="1.4" />
              <g transform={`translate(${(rulerMeasurement.start.x + rulerMeasurement.end.x) / 2} ${(rulerMeasurement.start.y + rulerMeasurement.end.y) / 2})`}>
                <rect x="-8" y="-3" width="16" height="6" rx="1" />
                <text textAnchor="middle" dominantBaseline="middle">{rulerMeasurement.distance.toFixed(3)} m</text>
              </g>
            </svg>}
            <svg className="sandbox-rope-layer" viewBox={`0 0 ${SANDBOX_WORLD_WIDTH} ${SANDBOX_WORLD_HEIGHT}`} preserveAspectRatio="none" aria-label="Rope connections">
              {ropeRoutes.map(({ link, route, a, b }) => {
                if (!a || !b || route.points.length < 2) return null;
                const path = ropePath(route.points);
                const select = () => selectLink(link.id);
                return (
                  <g
                    key={link.id}
                    className={`sandbox-rope ${selectedLinkId === link.id ? "selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select rope from ${a.label} to ${b.label}${link.pulleys.length ? ` through ${link.pulleys.length} pulley` : ""}`}
                    onClick={select}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } }}
                  >
                    <path className="sandbox-rope-hit" d={path} />
                    <path className="sandbox-rope-line" d={path} />
                  </g>
                );
              })}
            </svg>
            {ropeRoutes.map(({ link, route, a, b }) => {
              if (!a || !b || route.points.length < 2) return null;
              const start = route.points[0];
              const end = route.points.at(-1);
              return (
                <div key={`${link.id}-markers`} className={`sandbox-rope-markers ${selectedLinkId === link.id ? "selected" : ""}`} aria-hidden="true">
                  <span className="rope-marker marker-start" style={{ left: `${start.x * CANVAS_PIXELS_PER_UNIT}px`, top: `${start.y * CANVAS_PIXELS_PER_UNIT}px` }}>S</span>
                  {route.wraps.map((wrap: { id: string }, index: number) => {
                    const pulley = itemsById.get(wrap.id);
                    return pulley ? <span key={`${wrap.id}-${index}`} className="rope-marker marker-pulley" style={{ left: `${pulley.x * CANVAS_PIXELS_PER_UNIT}px`, top: `${pulley.y * CANVAS_PIXELS_PER_UNIT}px` }}>P{index + 1}</span> : null;
                  })}
                  {end && <span className="rope-marker marker-end" style={{ left: `${end.x * CANVAS_PIXELS_PER_UNIT}px`, top: `${end.y * CANVAS_PIXELS_PER_UNIT}px` }}>E</span>}
                </div>
              );
            })}
            {links.filter((link) => link.type === "spring").map((link) => {
              const a = itemsById.get(link.a);
              const b = itemsById.get(link.b);
              if (!a || !b) return null;
              return <button key={link.id} type="button" className={`sandbox-link link-${link.type} ${selectedLinkId === link.id ? "selected" : ""}`} style={linkStyle(a, b)} onClick={() => selectLink(link.id)} aria-label={`Select ${link.type} connecting ${a.label} and ${b.label}`} />;
            })}
            {/* Pointer handlers read refs only after user input, never during this render. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            {items.map((item) => {
              const dimensions = entityDimensions(item);
              const speed = Math.hypot(item.vx, item.vy);
              const visualAngle = item.type === "pendulum" || item.type === "incline" ? 0 : item.angle;
              const activeSnap = snapGuide?.itemId === item.id ? snapGuide : null;
              const alreadyInDraftRoute = linkPulleyIds.includes(item.id);
              const alreadyInEditedRoute = Boolean(editedRope?.pulleys.some((stop) => stop.id === item.id));
              const canUseDraftPort = Boolean(
                connectorTool &&
                item.type !== "gravity-region" &&
                item.id !== linkStartId &&
                (item.type !== "pulley" || connectorTool === "spring" || (linkStartId && !alreadyInDraftRoute)),
              );
              const canUseRoutePort = Boolean(pulleyLinkId && item.type === "pulley" && !alreadyInEditedRoute);
              const portLabel = item.type === "pulley"
                ? `P${(editedRope?.pulleys.length ?? linkPulleyIds.length) + 1}`
                : linkStartId ? "E" : "S";
              return (
                <div
                  key={item.id}
                  className={`sandbox-entity entity-${item.type} ${item.type === "incline" && item.angle < 0 ? "flipped" : ""} ${selectedItemId === item.id ? "selected" : ""} ${rulerPoints.some((point) => point.kind === "object" && point.itemId === item.id) ? "ruler-point" : ""} ${linkStartId === item.id ? "link-start" : ""} ${pulleyLinkId && item.type === "pulley" ? "pulley-target" : ""} ${activeSnap ? "snapping" : ""}`}
                  style={{
                    left: `${item.x * CANVAS_PIXELS_PER_UNIT}px`,
                    top: `${item.y * CANVAS_PIXELS_PER_UNIT}px`,
                    width: dimensions.width,
                    height: dimensions.height,
                    transform: itemTransform(item),
                    "--entity-angle": `${visualAngle}deg`,
                    "--counter-entity-angle": `${-visualAngle}deg`,
                    "--pendulum-angle": `${item.angle}deg`,
                    "--incline-angle": `${-item.angle}deg`,
                    "--incline-hitbox-length": `${getInclineGeometry(item).diagonal * CANVAS_PIXELS_PER_UNIT}px`,
                    "--pendulum-arm-length": `${item.length * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT}px`,
                    "--pendulum-bob-size": `${item.size * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT}px`,
                    "--pendulum-bob-offset": `${-(item.size * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT) / 2}px`,
                  } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label} at ${item.x.toFixed(0)}, ${item.y.toFixed(0)}`}
                  onClick={() => {
                    if (rulerActive) return;
                    if (connectorClickRef.current === item.id) {
                      connectorClickRef.current = null;
                      return;
                    }
                    if (!connectorTool && !pulleyLinkId) selectItem(item.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (rulerActive) {
                      const anchor = (getSandboxRulerAnchors(item) as RulerAnchor[])[0];
                      if (anchor) chooseRulerPoint({ kind: "object", itemId: item.id, anchor: anchor.id });
                    }
                    else if (pulleyLinkId && item.type === "pulley") addPulleyToLink(pulleyLinkId, item.id);
                    else if (connectorTool) chooseEndpoint(item.id);
                    else if (!pulleyLinkId) selectItem(item.id);
                  }}
                  onPointerDown={(event) => beginItemDrag(event, item)}
                  onPointerMove={moveItem}
                  onPointerUp={endItemDrag}
                  onPointerCancel={endItemDrag}
                >
                  <span className="sandbox-shape" aria-hidden="true">
                    {item.type === "cart" && <><i /><i /></>}
                    {item.type === "pulley" && <i />}
                    {item.type === "rod" && <span className="rod-anchor-points"><i className={item.anchorEnabled && item.anchorPosition === -1 ? "active" : ""} /><i className={item.anchorEnabled && item.anchorPosition === 0 ? "active" : ""} /><i className={item.anchorEnabled && item.anchorPosition === 1 ? "active" : ""} /></span>}
                    {item.type === "pendulum" && <><i className="pendulum-arm"><b /></i></>}
                    {item.type === "gravity-region" && <b style={{ transform: `rotate(${item.gravityDirection - 90}deg)` }}>↓</b>}
                  </span>
                  <span className="sandbox-hitbox" aria-hidden="true"><i>hitbox</i>{item.type === "pendulum" && <b className="pendulum-hitbox-arm"><em /></b>}</span>
                  {isDynamicItem(item) && speed > 0.08 && <span className="sandbox-velocity" style={{ "--velocity-angle": `${Math.atan2(item.vy, item.vx)}rad`, "--velocity-length": `${clamp(speed * 9, 26, 78)}px` } as CSSProperties}><i>{speed.toFixed(1)} m/s</i></span>}
                  {(canUseDraftPort || canUseRoutePort) && <button
                    type="button"
                    className="sandbox-link-port"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (pulleyLinkId) addPulleyToLink(pulleyLinkId, item.id);
                      else chooseEndpoint(item.id);
                    }}
                    aria-label={pulleyLinkId ? `Route selected rope around ${item.label}` : `Use ${item.label} for ${connectorTool} connection`}
                  ><span aria-hidden="true">{portLabel}</span></button>}
                  {activeSnap && <span className="sandbox-snap-badge">{activeSnap.smooth ? "SMOOTH JOIN" : "SNAP"} → {activeSnap.targetLabel}</span>}
                  {selectedItemId === item.id && !initialized && !running && !connectorTool && !pulleyLinkId && (
                    item.type === "pendulum"
                      ? <button
                        type="button"
                        className="sandbox-resize-handle handle-pendulum"
                        style={{
                          left: `calc(50% + ${-Math.sin(item.angle * Math.PI / 180) * item.length * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT}px)`,
                          top: `${Math.cos(item.angle * Math.PI / 180) * item.length * WORLD_SCALE * CANVAS_PIXELS_PER_UNIT}px`,
                        }}
                        aria-label={`Resize ${item.label} from its bob`}
                        onPointerDown={(event) => beginResize(event, item, "pendulum-length")}
                        onPointerMove={resizeItem}
                        onPointerUp={endResize}
                        onPointerCancel={endResize}
                      />
                      : ["incline", "rod"].includes(item.type)
                      ? <>
                        <button type="button" className="sandbox-resize-handle handle-start" aria-label={`Resize ${item.label} from its starting end`} onPointerDown={(event) => beginResize(event, item, "start")} onPointerMove={resizeItem} onPointerUp={endResize} onPointerCancel={endResize} />
                        <button type="button" className="sandbox-resize-handle handle-end" aria-label={`Resize ${item.label} from its ending end`} onPointerDown={(event) => beginResize(event, item, "end")} onPointerMove={resizeItem} onPointerUp={endResize} onPointerCancel={endResize} />
                      </>
                      : item.type === "block" || item.type === "gravity-region" || item.type === "platform"
                        ? ["nw", "ne", "sw", "se"].map((handle) => <button key={handle} type="button" className={`sandbox-resize-handle handle-${handle}`} aria-label={`Resize ${item.label} from the ${handle.toUpperCase()} corner`} onPointerDown={(event) => beginResize(event, item, handle)} onPointerMove={resizeItem} onPointerUp={endResize} onPointerCancel={endResize} />)
                        : <button type="button" className="sandbox-resize-handle handle-scale" aria-label={`Resize ${item.label}`} onPointerDown={(event) => beginResize(event, item, "scale")} onPointerMove={resizeItem} onPointerUp={endResize} onPointerCancel={endResize} />
                  )}
                  <small>{item.label}</small>
                </div>
              );
            })}
            {connectorTool && <div className="sandbox-connect-note">
              <div className="sandbox-connect-copy">
                <strong>{connectorTool === "rope" ? "Build rope route" : "Connect spring"}</strong>
                <span>{!linkStartId
                  ? "Tap the starting object."
                  : connectorTool === "rope"
                    ? "Tap pulleys in start-to-end order, then tap the ending object."
                    : "Tap the ending object."}</span>
                {linkStartId && <div className="sandbox-connect-route" aria-label="Connection route so far">
                  <b><small>Start</small>{itemsById.get(linkStartId)?.label ?? "Object"}</b>
                  {connectorTool === "rope" && linkPulleyIds.map((id, index) => <span key={id}><i aria-hidden="true">→</i><b><small>P{index + 1}</small>{itemsById.get(id)?.label ?? "Pulley"}</b></span>)}
                  <i aria-hidden="true">→</i><b className="pending"><small>End</small>Choose</b>
                </div>}
              </div>
              <div className="sandbox-connect-actions">
                {connectorTool === "rope" && linkPulleyIds.length > 0 && <button type="button" onClick={() => setLinkPulleyIds((current) => current.slice(0, -1))}>Undo pulley</button>}
                <button type="button" onClick={() => { setConnectorTool(null); setLinkStartId(null); setLinkPulleyIds([]); }}>Cancel</button>
              </div>
            </div>}
            {pulleyLinkId && editedRope && <div className="sandbox-connect-note">
              <div className="sandbox-connect-copy">
                <strong>Edit pulley route</strong>
                <span>Tap additional pulleys in start-to-end order. Add as many as needed, then choose Done.</span>
                <div className="sandbox-connect-route" aria-label="Current pulley route">
                  <b><small>Start</small>{itemsById.get(editedRope.a)?.label ?? "Object"}</b>
                  {editedRope.pulleys.map((stop, index) => <span key={stop.id}><i aria-hidden="true">→</i><b><small>P{index + 1}</small>{itemsById.get(stop.id)?.label ?? "Pulley"}</b></span>)}
                  <i aria-hidden="true">→</i><b><small>End</small>{itemsById.get(editedRope.b)?.label ?? "Object"}</b>
                </div>
              </div>
              <div className="sandbox-connect-actions">
                {editedRope.pulleys.length > 0 && <button type="button" onClick={() => updatePulleyRoute(editedRope.id, "remove")}>Undo pulley</button>}
                <button type="button" onClick={() => setPulleyLinkId(null)}>Done</button>
              </div>
            </div>}
            </div>
          </div>

          <div className="sandbox-stage-actions">
            <button type="button" onClick={loadStarter} disabled={initialized}>Load sample</button>
            <button type="button" onClick={clear} disabled={initialized}>Clear</button>
            <button type="button" className={projectPanelOpen ? "active" : ""} onClick={() => { runningRef.current = false; setRunning(false); setProjectPanelOpen((current) => !current); }}>Save / Load code</button>
            <button type="button" className={showGraph ? "active" : ""} disabled={!initialized || graphableItems.length === 0} onClick={() => setShowGraph((current) => !current)}>Live graph</button>
            <span>{initialized ? "Reset returns to the Run baseline" : "Build the setup, then initialize the run"}</span>
          </div>
          {projectPanelOpen && <section className="sandbox-project-panel" aria-label="Save or load a PhysicsLab project code">
            <div>
              <header><span>Save project</span><small>Letters and numbers only</small></header>
              <p>Generate a portable code for the objects, values, and connections currently in the sandbox.</p>
              <textarea aria-label="Generated PhysicsLab project code" readOnly value={projectCode} placeholder="Choose Generate code" onFocus={(event) => event.currentTarget.select()} />
              <div><button type="button" onClick={generateProjectCode}>Generate code</button><button type="button" onClick={copyProjectCode} disabled={!projectCode}>Copy code</button></div>
            </div>
            <div>
              <header><span>Load project</span><small>Restores an editable setup</small></header>
              <p>Paste a PhysicsLab code to replace the current sandbox and return to setup mode.</p>
              <textarea aria-label="PhysicsLab project code to load" value={loadCode} onChange={(event) => setLoadCode(event.target.value)} placeholder="Paste a PHY1… code" />
              <div><button type="button" onClick={loadProject} disabled={!loadCode.trim()}>Load code</button></div>
            </div>
            {projectMessage && <output className="sandbox-project-message">{projectMessage}</output>}
          </section>}
          {showGraph && initialized && <section className="sandbox-graph-panel">
            <div className="sandbox-graph-object-tabs" role="group" aria-label="Object shown on the graph">
              <span>Tracked object</span>
              {graphableItems.map((item) => <button key={item.id} type="button" className={trackedGraphObject?.id === item.id ? "active" : ""} onClick={() => setGraphObjectId(item.id)}>{item.label} <small>{item.id.split("-").at(-1)}</small></button>)}
            </div>
            {trackedGraphObject
              ? <SandboxGraph key={`${runGeneration}-${trackedGraphObject.id}`} history={motionHistory} objectId={trackedGraphObject.id} objectLabel={`${trackedGraphObject.label} ${trackedGraphObject.id.split("-").at(-1)}`} currentTime={simulationTime} />
              : <p className="sandbox-graph-empty">Add a moving object to record a graph.</p>}
          </section>}
        </div>

        <aside className="sandbox-inspector" aria-label="Selected item properties">
          <div className="sandbox-panel-title"><span>{initialized ? "Measurements" : "Properties"}</span><small>{selectedItem ? selectedItem.label : selectedLink?.type ?? (initialized ? `${simulationTime.toFixed(2)} s` : "Select an object")}</small>{(selectedItem || selectedLink) && <button type="button" onClick={clearSelection} aria-label="Clear selected properties">×</button>}</div>
          {selectedItem ? (
            <div className="sandbox-properties">
              <div className="sandbox-selection-name"><span aria-hidden="true">{ICONS[selectedItem.type]}</span><div><strong>{selectedItem.label}</strong><small>{isFixedItem(selectedItem) ? "Anchored structure" : selectedItem.type === "pendulum" ? "Oscillating system" : "Dynamic object"}</small></div></div>
              {initialized ? (
                running
                  ? <div className="sandbox-pause-to-inspect"><span>▶</span><strong>Simulation playing</strong><p>Pause the run to inspect velocity, energy, acceleration, and the free-body diagram.</p></div>
                  : selectedAnalysis
                    ? <LiveObjectInspection item={selectedItem} analysis={selectedAnalysis} />
                    : <div className="sandbox-pause-to-inspect"><strong>No motion data</strong><p>This structure does not have a dynamic force reading.</p></div>
              ) : <>
              {(["block", "ball", "cart", "rod", "wheel", "pendulum", "pulley"].includes(selectedItem.type)) && <NumberControl label="Mass" value={selectedItem.mass} min={0.2} max={12} step={0.1} unit="kg" onChange={(value) => updateItem(selectedItem.id, "mass", value)} />}
              {!["gravity-region", "platform"].includes(selectedItem.type) && <NumberControl label={selectedItem.type === "incline" || selectedItem.type === "rod" ? "Length" : "Size"} value={selectedItem.size} min={1} max={8} step={1} unit="m" onChange={(value) => updateItem(selectedItem.id, "size", value)} />}
              {selectedItem.type === "platform" && <><NumberControl label="Platform length" value={selectedItem.width} min={1} max={12} step={1} unit="m" onChange={(value) => updateItem(selectedItem.id, "width", value)} /><NumberControl label="Platform height" value={selectedItem.height} min={1} max={5} step={1} unit="m" onChange={(value) => updateItem(selectedItem.id, "height", value)} /></>}
              {!isFixedItem(selectedItem) && <><NumberControl label="Initial velocity x" value={selectedItem.initialVx} min={-10} max={10} step={0.25} unit="m/s" onChange={(value) => updateItem(selectedItem.id, "vx", value)} />{selectedItem.type !== "cart" && <NumberControl label="Initial velocity y" value={selectedItem.initialVy} min={-10} max={10} step={0.25} unit="m/s" onChange={(value) => updateItem(selectedItem.id, "vy", value)} />}</>}
              {(["block", "cart", "platform", "incline"].includes(selectedItem.type)) && <NumberControl label="Friction μ" value={selectedItem.friction} min={0} max={1} step={0.01} unit="" onChange={(value) => updateItem(selectedItem.id, "friction", value)} />}
              {(["block", "cart", "rod", "pendulum", "platform"].includes(selectedItem.type)) && <NumberControl label={selectedItem.type === "platform" ? "Surface angle" : "Starting rotation"} value={selectedItem.initialAngle} min={-90} max={90} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "angle", value)} />}
              {selectedItem.type === "incline" && <><NumberControl label="Surface angle" value={Math.abs(selectedItem.initialAngle)} min={5} max={70} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "angle", Math.sign(selectedItem.angle || 1) * value)} /><button type="button" onClick={() => updateItem(selectedItem.id, "angle", -selectedItem.angle)}>⇄ Flip inclined plane</button></>}
              {selectedItem.type === "pendulum" && <NumberControl label="Pendulum length" value={selectedItem.length} min={1} max={5} step={1} unit="m" onChange={(value) => updateItem(selectedItem.id, "length", value)} />}
              {(["wheel", "pulley"].includes(selectedItem.type)) && <NumberControl label="Radius" value={selectedItem.radius} min={0.5} max={4} step={0.5} unit="m" onChange={(value) => updateItem(selectedItem.id, "radius", value)} />}
              {(["wheel", "rod"].includes(selectedItem.type)) && <NumberControl label="Rotational inertia" value={selectedItem.inertia} min={0.1} max={10} step={0.1} unit="kg·m²" onChange={(value) => updateItem(selectedItem.id, "inertia", value)} />}
              {selectedItem.type === "rod" && <div className="sandbox-anchor-control"><span>Anchor point</span><div><button type="button" className={!selectedItem.anchorEnabled ? "active" : ""} onClick={() => setRodAnchor(selectedItem, null)}>Free</button><button type="button" className={selectedItem.anchorEnabled && selectedItem.anchorPosition === -1 ? "active" : ""} onClick={() => setRodAnchor(selectedItem, -1)}>Left</button><button type="button" className={selectedItem.anchorEnabled && selectedItem.anchorPosition === 0 ? "active" : ""} onClick={() => setRodAnchor(selectedItem, 0)}>Center</button><button type="button" className={selectedItem.anchorEnabled && selectedItem.anchorPosition === 1 ? "active" : ""} onClick={() => setRodAnchor(selectedItem, 1)}>Right</button></div></div>}
              {selectedItem.type === "gravity-region" && <><NumberControl label="Field width" value={selectedItem.width} min={1} max={14} step={1} unit="m" onChange={(value) => updateItem(selectedItem.id, "width", value)} /><NumberControl label="Field height" value={selectedItem.height} min={1} max={12} step={1} unit="m" onChange={(value) => updateItem(selectedItem.id, "height", value)} /><NumberControl label="Gravity strength" value={selectedItem.gravityStrength} min={0} max={25} step={0.1} unit="m/s²" onChange={(value) => updateItem(selectedItem.id, "gravityStrength", value)} /><NumberControl label="Gravity direction" value={selectedItem.gravityDirection} min={-180} max={180} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "gravityDirection", value)} /></>}
              {selectedItem.type === "pulley" && <label className="sandbox-check"><input type="checkbox" checked={selectedItem.fixed} onChange={(event) => updateItem(selectedItem.id, "fixed", event.target.checked)} /><span>Fixed pulley</span></label>}
              <button type="button" className="sandbox-delete" onClick={removeSelected} aria-keyshortcuts="Backspace Delete">Remove {selectedItem.label.toLowerCase()}</button>
              </>}
            </div>
          ) : selectedLink ? (
            <div className="sandbox-properties">
              <div className="sandbox-selection-name"><span aria-hidden="true">{ICONS[selectedLink.type]}</span><div><strong>{selectedLink.type === "rope" ? "Rope / string" : "Spring"}</strong><small>{selectedLink.type === "rope" ? "Endpoint + pulley constraint" : "Connected constraint"}</small></div></div>
              <div className="sandbox-route-summary">
                <span><small>Start</small><strong>{itemsById.get(selectedLink.a)?.label ?? "Missing"}</strong></span>
                <i aria-hidden="true">→</i>
                {selectedLink.type === "rope" && selectedLink.pulleys.map((stop) => <span key={stop.id}><small>Pulley</small><strong>{itemsById.get(stop.id)?.label ?? "Missing"}</strong></span>)}
                {selectedLink.type === "rope" && selectedLink.pulleys.length > 0 && <i aria-hidden="true">→</i>}
                <span><small>End</small><strong>{itemsById.get(selectedLink.b)?.label ?? "Missing"}</strong></span>
              </div>
              {initialized ? <div className="sandbox-pause-to-inspect"><strong>Connection locked for this run</strong><p>Choose Edit setup to change its length, stiffness, or pulley route.</p></div> : <>
              <NumberControl label="Natural length" value={selectedLink.naturalLength} min={0.25} max={300} step={0.05} unit="m" onChange={(value) => updateLink(selectedLink.id, "naturalLength", value)} />
              {selectedLink.type === "spring" && <NumberControl label="Spring constant" value={selectedLink.springConstant} min={2} max={80} step={1} unit="N/m" onChange={(value) => updateLink(selectedLink.id, "springConstant", value)} />}
              {selectedLink.type === "rope" && <label className="sandbox-check"><input type="checkbox" checked={selectedLink.verticalSnap} onChange={(event) => setRopeVerticalSnap(selectedLink.id, event.target.checked)} /><span>Auto-snap hanging ends vertically</span></label>}
              {selectedLink.type === "rope" && selectedLink.pulleys.length > 0 && <div className="sandbox-pulley-stops" aria-label="Pulley route order">
                {selectedLink.pulleys.map((stop, index) => <div key={stop.id}>
                  <span><small>P{index + 1}</small><strong>{itemsById.get(stop.id)?.label ?? "Missing pulley"}</strong></span>
                  <div>
                    <button type="button" disabled={index === 0} onClick={() => updatePulleyRoute(selectedLink.id, "earlier", index)} aria-label={`Move pulley ${index + 1} earlier in the rope route`}>←</button>
                    <button type="button" disabled={index === selectedLink.pulleys.length - 1} onClick={() => updatePulleyRoute(selectedLink.id, "later", index)} aria-label={`Move pulley ${index + 1} later in the rope route`}>→</button>
                    <button type="button" onClick={() => updatePulleyRoute(selectedLink.id, "flip", index)} aria-label={`Flip the wrap around pulley ${index + 1}`}>↻</button>
                    <button type="button" onClick={() => updatePulleyRoute(selectedLink.id, "remove", index)} aria-label={`Remove pulley ${index + 1} from the rope route`}>×</button>
                  </div>
                </div>)}
              </div>}
              {selectedLink.type === "rope" && <div className="sandbox-route-actions">
                <button type="button" className={pulleyLinkId === selectedLink.id ? "active" : ""} aria-pressed={pulleyLinkId === selectedLink.id} onClick={() => { setPulleyLinkId((current) => current === selectedLink.id ? null : selectedLink.id); setConnectorTool(null); setLinkStartId(null); setLinkPulleyIds([]); setRunning(false); }}>{pulleyLinkId === selectedLink.id ? "Done adding pulleys" : "Add pulleys to route"}</button>
              </div>}
              <button type="button" className="sandbox-delete" onClick={removeSelected} aria-keyshortcuts="Backspace Delete">Remove connection</button>
              </>}
            </div>
          ) : <div className="sandbox-inspector-empty"><span aria-hidden="true">↖</span><strong>{initialized ? running ? "Run in progress" : "Select an object" : "Select an object"}</strong><p>{initialized ? running ? "Pause to inspect live motion data and free-body diagrams." : "Choose an object to inspect its exact state at this moment." : "Its dimensions, motion, and connection settings will stay here beside the grid."}</p></div>}
        </aside>
      </div>
    </section>
  );
}
