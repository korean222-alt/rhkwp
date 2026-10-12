export const MAX_CAPTURES = 4;

export function displayOptions() {
  // Request one tab's digital audio, never the speaker/microphone mix.
  return {
    video: { frameRate: 5, displaySurface: 'browser' },
    audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'exclude', windowAudio: 'exclude', selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
  };
}

export function tabSource(stream: MediaStream) {
  const track = stream.getVideoTracks()[0], settings = track?.getSettings();
  return { isTab: settings?.displaySurface === 'browser', sourceId: settings?.deviceId || track?.label || '' };
}

export function validateDisplay(stream: MediaStream, existing: { isTab: boolean; hasAudio: boolean; sourceId: string }[]) {
  const source = tabSource(stream);
  if (existing.length && (!source.isTab || !stream.getAudioTracks().length || existing.some(c => !c.isTab || !c.hasAudio))) {
    throw new Error('동시 녹음은 강의마다 「Chrome 탭」과 「탭 오디오 공유」를 선택해야 합니다. 창·전체 화면에서는 소리가 섞일 수 있습니다. 기존 녹화는 계속됩니다.');
  }
  if (source.isTab && source.sourceId && existing.some(c => c.isTab && c.sourceId === source.sourceId)) {
    throw new Error('이미 녹화 중인 탭입니다. 다른 강의 탭을 선택해 주세요. 기존 녹화는 계속됩니다.');
  }
  return source;
}
