// The same lock order is used for every portable backup/restore/erase. Capture
// and inference cannot start in another tab halfway through a data operation.
export async function withMaintenance<T>(task: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('안전한 백업·복원을 위해 최신 Chrome, Edge 또는 Safari를 사용하세요.');
  return navigator.locks.request('lecturelens-capture', { ifAvailable: true }, async capture => {
    if (!capture) throw new Error('다른 LectureLens 탭에서 녹화 또는 자료 작업 중입니다. 해당 작업을 먼저 마쳐 주세요.');
    return navigator.locks.request('lecturelens-processing', { ifAvailable: true }, async processing => {
      if (!processing) throw new Error('다른 LectureLens 탭에서 음성을 처리 중입니다. 처리를 마친 뒤 다시 시도하세요.');
      return withDataWrite(task);
    });
  });
}
export async function withDataWrite<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('lecturelens-data', task) : task();
}
