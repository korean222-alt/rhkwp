import * as db from './db';
import { DEFAULT_SETTINGS, type Session } from '../types';
export async function createDemo() {
  const id = crypto.randomUUID();
  const session: Session = { id, name: '경제학 첫걸음 · 수요와 공급', createdAt: Date.now(), updatedAt: Date.now(), status: 'complete', duration: 152, settings: DEFAULT_SETTINGS, source: 'demo', bytes: 0, warning: '이 자료는 사용법을 보여 주는 예시입니다. 실제 녹화·음성 인식 결과가 아닙니다.' };
  await db.putSession(session);
  const notes = [
    { sec: 0, title: '01. 수요와 공급', sub: '경제학 첫걸음', ocr: '수요와 공급\n가격과 거래량이 만나는 지점\n수요: 사고자 하는 양\n공급: 팔고자 하는 양' },
    { sec: 45, title: '02. 시장 균형', sub: '가격이 오르면 어떻게 될까요?', ocr: '시장 균형\n수요 곡선은 우하향, 공급 곡선은 우상향\n두 곡선의 교점 = 균형 가격 · 균형 거래량' },
    { sec: 100, title: '03. 수요의 이동', sub: '선호 · 소득 · 대체재', ocr: '수요의 이동\n가격 이외의 요인이 바뀌면 수요 곡선이 이동한다.\n소득 증가 → 정상재 수요 증가' },
  ];
  for (const n of notes) {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#eef2e7'; ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#255449'; ctx.font = '20px sans-serif'; ctx.fillText('LECTURELENS / 예시 강의', 65, 75);
    ctx.font = 'bold 44px sans-serif'; ctx.fillText(n.title, 65, 165);
    ctx.font = '24px sans-serif'; ctx.fillStyle = '#688077'; ctx.fillText(n.sub, 65, 215);
    ctx.strokeStyle = '#2e6b58'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(520, 440); ctx.lineTo(850, 440); ctx.moveTo(520, 440); ctx.lineTo(520, 265); ctx.stroke();
    ctx.strokeStyle = '#df8958'; ctx.beginPath(); ctx.moveTo(560, 285); ctx.lineTo(820, 415); ctx.stroke();
    ctx.strokeStyle = '#679585'; ctx.beginPath(); ctx.moveTo(560, 415); ctx.lineTo(820, 285); ctx.stroke();
    ctx.fillStyle = '#1d5144'; ctx.beginPath(); ctx.arc(690, 350, 8, 0, Math.PI * 2); ctx.fill();
    const image = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7));
    const frameId = crypto.randomUUID();
    await db.saveFrame({ id: frameId, sessionId: id, sceneId: frameId, sec: n.sec, type: 'scene', image, ocr: n.ocr, ocrStatus: 'done' });
  }
  const text = [
    [0, 20, '오늘은 수요와 공급의 기본 개념을 알아보겠습니다.'],
    [20, 44, '화면을 보시면 수요는 소비자가 사고자 하는 양이고, 공급은 판매자가 팔고자 하는 양입니다.'],
    [46, 70, '이 그래프를 보시면 두 곡선이 만나는 지점이 있습니다. 이곳이 시장 균형입니다.'],
    [70, 98, '균형 가격에서는 소비자가 원하는 양과 판매자가 공급하는 양이 같아집니다.'],
    [102, 124, '다음 페이지를 보시면 소득과 선호에 따라 수요 곡선 자체가 이동할 수 있습니다.'],
    [125, 152, '예시로 소득이 증가할 때 정상재의 수요가 늘어나는 경우를 생각해 보세요.'],
  ] as const;
  for (const [start, end, value] of text) await db.editTranscript({ id: crypto.randomUUID(), sessionId: id, start, end, text: value });
  return id;
}
