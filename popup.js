const LS_LAST_PHASE = 'will_popup_last_phase';
const LS_EXCEL_ROWS = 'will_excel_rows';
const LS_EXCEL_SELECTED_INDEX = 'will_excel_selected_index';

document.addEventListener('DOMContentLoaded', () => {
  restoreExcelState();

  if (localStorage.getItem('bot_waiting') === 'true') {
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('instructionText').innerText =
      localStorage.getItem('bot_msg') || 'ESPERANDO ACCIÓN...';
  }

  const lastStatus = localStorage.getItem('bot_status_text');
  const lastColor = localStorage.getItem('bot_status_color');
  if (lastStatus) updateStatus(lastStatus, lastColor);
});

document.getElementById('excelFile').addEventListener('change', handleExcelUpload);
document.getElementById('personSelect').addEventListener('change', (e) => {
  localStorage.setItem(LS_EXCEL_SELECTED_INDEX, e.target.value || '');
});

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'WAIT_USER') {
    localStorage.setItem('bot_waiting', 'true');
    localStorage.setItem('bot_msg', request.message);
    document.getElementById('controlPanel').style.display = 'block';
    document.getElementById('instructionText').innerText = `⚠️ ${request.message}`;
    updateStatus('⏳ Acción requerida...', '#ffcc00');
  }
});

function getSelectedPersonPayload() {
  const rowsRaw = localStorage.getItem(LS_EXCEL_ROWS);
  if (!rowsRaw) return { ok: false, message: 'Primero carga un archivo Excel.' };

  let rows;
  try {
    rows = JSON.parse(rowsRaw);
  } catch {
    return { ok: false, message: 'No se pudieron leer las filas guardadas del Excel.' };
  }

  const selectedValue = document.getElementById('personSelect').value;
  const index = Number.parseInt(selectedValue, 10);
  if (Number.isNaN(index) || index < 0 || index >= rows.length) {
    return { ok: false, message: 'Selecciona una persona válida de la tabla.' };
  }

  return { ok: true, payload: rows[index] };
}

/** Acepta getinternet.gov con ruta que contenga "apply" (con o sin www, query, etc.). */
function isApplyPageUrl(url) {
  if (!url || url.startsWith('chrome:')) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const hostOk =
      host === 'www.getinternet.gov' ||
      host === 'getinternet.gov' ||
      host.endsWith('.getinternet.gov');
    return hostOk && u.pathname.toLowerCase().includes('apply');
  } catch {
    return false;
  }
}

document.getElementById('part1Btn').addEventListener('click', async () => {
  localStorage.setItem(LS_LAST_PHASE, 'part1');
  const got = getSelectedPersonPayload();
  if (!got.ok) {
    updateStatus(`❌ ${got.message}`, '#ff4444');
    return;
  }
  updateStatus('🚀 Parte 1...', '#2563eb');
  await sendToContentScript('START_BOT_PART1', got.payload);
});

document.getElementById('part2Btn').addEventListener('click', async () => {
  localStorage.setItem(LS_LAST_PHASE, 'part2');
  const got = getSelectedPersonPayload();
  if (!got.ok) {
    updateStatus(`❌ ${got.message}`, '#ff4444');
    return;
  }
  updateStatus('🚀 Parte 2 (Lifeline → final)...', '#059669');
  await sendToContentScript('START_BOT_PART2', got.payload);
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  await sendToContentScript('STOP_BOT', { reason: 'popup-stop-button' });
  localStorage.removeItem('bot_waiting');
  localStorage.removeItem('bot_msg');
  document.getElementById('controlPanel').style.display = 'none';
  updateStatus('🛑 Bot detenido manualmente.', '#ff5d7a');
});

document.getElementById('resumeBtn').addEventListener('click', () => handleUserAction('next'));
document.getElementById('retryBtn').addEventListener('click', () => handleUserAction('retry'));

async function handleUserAction(choice) {
  localStorage.removeItem('bot_waiting');
  localStorage.removeItem('bot_msg');
  document.getElementById('controlPanel').style.display = 'none';
  updateStatus(choice === 'next' ? '🚀 Continuando...' : '🔄 Reintentando...', '#00ffcc');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'USER_CLICKED', choice: choice });
  }
}

async function sendToContentScript(action, payload) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) {
    updateStatus('❌ No hay pestaña activa.', '#ff4444');
    return;
  }
  const url = tab.url || '';
  if (!isApplyPageUrl(url)) {
    updateStatus(
      '❌ Activa la pestaña de la solicitud (URL con getinternet.gov y …/apply…). Recarga F5 si hace falta.',
      '#ff4444'
    );
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { action, payload });
  } catch (e) {
    console.error('[will-bot] sendMessage', e);
    updateStatus(
      '❌ El bot no está cargado en esta página. Recarga (F5) en la solicitud e inténtalo otra vez.',
      '#ff4444'
    );
  }
}

function updateStatus(text, color) {
  const s = document.getElementById('status');
  s.innerText = text;
  s.style.color = color;
  localStorage.setItem('bot_status_text', text);
  localStorage.setItem('bot_status_color', color);
}

window.updateStatus = updateStatus;

function getRowLabel(row, idx) {
  const first = String(row['First Name'] || row['FIRST NAME'] || '').trim();
  const last = String(row['Last Name(s)'] || row['LAST NAME(S)'] || '').trim();
  const fullName = `${first} ${last}`.trim();
  const zip = String(row['Zip Code'] || row['ZIP CODE'] || '').trim();
  const suffix = zip ? ` • ${zip}` : '';
  return fullName ? `${idx + 1}. ${fullName}${suffix}` : `${idx + 1}. Registro ${idx + 1}${suffix}`;
}

function pickSheet(workbook) {
  const names = workbook.SheetNames || [];
  if (names.length === 0) return null;
  const preferred = names.find((n) => n.trim().toLowerCase() === 'data');
  return preferred || names[0];
}

function setPersonOptions(rows) {
  const select = document.getElementById('personSelect');
  select.innerHTML = '';
  if (!rows.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No hay filas en la hoja seleccionada';
    select.appendChild(opt);
    return;
  }

  rows.forEach((row, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = getRowLabel(row, idx);
    select.appendChild(opt);
  });

  const savedIdx = localStorage.getItem(LS_EXCEL_SELECTED_INDEX);
  if (savedIdx !== null && rows[Number.parseInt(savedIdx, 10)]) {
    select.value = savedIdx;
  } else {
    select.value = '0';
    localStorage.setItem(LS_EXCEL_SELECTED_INDEX, '0');
  }
}

async function handleExcelUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    updateStatus('❌ No se cargó la librería de Excel (XLSX).', '#ff4444');
    return;
  }

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = pickSheet(wb);
    if (!sheetName) {
      updateStatus('❌ El archivo no tiene hojas disponibles.', '#ff4444');
      return;
    }

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    localStorage.setItem(LS_EXCEL_ROWS, JSON.stringify(rows));
    setPersonOptions(rows);
    updateStatus(`✅ Excel cargado (${rows.length} personas)`, '#00ffcc');
  } catch (err) {
    console.error('[will-bot] excel', err);
    updateStatus('❌ Error leyendo el Excel. Verifica formato y columnas.', '#ff4444');
  }
}

function restoreExcelState() {
  const rowsRaw = localStorage.getItem(LS_EXCEL_ROWS);
  if (!rowsRaw) return;
  try {
    const rows = JSON.parse(rowsRaw);
    if (Array.isArray(rows)) setPersonOptions(rows);
  } catch {
    localStorage.removeItem(LS_EXCEL_ROWS);
    localStorage.removeItem(LS_EXCEL_SELECTED_INDEX);
  }
}
