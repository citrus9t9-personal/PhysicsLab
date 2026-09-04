"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { getGraphGridStep } from "./graph.mjs";

export interface SandboxMotionObject {
  x: number;
  height: number;
  vx: number;
  vy: number;
  speed: number;
  mass: number;
}

export interface SandboxMotionSample {
  time: number;
  objects: Record<string, SandboxMotionObject>;
}

export type SandboxGraphMetric = "x" | "height" | "vx" | "vy" | "speed" | "acceleration" | "energy";

const METRICS: Array<{ id: SandboxGraphMetric; short: string; label: string; unit: string; min: number; max: number }> = [
  { id: "x", short: "x", label: "Horizontal position", unit: "m", min: 0, max: 100 },
  { id: "height", short: "y", label: "Height", unit: "m", min: 0, max: 100 },
  { id: "vx", short: "vₓ", label: "Horizontal velocity", unit: "m/s", min: -20, max: 20 },
  { id: "vy", short: "vᵧ", label: "Vertical velocity", unit: "m/s", min: -20, max: 20 },
  { id: "speed", short: "|v|", label: "Speed", unit: "m/s", min: 0, max: 20 },
  { id: "acceleration", short: "|a|", label: "Acceleration", unit: "m/s²", min: 0, max: 25 },
  { id: "energy", short: "KE", label: "Kinetic energy", unit: "J", min: 0, max: 500 },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function liveFollowingView<T extends { xCenter: number; xSpan: number }>(view: T, currentTime: number, followLive: boolean) {
  if (!followLive || currentTime <= view.xCenter + view.xSpan / 2 * 0.92) return view;
  return { ...view, xCenter: currentTime - view.xSpan * 0.42 };
}

function formatTick(value: number, step: number) {
  const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
  const clean = Math.abs(value) < step / 100 ? 0 : value;
  return clean.toFixed(decimals);
}

export default function SandboxGraph({
  history,
  objectId,
  objectLabel,
  currentTime,
}: {
  history: SandboxMotionSample[];
  objectId: string;
  objectLabel: string;
  currentTime: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [metric, setMetric] = useState<SandboxGraphMetric>("x");
  const metricInfo = METRICS.find((candidate) => candidate.id === metric) ?? METRICS[0];
  const defaultView = useMemo(() => ({
    xCenter: 5,
    xSpan: 10,
    yCenter: (metricInfo.min + metricInfo.max) / 2,
    ySpan: metricInfo.max - metricInfo.min,
  }), [metricInfo]);
  const [view, setView] = useState(defaultView);
  const [tool, setTool] = useState<"select" | "pan">("select");
  const [dragging, setDragging] = useState(false);
  const [followLive, setFollowLive] = useState(true);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number; view: typeof defaultView } | null>(null);
  const selectRef = useRef<{ pointerId: number; start: number } | null>(null);
  const plottedView = liveFollowingView(view, currentTime, followLive);

  const data = useMemo(() => history.flatMap((sample, index) => {
    const object = sample.objects[objectId];
    if (!object) return [];
    let value = object[metric as keyof SandboxMotionObject] as number;
    if (metric === "acceleration") {
      const previous = history[index - 1];
      const previousObject = previous?.objects[objectId];
      const delta = sample.time - (previous?.time ?? sample.time);
      value = previousObject && delta > 0
        ? Math.hypot(object.vx - previousObject.vx, object.vy - previousObject.vy) / delta
        : 0;
    } else if (metric === "energy") {
      value = 0.5 * object.mass * object.speed ** 2;
    }
    return [{ time: sample.time, value }];
  }), [history, metric, objectId]);

  const selectedStats = useMemo(() => {
    if (!selection) return null;
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    const points = data.filter((point) => point.time >= start && point.time <= end);
    if (!points.length) return null;
    const values = points.map((point) => point.value);
    return {
      start,
      end,
      deltaTime: end - start,
      deltaValue: points.at(-1)!.value - points[0].value,
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  }, [data, selection]);

  const hoverPoint = useMemo(() => {
    if (hoverTime === null || !data.length) return null;
    return data.reduce((best, point) => Math.abs(point.time - hoverTime) < Math.abs(best.time - hoverTime) ? point : best);
  }, [data, hoverTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);

      const width = rect.width;
      const height = rect.height;
      const padding = { top: 18, right: 24, bottom: 42, left: 62 };
      const plotWidth = Math.max(width - padding.left - padding.right, 1);
      const plotHeight = Math.max(height - padding.top - padding.bottom, 1);
      const xMin = plottedView.xCenter - plottedView.xSpan / 2;
      const xMax = plottedView.xCenter + plottedView.xSpan / 2;
      const yMin = plottedView.yCenter - plottedView.ySpan / 2;
      const yMax = plottedView.yCenter + plottedView.ySpan / 2;
      const xStep = getGraphGridStep(plottedView.xSpan, 11);
      const yStep = getGraphGridStep(plottedView.ySpan, 9);
      const toX = (value: number) => padding.left + ((value - xMin) / plottedView.xSpan) * plotWidth;
      const toY = (value: number) => padding.top + ((yMax - value) / plottedView.ySpan) * plotHeight;
      const styles = getComputedStyle(document.documentElement);
      const ink = styles.getPropertyValue("--ink").trim() || "#14201f";
      const muted = styles.getPropertyValue("--muted").trim() || "#65706d";
      const line = styles.getPropertyValue("--line").trim() || "#c9cec8";
      const orange = styles.getPropertyValue("--orange").trim() || "#ed5a32";
      const green = styles.getPropertyValue("--green").trim() || "#1a4b43";
      const blue = styles.getPropertyValue("--blue").trim() || "#22658b";
      const surface = styles.getPropertyValue("--surface-strong").trim() || "#ffffff";

      context.fillStyle = surface;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = line;
      context.lineWidth = 1;
      context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = muted;
      context.textBaseline = "middle";

      for (let value = Math.ceil(xMin / xStep) * xStep; value <= xMax + xStep / 2; value += xStep) {
        const x = toX(value);
        context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, padding.top + plotHeight); context.stroke();
        context.fillText(formatTick(value, xStep), x + 3, height - 23);
      }
      for (let value = Math.ceil(yMin / yStep) * yStep; value <= yMax + yStep / 2; value += yStep) {
        const y = toY(value);
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(padding.left + plotWidth, y); context.stroke();
        context.fillText(formatTick(value, yStep), 7, y);
      }

      context.strokeStyle = ink;
      context.lineWidth = 1.4;
      if (xMin <= 0 && xMax >= 0) {
        context.beginPath(); context.moveTo(toX(0), padding.top); context.lineTo(toX(0), padding.top + plotHeight); context.stroke();
      }
      if (yMin <= 0 && yMax >= 0) {
        context.beginPath(); context.moveTo(padding.left, toY(0)); context.lineTo(padding.left + plotWidth, toY(0)); context.stroke();
      }

      context.save();
      context.beginPath();
      context.rect(padding.left, padding.top, plotWidth, plotHeight);
      context.clip();
      if (selection) {
        const startX = toX(Math.min(selection.start, selection.end));
        const endX = toX(Math.max(selection.start, selection.end));
        context.fillStyle = "rgba(34, 101, 139, 0.13)";
        context.fillRect(startX, padding.top, endX - startX, plotHeight);
        context.strokeStyle = blue;
        context.lineWidth = 1;
        context.setLineDash([4, 4]);
        for (const x of [startX, endX]) {
          context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, padding.top + plotHeight); context.stroke();
        }
        context.setLineDash([]);
      }

      context.strokeStyle = orange;
      context.lineWidth = 2.6;
      context.lineJoin = "round";
      context.beginPath();
      data.forEach((point, index) => {
        const x = toX(point.time);
        const y = toY(point.value);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();

      const latest = data.at(-1);
      if (latest) {
        context.fillStyle = orange;
        context.beginPath(); context.arc(toX(latest.time), toY(latest.value), 4, 0, Math.PI * 2); context.fill();
      }
      if (hoverPoint) {
        context.fillStyle = blue;
        context.beginPath(); context.arc(toX(hoverPoint.time), toY(hoverPoint.value), 5, 0, Math.PI * 2); context.fill();
      }
      context.strokeStyle = green;
      context.lineWidth = 1.5;
      context.setLineDash([5, 5]);
      context.beginPath(); context.moveTo(toX(currentTime), padding.top); context.lineTo(toX(currentTime), padding.top + plotHeight); context.stroke();
      context.restore();

      context.fillStyle = ink;
      context.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText("time (s)", width - 80, height - 10);
      context.save();
      context.translate(15, padding.top + plotHeight / 2 + 30);
      context.rotate(-Math.PI / 2);
      context.fillText(`${metricInfo.short} (${metricInfo.unit})`, 0, 0);
      context.restore();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [currentTime, data, hoverPoint, metricInfo, plottedView, selection]);

  const clientToTime = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const plotWidth = Math.max(rect.width - 86, 1);
    const ratio = clamp((clientX - rect.left - 62) / plotWidth, 0, 1);
    return plottedView.xCenter - plottedView.xSpan / 2 + ratio * plottedView.xSpan;
  };

  const beginGraphAction = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    setFollowLive(false);
    setDragging(true);
    if (tool === "pan") {
      panRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, view: plottedView };
    } else {
      const start = clientToTime(event.clientX);
      selectRef.current = { pointerId: event.pointerId, start };
      setSelection({ start, end: start });
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveGraphAction = (event: PointerEvent<HTMLCanvasElement>) => {
    setHoverTime(clientToTime(event.clientX));
    const pan = panRef.current;
    if (pan?.pointerId === event.pointerId) {
      const rect = event.currentTarget.getBoundingClientRect();
      setView({
        ...pan.view,
        xCenter: pan.view.xCenter - ((event.clientX - pan.clientX) / Math.max(rect.width - 86, 1)) * pan.view.xSpan,
        yCenter: pan.view.yCenter + ((event.clientY - pan.clientY) / Math.max(rect.height - 60, 1)) * pan.view.ySpan,
      });
    }
    const selecting = selectRef.current;
    if (selecting?.pointerId === event.pointerId) {
      setSelection({ start: selecting.start, end: clientToTime(event.clientX) });
    }
  };

  const endGraphAction = (event: PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
    if (selectRef.current?.pointerId === event.pointerId) selectRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoomGraph = (factor: number, xRatio = 0.5, yRatio = 0.5) => {
    const startingView = plottedView;
    setFollowLive(false);
    setView(() => {
      const nextXSpan = clamp(startingView.xSpan * factor, 0.1, 10_000);
      const nextYSpan = clamp(startingView.ySpan * factor, 0.05, 100_000);
      const focusX = startingView.xCenter + (xRatio - 0.5) * startingView.xSpan;
      const focusY = startingView.yCenter + (0.5 - yRatio) * startingView.ySpan;
      return {
        xCenter: focusX - (xRatio - 0.5) * nextXSpan,
        yCenter: focusY - (0.5 - yRatio) * nextYSpan,
        xSpan: nextXSpan,
        ySpan: nextYSpan,
      };
    });
  };

  const wheelZoom = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomGraph(
      Math.exp(clamp(event.deltaY, -120, 120) * 0.0025),
      clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((event.clientY - rect.top) / rect.height, 0, 1),
    );
  };

  const resetGraph = () => {
    setView(defaultView);
    setSelection(null);
    setFollowLive(true);
  };

  const chooseMetric = (nextMetric: SandboxGraphMetric) => {
    const nextInfo = METRICS.find((candidate) => candidate.id === nextMetric) ?? METRICS[0];
    setMetric(nextMetric);
    setView({ xCenter: 5, xSpan: 10, yCenter: (nextInfo.min + nextInfo.max) / 2, ySpan: nextInfo.max - nextInfo.min });
    setSelection(null);
    setFollowLive(true);
  };

  return (
    <section className="sandbox-graph" aria-label={`Live graph for ${objectLabel}`}>
      <header className="sandbox-graph-header">
        <div><span>Live graph</span><strong>{objectLabel} · {metricInfo.label}</strong><small>Drag to highlight · choose Pan to move · wheel to zoom</small></div>
        <div className="sandbox-graph-tools">
          <span role="group" aria-label="Graph interaction tool">
            <button type="button" className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}>Select</button>
            <button type="button" className={tool === "pan" ? "active" : ""} onClick={() => setTool("pan")}>Pan</button>
          </span>
          <span role="group" aria-label="Graph quantity">
            {METRICS.map((candidate) => <button key={candidate.id} type="button" className={metric === candidate.id ? "active" : ""} title={`${candidate.label} (${candidate.unit})`} onClick={() => chooseMetric(candidate.id)}>{candidate.short}</button>)}
          </span>
        </div>
      </header>
      <div className="sandbox-graph-canvas-wrap">
        <canvas
          ref={canvasRef}
          className={dragging ? "dragging" : ""}
          role="img"
          tabIndex={0}
          aria-label={`${metricInfo.label} versus time for ${objectLabel}. Drag to ${tool === "select" ? "highlight a time interval" : "pan"}; use the mouse wheel to zoom.`}
          onPointerDown={beginGraphAction}
          onPointerMove={moveGraphAction}
          onPointerUp={endGraphAction}
          onPointerCancel={endGraphAction}
          onPointerLeave={() => setHoverTime(null)}
          onWheel={wheelZoom}
          onDoubleClick={resetGraph}
        />
        <div className="sandbox-graph-zoom" aria-label="Graph zoom controls">
          <button type="button" onClick={() => zoomGraph(0.75)} aria-label="Zoom graph in">＋</button>
          <button type="button" onClick={() => zoomGraph(1 / 0.75)} aria-label="Zoom graph out">−</button>
          <button type="button" onClick={resetGraph} aria-label="Reset graph view">⌂</button>
        </div>
        {hoverPoint && <output className="sandbox-graph-cursor">t {hoverPoint.time.toFixed(2)} s · {hoverPoint.value.toFixed(3)} {metricInfo.unit}</output>}
      </div>
      <footer className="sandbox-graph-stats">
        {selectedStats ? <>
          <span><small>Selected</small><strong>{selectedStats.start.toFixed(2)}–{selectedStats.end.toFixed(2)} s</strong></span>
          <span><small>Δt</small><strong>{selectedStats.deltaTime.toFixed(3)} s</strong></span>
          <span><small>Minimum</small><strong>{selectedStats.min.toFixed(3)} {metricInfo.unit}</strong></span>
          <span><small>Maximum</small><strong>{selectedStats.max.toFixed(3)} {metricInfo.unit}</strong></span>
          <span><small>Mean</small><strong>{selectedStats.mean.toFixed(3)} {metricInfo.unit}</strong></span>
          <span><small>Δ value</small><strong>{selectedStats.deltaValue.toFixed(3)} {metricInfo.unit}</strong></span>
          <button type="button" onClick={() => setSelection(null)}>Clear highlight</button>
        </> : <span><small>Selection</small><strong>Drag across the graph to analyze a time interval.</strong></span>}
      </footer>
    </section>
  );
}
