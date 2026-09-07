import { useEffect, useState } from 'react';

export default function useQueues(flexClient) {
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!flexClient) return;
    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const workspace = await flexClient.getWorkspace();
        const taskQueues = await workspace.fetchTaskQueues();
        if (!mounted) return;
        setQueues(Array.from(taskQueues.values()));
      } catch (err) {
        console.error('[useQueues] fetchTaskQueues failed', err);
        if (mounted) setError(err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [flexClient]);

  return { queues, loading, error };
}
