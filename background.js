const AI_ENDPOINT = 'https://settingly.onrender.com/api/search';

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-search') return;

  let controller = new AbortController();

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'abort') {
      controller.abort();
      port.disconnect();
      return;
    }

    const { query, domain, pageTitle } = msg;

    try {
      const response = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, domain, pageTitle }),
        signal: controller.signal,
      });

      if (!response.ok) {
        port.postMessage({ type: 'error', text: 'AI search failed.' });
        port.disconnect();
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (!payload) continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.done) break;
              if (parsed.text) {
                port.postMessage({ type: 'chunk', text: parsed.text });
              }
            } catch {}
          }
        }
      }

      port.postMessage({ type: 'done' });
    } catch (err) {
      if (err.name !== 'AbortError') {
        port.postMessage({ type: 'error', text: err.message });
      }
    } finally {
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    controller.abort();
  });
});
