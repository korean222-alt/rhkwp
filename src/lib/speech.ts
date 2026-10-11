export type SpeechChunk = { text: string; timestamp: [number | null, number | null] };

export function chooseLanguage(scores: ArrayLike<number>, koreanId: number, englishId: number) {
  if (!Number.isFinite(scores[koreanId]) || !Number.isFinite(scores[englishId])) throw new Error('음성 언어를 판별하지 못했습니다. 강의 언어를 직접 선택해 다시 처리하세요.');
  return scores[koreanId] >= scores[englishId] ? koreanId : englishId;
}

export function transcriptionIssue(chunks: SpeechChunk[], duration: number) {
  const text = chunks.map(c => c.text).join(' ').trim();
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (text.length > 300 && text.length / Math.max(1, duration) > 80) return '음성 길이에 비해 자막이 지나치게 깁니다.';
  // Reject sustained loops, not ordinary repeated words or a twice-repeated
  // sentence. Do not silently shorten the output and call it a transcription.
  if (words.length < 24) return;
  for (let width = 1; width <= 12; width++) {
    for (let start = 0; start + width * 6 <= words.length; start++) {
      const phrase = words.slice(start, start + width).join(' ');
      let repeats = 1;
      while (words.slice(start + repeats * width, start + (repeats + 1) * width).join(' ') === phrase) repeats++;
      if (repeats >= 6 && repeats * width >= Math.max(24, words.length * .5)) return '같은 문장이 과도하게 반복되어 인식 결과를 확인해야 합니다.';
    }
  }
}

export function audioWindows(audio: Float32Array, maxSeconds: number, minSeconds = maxSeconds / 2) {
  const windows: { audio: Float32Array; start: number }[] = [];
  let start = 0;
  while (start < audio.length) {
    const target = Math.min(audio.length, start + Math.round(maxSeconds * 16000));
    let end = target;
    if (target < audio.length) {
      let quietest = .008 ** 2;
      // Prefer a quiet 100ms boundary to cutting in the middle of a word.
      for (let at = start + Math.round(minSeconds * 16000); at + 1600 <= target; at += 1600) {
        let energy = 0;
        for (let i = at; i < at + 1600; i++) energy += audio[i] ** 2;
        if (energy / 1600 <= quietest) { quietest = energy / 1600; end = at + 800; }
      }
    }
    windows.push({ audio: audio.subarray(start, end), start: start / 16000 });
    start = end;
  }
  return windows;
}
