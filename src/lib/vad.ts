export function hasSpeech(samples: Float32Array) {
  // Conservative energy VAD. Only skip near-silence; no audio/timestamps are cut.
  let active = 0;
  for (let start = 0; start < samples.length; start += 320) {
    const end = Math.min(start + 320, samples.length); let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    if (Math.sqrt(sum / (end - start)) > 0.003) active++;
  }
  return active >= 4;
}
