// Browser side of the server API (spec §7).

export async function fetchHealth() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch('/api/health', { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return { live: false, models: [], defaultModel: 'sim' };
  }
}

/**
 * POST /api/chat and call onText for every streamed chunk.
 * Resolves when the reply is complete; throws Error(readable message) on failure.
 */
export async function streamChat(body, { signal, onText }) {
  let res;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach the Tennex server. Is it running?');
  }
  if (!res.ok) {
    let msg = `Server error (HTTP ${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
    if (res.status === 413) msg = 'That message is too large to send.';
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      let msg;
      try { msg = JSON.parse(data); } catch { continue; }
      if (msg.error) throw new Error(msg.error);
      if (msg.done) return;
      if (typeof msg.t === 'string') onText(msg.t);
    }
  }
  throw new Error('The reply ended unexpectedly.');
}
