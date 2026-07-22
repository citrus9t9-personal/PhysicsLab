export function getFixedGraphScale(samples, metric) {
  const values = samples.map((sample) => sample[metric]);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);

  if (Math.abs(max - min) < 0.001) {
    max += 1;
    min -= 1;
  }

  const margin = (max - min) * 0.12;
  return { min: min - margin, max: max + margin };
}

export function revealGraphSamples(samples, metric, currentTime) {
  if (samples.length === 0) return [];

  const first = samples[0];
  const final = samples.at(-1);
  const time = Math.min(Math.max(currentTime, first.time), final.time);
  const revealed = samples
    .filter((sample) => sample.time <= time)
    .map((sample) => ({ time: sample.time, value: sample[metric] }));
  const previous = revealed.at(-1);
  const next = samples.find((sample) => sample.time > time);

  if (previous && next && time > previous.time) {
    const progress = (time - previous.time) / (next.time - previous.time);
    revealed.push({
      time,
      value: previous.value + (next[metric] - previous.value) * progress,
    });
  }

  return revealed;
}
