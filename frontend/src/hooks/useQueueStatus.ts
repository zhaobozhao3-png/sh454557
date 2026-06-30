import { useEffect, useState } from 'react';
import { novaTaskSocket } from '@/lib/ccode-task-socket';
import { getNovaQueueStatus, type NovaQueueStatus } from '@/lib/ccode-task-client';

export function useQueueStatus() {
  const [queueStatus, setQueueStatus] = useState<NovaQueueStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getNovaQueueStatus()
      .then(stats => {
        if (!cancelled) setQueueStatus(stats);
      })
      .catch(() => {
        // WebSocket/fallback polling will keep trying; keep the last good value if present.
      });
    const unsubscribe = novaTaskSocket.subscribeQueue(stats => setQueueStatus(stats));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return queueStatus;
}
