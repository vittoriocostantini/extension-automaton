/** Telemetría opcional para depuración local (falla en silencio si no hay servidor). */
window.debugLog = (hypothesisId, location, message, data) => {
  fetch('http://127.0.0.1:7845/ingest/55c18502-98e1-4250-b1c2-3a6d7786f45a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '015917' },
    body: JSON.stringify({
      sessionId: '015917',
      runId: 'initial',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
};
