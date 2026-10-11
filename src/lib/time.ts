export function time(sec: number, milliseconds = false) {
  const total = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(total / 3600000).toString().padStart(2, '0');
  const m = Math.floor(total / 60000 % 60).toString().padStart(2, '0');
  const s = Math.floor(total / 1000 % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}${milliseconds ? ',' + (total % 1000).toString().padStart(3, '0') : ''}`;
}
export function parseTime(input: string | number) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error('시각은 0 이상의 초 단위 숫자여야 합니다.');
    return input;
  }
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(input.trim())) throw new Error('시각을 HH:MM:SS 또는 초로 입력하세요.');
  const parts = input.trim().split(':').map(Number);
  if (parts.slice(1).some(v => v >= 60)) throw new Error('분과 초는 60 미만이어야 합니다.');
  return parts.reduce((sum, value) => sum * 60 + value, 0);
}
export function size(bytes: number) {
  return bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}
