/**
 * settings/whatsapp.js — Multi-instance phone pool manager UI.
 */
import { get, post, del } from '../../api.js';
import { escHtml } from '../../utils.js';
import { toast } from '../../components/toast.js';
import { confirm } from '../../components/modal.js';

let _state;

export function init(state) {
  _state = state;
  load();
  wireAddInstance();
}

async function load() {
  const list = document.getElementById('wa-instances-list');
  if (!list) return;
  try {
    const { instances } = await get('/api/whatsapp/instances');
    render(instances || []);
  } catch (err) {
    list.innerHTML = `<p class="text-sm text-error">${escHtml(err.message)}</p>`;
  }
}

function render(instances) {
  const list = document.getElementById('wa-instances-list');
  if (!list) return;

  if (!instances.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">📱</div>
        <div class="empty-state__title">No instances yet</div>
        <div class="empty-state__message">Create an instance to start adding WhatsApp phone numbers.</div>
      </div>`;
    return;
  }

  list.innerHTML = instances.map(inst => instanceCard(inst)).join('');
  wireInstanceActions();
}

function instanceCard(inst) {
  const phones = inst.phones || [];
  return `
    <div class="card card--glass" data-instance="${inst.id}">
      <div class="card__header">
        <div>
          <div class="card__title">${escHtml(inst.name)}</div>
          ${inst.description ? `<div class="card__subtitle">${escHtml(inst.description)}</div>` : ''}
        </div>
        <div class="flex gap-2">
          <button class="btn btn--secondary btn--sm" data-add-phone="${inst.id}">+ Add Phone</button>
          <button class="btn btn--ghost btn--icon btn--sm text-error" data-delete-instance="${inst.id}" title="Delete instance">🗑️</button>
        </div>
      </div>
      <div class="card__body">
        ${phones.length === 0
          ? `<p class="text-sm text-muted">No phones in this instance.</p>`
          : `<div class="flex flex-col gap-3">${phones.map(phoneRow).join('')}</div>`
        }
      </div>
    </div>
  `;
}

function phoneRow(phone) {
  const statusClass = phone.status === 'connected' ? 'status-dot--green'
    : phone.status === 'pending_qr' ? 'status-dot--yellow'
    : 'status-dot--red';

  return `
    <div class="flex items-center gap-3" data-phone="${phone.id}">
      <span class="status-dot ${statusClass}" title="${escHtml(phone.status)}"></span>
      <span class="flex-1 text-sm">${escHtml(phone.displayName || `Phone #${phone.id}`)}</span>
      <span class="badge badge--neutral text-xs">${escHtml(phone.status)}</span>
      ${phone.status === 'pending_qr' || phone.status === 'disconnected'
        ? `<button class="btn btn--secondary btn--sm" data-show-qr="${phone.id}">QR</button>`
        : ''}
      <button class="btn btn--ghost btn--sm" data-reconnect-phone="${phone.id}" title="Reconnect">↺</button>
      <button class="btn btn--ghost btn--icon btn--sm text-error" data-delete-phone="${phone.id}" title="Remove">✕</button>
    </div>
  `;
}

function wireInstanceActions() {
  const list = document.getElementById('wa-instances-list');
  if (!list) return;

  list.querySelectorAll('[data-add-phone]').forEach(btn => {
    btn.addEventListener('click', () => addPhone(Number(btn.dataset.addPhone)));
  });

  list.querySelectorAll('[data-delete-instance]').forEach(btn => {
    btn.addEventListener('click', () => deleteInstance(Number(btn.dataset.deleteInstance)));
  });

  list.querySelectorAll('[data-show-qr]').forEach(btn => {
    btn.addEventListener('click', () => showQr(Number(btn.dataset.showQr)));
  });

  list.querySelectorAll('[data-reconnect-phone]').forEach(btn => {
    btn.addEventListener('click', () => reconnectPhone(Number(btn.dataset.reconnectPhone)));
  });

  list.querySelectorAll('[data-delete-phone]').forEach(btn => {
    btn.addEventListener('click', () => deletePhone(Number(btn.dataset.deletePhone)));
  });
}

function wireAddInstance() {
  document.getElementById('btn-add-instance')?.addEventListener('click', async () => {
    const name = prompt('Instance name (e.g. "Main Pool", "Fishing Group")');
    if (!name) return;
    try {
      await post('/api/whatsapp/instances', { name });
      toast.success('Instance created');
      load();
    } catch (err) {
      toast.error('Failed', err.message);
    }
  });
}

async function addPhone(instanceId) {
  const displayName = prompt('Phone label (optional, e.g. "Main number")');
  try {
    const { phone } = await post(`/api/whatsapp/instances/${instanceId}/phones`, { displayName });
    toast.success('Phone added', 'Scan the QR code to connect.');
    load();
    showQr(phone.id);
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function deleteInstance(instanceId) {
  const ok = await confirm('Delete this instance and all its phones?', { okLabel: 'Delete', okClass: 'btn--danger' });
  if (!ok) return;
  try {
    await del(`/api/whatsapp/instances/${instanceId}`);
    toast.success('Instance deleted');
    load();
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function deletePhone(phoneId) {
  const ok = await confirm('Remove this phone number?', { okLabel: 'Remove' });
  if (!ok) return;
  try {
    await del(`/api/whatsapp/phones/${phoneId}`);
    toast.success('Phone removed');
    load();
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

async function reconnectPhone(phoneId) {
  try {
    await post(`/api/whatsapp/phones/${phoneId}/reconnect`);
    toast.info('Reconnecting…');
    setTimeout(load, 3000);
  } catch (err) {
    toast.error('Failed', err.message);
  }
}

function showQr(phoneId) {
  const overlay = document.getElementById('qr-modal-overlay');
  const canvas  = document.getElementById('qr-canvas');
  const status  = document.getElementById('qr-status');

  if (!overlay || !canvas) return;

  status.textContent = 'Waiting for QR code…';
  overlay.classList.add('is-open');

  const sse = new EventSource(`/api/whatsapp/phones/${phoneId}/qr`);

  sse.onmessage = async (e) => {
    const data = JSON.parse(e.data);
    if (data.qr) {
      status.textContent = 'Scan with WhatsApp → Linked Devices → Link a Device';
      if (typeof QRCode !== 'undefined') {
        canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
        await QRCode.toCanvas(canvas, data.qr, { width: 200, margin: 1 });
      }
    }
    if (data.ready) {
      status.textContent = '✅ Connected!';
      sse.close();
      setTimeout(() => {
        overlay.classList.remove('is-open');
        load();
      }, 1500);
    }
  };

  sse.onerror = () => {
    status.textContent = 'Connection lost. Try reconnecting.';
    sse.close();
  };

  document.getElementById('qr-modal-close')?.addEventListener('click', () => sse.close(), { once: true });
}
