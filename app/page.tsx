"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  atwoodMotion,
  inclineMotion,
  projectileMotion,
  resolveBlockCollision,
  springMotion,
} from "./physics.mjs";
import { getFixedGraphScale, revealGraphSamples } from "./graph.mjs";
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

interface LabSnapshot {
  id: string;
  scenario: ScenarioId;
  scenarioName: string;
  time: number;
  trackedObject: TrackedObject;
  values: LabValues;
  collisionMode: CollisionMode;
  frame: Frame;
}

interface SnapshotMetric {
  label: string;
  value: number;
  unit: string;
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
      const padding = { top: 28, right: 24, bottom: 38, left: 56 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const { min, max } = getFixedGraphScale(samples, metric);
      const visibleSamples = revealGraphSamples(samples, metric, currentTime);

      context.clearRect(0, 0, width, height);
      context.strokeStyle = "rgba(20, 32, 31, 0.12)";
      context.lineWidth = 1;
      for (let index = 0; index <= 5; index += 1) {
        const x = padding.left + (plotWidth * index) / 5;
        context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, padding.top + plotHeight); context.stroke();
      }
      for (let index = 0; index <= 4; index += 1) {
        const y = padding.top + (plotHeight * index) / 4;
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(padding.left + plotWidth, y); context.stroke();
      }

      const zeroY = padding.top + ((max - 0) / (max - min)) * plotHeight;
      context.strokeStyle = "rgba(20, 32, 31, 0.55)";
      context.beginPath(); context.moveTo(padding.left, zeroY); context.lineTo(padding.left + plotWidth, zeroY); context.stroke();

      context.strokeStyle = "#ed5a32";
      context.lineWidth = 3;
      context.lineJoin = "round";
      context.beginPath();
      visibleSamples.forEach((sample, index) => {
        const x = padding.left + (sample.time / duration) * plotWidth;
        const y = padding.top + ((max - sample.value) / (max - min)) * plotHeight;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();

      const currentPoint = visibleSamples.at(-1);
      if (currentPoint) {
        const pointX = padding.left + (currentPoint.time / duration) * plotWidth;
        const pointY = padding.top + ((max - currentPoint.value) / (max - min)) * plotHeight;
        context.fillStyle = "#ed5a32";
        context.beginPath(); context.arc(pointX, pointY, 4, 0, Math.PI * 2); context.fill();
      }

      const markerX = padding.left + (currentTime / duration) * plotWidth;
      context.strokeStyle = "#1a4b43";
      context.lineWidth = 2;
      context.setLineDash([5, 5]);
      context.beginPath(); context.moveTo(markerX, padding.top); context.lineTo(markerX, padding.top + plotHeight); context.stroke();
      context.setLineDash([]);

      context.fillStyle = "#14201f";
      context.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.fillText(`${max.toFixed(1)}`, 10, padding.top + 4);
      context.fillText(`${min.toFixed(1)}`, 10, padding.top + plotHeight);
      context.fillText("0 s", padding.left, height - 12);
      context.fillText(`${duration.toFixed(1)} s`, width - 62, height - 12);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [samples, metric, currentTime, duration]);

  return <canvas ref={canvasRef} className="graph-canvas" role="img" aria-label={`${metric} versus time graph drawn through ${currentTime.toFixed(2)} seconds on a fixed full-experiment scale`} />;
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

function getSnapshotMetrics(snapshot: LabSnapshot): SnapshotMetric[] {
  const { frame, scenario } = snapshot;
  return [
    {
      label: scenario === "projectile" ? "Horizontal position" : "Position",
      value: scenario === "projectile" ? frame.positionX : frame.position,
      unit: "m",
    },
    {
      label: scenario === "projectile" ? "Speed" : "Velocity",
      value: frame.velocity,
      unit: "m/s",
    },
    {
      label: "Acceleration",
      value: frame.acceleration,
      unit: "m/s²",
    },
    {
      label: "Net force",
      value: frame.netForce,
      unit: "N",
    },
    {
      label: "Total energy",
      value: frame.totalEnergy,
      unit: "J",
    },
  ];
}

function LabNotebook({
  snapshots,
  comparisonIds,
  onRestore,
  onRemove,
  onToggleComparison,
  onClear,
}: {
  snapshots: LabSnapshot[];
  comparisonIds: string[];
  onRestore: (snapshot: LabSnapshot) => void;
  onRemove: (id: string) => void;
  onToggleComparison: (id: string) => void;
  onClear: () => void;
}) {
  const comparison = comparisonIds
    .map((id) => snapshots.find((snapshot) => snapshot.id === id))
    .filter((snapshot): snapshot is LabSnapshot => Boolean(snapshot));
  const canCompare = comparison.length === 2 && comparison[0].scenario === comparison[1].scenario;
  const firstMetrics = canCompare ? getSnapshotMetrics(comparison[0]) : [];
  const secondMetrics = canCompare ? getSnapshotMetrics(comparison[1]) : [];

  return (
    <section className="lab-notebook" id="notebook" aria-labelledby="notebook-title">
      <div className="notebook-heading">
        <div>
          <p className="eyebrow">Saved evidence / up to 6 moments</p>
          <h2 id="notebook-title">Experiment notebook</h2>
        </div>
        <div className="notebook-actions">
          <span>{snapshots.length} captured</span>
          {snapshots.length > 0 && <button type="button" onClick={onClear}>Clear all</button>}
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="notebook-empty">
          <span aria-hidden="true">＋</span>
          <div><strong>No moments captured yet.</strong><p>Pause anywhere—or scrub to an exact time—then use “Capture this moment” in the analysis panel.</p></div>
        </div>
      ) : (
        <>
          <div className="snapshot-grid">
            {snapshots.map((snapshot, index) => {
              const metrics = getSnapshotMetrics(snapshot);
              const comparisonPosition = comparisonIds.indexOf(snapshot.id);
              return (
                <article className={`snapshot-card scenario-${snapshot.scenario}`} key={snapshot.id}>
                  <div className="snapshot-card-head">
                    <span>{snapshot.scenarioName}</span>
                    <button type="button" onClick={() => onRemove(snapshot.id)} aria-label={`Remove snapshot at ${snapshot.time.toFixed(2)} seconds`}>×</button>
                  </div>
                  <button className="snapshot-jump" type="button" onClick={() => onRestore(snapshot)}>
                    <small>Moment {snapshots.length - index}</small>
                    <strong>{snapshot.time.toFixed(2)}<em>s</em></strong>
                    <span>Jump to this moment →</span>
                  </button>
                  <dl className="snapshot-values">
                    {metrics.slice(0, 3).map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{formatValue(metric.value, metric.unit, true)}</dd></div>)}
                  </dl>
                  <div className="snapshot-card-foot">
                    <span>{snapshot.scenario === "pulley" || snapshot.scenario === "collision" ? `Object ${snapshot.trackedObject}` : "Tracked object"}</span>
                    <button type="button" className={comparisonPosition >= 0 ? "selected" : ""} onClick={() => onToggleComparison(snapshot.id)} aria-pressed={comparisonPosition >= 0}>
                      {comparisonPosition >= 0 ? `Compare ${comparisonPosition + 1}` : "Compare"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className={`comparison-panel ${canCompare ? "ready" : "waiting"}`}>
            <div className="comparison-intro">
              <span>Compare two moments</span>
              {canCompare ? (
                <><strong>{comparison[0].time.toFixed(2)}s → {comparison[1].time.toFixed(2)}s</strong><p>Change shown as Moment 2 minus Moment 1.</p></>
              ) : (
                <><strong>Select {comparison.length === 0 ? "two snapshots" : "one more snapshot"}</strong><p>Choose snapshots from the same experiment to reveal how its values changed.</p></>
              )}
            </div>
            {canCompare && (
              <dl className="comparison-values">
                <div><dt>Elapsed time</dt><dd>{formatValue(comparison[1].time - comparison[0].time, "s", true)}</dd></div>
                {firstMetrics.map((metric, index) => (
                  <div key={metric.label}><dt>Δ {metric.label}</dt><dd>{formatValue(secondMetrics[index].value - metric.value, metric.unit, true)}</dd></div>
                ))}
              </dl>
            )}
          </div>
        </>
      )}
    </section>
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
  const [snapshots, setSnapshots] = useState<LabSnapshot[]>([]);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("Experiment ready.");
  const lastFrameRef = useRef<number | null>(null);
  const snapshotCounterRef = useRef(1);

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

  const captureSnapshot = () => {
    const snapshot: LabSnapshot = {
      id: `snapshot-${snapshotCounterRef.current}`,
      scenario,
      scenarioName: definition.name,
      time,
      trackedObject,
      values: { ...values },
      collisionMode,
      frame: { ...frame },
    };
    snapshotCounterRef.current += 1;
    const previousSameScenario = snapshots.slice(0, 5).find((item) => item.scenario === scenario);
    setSnapshots((current) => [snapshot, ...current].slice(0, 6));
    setComparisonIds(previousSameScenario ? [previousSameScenario.id, snapshot.id] : [snapshot.id]);
    setRunState("paused");
    setAnnouncement(`${definition.name} moment captured at ${time.toFixed(2)} seconds.`);
  };

  const restoreSnapshot = (snapshot: LabSnapshot) => {
    setScenario(snapshot.scenario);
    setValues({ ...snapshot.values });
    setCollisionModeState(snapshot.collisionMode);
    setTrackedObject(snapshot.trackedObject);
    setTime(snapshot.time);
    setRunState("paused");
    setViewMode("motion");
    setAnnouncement(`${snapshot.scenarioName} restored at ${snapshot.time.toFixed(2)} seconds.`);
    document.getElementById("lab")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const removeSnapshot = (id: string) => {
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== id));
    setComparisonIds((current) => current.filter((snapshotId) => snapshotId !== id));
    setAnnouncement("Snapshot removed from the notebook.");
  };

  const toggleComparison = (id: string) => {
    const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === id);
    if (!selectedSnapshot) return;
    setComparisonIds((current) => {
      if (current.includes(id)) return current.filter((snapshotId) => snapshotId !== id);
      const sameScenario = current.filter((snapshotId) => snapshots.find((snapshot) => snapshot.id === snapshotId)?.scenario === selectedSnapshot.scenario);
      return [...sameScenario.slice(-1), id];
    });
  };

  const clearSnapshots = () => {
    setSnapshots([]);
    setComparisonIds([]);
    setAnnouncement("All notebook snapshots cleared.");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Motion Lab home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>MOTION<strong>LAB</strong></span>
        </a>
        <div className="topbar-note"><span /> AP Physics 1 · Mechanics prototype</div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Interactive physics workspace / prototype 02</p>
          <h1>See the forces<br /><em>behind the motion.</em></h1>
        </div>
        <p>Build a scenario, run time forward, and capture exact moments to compare the motion with forces, energy, and graphs.</p>
      </section>

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

          <section className="lab" id="lab">
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
                  <small>Fixed full-run scale · {Math.round((time / duration) * 100)}% drawn</small>
                </div>
                <div className="metric-tabs" role="group" aria-label="Graph quantity">
                  {(["position", "velocity", "acceleration"] as GraphMetric[]).map((metric) => (
                    <button key={metric} type="button" className={graphMetric === metric ? "active" : ""} onClick={() => setGraphMetric(metric)}>{metric.charAt(0).toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <GraphCanvas samples={samples} metric={graphMetric} currentTime={time} duration={duration} />
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
              <label className="speed-select">Speed<select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
            </div>
          </div>
          <p className="principle-note"><span>What to notice</span>{definition.principle}</p>
        </section>

        <aside className="analysis-panel">
          <div className="section-heading"><span>Snapshot analysis</span><strong>{time.toFixed(2)}s</strong></div>
          {(scenario === "pulley" || scenario === "collision") && (
            <div className="object-toggle" role="group" aria-label="Tracked object">
              {(["A", "B"] as TrackedObject[]).map((object) => <button key={object} type="button" className={trackedObject === object ? "active" : ""} onClick={() => setTrackedObject(object)}>Object {object}</button>)}
            </div>
          )}
          <StatsPanel scenario={scenario} frame={frame} />
          <button className="capture-button" type="button" onClick={captureSnapshot}>
            <span aria-hidden="true">＋</span>
            <span><strong>Capture this moment</strong><small>Save values at {time.toFixed(2)} s</small></span>
          </button>
          <div className="fbd-heading"><span>Free-body diagram</span><small>{runState === "running" ? "Pause to inspect" : "Live snapshot"}</small></div>
          <ForceDiagram scenario={scenario} values={values} frame={frame} trackedObject={trackedObject} time={time} />
        </aside>
          </section>

          <LabNotebook snapshots={snapshots} comparisonIds={comparisonIds} onRestore={restoreSnapshot} onRemove={removeSnapshot} onToggleComparison={toggleComparison} onClear={clearSnapshots} />
        </>
      ) : (
        <SandboxLab />
      )}

      <footer>
        <span>MOTIONLAB · CAPSTONE PROTOTYPE</span>
        <p>Idealized AP Physics 1 models · no air resistance unless specified</p>
        <span>5 EXPERIMENTS + 1 SANDBOX</span>
      </footer>
      <p className="sr-only" aria-live="polite">{announcement} Simulation {runState} at {time.toFixed(2)} seconds.</p>
    </main>
  );
}
