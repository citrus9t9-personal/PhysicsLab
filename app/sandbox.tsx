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
}

interface SandboxLink {
  id: string;
  type: ConnectorType;
  a: string;
  b: string;
  naturalLength: number;
  springConstant: number;
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
  if (item.type === "platform" || item.type === "incline") return { width: clamp(item.size * 28, 90, 230), height: 25 };
  if (item.type === "rod") return { width: clamp(item.size * 30, 80, 210), height: 24 };
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

export default function SandboxLab() {
  const [items, setItems] = useState<SandboxItem[]>(() => createStarterSandbox());
  const [links, setLinks] = useState<SandboxLink[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>("starter-block");
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [connectorTool, setConnectorTool] = useState<ConnectorType | null>(null);
  const [linkStartId, setLinkStartId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef(1);
  const lastFrameRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const connectorClickRef = useRef<string | null>(null);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  const selectedLink = links.find((link) => link.id === selectedLinkId) ?? null;
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

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
  };

  const addTool = (type: string, x?: number, y?: number) => {
    if (type === "rope" || type === "spring") {
      setConnectorTool(type);
      setLinkStartId(null);
      setRunning(false);
      return;
    }
    const index = counterRef.current;
    counterRef.current += 1;
    const next = createSandboxItem(type, `sandbox-${type}-${index}`, x ?? 42 + (index % 4) * 5, y ?? 28 + (index % 3) * 7) as SandboxItem;
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
      return next;
    }));
  };

  const removeSelected = () => {
    if (selectedItemId) {
      setItems((current) => current.filter((item) => item.id !== selectedItemId));
      setLinks((current) => current.filter((link) => link.a !== selectedItemId && link.b !== selectedItemId));
      setSelectedItemId(null);
    }
    if (selectedLinkId) {
      setLinks((current) => current.filter((link) => link.id !== selectedLinkId));
      setSelectedLinkId(null);
    }
    setRunning(false);
  };

  const createLink = (sourceId: string, targetId: string, type = connectorTool) => {
    if (!type || sourceId === targetId) return;
    const a = itemsById.get(sourceId);
    const b = itemsById.get(targetId);
    if (!a || !b) return;
    const id = `sandbox-link-${counterRef.current}`;
    counterRef.current += 1;
    const link: SandboxLink = {
      id,
      type,
      a: sourceId,
      b: targetId,
      naturalLength: linkLength(a, b),
      springConstant: 18,
    };
    setLinks((current) => [...current, link]);
    setSelectedLinkId(id);
    setSelectedItemId(null);
    setConnectorTool(null);
    setLinkStartId(null);
  };

  const chooseEndpoint = (id: string) => {
    if (!connectorTool) return;
    if (!linkStartId) {
      setLinkStartId(id);
      return;
    }
    createLink(linkStartId, id);
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
    if (sourceId) createLink(sourceId, targetId);
  };

  const beginItemDrag = (event: PointerEvent<HTMLDivElement>, item: SandboxItem) => {
    if (connectorTool) {
      event.preventDefault();
      connectorClickRef.current = item.id;
      chooseEndpoint(item.id);
      return;
    }
    if ((event.target as HTMLElement).closest(".sandbox-link-port")) return;
    setRunning(false);
    selectItem(item.id);
    const point = stageCoordinates(event.clientX, event.clientY);
    dragRef.current = { id: item.id, offsetX: point.x - item.x, offsetY: point.y - item.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveItem = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = stageCoordinates(event.clientX, event.clientY);
    setItems((current) => current.map((item) => item.id === drag.id
      ? { ...item, x: clamp(point.x - drag.offsetX, 2, 98), y: clamp(point.y - drag.offsetY, 2, 94) }
      : item));
  };

  const endItemDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    setItems((current) => current.map((item) => item.id === drag.id
      ? { ...item, initialX: item.x, initialY: item.y }
      : item));
    dragRef.current = null;
  };

  const reset = () => {
    setItems((current) => resetSandbox(current));
    setRunning(false);
  };

  const loadStarter = () => {
    setItems(createStarterSandbox());
    setLinks([]);
    setSelectedItemId("starter-block");
    setSelectedLinkId(null);
    setConnectorTool(null);
    setLinkStartId(null);
    setRunning(false);
  };

  const clear = () => {
    setItems([]);
    setLinks([]);
    setSelectedItemId(null);
    setSelectedLinkId(null);
    setConnectorTool(null);
    setLinkStartId(null);
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
            <div className="sandbox-toolbar-meta"><span>{dynamicCount} moving</span><span>{links.length} connected</span><label>Speed <select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div>
          </div>

          <div
            ref={stageRef}
            className={`sandbox-stage ${connectorTool ? "connecting" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleStageDrop}
            role="application"
            aria-label="Physics sandbox canvas. Drag items to reposition them."
          >
            <div className="sandbox-grid" />
            <div className="sandbox-floor"><span>floor</span></div>
            {links.map((link) => {
              const a = itemsById.get(link.a);
              const b = itemsById.get(link.b);
              if (!a || !b) return null;
              return <button key={link.id} type="button" className={`sandbox-link link-${link.type} ${selectedLinkId === link.id ? "selected" : ""}`} style={linkStyle(a, b)} onClick={() => { setSelectedLinkId(link.id); setSelectedItemId(null); }} aria-label={`Select ${link.type} connecting ${a.label} and ${b.label}`} />;
            })}
            {items.map((item) => {
              const dimensions = entityDimensions(item);
              const speed = Math.hypot(item.vx, item.vy);
              const visualAngle = item.type === "pendulum" ? 0 : item.type === "incline" ? -item.angle : item.angle;
              return (
                <div
                  key={item.id}
                  className={`sandbox-entity entity-${item.type} ${selectedItemId === item.id ? "selected" : ""} ${linkStartId === item.id ? "link-start" : ""}`}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${dimensions.width}px`, height: `${dimensions.height}px`, transform: itemTransform(item), "--entity-angle": `${visualAngle}deg`, "--counter-entity-angle": `${-visualAngle}deg`, "--pendulum-angle": `${item.angle}deg` } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-label={`${item.label} at ${item.x.toFixed(0)}, ${item.y.toFixed(0)}`}
                  onClick={() => {
                    if (connectorClickRef.current === item.id) {
                      connectorClickRef.current = null;
                      return;
                    }
                    if (!connectorTool) selectItem(item.id);
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); connectorTool ? chooseEndpoint(item.id) : selectItem(item.id); } }}
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
                  {isDynamicItem(item) && speed > 0.08 && <span className="sandbox-velocity" style={{ "--velocity-angle": `${Math.atan2(item.vy, item.vx)}rad`, "--velocity-length": `${clamp(speed * 9, 26, 78)}px` } as CSSProperties}><i>{speed.toFixed(1)} m/s</i></span>}
                  {connectorTool && <button type="button" draggable className="sandbox-link-port" onDragStart={(event) => handlePortDrag(event, item.id)} onClick={(event) => { event.stopPropagation(); chooseEndpoint(item.id); }} aria-label={`Start ${connectorTool} connection from ${item.label}`} />}
                  <small>{item.label}</small>
                </div>
              );
            })}
            {items.length === 0 && <div className="sandbox-empty"><strong>Drop an object anywhere.</strong><span>Start with a block, ball, platform, or gravity region.</span></div>}
            {connectorTool && <div className="sandbox-connect-note"><strong>{connectorTool === "rope" ? "Rope" : "Spring"} tool armed</strong><span>{linkStartId ? "Choose the second object." : "Drag a green port between objects, or tap two objects."}</span><button type="button" onClick={() => { setConnectorTool(null); setLinkStartId(null); }}>Cancel</button></div>}
          </div>

          <div className="sandbox-stage-actions"><button type="button" onClick={loadStarter}>Load starter setup</button><button type="button" onClick={clear}>Clear canvas</button><span>Drag objects to set their starting positions.</span></div>
        </div>

        <aside className="sandbox-inspector" aria-label="Selected item properties">
          <div className="sandbox-panel-title"><span>Properties</span><small>{selectedItem ? selectedItem.label : selectedLink ? selectedLink.type : "Nothing selected"}</small></div>
          {selectedItem ? (
            <div className="sandbox-properties">
              <div className="sandbox-selection-name"><span aria-hidden="true">{ICONS[selectedItem.type]}</span><div><strong>{selectedItem.label}</strong><small>{isDynamicItem(selectedItem) ? "Dynamic object" : selectedItem.type === "pendulum" ? "Oscillating system" : "Placed structure"}</small></div></div>
              {(["block", "ball", "cart", "rod", "wheel", "pendulum", "pulley"].includes(selectedItem.type)) && <NumberControl label="Mass" value={selectedItem.mass} min={0.2} max={12} step={0.1} unit="kg" onChange={(value) => updateItem(selectedItem.id, "mass", value)} />}
              {!(["pivot"].includes(selectedItem.type)) && <NumberControl label={selectedItem.type === "platform" || selectedItem.type === "incline" || selectedItem.type === "rod" ? "Length" : "Size"} value={selectedItem.size} min={0.5} max={8} step={0.1} unit="m" onChange={(value) => updateItem(selectedItem.id, "size", value)} />}
              {isDynamicItem(selectedItem) && <><NumberControl label="Initial velocity x" value={selectedItem.initialVx} min={-10} max={10} step={0.25} unit="m/s" onChange={(value) => updateItem(selectedItem.id, "vx", value)} />{selectedItem.type !== "cart" && <NumberControl label="Initial velocity y" value={selectedItem.initialVy} min={-10} max={10} step={0.25} unit="m/s" onChange={(value) => updateItem(selectedItem.id, "vy", value)} />}</>}
              {(["block", "cart", "platform", "incline"].includes(selectedItem.type)) && <NumberControl label="Friction μ" value={selectedItem.friction} min={0} max={1} step={0.01} unit="" onChange={(value) => updateItem(selectedItem.id, "friction", value)} />}
              {(["incline", "rod", "pendulum"].includes(selectedItem.type)) && <NumberControl label="Starting angle" value={selectedItem.initialAngle} min={-75} max={75} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "angle", value)} />}
              {selectedItem.type === "pendulum" && <NumberControl label="Pendulum length" value={selectedItem.length} min={0.5} max={5} step={0.1} unit="m" onChange={(value) => updateItem(selectedItem.id, "length", value)} />}
              {(["wheel", "pulley", "circular-track"].includes(selectedItem.type)) && <NumberControl label="Radius" value={selectedItem.radius} min={0.3} max={4} step={0.1} unit="m" onChange={(value) => updateItem(selectedItem.id, "radius", value)} />}
              {(["wheel", "rod"].includes(selectedItem.type)) && <NumberControl label="Rotational inertia" value={selectedItem.inertia} min={0.1} max={10} step={0.1} unit="kg·m²" onChange={(value) => updateItem(selectedItem.id, "inertia", value)} />}
              {selectedItem.type === "gravity-region" && <><NumberControl label="Gravity strength" value={selectedItem.gravityStrength} min={0} max={25} step={0.1} unit="m/s²" onChange={(value) => updateItem(selectedItem.id, "gravityStrength", value)} /><NumberControl label="Gravity direction" value={selectedItem.gravityDirection} min={-180} max={180} step={1} unit="°" onChange={(value) => updateItem(selectedItem.id, "gravityDirection", value)} /></>}
              {selectedItem.type === "pulley" && <label className="sandbox-check"><input type="checkbox" checked={selectedItem.fixed} onChange={(event) => updateItem(selectedItem.id, "fixed", event.target.checked)} /><span>Fixed pulley</span></label>}
              <button type="button" className="sandbox-delete" onClick={removeSelected}>Remove {selectedItem.label.toLowerCase()}</button>
            </div>
          ) : selectedLink ? (
            <div className="sandbox-properties">
              <div className="sandbox-selection-name"><span aria-hidden="true">{ICONS[selectedLink.type]}</span><div><strong>{selectedLink.type === "rope" ? "Rope / string" : "Spring"}</strong><small>Connected constraint</small></div></div>
              <NumberControl label="Natural length" value={selectedLink.naturalLength} min={0.25} max={12} step={0.05} unit="m" onChange={(value) => setLinks((current) => current.map((link) => link.id === selectedLink.id ? { ...link, naturalLength: value } : link))} />
              {selectedLink.type === "spring" && <NumberControl label="Spring constant" value={selectedLink.springConstant} min={2} max={80} step={1} unit="N/m" onChange={(value) => setLinks((current) => current.map((link) => link.id === selectedLink.id ? { ...link, springConstant: value } : link))} />}
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
