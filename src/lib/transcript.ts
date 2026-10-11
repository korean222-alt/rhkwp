import type { Transcript } from '../types';
import { time } from './time';
export const plain = (rows: Transcript[], timeline = true) => rows.map(r => timeline ? `[${time(r.start)}] ${r.text}` : r.text).join('\n');
export const srt = (rows: Transcript[]) => rows.map((r, i) => `${i + 1}\n${time(r.start, true)} --> ${time(r.end, true)}\n${r.text}`).join('\n\n');
