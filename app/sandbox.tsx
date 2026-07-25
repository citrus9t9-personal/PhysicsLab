"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from "react";

import {
  SANDBOX_TOOLS,
  WORLD_SCALE,
  createSandboxItem,
  createStarterSandbox,
  findSnapPlacement,
  getRopeRoute,
  isDynamicItem,
  resetSandbox,
  stepSandbox,
} from "./sandbox-physics.mjs";

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
  snapTargetId: string | null;
  snapOffsetX: number;
  snapOffsetY: number;
  snapNormalX: number;
  snapNormalY: number;
}

interface SandboxLink {
  id: string;
  type: ConnectorType;
  a: string;
  b: string;
  naturalLength: number;
  springConstant: number;
  pulleys: Array<{ id: string; direction: number }>;
}

interface SnapGuide {
  itemId: string;
  targetId: string;
  targetLabel: string;
  persistent: boolean;
  part: string;
}

const ICONS: Record<string, string> = {
  block: "▣",
  ball: "●",
  cart: "▱",
  rod: "━",
  wheel: "◉",
  pendulum: "⌁",
  "collision-target": "◎",
  platform: "▬",
  incline: "◢",
  pulley: "◉",
  pivot: "⊕",
  "circular-track": "◯",
  "gravity-region": "↓",
  rope: "⌇",
  spring: "≋",
};

const CATEGORIES = ["Objects", "Structures", "Fields", "Connections"];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

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

function entityDimensions(item: SandboxItem) {
  if (item.type === "platform" || item.type === "incline") return { width: clamp(item.size * 42, 90, 310), height: 25 };
  if (item.type === "rod") return { width: clamp(item.size * 42, 80, 300), height: 24 };
  if (item.type === "gravity-region") {
    const size = clamp(item.size * 22, 105, 240);
    return { width: size, height: size };
  }
  if (item.type === "circular-track") {
    const size = clamp(item.radius * 42, 90, 220);
    return { width: size, height: size };
  }
  if (item.type === "pendulum") return { width: 120, height: clamp(item.length * 40, 100, 230) };
  const size = clamp(item.size * 42, 42, 104);
  return { width: size, height: item.type === "cart" ? size * 0.62 : size };
}

function itemTransform(item: SandboxItem) {
  if (item.type === "pendulum") return "translate(-50%, 0)";
  const angle = item.type === "incline" ? -item.angle : item.angle;
  return `translate(-50%, -50%) rotate(${angle}deg)`;
}

function linkStyle(a: SandboxItem, b: SandboxItem) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    left: `${a.x}%`,
    top: `${a.y}%`,
    width: `${Math.hypot(dx, dy)}%`,
    transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`,
  } as CSSProperties;
}

function linkLength(a: SandboxItem, b: SandboxItem) {
  return Math.max(0.25, Math.hypot(b.x - a.x, b.y - a.y) / WORLD_SCALE);
}

function ropePath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(" ");
}

function attachedDescendants(items: SandboxItem[], rootId: string) {
  const descendants = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (!item.snapTargetId || descendants.has(item.id)) continue;
      if (item.snapTargetId === rootId || descendants.has(item.snapTargetId)) {
        descendants.add(item.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export default function SandboxLab() {
  const [items, setItems] = useState<SandboxItem[]>(() => createStarterSandbox());
  const [links, setLinks] = useState<SandboxLink[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>("starter-block");
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [connectorTool, setConnectorTool] = useState<ConnectorType | null>(null);
  const [linkStartId, setLinkStartId] = useState<string | null>(null);
  const [linkPulleyIds, setLinkPulleyIds] = useState<string[]>([]);
  const [pulleyLinkId, setPulleyLinkId] = useState<string | null>(null);
  const [showHitboxes, setShowHitboxes] = useState(false);
  const [snapGuide, setSnapGuide] = useState<SnapGuide | null>(null);
  const [running, setRunning] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(1);
  const lastFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const connectorClickRef = useRef<string | null>(null);
  const itemsRef = useRef(items);
  const snapGuideRef = useRef<SnapGuide | null>(null);
  itemsRef.current = items;
  snapGuideRef.current = snapGuide;

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

  useEffect(() => {
    if (!running) {
      lastFrameRef.current = null;
      return;
    }
    let frame = 0;
    const animate = (timestamp: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
      const delta = Math.min((timestamp - lastFrameRef.current) / 1000, 0.04) * playbackSpeed;
      lastFrameRef.current = timestamp;
      setItems((current) => stepSandbox(current, links, delta));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [running, links, playbackSpeed]);

  const selectItem = (id: string) => {
    setSelectedItemId(id);
    setSelectedLinkId(null);
    setPulleyLinkId(null);
  };

  const addTool = (type: string, x?: number, y?: number) => {
    if (type === "rope" || type === "spring") {
      setConnectorTool(type);
      setLinkStartId(null);
      setLinkPulleyIds([]);
      setPulleyLinkId(null);
      setRunning(false);
      return;
    }
    const index = counterRef.current;
    counterRef.current += 1;
    const raw = createSandboxItem(type, `sandbox-${type}-${index}`, x ?? 42 + (index % 4) * 5, y ?? 28 + (index % 3) * 7) as SandboxItem;
    const snap = findSnapPlacement(raw, itemsRef.current);
    const persistent = Boolean(snap && !isDynamicItem(raw));
    const next = snap ? {
      ...raw,
      x: snap.x,
      y: snap.y,
      initialX: snap.x,
      initialY: snap.y,
      snapTargetId: persistent ? snap.targetId : null,
      snapOffsetX: persistent ? snap.x - (itemsRef.current.find((item) => item.id === snap.targetId)?.x ?? snap.x) : 0,
      snapOffsetY: persistent ? snap.y - (itemsRef.current.find((item) => item.id === snap.targetId)?.y ?? snap.y) : 0,
      snapNormalX: persistent ? snap.normal.x : 0,
      snapNormalY: persistent ? snap.normal.y : -1,
    } : raw;
    setItems((current) => [...current, next]);
    selectItem(next.id);
    setRunning(false);
  };

  const handlePaletteDrag = (event: DragEvent<HTMLButtonElement>, type: string) => {
    event.dataTransfer.setData("application/x-motionlab-tool", type);
    event.dataTransfer.effectAllowed = "copy";
  };

  const stageCoordinates = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 50, y: 40 };
    return {
      x: clamp(((clientX - rect.left) / rect.width) * 100, 2, 98),
      y: clamp(((clientY - rect.top) / rect.height) * 100, 2, 94),
    };
  };

  const handleStageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const type = event.dataTransfer.getData("application/x-motionlab-tool");
    if (!type) return;
    const point = stageCoordinates(event.clientX, event.clientY);
    addTool(type, point.x, point.y);
  };

  const updateItem = (id: string, key: keyof SandboxItem, value: number | boolean) => {
    setRunning(false);
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, [key]: value };
      if (key === "vx") next.initialVx = Number(value);
      if (key === "vy") next.initialVy = Number(value);
      if (key === "angle") next.initialAngle = Number(value);
      if (key === "fixed" && value === false) {
        next.snapTargetId = null;
        next.snapOffsetX = 0;
        next.snapOffsetY = 0;
      }
      return next;
    }));
  };

  const removeSelected = () => {
    if (selectedItemId) {
      setItems((current) => current
        .filter((item) => item.id !== selectedItemId)
        .map((item) => item.snapTargetId === selectedItemId
          ? { ...item, snapTargetId: null, snapOffsetX: 0, snapOffsetY: 0 }
          : item));
      setLinks((current) => current
        .filter((link) => link.a !== selectedItemId && link.b !== selectedItemId)
        .map((link) => ({ ...link, pulleys: link.pulleys.filter((pulley) => pulley.id !== selectedItemId) })));
      setSelectedItemId(null);
    }
    if (selectedLinkId) {
      setLinks((current) => current.filter((link) => link.id !== selectedLinkId));
      setSelectedLinkId(null);
    }
    setSnapGuide(null);
    setPulleyLinkId(null);
    setRunning(false);
  };

  const createLink = (sourceId: string, targetId: string, type = connectorTool, pulleyIds = linkPulleyIds) => {
    if (!type || sourceId === targetId) return;
    const a = itemsById.get(sourceId);
    const b = itemsById.get(targetId);
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
      pulleys: type === "rope" ? pulleyIds.map((pulleyId) => ({ id: pulleyId, direction: 0 })) : [],
    };
    const link = {
      ...draft,
      naturalLength: type === "rope"
        ? Math.max(0.25, getRopeRoute(items, draft).lengthMeters)
        : linkLength(a, b),
    };
    setLinks((current) => [...current, link]);
    setSelectedLinkId(id);
    setSelectedItemId(null);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
  };

  const chooseEndpoint = (id: string) => {
    if (!connectorTool) return;
    const item = itemsById.get(id);
    if (!item) return;
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
    const pulley = itemsById.get(pulleyId);
    if (pulley?.type !== "pulley") return;
    setLinks((current) => current.map((link) => {
      if (link.id !== linkId || link.type !== "rope" || link.pulleys.some((stop) => stop.id === pulleyId)) return link;
      const pulleys = [...link.pulleys, { id: pulleyId, direction: 0 }];
      const routed = { ...link, pulleys };
      return { ...routed, naturalLength: Math.max(0.25, getRopeRoute(items, routed).lengthMeters) };
    }));
    setSelectedItemId(null);
    setSelectedLinkId(linkId);
    setPulleyLinkId(null);
    setRunning(false);
  };

  const updatePulleyRoute = (linkId: string, action: "flip" | "remove") => {
    setLinks((current) => current.map((link) => {
      if (link.id !== linkId || link.type !== "rope" || link.pulleys.length === 0) return link;
      const pulleys = link.pulleys.slice();
      if (action === "remove") {
        pulleys.pop();
      } else {
        const last = pulleys.at(-1);
        if (last) {
          const currentDirection = last.direction || getRopeRoute(items, link).wraps.at(-1)?.direction || 1;
          pulleys[pulleys.length - 1] = { ...last, direction: -currentDirection };
        }
      }
      const routed = { ...link, pulleys };
      return { ...routed, naturalLength: Math.max(0.25, getRopeRoute(items, routed).lengthMeters) };
    }));
    setRunning(false);
  };

  const handlePortDrag = (event: DragEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    event.dataTransfer.setData("application/x-motionlab-link-source", id);
    event.dataTransfer.effectAllowed = "link";
  };

  const handleEntityLinkDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    if (!connectorTool) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer.getData("application/x-motionlab-link-source");
    const target = itemsById.get(targetId);
    if (!sourceId || !target) return;
    if (connectorTool === "rope" && target.type === "pulley") {
      setLinkStartId(sourceId);
      setLinkPulleyIds((current) => current.includes(targetId) ? current : [...current, targetId]);
      return;
    }
    createLink(sourceId, targetId, connectorTool, linkPulleyIds);
  };

  const beginItemDrag = (event: PointerEvent<HTMLDivElement>, item: SandboxItem) => {
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
    if ((event.target as HTMLElement).closest(".sandbox-link-port")) return;
    setRunning(false);
    setSnapGuide(null);
    selectItem(item.id);
    const point = stageCoordinates(event.clientX, event.clientY);
    dragRef.current = { id: item.id, offsetX: point.x - item.x, offsetY: point.y - item.y, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveItem = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = stageCoordinates(event.clientX, event.clientY);
    const current = itemsRef.current;
    const dragged = current.find((item) => item.id === drag.id);
    if (!dragged) return;
    const rawX = clamp(point.x - drag.offsetX, 2, 98);
    const rawY = clamp(point.y - drag.offsetY, 2, 94);
    if (Math.hypot(rawX - dragged.x, rawY - dragged.y) < 0.01) return;
    drag.moved = true;

    const descendants = attachedDescendants(current, drag.id);
    const provisional = {
      ...dragged,
      x: rawX,
      y: rawY,
      snapTargetId: null,
      snapOffsetX: 0,
      snapOffsetY: 0,
    };
    const snap = findSnapPlacement(
      provisional,
      current.filter((item) => item.id !== drag.id && !descendants.has(item.id)),
    );
    const persistent = Boolean(snap && !isDynamicItem(dragged));
    const target = snap ? current.find((item) => item.id === snap.targetId) : null;
    const placed = snap ? {
      ...provisional,
      x: clamp(snap.x, 2, 98),
      y: clamp(snap.y, 2, 94),
      snapTargetId: persistent ? snap.targetId : null,
      snapOffsetX: persistent ? snap.x - (target?.x ?? snap.x) : 0,
      snapOffsetY: persistent ? snap.y - (target?.y ?? snap.y) : 0,
      snapNormalX: persistent ? snap.normal.x : 0,
      snapNormalY: persistent ? snap.normal.y : -1,
    } : provisional;
    const dx = placed.x - dragged.x;
    const dy = placed.y - dragged.y;
    const next = current.map((item) => {
      if (item.id === drag.id) return placed;
      if (descendants.has(item.id)) return { ...item, x: item.x + dx, y: item.y + dy };
      return item;
    });
    const guide = snap ? {
      itemId: drag.id,
      targetId: snap.targetId,
      targetLabel: snap.targetLabel,
      persistent,
      part: snap.part,
    } : null;
    itemsRef.current = next;
    snapGuideRef.current = guide;
    setItems(next);
    setSnapGuide(guide);
  };

  const endItemDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = itemsRef.current;
    const descendants = attachedDescendants(current, drag.id);
    const next = current.map((item) => {
      if (item.id !== drag.id && !descendants.has(item.id)) return item;
      if (item.id !== drag.id) return { ...item, initialX: item.x, initialY: item.y };
      if (!drag.moved) return item;
      const temporary = isDynamicItem(item);
      return {
        ...item,
        initialX: item.x,
        initialY: item.y,
        snapTargetId: temporary ? null : item.snapTargetId,
        snapOffsetX: temporary ? 0 : item.snapOffsetX,
        snapOffsetY: temporary ? 0 : item.snapOffsetY,
      };
    });
    itemsRef.current = next;
    setItems(next);
    snapGuideRef.current = null;
    setSnapGuide(null);
    dragRef.current = null;
  };

  const reset = () => {
    setItems((current) => resetSandbox(current));
    setSnapGuide(null);
    setRunning(false);
  };

  const loadStarter = () => {
    setItems(createStarterSandbox());
    setLinks([]);
    setSelectedItemId("starter-block");
    setSelectedLinkId(null);
    setConnectorTool(null);
    setLinkStartId(null);
    setLinkPulleyIds([]);
    setPulleyLinkId(null);
    setSnapGuide(null);
    setRunning(false);
  };

  const clear = () => {
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
  };

  const dynamicCount = items.filter(isDynamicItem).length;

  return (
    <section className="sandbox-lab" aria-labelledby="sandbox-title">
      <header className="sandbox-heading">
        <div><p className="eyebrow">Open experiment / drag + connect</p><h2 id="sandbox-title">Sandbox mode</h2></div>
        <p>Build a system from individual parts, set its starting conditions, then run the same physics clock used by the guided experiments.</p>
      </header>

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
                  draggable
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
        </aside>

        <div className="sandbox-center">
          <div className="sandbox-toolbar">
            <div className="sandbox-run-controls">
              <button type="button" className="sandbox-run" onClick={() => setRunning((current) => !current)}>{running ? "Ⅱ Pause" : "▶ Run"}</button>
              <button type="button" onClick={() => { setRunning(false); setItems((current) => stepSandbox(current, links, 1 / 30)); }}>Step</button>
              <button type="button" onClick={reset}>Reset</button>
            </div>
            <div className="sandbox-toolbar-meta">
              <span>{dynamicCount} moving</span>
              <span>{links.length} connected</span>
              <span>snap on</span>
              <label className="sandbox-hitbox-toggle"><input type="checkbox" checked={showHitboxes} onChange={(event) => setShowHitboxes(event.target.checked)} /> Hitboxes</label>
              <label>Speed <select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
            </div>
          </div>

          <div
            ref={stageRef}
            className={`sandbox-stage ${connectorTool || pulleyLinkId ? "connecting" : ""} ${showHitboxes ? "show-hitboxes" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleStageDrop}
            role="application"
            aria-label="Physics sandbox canvas. Drag items to reposition them."
          >
            <div className="sandbox-grid" />
            <div className="sandbox-floor"><span>floor</span></div>
            <svg className="sandbox-rope-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Rope connections">
              {ropeRoutes.map(({ link, route, a, b }) => {
                if (!a || !b || route.points.length < 2) return null;
                const path = ropePath(route.points);
                const select = () => { setSelectedLinkId(link.id); setSelectedItemId(null); setPulleyLinkId(null); };
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
                  <span className="rope-marker marker-start" style={{ left: `${start.x}%`, top: `${start.y}%` }}>S</span>
                  {route.wraps.map((wrap: { id: string }, index: number) => {
                    const pulley = itemsById.get(wrap.id);
                    return pulley ? <span key={`${wrap.id}-${index}`} className="rope-marker marker-pulley" style={{ left: `${pulley.x}%`, top: `${pulley.y}%` }}>P{index + 1}</span> : null;
                  })}
                  {end && <span className="rope-marker marker-end" style={{ left: `${end.x}%`, top: `${end.y}%` }}>E</span>}
                </div>
              );
            })}
            {links.filter((link) => link.type === "spring").map((link) => {
              const a = itemsById.get(link.a);
              const b = itemsById.get(link.b);
              if (!a || !b) return null;
              return <button key={link.id} type="button" className={`sandbox-link link-${link.type} ${selectedLinkId === link.id ? "selected" : ""}`} style={linkStyle(a, b)} onClick={() => { setSelectedLinkId(link.id); setSelectedItemId(null); setPulleyLinkId(null); }} aria-label={`Select ${link.type} connecting ${a.label} and ${b.label}`} />;
            })}
            {items.map((item) => {
              const dimensions = entityDimensions(item);
              const speed = Math.hypot(item.vx, item.vy);
              const visualAngle = item.type === "pendulum" ? 0 : item.type === "incline" ? -item.angle : item.angle;
              const activeSnap = snapGuide?.itemId === item.id ? snapGuide : null;
              const snapTarget = item.snapTargetId ? itemsById.get(item.snapTargetId) : null;
              return (
                <div
                  key={item.id}
                  className={`sandbox-entity entity-${item.type} ${selectedItemId === item.id ? "selected" : ""} ${linkStartId === item.id ? "link-start" : ""} ${pulleyLinkId && item.type === "pulley" ? "pulley-target" : ""} ${activeSnap ? "snapping" : ""} ${snapTarget ? "attached" : ""}`}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${dimensions.width}px`, height: `${dimensions.height}px`, transform: itemTransform(item), "--entity-angle": `${visualAngle}deg`, "--counter-entity-angle": `${-visualAngle}deg`, "--pendulum-angle": `${item.angle}deg` } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label} at ${item.x.toFixed(0)}, ${item.y.toFixed(0)}${snapTarget ? ` attached to ${snapTarget.label}` : ""}`}
                  onClick={() => {
                    if (connectorClickRef.current === item.id) {
                      connectorClickRef.current = null;
                      return;
                    }
                    if (!connectorTool && !pulleyLinkId) selectItem(item.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (pulleyLinkId && item.type === "pulley") addPulleyToLink(pulleyLinkId, item.id);
                    else if (connectorTool) chooseEndpoint(item.id);
                    else if (!pulleyLinkId) selectItem(item.id);
                  }}
                  onPointerDown={(event) => beginItemDrag(event, item)}
                  onPointerMove={moveItem}
                  onPointerUp={endItemDrag}
                  onPointerCancel={endItemDrag}
                  onDragOver={(event) => connectorTool && event.preventDefault()}
                  onDrop={(event) => handleEntityLinkDrop(event, item.id)}
                >
                  <span className="sandbox-shape" aria-hidden="true">
                    {item.type === "cart" && <><i /><i /></>}
                    {item.type === "pulley" && <i />}
                    {item.type === "pivot" && <i />}
                    {item.type === "pendulum" && <><i className="pendulum-arm" style={{ height: `${clamp(item.length * 35, 72, 190)}px` }}><b /></i></>}
                    {item.type === "gravity-region" && <b style={{ transform: `rotate(${item.gravityDirection - 90}deg)` }}>↓</b>}
                    {item.type === "collision-target" && <i />}
                  </span>
                  <span className="sandbox-hitbox" aria-hidden="true"><i>hitbox</i>{item.type === "pendulum" && <b className="pendulum-hitbox-arm" style={{ height: `${clamp(item.length * 35, 72, 190)}px` }}><em /></b>}</span>
                  {isDynamicItem(item) && speed > 0.08 && <span className="sandbox-velocity" style={{ "--velocity-angle": `${Math.atan2(item.vy, item.vx)}rad`, "--velocity-length": `${clamp(speed * 9, 26, 78)}px` } as CSSProperties}><i>{speed.toFixed(1)} m/s</i></span>}
                  {(connectorTool || (pulleyLinkId && item.type === "pulley")) && <button
                    type="button"
                    draggable={Boolean(connectorTool)}
                    className="sandbox-link-port"
                    onDragStart={(event) => connectorTool && handlePortDrag(event, item.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (pulleyLinkId) addPulleyToLink(pulleyLinkId, item.id);
                      else chooseEndpoint(item.id);
                    }}
                    aria-label={pulleyLinkId ? `Route selected rope around ${item.label}` : `Use ${item.label} for ${connectorTool} connection`}
                  />}
                  {activeSnap && <span className="sandbox-snap-badge">{activeSnap.persistent ? "STICK" : "TEMP"} → {activeSnap.targetLabel}</span>}
                  {!activeSnap && snapTarget && <span className="sandbox-attachment-badge">STUCK → {snapTarget.label}</span>}
                  <small>{item.label}</small>
                </div>
              );
            })}
            {items.length === 0 && <div className="sandbox-empty"><strong>Drop an object anywhere.</strong><span>Start with a block, ball, platform, or gravity region.</span></div>}
            {connectorTool && <div className="sandbox-connect-note">
              <strong>{connectorTool === "rope" ? "Rope" : "Spring"} tool armed</strong>
              <span>{!linkStartId
                ? "Choose the starting object."
                : connectorTool === "rope" && linkPulleyIds.length
                  ? `${linkPulleyIds.length} pulley ${linkPulleyIds.length === 1 ? "wrap" : "wraps"} added. Choose the ending object.`
                  : connectorTool === "rope"
                    ? "Choose the ending object, or tap a pulley to route around it."
                    : "Choose the ending object."}</span>
              <button type="button" onClick={() => { setConnectorTool(null); setLinkStartId(null); setLinkPulleyIds([]); }}>Cancel</button>
            </div>}
            {pulleyLinkId && <div className="sandbox-connect-note"><strong>Connect rope to pulley</strong><span>Choose a pulley. The rope will wrap around its rim instead of attaching to its center.</span><button type="button" onClick={() => setPulleyLinkId(null)}>Cancel</button></div>}
          </div>

          <div className="sandbox-stage-actions"><button type="button" onClick={loadStarter}>Load starter setup</button><button type="button" onClick={clear}>Clear canvas</button><span>Movable objects snap temporarily · fixed structures stick and slide.</span></div>
        </div>

        <aside className="sandbox-inspector" aria-label="Selected item properties">
          <div className="sandbox-panel-title"><span>Properties</span><small>{selectedItem ? selectedItem.label : selectedLink ? selectedLink.type : "Nothing selected"}</small></div>
          {selectedItem ? (
            <div className="sandbox-properties">
              <div className="sandbox-selection-name"><span aria-hidden="true">{ICONS[selectedItem.type]}</span><div><strong>{selectedItem.label}</strong><small>{isDynamicItem(selectedItem) ? "Dynamic object" : selectedItem.type === "pendulum" ? "Oscillating system" : "Placed structure"}</small></div></div>
              {selectedItem.snapTargetId && <div className="sandbox-snap-status"><span><small>Persistent snap</small><strong>Stuck to {itemsById.get(selectedItem.snapTargetId)?.label ?? "surface"}</strong></span><button type="button" onClick={() => setItems((current) => current.map((item) => item.id === selectedItem.id ? { ...item, snapTargetId: null, snapOffsetX: 0, snapOffsetY: 0 } : item))}>Detach</button></div>}
              {(["block", "ball", "cart", "rod", "wheel", "pendulum", "pulley"].includes(selectedItem.type)) && <NumberControl label="Mass" value={selectedItem.mass} min={0.2} max={12} step={0.1} unit="kg" onChange={(value) => updateItem(selectedItem.id, "mass", value)} />}
              {!(["pivot"].includes(selectedItem.type)) && <NumberControl label={selectedItem.type === "platform" || selectedItem.type === "incline" || selectedItem.type === "rod" ? "Length" : "Size"} value={selectedItem.size} min={0.5} max={8} step={0.1} unit="m" onChange={(value) => updateItem(selectedItem.id, "size", value)} />}
              {isDynamicItem(selectedItem) && <><NumberControl label="Initial velocity x" value={selectedItem.initialVx} min={-10} max={10} step={0.25} unit="m/s" onChange={(value) => updateItem(selectedItem.id, "vx", value)} />{selectedItem.type !== "cart" && <NumberControl label="Initial velocity y" value={selectedItem.initialVy} min={-10} max={10} step={0.25} unit="m/s" onChange={(value) => updateItem(selectedItem.id, "vy", value)} />}</>}
              {(["block", "cart", "platform", "incline"].includes(selectedItem.type)) && <NumberControl label="Friction μ" value={selectedItem.friction} min={0} max={1} step={0.01} unit="" onChange={(value) => updateItem(selectedItem.id, "friction", value)} />}
              {(["incline", "rod", "pendulum", "platform"].includes(selectedItem.type)) && <NumberControl label={selectedItem.type === "platform" ? "Surface angle" : "Starting angle"} value={selectedItem.initialAngle} min={selectedItem.type === "platform" ? -90 : -75} max={selectedItem.type === "platform" ? 90 : 75} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "angle", value)} />}
              {selectedItem.type === "pendulum" && <NumberControl label="Pendulum length" value={selectedItem.length} min={0.5} max={5} step={0.1} unit="m" onChange={(value) => updateItem(selectedItem.id, "length", value)} />}
              {(["wheel", "pulley", "circular-track"].includes(selectedItem.type)) && <NumberControl label="Radius" value={selectedItem.radius} min={0.3} max={4} step={0.1} unit="m" onChange={(value) => updateItem(selectedItem.id, "radius", value)} />}
              {(["wheel", "rod"].includes(selectedItem.type)) && <NumberControl label="Rotational inertia" value={selectedItem.inertia} min={0.1} max={10} step={0.1} unit="kg·m²" onChange={(value) => updateItem(selectedItem.id, "inertia", value)} />}
              {selectedItem.type === "gravity-region" && <><NumberControl label="Gravity strength" value={selectedItem.gravityStrength} min={0} max={25} step={0.1} unit="m/s²" onChange={(value) => updateItem(selectedItem.id, "gravityStrength", value)} /><NumberControl label="Gravity direction" value={selectedItem.gravityDirection} min={-180} max={180} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "gravityDirection", value)} /></>}
              {selectedItem.type === "pulley" && <label className="sandbox-check"><input type="checkbox" checked={selectedItem.fixed} onChange={(event) => updateItem(selectedItem.id, "fixed", event.target.checked)} /><span>Fixed pulley</span></label>}
              <button type="button" className="sandbox-delete" onClick={removeSelected}>Remove {selectedItem.label.toLowerCase()}</button>
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
              <NumberControl label="Natural length" value={selectedLink.naturalLength} min={0.25} max={12} step={0.05} unit="m" onChange={(value) => setLinks((current) => current.map((link) => link.id === selectedLink.id ? { ...link, naturalLength: value } : link))} />
              {selectedLink.type === "spring" && <NumberControl label="Spring constant" value={selectedLink.springConstant} min={2} max={80} step={1} unit="N/m" onChange={(value) => setLinks((current) => current.map((link) => link.id === selectedLink.id ? { ...link, springConstant: value } : link))} />}
              {selectedLink.type === "rope" && <div className="sandbox-route-actions">
                <button type="button" className={pulleyLinkId === selectedLink.id ? "active" : ""} aria-pressed={pulleyLinkId === selectedLink.id} onClick={() => { setPulleyLinkId((current) => current === selectedLink.id ? null : selectedLink.id); setConnectorTool(null); setLinkStartId(null); setLinkPulleyIds([]); setRunning(false); }}>Connect to pulley</button>
                {selectedLink.pulleys.length > 0 && <><button type="button" onClick={() => updatePulleyRoute(selectedLink.id, "flip")}>Flip last wrap</button><button type="button" onClick={() => updatePulleyRoute(selectedLink.id, "remove")}>Remove last pulley</button></>}
              </div>}
              <button type="button" className="sandbox-delete" onClick={removeSelected}>Remove connection</button>
            </div>
          ) : (
            <div className="sandbox-inspector-empty"><span>↖</span><strong>Select an object</strong><p>Its mass, size, velocity, friction, and special properties will appear here.</p></div>
          )}
        </aside>
      </div>
    </section>
  );
}
