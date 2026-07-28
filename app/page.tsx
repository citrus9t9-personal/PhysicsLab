"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from "react";

import {
  atwoodMotion,
  inclineMotion,
  projectileMotion,
  resolveBlockCollision,
  springMotion,
} from "./physics.mjs";
import { getFixedGraphScale, getGraphGridStep, revealGraphSamples } from "./graph.mjs";
import SandboxLab from "./sandbox";

type ScenarioId = "projectile" | "incline" | "pulley" | "collision" | "spring";
type WorkspaceMode = "guided" | "sandbox";
type RunState = "ready" | "running" | "paused" | "complete";
type ViewMode = "motion" | "graphs";
type GraphMetric = "position" | "velocity" | "acceleration";
type TrackedObject = "A" | "B";
type CollisionMode = "elastic" | "inelastic";

interface LabValues {
  gravity: number;
  projectileSpeed: number;
  projectileAngle: number;
  projectileMass: number;
  inclineMass: number;
  inclineAngle: number;
  friction: number;
  pulleyMassA: number;
  pulleyMassB: number;
  collisionMassA: number;
  collisionMassB: number;
  collisionVelocityA: number;
  collisionVelocityB: number;
  springMass: number;
  springConstant: number;
  amplitude: number;
}

interface Frame {
  position: number;
  velocity: number;
  acceleration: number;
  netForce: number;
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
  positionX: number;
  positionY: number;
  velocityX: number;
  velocityY: number;
  bodyAPosition: number;
  bodyBPosition: number;
  secondaryVelocity: number;
  displacement: number;
  tension: number;
  normalForce: number;
  frictionForce: number;
  springForce: number;
  impactTime: number;
  collisionHappened: boolean;
  joined: boolean;
}

interface ScenarioDefinition {
  id: ScenarioId;
  number: string;
  name: string;
  shortName: string;
  description: string;
  principle: string;
}

const G = 9.81;
const EMPTY_FRAME: Frame = {
  position: 0,
  velocity: 0,
  acceleration: 0,
  netForce: 0,
  kineticEnergy: 0,
  potentialEnergy: 0,
  totalEnergy: 0,
  positionX: 0,
  positionY: 0,
  velocityX: 0,
  velocityY: 0,
  bodyAPosition: 2,
  bodyBPosition: 8,
  secondaryVelocity: 0,
  displacement: 0,
  tension: 0,
  normalForce: 0,
  frictionForce: 0,
  springForce: 0,
  impactTime: Number.POSITIVE_INFINITY,
  collisionHappened: false,
  joined: false,
};

const INITIAL_VALUES: LabValues = {
  gravity: G,
  projectileSpeed: 18,
  projectileAngle: 42,
  projectileMass: 1.5,
  inclineMass: 4,
  inclineAngle: 28,
  friction: 0.15,
  pulleyMassA: 3,
  pulleyMassB: 5,
  collisionMassA: 2,
  collisionMassB: 4,
  collisionVelocityA: 4,
  collisionVelocityB: 0,
  springMass: 2,
  springConstant: 18,
  amplitude: 1.4,
};

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "projectile",
    number: "01",
    name: "Projectile motion",
    shortName: "Kinematics",
    description: "Launch an object and follow its horizontal and vertical motion.",
    principle: "Horizontal velocity stays constant while gravity changes vertical velocity.",
  },
  {
    id: "incline",
    number: "02",
    name: "Inclined plane",
    shortName: "Slopes",
    description: "Balance gravity, the normal force, and friction on a ramp.",
    principle: "The component of gravity parallel to the surface drives the block downhill.",
  },
  {
    id: "pulley",
    number: "03",
    name: "Atwood machine",
    shortName: "Pulleys",
    description: "Connect two masses and observe how imbalance produces acceleration.",
    principle: "Both masses share one acceleration because the ideal rope stays taut.",
  },
  {
    id: "collision",
    number: "04",
    name: "One-dimensional collision",
    shortName: "Collisions",
    description: "Compare elastic impacts with objects that stick together.",
    principle: "Momentum is conserved; kinetic energy is conserved only in elastic impacts.",
  },
  {
    id: "spring",
    number: "05",
    name: "Mass on a spring",
    shortName: "Springs",
    description: "Track restoring force and energy through simple harmonic motion.",
    principle: "The restoring force always points toward equilibrium: F = −kx.",
  },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const formatValue = (value: number, unit: string, signed = false) => {
  const clean = Math.abs(value) < 0.005 ? 0 : value;
  const sign = signed && clean > 0 ? "+" : "";
  return `${sign}${clean.toFixed(2)} ${unit}`;
};

function getDuration(scenario: ScenarioId, values: LabValues) {
  if (scenario === "projectile") {
    return Math.max(
      projectileMotion(
        {
          speed: values.projectileSpeed,
          angleDegrees: values.projectileAngle,
          mass: values.projectileMass,
          gravity: values.gravity,
        },
        0,
      ).flightTime,
      0.5,
    );
  }

  if (scenario === "incline") {
    const state = inclineMotion(
      {
        angleDegrees: values.inclineAngle,
        friction: values.friction,
        mass: values.inclineMass,
        gravity: values.gravity,
      },
      0,
    );
    return state.acceleration > 0
      ? clamp(Math.sqrt(12 / state.acceleration), 1.5, 7)
      : 5;
  }

  if (scenario === "pulley") {
    const state = atwoodMotion(
      {
        massA: values.pulleyMassA,
        massB: values.pulleyMassB,
        gravity: values.gravity,
      },
      0,
    );
    return Math.abs(state.acceleration) > 0.01
      ? clamp(Math.sqrt(4 / Math.abs(state.acceleration)), 1.5, 6)
      : 5;
  }

  if (scenario === "collision") {
    const closingSpeed = values.collisionVelocityA - values.collisionVelocityB;
    const impactTime = closingSpeed > 0 ? 4.5 / closingSpeed : Number.POSITIVE_INFINITY;
    return Number.isFinite(impactTime) ? clamp(impactTime + 2.5, 3, 7) : 5;
  }

  const spring = springMotion(
    {
      mass: values.springMass,
      springConstant: values.springConstant,
      amplitude: values.amplitude,
    },
    0,
  );
  return spring.period * 2;
}

function computeFrame(
  scenario: ScenarioId,
  values: LabValues,
  time: number,
  trackedObject: TrackedObject,
  collisionMode: CollisionMode,
): Frame {
  if (scenario === "projectile") {
    const state = projectileMotion(
      {
        speed: values.projectileSpeed,
        angleDegrees: values.projectileAngle,
        mass: values.projectileMass,
        gravity: values.gravity,
      },
      time,
    );
    return {
      ...EMPTY_FRAME,
      position: state.positionX,
      velocity: state.speed,
      acceleration: -state.acceleration,
      netForce: -state.netForce,
      kineticEnergy: state.kineticEnergy,
      potentialEnergy: state.potentialEnergy,
      totalEnergy: state.kineticEnergy + state.potentialEnergy,
      positionX: state.positionX,
      positionY: state.positionY,
      velocityX: state.velocityX,
      velocityY: state.velocityY,
    };
  }

  if (scenario === "incline") {
    const state = inclineMotion(
      {
        angleDegrees: values.inclineAngle,
        friction: values.friction,
        mass: values.inclineMass,
        gravity: values.gravity,
      },
      time,
    );
    return {
      ...EMPTY_FRAME,
      position: state.position,
      velocity: state.velocity,
      acceleration: state.acceleration,
      netForce: state.netForce,
      kineticEnergy: state.kineticEnergy,
      totalEnergy: state.kineticEnergy,
      normalForce: state.normalForce,
      frictionForce: state.frictionForce,
    };
  }

  if (scenario === "pulley") {
    const state = atwoodMotion(
      {
        massA: values.pulleyMassA,
        massB: values.pulleyMassB,
        gravity: values.gravity,
      },
      time,
    );
    const isA = trackedObject === "A";
    const trackedMass = isA ? values.pulleyMassA : values.pulleyMassB;
    const direction = isA ? 1 : -1;
    return {
      ...EMPTY_FRAME,
      position: direction * state.displacement,
      velocity: direction * state.velocity,
      acceleration: direction * state.acceleration,
      netForce: direction * (isA ? state.netForceA : -state.netForceB),
      kineticEnergy: 0.5 * trackedMass * state.velocity ** 2,
      totalEnergy: state.kineticEnergy,
      displacement: state.displacement,
      tension: state.tension,
    };
  }

  if (scenario === "collision") {
    const bodyA = {
      position: 2,
      velocity: values.collisionVelocityA,
      mass: values.collisionMassA,
    };
    const bodyB = {
      position: 7.5,
      velocity: values.collisionVelocityB,
      mass: values.collisionMassB,
    };
    const closingSpeed = bodyA.velocity - bodyB.velocity;
    const impactTime = closingSpeed > 0 ? 4.5 / closingSpeed : Number.POSITIVE_INFINITY;
    const result = resolveBlockCollision(bodyA, bodyB, collisionMode);
    const afterImpact = time >= impactTime;
    const beforeTime = Math.min(time, impactTime);
    const timeAfter = afterImpact ? time - impactTime : 0;
    const positionA = bodyA.position + bodyA.velocity * beforeTime + result.velocityA * timeAfter;
    const positionB = bodyB.position + bodyB.velocity * beforeTime + result.velocityB * timeAfter;
    const velocityA = afterImpact ? result.velocityA : bodyA.velocity;
    const velocityB = afterImpact ? result.velocityB : bodyB.velocity;
    const isA = trackedObject === "A";
    const mass = isA ? bodyA.mass : bodyB.mass;
    const velocity = isA ? velocityA : velocityB;
    const position = isA ? positionA : positionB;
    return {
      ...EMPTY_FRAME,
      position,
      velocity,
      kineticEnergy: 0.5 * mass * velocity ** 2,
      totalEnergy:
        0.5 * bodyA.mass * velocityA ** 2 + 0.5 * bodyB.mass * velocityB ** 2,
      bodyAPosition: positionA,
      bodyBPosition: positionB,
      velocityX: velocityA,
      velocityY: velocityB,
      secondaryVelocity: isA ? velocityB : velocityA,
      impactTime,
      collisionHappened: afterImpact,
      joined: afterImpact && result.joined,
    };
  }

  const state = springMotion(
    {
      mass: values.springMass,
      springConstant: values.springConstant,
      amplitude: values.amplitude,
    },
    time,
  );
  return {
    ...EMPTY_FRAME,
    position: state.position,
    velocity: state.velocity,
    acceleration: state.acceleration,
    netForce: state.netForce,
    kineticEnergy: state.kineticEnergy,
    potentialEnergy: state.potentialEnergy,
    totalEnergy: state.totalEnergy,
    springForce: state.springForce,
  };
}

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="range-control" htmlFor={id}>
      <span className="range-label">
        <span>{label}</span>
        <output htmlFor={id}>{value.toFixed(step < 0.1 ? 2 : 1)} {unit}</output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--range-progress": `${progress}%` } as CSSProperties}
      />
      <span className="range-bounds" aria-hidden="true">
        <span>{min}</span><span>{max}</span>
      </span>
    </label>
  );
}

function ScenarioControls({
  scenario,
  values,
  collisionMode,
  updateValue,
  setCollisionMode,
}: {
  scenario: ScenarioId;
  values: LabValues;
  collisionMode: CollisionMode;
  updateValue: (key: keyof LabValues, value: number) => void;
  setCollisionMode: (mode: CollisionMode) => void;
}) {
  if (scenario === "projectile") {
    return (
      <>
        <RangeControl id="launch-speed" label="Launch speed" value={values.projectileSpeed} min={4} max={30} step={0.5} unit="m/s" onChange={(value) => updateValue("projectileSpeed", value)} />
        <RangeControl id="launch-angle" label="Launch angle" value={values.projectileAngle} min={10} max={80} step={1} unit="°" onChange={(value) => updateValue("projectileAngle", value)} />
        <RangeControl id="projectile-mass" label="Object mass" value={values.projectileMass} min={0.5} max={8} step={0.5} unit="kg" onChange={(value) => updateValue("projectileMass", value)} />
      </>
    );
  }

  if (scenario === "incline") {
    return (
      <>
        <RangeControl id="incline-angle" label="Ramp angle" value={values.inclineAngle} min={10} max={50} step={1} unit="°" onChange={(value) => updateValue("inclineAngle", value)} />
        <RangeControl id="incline-mass" label="Block mass" value={values.inclineMass} min={1} max={10} step={0.5} unit="kg" onChange={(value) => updateValue("inclineMass", value)} />
        <RangeControl id="friction" label="Kinetic friction μ" value={values.friction} min={0} max={0.6} step={0.01} unit="" onChange={(value) => updateValue("friction", value)} />
      </>
    );
  }

  if (scenario === "pulley") {
    return (
      <>
        <RangeControl id="pulley-mass-a" label="Mass A" value={values.pulleyMassA} min={1} max={10} step={0.5} unit="kg" onChange={(value) => updateValue("pulleyMassA", value)} />
        <RangeControl id="pulley-mass-b" label="Mass B" value={values.pulleyMassB} min={1} max={10} step={0.5} unit="kg" onChange={(value) => updateValue("pulleyMassB", value)} />
      </>
    );
  }

  if (scenario === "collision") {
    return (
      <>
        <fieldset className="toggle-fieldset">
          <legend>Impact type</legend>
          <div className="toggle-group">
            {(["elastic", "inelastic"] as CollisionMode[]).map((mode) => (
              <label key={mode}>
                <input type="radio" name="collision-mode" checked={collisionMode === mode} onChange={() => setCollisionMode(mode)} />
                <span>{mode === "elastic" ? "Elastic" : "Stick together"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <RangeControl id="collision-mass-a" label="Mass A" value={values.collisionMassA} min={1} max={10} step={0.5} unit="kg" onChange={(value) => updateValue("collisionMassA", value)} />
        <RangeControl id="collision-velocity-a" label="Velocity A" value={values.collisionVelocityA} min={0.5} max={8} step={0.5} unit="m/s" onChange={(value) => updateValue("collisionVelocityA", value)} />
        <RangeControl id="collision-mass-b" label="Mass B" value={values.collisionMassB} min={1} max={10} step={0.5} unit="kg" onChange={(value) => updateValue("collisionMassB", value)} />
        <RangeControl id="collision-velocity-b" label="Velocity B" value={values.collisionVelocityB} min={-3} max={3} step={0.5} unit="m/s" onChange={(value) => updateValue("collisionVelocityB", value)} />
      </>
    );
  }

  return (
    <>
      <RangeControl id="spring-mass" label="Block mass" value={values.springMass} min={0.5} max={8} step={0.5} unit="kg" onChange={(value) => updateValue("springMass", value)} />
      <RangeControl id="spring-k" label="Spring constant" value={values.springConstant} min={5} max={50} step={1} unit="N/m" onChange={(value) => updateValue("springConstant", value)} />
      <RangeControl id="spring-amplitude" label="Amplitude" value={values.amplitude} min={0.4} max={2.2} step={0.1} unit="m" onChange={(value) => updateValue("amplitude", value)} />
    </>
  );
}

function MotionLegend() {
  return (
    <div className="motion-legend" aria-hidden="true">
      <span><i className="legend-current" /> current</span>
      <span><i className="legend-trail" /> past position</span>
      <span><i className="legend-vector" /> velocity</span>
    </div>
  );
}

function WorldScene({
  scenario,
  values,
  frame,
  time,
}: {
  scenario: ScenarioId;
  values: LabValues;
  frame: Frame;
  time: number;
}) {
  if (scenario === "projectile") {
    const duration = getDuration(scenario, values);
    const finalState = projectileMotion({ speed: values.projectileSpeed, angleDegrees: values.projectileAngle, mass: values.projectileMass, gravity: values.gravity }, duration);
    const apex = projectileMotion({ speed: values.projectileSpeed, angleDegrees: values.projectileAngle, mass: values.projectileMass, gravity: values.gravity }, duration / 2);
    const xPercent = 8 + (frame.positionX / Math.max(finalState.positionX, 1)) * 84;
    const yPercent = 15 + (frame.positionY / Math.max(apex.positionY, 1)) * 60;
    const velocityAngle = (Math.atan2(-frame.velocityY, frame.velocityX) * 180) / Math.PI;
    const arrowLength = clamp(frame.velocity * 3.2, 44, 82);
    const trailTimes = Array.from({ length: 7 }, (_, index) => (time * index) / 7);
    return (
      <div className="world projectile-world" role="img" aria-label="Projectile moving through a two-dimensional coordinate plane">
        <div className="world-grid" />
        <MotionLegend />
        <div className="ground-line"><span>0 m</span><span>{finalState.positionX.toFixed(1)} m</span></div>
        <div className="launcher" style={{ "--launch-angle": `${-values.projectileAngle}deg` } as CSSProperties} />
        <div className="apex-marker" style={{ left: "50%", bottom: "75%" }}><i /><span>apex · vᵧ = 0</span></div>
        {trailTimes.map((trailTime, index) => {
          const trail = projectileMotion({ speed: values.projectileSpeed, angleDegrees: values.projectileAngle, mass: values.projectileMass, gravity: values.gravity }, trailTime);
          return <i key={index} className="trail-dot" style={{ left: `${8 + (trail.positionX / Math.max(finalState.positionX, 1)) * 84}%`, bottom: `${15 + (trail.positionY / Math.max(apex.positionY, 1)) * 60}%`, opacity: 0.15 + index * 0.08 }} />;
        })}
        <div className="projectile-object" style={{ left: `${xPercent}%`, bottom: `${yPercent}%` }}><span>m</span></div>
        <div className="motion-arrow projectile-velocity" style={{ left: `${xPercent}%`, bottom: `${yPercent}%`, "--arrow-angle": `${velocityAngle}deg`, "--arrow-length": `${arrowLength}px`, "--arrow-counter-angle": `${-velocityAngle}deg` } as CSSProperties}><span>{frame.velocity.toFixed(1)} m/s</span></div>
        <div className="gravity-tag">g = 9.81 m/s² ↓</div>
      </div>
    );
  }

  if (scenario === "incline") {
    const distance = Math.min(frame.position, 6);
    const progress = clamp(distance / 6, 0, 1);
    return (
      <div className="world incline-world" role="img" aria-label="Block sliding down an inclined plane">
        <div className="world-grid" />
        <MotionLegend />
        <div className="incline-rig" style={{ "--ramp-angle": `${-values.inclineAngle}deg` } as CSSProperties}>
          <div className="ramp-surface" />
          {progress > 0.02 && Array.from({ length: 5 }, (_, index) => (
            <i key={index} className="incline-ghost" style={{ left: `${82 - progress * (index / 5) * 76}%`, opacity: 0.12 + index * 0.08 }} />
          ))}
          <div className="incline-block" style={{ left: `${82 - progress * 76}%` }}><span>m</span></div>
          <span className="ramp-distance ramp-start">0 m</span><span className="ramp-distance ramp-end">6 m</span>
        </div>
        <div className="angle-marker">θ = {values.inclineAngle.toFixed(0)}°</div>
        <div className="surface-tag">μₖ = {values.friction.toFixed(2)}</div>
        <div className="slope-direction">← downhill <strong>{frame.velocity.toFixed(1)} m/s</strong></div>
      </div>
    );
  }

  if (scenario === "pulley") {
    const offset = clamp(frame.displacement * 35, -88, 88);
    const massBMovesDown = values.pulleyMassB >= values.pulleyMassA;
    const speed = Math.abs(frame.velocity);
    return (
      <div className="world pulley-world" role="img" aria-label="Two masses connected over an ideal pulley">
        <MotionLegend />
        <div className="pulley-support" />
        <div className="pulley-wheel"><i /><span>ideal pulley</span></div>
        <div className="pulley-rope rope-a" style={{ height: `${132 - offset}px` }} />
        <div className="pulley-rope rope-b" style={{ height: `${132 + offset}px` }} />
        <div className="hanging-ghost ghost-a" /><div className="hanging-ghost ghost-b" />
        <div className="hanging-block block-a" style={{ top: `${250 - offset}px` }}><strong>A</strong><span>{values.pulleyMassA.toFixed(1)} kg</span></div>
        <div className="hanging-block block-b" style={{ top: `${250 + offset}px` }}><strong>B</strong><span>{values.pulleyMassB.toFixed(1)} kg</span></div>
        <div className={`pulley-direction direction-a ${massBMovesDown ? "up" : "down"}`}><strong>{massBMovesDown ? "↑" : "↓"}</strong><span>A · {speed.toFixed(1)} m/s</span></div>
        <div className={`pulley-direction direction-b ${massBMovesDown ? "down" : "up"}`}><strong>{massBMovesDown ? "↓" : "↑"}</strong><span>B · {speed.toFixed(1)} m/s</span></div>
        {Math.abs(values.pulleyMassA - values.pulleyMassB) < 0.01 && <div className="balanced-tag">balanced · a = 0</div>}
      </div>
    );
  }

  if (scenario === "collision") {
    const positionA = clamp(5 + (frame.bodyAPosition / 12) * 90, -8, 105);
    const positionB = clamp(5 + (frame.bodyBPosition / 12) * 90, -8, 105);
    return (
      <div className="world collision-world" role="img" aria-label="Two blocks moving on a frictionless twelve meter track">
        <div className="world-grid" />
        <MotionLegend />
        <div className="collision-track"><span>0</span><span>6 m</span><span>12 m</span></div>
        <div className="collision-ghost ghost-a" /><div className="collision-ghost ghost-b" />
        <div className={`collision-block block-a ${frame.joined ? "joined-a" : ""}`} style={{ left: `${positionA}%` }}><span className={`block-velocity ${frame.velocityX < 0 ? "left" : "right"}`}>{frame.velocityX < 0 ? "←" : "→"} {Math.abs(frame.velocityX).toFixed(1)} m/s</span><strong>A</strong></div>
        <div className={`collision-block block-b ${frame.joined ? "joined-b" : ""}`} style={{ left: `${positionB}%` }}><span className={`block-velocity ${frame.velocityY < 0 ? "left" : "right"}`}>{frame.velocityY < 0 ? "←" : "→"} {Math.abs(frame.velocityY).toFixed(1)} m/s</span><strong>B</strong></div>
        {frame.collisionHappened && <div className="impact-tag">momentum transferred</div>}
      </div>
    );
  }

  const xPercent = 50 + (frame.position / Math.max(values.amplitude, 0.1)) * 24;
  return (
    <div className="world spring-world" role="img" aria-label="Mass oscillating horizontally on an ideal spring">
      <div className="world-grid" />
      <MotionLegend />
      <div className="spring-wall" />
      <div className="amplitude-zone"><span>−A</span><span>+A</span></div>
      <div className="equilibrium-line"><span>x = 0</span></div>
      <div className="spring-coil" style={{ width: `calc(${xPercent}% - 8%)` }} />
      <div className="spring-ghost ghost-left" /><div className="spring-ghost ghost-right" />
      <div className="spring-block" style={{ left: `${xPercent}%` }}><span>m</span><i className={`spring-velocity ${frame.velocity < 0 ? "left" : "right"}`}>{Math.abs(frame.velocity) < 0.05 ? "turning point" : `${frame.velocity < 0 ? "←" : "→"} ${Math.abs(frame.velocity).toFixed(1)} m/s`}</i></div>
      <div className="spring-track" />
      <div className="spring-tag">k = {values.springConstant.toFixed(0)} N/m</div>
    </div>
  );
}

function GraphCanvas({
  samples,
  metric,
  currentTime,
  duration,
}: {
  samples: Array<{ time: number; position: number; velocity: number; acceleration: number }>;
  metric: GraphMetric;
  currentTime: number;
  duration: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const graphScale = useMemo(() => getFixedGraphScale(samples, metric), [samples, metric]);
  const defaultView = useMemo(() => ({
    xCenter: duration / 2,
    xSpan: Math.max(duration * 1.16, 0.5),
    yCenter: (graphScale.min + graphScale.max) / 2,
    ySpan: Math.max((graphScale.max - graphScale.min) * 1.16, 0.5),
  }), [duration, graphScale]);
  const [view, setView] = useState(defaultView);
  const [dragging, setDragging] = useState(false);
  const panRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    view: typeof defaultView;
  } | null>(null);

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
      const padding = { top: 22, right: 22, bottom: 38, left: 58 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const visibleSamples = revealGraphSamples(samples, metric, currentTime);
      const xMin = view.xCenter - view.xSpan / 2;
      const xMax = view.xCenter + view.xSpan / 2;
      const yMin = view.yCenter - view.ySpan / 2;
      const yMax = view.yCenter + view.ySpan / 2;
      const xStep = getGraphGridStep(view.xSpan, 11);
      const yStep = getGraphGridStep(view.ySpan, 9);
      const toX = (value: number) => padding.left + ((value - xMin) / view.xSpan) * plotWidth;
      const toY = (value: number) => padding.top + ((yMax - value) / view.ySpan) * plotHeight;
      const rootStyles = getComputedStyle(document.documentElement);
      const ink = rootStyles.getPropertyValue("--ink").trim() || "#14201f";
      const muted = rootStyles.getPropertyValue("--muted").trim() || "#65706d";
      const line = rootStyles.getPropertyValue("--line").trim() || "#c9cec8";
      const orange = rootStyles.getPropertyValue("--orange").trim() || "#ed5a32";
      const green = rootStyles.getPropertyValue("--green").trim() || "#1a4b43";
      const surface = rootStyles.getPropertyValue("--surface-strong").trim() || "#ffffff";
      const formatTick = (value: number, step: number) => {
        const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0;
        const clean = Math.abs(value) < step / 100 ? 0 : value;
        return clean.toFixed(decimals);
      };

      context.fillStyle = surface;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = line;
      context.lineWidth = 1;
      context.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillStyle = muted;
      context.textBaseline = "middle";

      const xLabelY = clamp(toY(0) + 16, padding.top + 14, height - padding.bottom + 20);
      const yLabelX = clamp(toX(0) + 7, padding.left + 5, width - padding.right - 38);
      const firstX = Math.ceil(xMin / xStep) * xStep;
      for (let value = firstX; value <= xMax + xStep / 2; value += xStep) {
        const x = toX(value);
        context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, padding.top + plotHeight); context.stroke();
        context.fillText(formatTick(value, xStep), x + 3, xLabelY);
      }
      const firstY = Math.ceil(yMin / yStep) * yStep;
      for (let value = firstY; value <= yMax + yStep / 2; value += yStep) {
        const y = toY(value);
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(padding.left + plotWidth, y); context.stroke();
        context.fillText(formatTick(value, yStep), yLabelX, y - 9);
      }

      context.strokeStyle = ink;
      context.lineWidth = 1.5;
      if (xMin <= 0 && xMax >= 0) {
        const zeroX = toX(0);
        context.beginPath(); context.moveTo(zeroX, padding.top); context.lineTo(zeroX, padding.top + plotHeight); context.stroke();
      }
      if (yMin <= 0 && yMax >= 0) {
        const zeroY = toY(0);
        context.beginPath(); context.moveTo(padding.left, zeroY); context.lineTo(padding.left + plotWidth, zeroY); context.stroke();
      }

      context.save();
      context.beginPath();
      context.rect(padding.left, padding.top, plotWidth, plotHeight);
      context.clip();
      context.strokeStyle = orange;
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.beginPath();
      visibleSamples.forEach((sample, index) => {
        const x = toX(sample.time);
        const y = toY(sample.value);
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();

      const currentPoint = visibleSamples.at(-1);
      if (currentPoint) {
        const pointX = toX(currentPoint.time);
        const pointY = toY(currentPoint.value);
        context.fillStyle = orange;
        context.beginPath(); context.arc(pointX, pointY, 4, 0, Math.PI * 2); context.fill();
      }

      const markerX = toX(currentTime);
      context.strokeStyle = green;
      context.lineWidth = 2;
      context.setLineDash([5, 5]);
      context.beginPath(); context.moveTo(markerX, padding.top); context.lineTo(markerX, padding.top + plotHeight); context.stroke();
      context.setLineDash([]);
      context.restore();

      context.fillStyle = ink;
      context.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textBaseline = "alphabetic";
      context.fillText("time (s)", width - 78, height - 10);
      context.save();
      context.translate(14, 94);
      context.rotate(-Math.PI / 2);
      context.fillText(metric, 0, 0);
      context.restore();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [samples, metric, currentTime, view]);

  const zoomGraph = (factor: number, xRatio = 0.5, yRatio = 0.5) => {
    setView((current) => {
      const nextXSpan = clamp(current.xSpan * factor, defaultView.xSpan * 0.04, defaultView.xSpan * 30);
      const nextYSpan = clamp(current.ySpan * factor, defaultView.ySpan * 0.04, defaultView.ySpan * 30);
      const focusX = current.xCenter + (xRatio - 0.5) * current.xSpan;
      const focusY = current.yCenter + (0.5 - yRatio) * current.ySpan;
      return {
        xCenter: focusX - (xRatio - 0.5) * nextXSpan,
        yCenter: focusY - (0.5 - yRatio) * nextYSpan,
        xSpan: nextXSpan,
        ySpan: nextYSpan,
      };
    });
  };

  const beginPan = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      view,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const panGraph = (event: PointerEvent<HTMLCanvasElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const plotWidth = Math.max(rect.width - 80, 1);
    const plotHeight = Math.max(rect.height - 60, 1);
    setView({
      ...pan.view,
      xCenter: pan.view.xCenter - ((event.clientX - pan.clientX) / plotWidth) * pan.view.xSpan,
      yCenter: pan.view.yCenter + ((event.clientY - pan.clientY) / plotHeight) * pan.view.ySpan,
    });
  };

  const endPan = (event: PointerEvent<HTMLCanvasElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
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

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`graph-canvas ${dragging ? "dragging" : ""}`}
        role="img"
        tabIndex={0}
        aria-label={`${metric} versus time interactive graph. Drag to pan, use the mouse wheel or buttons to zoom, and double click to reset.`}
        onPointerDown={beginPan}
        onPointerMove={panGraph}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onWheel={wheelZoom}
        onDoubleClick={() => setView(defaultView)}
        onKeyDown={(event) => {
          const direction = event.shiftKey ? 0.03 : 0.1;
          if (event.key === "ArrowLeft") setView((current) => ({ ...current, xCenter: current.xCenter - current.xSpan * direction }));
          else if (event.key === "ArrowRight") setView((current) => ({ ...current, xCenter: current.xCenter + current.xSpan * direction }));
          else if (event.key === "ArrowUp") setView((current) => ({ ...current, yCenter: current.yCenter + current.ySpan * direction }));
          else if (event.key === "ArrowDown") setView((current) => ({ ...current, yCenter: current.yCenter - current.ySpan * direction }));
          else return;
          event.preventDefault();
        }}
      />
      <div className="graph-zoom-controls" aria-label="Graph zoom controls">
        <button type="button" onClick={() => zoomGraph(0.75)} aria-label="Zoom graph in">＋</button>
        <button type="button" onClick={() => zoomGraph(1 / 0.75)} aria-label="Zoom graph out">−</button>
        <button type="button" onClick={() => setView(defaultView)} aria-label="Reset graph view">⌂</button>
      </div>
    </>
  );
}

function Vector({ label, angle, tone = "green" }: { label: string; angle: number; tone?: "green" | "orange" | "blue" }) {
  return (
    <div className={`vector vector-${tone}`} style={{ "--vector-angle": `${angle}deg`, "--counter-angle": `${-angle}deg` } as CSSProperties}>
      <span>{label}</span>
    </div>
  );
}

function ForceDiagram({
  scenario,
  values,
  frame,
  trackedObject,
  time,
}: {
  scenario: ScenarioId;
  values: LabValues;
  frame: Frame;
  trackedObject: TrackedObject;
  time: number;
}) {
  return (
    <div className="fbd" role="img" aria-label={`Free-body diagram for ${scenario === "pulley" || scenario === "collision" ? `object ${trackedObject}` : "the tracked object"}`}>
      <div className="fbd-grid" />
      <div className="fbd-body">{scenario === "pulley" || scenario === "collision" ? trackedObject : "m"}</div>
      {scenario === "projectile" && <Vector label={`Fg ${(values.projectileMass * values.gravity).toFixed(1)} N`} angle={90} tone="orange" />}
      {scenario === "incline" && <><Vector label="Fg" angle={90} tone="orange" /><Vector label={`N ${frame.normalForce.toFixed(1)} N`} angle={values.inclineAngle - 90} /><Vector label={`fₖ ${frame.frictionForce.toFixed(1)} N`} angle={180 - values.inclineAngle} tone="blue" /></>}
      {scenario === "pulley" && <><Vector label={`T ${frame.tension.toFixed(1)} N`} angle={-90} /><Vector label={`Fg ${((trackedObject === "A" ? values.pulleyMassA : values.pulleyMassB) * values.gravity).toFixed(1)} N`} angle={90} tone="orange" /></>}
      {scenario === "collision" && frame.collisionHappened && Math.abs(time - frame.impactTime) < 0.16 && <Vector label="impulse" angle={trackedObject === "A" ? 180 : 0} tone="orange" />}
      {scenario === "spring" && <Vector label={`Fs ${Math.abs(frame.springForce).toFixed(1)} N`} angle={frame.springForce >= 0 ? 0 : 180} tone="blue" />}
      {scenario === "collision" && <p className="fbd-note">Between impacts, net force is zero. The contact force acts over a very short impact interval.</p>}
    </div>
  );
}

function StatsPanel({ scenario, frame }: { scenario: ScenarioId; frame: Frame }) {
  const rows = scenario === "projectile"
    ? [
        ["Horizontal position", formatValue(frame.positionX, "m")],
        ["Height", formatValue(frame.positionY, "m")],
        ["Velocity x", formatValue(frame.velocityX, "m/s", true)],
        ["Velocity y", formatValue(frame.velocityY, "m/s", true)],
        ["Net force y", formatValue(frame.netForce, "N", true)],
        ["Total energy", formatValue(frame.totalEnergy, "J")],
      ]
    : [
        ["Position", formatValue(frame.position, "m", true)],
        ["Velocity", formatValue(frame.velocity, "m/s", true)],
        ["Acceleration", formatValue(frame.acceleration, "m/s²", true)],
        ["Net force", scenario === "collision" ? "0 N between impacts" : formatValue(frame.netForce, "N", true)],
        ["Kinetic energy", formatValue(frame.kineticEnergy, "J")],
        ["Total energy", formatValue(frame.totalEnergy, "J")],
      ];

  return (
    <dl className="stats-list">
      {rows.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

export default function Home() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("guided");
  const [scenario, setScenario] = useState<ScenarioId>("projectile");
  const [values, setValues] = useState<LabValues>(INITIAL_VALUES);
  const [collisionMode, setCollisionModeState] = useState<CollisionMode>("elastic");
  const [trackedObject, setTrackedObject] = useState<TrackedObject>("A");
  const [runState, setRunState] = useState<RunState>("ready");
  const [viewMode, setViewMode] = useState<ViewMode>("motion");
  const [graphMetric, setGraphMetric] = useState<GraphMetric>("position");
  const [time, setTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(0.5);
  const lastFrameRef = useRef<number | null>(null);

  const definition = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0];
  const duration = useMemo(() => getDuration(scenario, values), [scenario, values]);
  const frame = useMemo(() => computeFrame(scenario, values, time, trackedObject, collisionMode), [scenario, values, time, trackedObject, collisionMode]);
  const samples = useMemo(() => Array.from({ length: 121 }, (_, index) => {
    const sampleTime = (duration * index) / 120;
    const sample = computeFrame(scenario, values, sampleTime, trackedObject, collisionMode);
    return { time: sampleTime, position: sample.position, velocity: sample.velocity, acceleration: sample.acceleration };
  }), [scenario, values, duration, trackedObject, collisionMode]);

  useEffect(() => {
    if (runState !== "running") {
      lastFrameRef.current = null;
      return;
    }
    let animationFrame = 0;
    const animate = (timestamp: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = timestamp;
      const delta = Math.min((timestamp - lastFrameRef.current) / 1000, 0.05);
      lastFrameRef.current = timestamp;
      setTime((current) => {
        const next = current + delta * playbackSpeed;
        if (next >= duration) {
          setRunState("complete");
          return duration;
        }
        return next;
      });
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [runState, duration, playbackSpeed]);

  const reset = () => {
    setTime(0);
    setRunState("ready");
  };

  const updateValue = (key: keyof LabValues, value: number) => {
    setValues((current) => ({ ...current, [key]: value }));
    reset();
  };

  const chooseScenario = (nextScenario: ScenarioId) => {
    setScenario(nextScenario);
    setTrackedObject("A");
    setViewMode("motion");
    reset();
  };

  const setCollisionMode = (mode: CollisionMode) => {
    setCollisionModeState(mode);
    reset();
  };

  const togglePlayback = () => {
    if (runState === "running") {
      setRunState("paused");
      return;
    }
    if (runState === "complete") setTime(0);
    setRunState("running");
  };

  const scrub = (nextTime: number) => {
    setTime(nextTime);
    setRunState(nextTime >= duration ? "complete" : "paused");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Motion Lab home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>MOTION<strong>LAB</strong></span>
        </a>
        <div className="topbar-note"><span /> AP Physics 1</div>
      </header>

      <div className="workspace-mode" id="workspace" role="group" aria-label="Workspace mode">
        <button type="button" className={workspaceMode === "guided" ? "active" : ""} onClick={() => setWorkspaceMode("guided")} aria-pressed={workspaceMode === "guided"}><span>01—05</span><strong>Guided experiments</strong><small>Preset AP Physics scenarios</small></button>
        <button type="button" className={workspaceMode === "sandbox" ? "active" : ""} onClick={() => { setWorkspaceMode("sandbox"); setRunState("paused"); }} aria-pressed={workspaceMode === "sandbox"}><span>∞</span><strong>Sandbox mode</strong><small>Drag, connect, and build freely</small></button>
      </div>

      {workspaceMode === "guided" ? (
        <>
          <nav className="scenario-nav" aria-label="Physics scenarios">
            {SCENARIOS.map((item) => (
              <button key={item.id} type="button" className={scenario === item.id ? "active" : ""} onClick={() => chooseScenario(item.id)} aria-pressed={scenario === item.id}>
                <span>{item.number}</span><strong>{item.shortName}</strong><small>{item.name}</small>
              </button>
            ))}
          </nav>

          <section className={`lab ${viewMode === "graphs" ? "graph-mode" : ""}`} id="lab">
        <aside className="setup-panel">
          <div className="section-heading"><span>Experiment setup</span><strong>{definition.number}</strong></div>
          <h2>{definition.name}</h2>
          <p className="panel-description">{definition.description}</p>
          <div className="control-stack">
            <ScenarioControls scenario={scenario} values={values} collisionMode={collisionMode} updateValue={updateValue} setCollisionMode={setCollisionMode} />
          </div>
          <button className="reset-link" type="button" onClick={reset}>↺ Reset current experiment</button>
        </aside>

        <section className="simulation-panel" aria-label="Interactive simulation">
          <div className="simulator-header">
            <div className="view-tabs" role="group" aria-label="Simulation view">
              <button type="button" className={viewMode === "motion" ? "active" : ""} onClick={() => setViewMode("motion")}>Motion</button>
              <button type="button" className={viewMode === "graphs" ? "active" : ""} onClick={() => setViewMode("graphs")}>Graphs</button>
            </div>
            <div className={`run-status ${runState}`}><i />{runState}</div>
          </div>

          {viewMode === "motion" ? (
            <WorldScene scenario={scenario} values={values} frame={frame} time={time} />
          ) : (
            <div className="graph-view">
              <div className="graph-header">
                <div>
                  <span>Live graph</span>
                  <strong>{graphMetric} / time</strong>
                  <small>Drag to pan · wheel to zoom · drag the lower edge to resize</small>
                </div>
                <div className="metric-tabs" role="group" aria-label="Graph quantity">
                  {(["position", "velocity", "acceleration"] as GraphMetric[]).map((metric) => (
                    <button key={metric} type="button" className={graphMetric === metric ? "active" : ""} onClick={() => setGraphMetric(metric)}>{metric.charAt(0).toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <GraphCanvas key={`${scenario}-${graphMetric}-${duration.toFixed(4)}`} samples={samples} metric={graphMetric} currentTime={time} duration={duration} />
              <div className="graph-legend"><span><i /> revealed motion</span><span><i /> current moment</span></div>
            </div>
          )}

          <div className="timeline-panel">
            <div className="time-readout"><span>Time</span><strong>{time.toFixed(2)} s</strong><small>/ {duration.toFixed(2)} s</small></div>
            <input aria-label="Simulation timeline" type="range" min={0} max={duration} step={duration / 240} value={time} onChange={(event) => scrub(Number(event.target.value))} style={{ "--range-progress": `${(time / duration) * 100}%` } as CSSProperties} />
            <div className="playback-row">
              <button className="step-button" type="button" onClick={() => scrub(clamp(time - duration / 100, 0, duration))} aria-label="Step backward">−1</button>
              <button className="play-button" type="button" onClick={togglePlayback}>{runState === "running" ? "Ⅱ Pause" : runState === "paused" ? "▶ Resume" : "▶ Run experiment"}</button>
              <button className="step-button" type="button" onClick={() => scrub(clamp(time + duration / 100, 0, duration))} aria-label="Step forward">+1</button>
              <div className="speed-buttons" role="group" aria-label="Playback speed">
                <span>Speed</span>
                {[0.5, 1, 2].map((speed) => <button key={speed} type="button" className={playbackSpeed === speed ? "active" : ""} onClick={() => setPlaybackSpeed(speed)} aria-pressed={playbackSpeed === speed}>{speed}×</button>)}
              </div>
            </div>
          </div>
          <p className="principle-note"><span>What to notice</span>{definition.principle}</p>
        </section>

        <aside className="analysis-panel">
          <div className="section-heading"><span>Live analysis</span><strong>{time.toFixed(2)}s</strong></div>
          {(scenario === "pulley" || scenario === "collision") && (
            <div className="object-toggle" role="group" aria-label="Tracked object">
              {(["A", "B"] as TrackedObject[]).map((object) => <button key={object} type="button" className={trackedObject === object ? "active" : ""} onClick={() => setTrackedObject(object)}>Object {object}</button>)}
            </div>
          )}
          <StatsPanel scenario={scenario} frame={frame} />
          <div className="fbd-heading"><span>Free-body diagram</span><small>{runState === "running" ? "Pause to inspect" : "Live snapshot"}</small></div>
          <ForceDiagram scenario={scenario} values={values} frame={frame} trackedObject={trackedObject} time={time} />
        </aside>
          </section>

        </>
      ) : (
        <SandboxLab />
      )}

      <footer>
        <span>MOTIONLAB · CAPSTONE PROTOTYPE</span>
        <p>Idealized AP Physics 1 models · no air resistance unless specified</p>
        <span>5 EXPERIMENTS + 1 SANDBOX</span>
      </footer>
      <p className="sr-only" aria-live="polite">Simulation {runState} at {time.toFixed(2)} seconds.</p>
    </main>
  );
}
