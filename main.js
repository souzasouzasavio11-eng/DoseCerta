import './style.css';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'dosecerta.v1';
const HISTORY_KEY = 'dosecerta.history.v1';
const app = document.querySelector('#app');

let medicines = load(STORAGE_KEY, []);
let history = load(HISTORY_KEY, []);
let editingId = null;

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(medicines));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}
function pad(n) { return String(n).padStart(2, '0'); }
function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function parseLocal(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function nextDose(lastDose, intervalHours) {
  const intervalMs = Number(intervalHours) * 60 * 60 * 1000;
  if (!lastDose || !Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  return new Date(lastDose.getTime() + intervalMs);
}
function fmt(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(date);
}
function relative(date) {
  if (!date) return '';
  const diff = date.getTime() - Date.now();
  if (diff <= 0) return 'Horário já passou';
  const mins = Math.round(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `Daqui a ${m} min`;
  if (m === 0) return `Daqui a ${h} h`;
  return `Daqui a ${h} h e ${m} min`;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[c]);
}
function persistAndRender() {
  save();
  render();
  refreshNotifications();
}

async function refreshNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') return;
    await LocalNotifications.cancel({ notifications: (await LocalNotifications.getPending()).notifications });
    const notifications = [];
    medicines.forEach((med, medIndex) => {
      const last = parseLocal(med.lastDose);
      if (!last) return;
      let occurrence = new Date(last);
      // Agenda as próximas 20 ocorrências de cada medicamento.
      for (let i = 1; i <= 20; i++) {
        occurrence = new Date(occurrence.getTime() + Number(med.intervalHours) * 3600000);
        if (occurrence.getTime() <= Date.now()) continue;
        const id = Math.abs(hash(`${med.id}-${i}`)) % 2000000000;
        notifications.push({
          id,
          title: `Hora do medicamento: ${med.name}`,
          body: `Lembrete de horário cadastrado no DoseCerta.`,
          channelId: 'dose-alerts',
          schedule: { at: occurrence, allowWhileIdle: true },
          extra: { medicineId: med.id }
        });
      }
    });
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  } catch (err) {
    console.warn('Não foi possível atualizar as notificações:', err);
  }
}
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return h;
}
async function enableNotifications() {
  if (!Capacitor.isNativePlatform()) {
    alert('As notificações ficam disponíveis quando o DoseCerta estiver instalado como aplicativo Android.');
    return;
  }
  try {
    let permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') permission = await LocalNotifications.requestPermissions();
    if (permission.display === 'granted') {
      await LocalNotifications.createChannel({
        id: 'dose-alerts', name: 'Lembretes de medicamentos',
        description: 'Lembretes dos horários cadastrados no DoseCerta',
        importance: 5, visibility: 1, sound: 'default'
      }).catch(() => {});
      await refreshNotifications();
      alert('Permissão concedida. Os próximos horários foram agendados.');
    } else {
      alert('A permissão não foi concedida. Você pode ativá-la nas configurações do Android.');
    }
  } catch {
    alert('Não foi possível ativar as notificações neste momento.');
  }
}
function addHistory(med, date) {
  history.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    medicineId: med.id, medicineName: med.name, takenAt: date.toISOString()
  });
  history = history.slice(0, 100);
}
function openForm(id = null) {
  editingId = id;
  const med = medicines.find(m => m.id === id);
  const now = new Date();
  const modal = document.querySelector('#modal');
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div><span class="eyebrow">${med ? 'EDITAR CADASTRO' : 'NOVO CADASTRO'}</span><h2>${med ? 'Editar medicamento' : 'Adicionar medicamento'}</h2></div>
        <button class="icon-btn" id="closeModal" aria-label="Fechar">×</button>
      </div>
      <form id="medicineForm">
        <label>Nome do medicamento<input name="name" required maxlength="60" placeholder="Ex.: Medicamento" value="${escapeHtml(med?.name || '')}"></label>
        <label>Última dose<input name="lastDose" type="datetime-local" required value="${med?.lastDose || toLocalInput(now)}"></label>
        <label>Intervalo entre as doses (em horas)<input name="intervalHours" type="number" min="0.25" max="168" step="0.25" required placeholder="Ex.: 8" value="${med?.intervalHours ?? 8}"></label>
        <label>Observação (opcional)<input name="note" maxlength="100" placeholder="Ex.: conforme orientação recebida" value="${escapeHtml(med?.note || '')}"></label>
        <p class="form-note">Cadastre somente os horários e intervalos indicados na sua prescrição ou orientação profissional.</p>
        <button class="primary-btn full" type="submit">${med ? 'Salvar alterações' : 'Salvar medicamento'}</button>
      </form>
    </div>`;
  modal.classList.remove('hidden');
  document.querySelector('#closeModal').addEventListener('click', closeForm);
  modal.addEventListener('click', e => { if (e.target === modal) closeForm(); }, { once: true });
  document.querySelector('#medicineForm').addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get('name')).trim();
    const lastDose = String(data.get('lastDose'));
    const intervalHours = Number(data.get('intervalHours'));
    if (!name || !parseLocal(lastDose) || !Number.isFinite(intervalHours) || intervalHours <= 0 || intervalHours > 168) {
      alert('Confira os dados informados.');
      return;
    }
    const payload = { id: med?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      name, lastDose, intervalHours, note: String(data.get('note')).trim() };
    if (med) medicines = medicines.map(m => m.id === med.id ? payload : m);
    else medicines.unshift(payload);
    closeForm();
    persistAndRender();
  });
}
function closeForm() {
  document.querySelector('#modal').classList.add('hidden');
  document.querySelector('#modal').innerHTML = '';
}
function markTaken(id) {
  const med = medicines.find(m => m.id === id);
  if (!med) return;
  const now = new Date();
  addHistory(med, now);
  med.lastDose = toLocalInput(now);
  persistAndRender();
}
function deleteMedicine(id) {
  const med = medicines.find(m => m.id === id);
  if (!med || !confirm(`Excluir ${med.name}? O histórico já registrado será mantido.`)) return;
  medicines = medicines.filter(m => m.id !== id);
  persistAndRender();
}
function render() {
  const upcoming = medicines.map(m => ({ ...m, next: nextDose(parseLocal(m.lastDose), m.intervalHours) }))
    .sort((a,b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity));
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="DoseCerta início"><span class="brand-mark">+</span><span>Dose<span class="brand-light">Certa</span></span></a>
      <button class="notify-btn" id="notifyBtn"><span class="bell">♧</span> Lembretes</button>
    </header>
    <main>
      <section class="hero">
        <div class="hero-copy"><span class="eyebrow">SUA ROTINA, MAIS ORGANIZADA</span><h1>Cuidar dos horários<br>ficou mais simples.</h1><p>Organize seus medicamentos e acompanhe os próximos horários.</p></div>
        <div class="hero-symbol"><span>+</span></div>
      </section>
      <section class="section-head">
        <div><span class="eyebrow">ACOMPANHAMENTO</span><h2>Seus medicamentos</h2></div>
        <button class="primary-btn add-btn" id="addBtn">＋ Adicionar</button>
      </section>
      ${upcoming.length ? `<div class="med-list">${upcoming.map(m => {
        const next = m.next;
        const overdue = next && next.getTime() <= Date.now();
        return `<article class="med-card">
          <div class="med-card-top"><div class="med-icon">✚</div><div class="med-title"><h3>${escapeHtml(m.name)}</h3><span>${escapeHtml(m.note || 'Intervalo cadastrado: ' + m.intervalHours + 'h')}</span></div><button class="dots" data-edit="${m.id}" aria-label="Editar">•••</button></div>
          <div class="dose-info"><div><span class="eyebrow">PRÓXIMO HORÁRIO</span><strong>${fmt(next)}</strong><small class="${overdue ? 'overdue' : ''}">${relative(next)}</small></div><div class="interval"><span class="eyebrow">INTERVALO</span><strong>${m.intervalHours}h</strong></div></div>
          <div class="last-dose">Última dose cadastrada: ${fmt(parseLocal(m.lastDose))}</div>
          <div class="card-actions"><button class="taken-btn" data-taken="${m.id}">✓ Registrar dose tomada</button><button class="text-btn" data-delete="${m.id}">Excluir</button></div>
        </article>`;
      }).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">＋</div><h3>Nenhum medicamento cadastrado</h3><p>Adicione o primeiro para começar a organizar seus horários.</p><button class="primary-btn" id="emptyAdd">Adicionar medicamento</button></div>`}
      <section class="history-section">
        <div class="section-head history-head"><div><span class="eyebrow">REGISTROS</span><h2>Histórico recente</h2></div><span class="history-count">${history.length} registro(s)</span></div>
        ${history.length ? `<div class="history-list">${history.slice(0,8).map(item => `<div class="history-item"><span class="history-check">✓</span><div><strong>${escapeHtml(item.medicineName)}</strong><small>${fmt(new Date(item.takenAt))}</small></div></div>`).join('')}</div>` : `<p class="muted">As doses registradas por você aparecerão aqui.</p>`}
      </section>
      <p class="disclaimer"><strong>Atenção:</strong> DoseCerta é um organizador de horários. Não indica medicamentos, doses ou intervalos. Siga sempre a prescrição e as orientações do profissional de saúde. Confirme os lembretes no próprio aparelho.</p>
    </main>
    <footer>DOSECERTA <span>•</span> ORGANIZAÇÃO DE HORÁRIOS</footer>
    <div id="modal" class="modal hidden"></div>`;
  document.querySelector('#addBtn')?.addEventListener('click', () => openForm());
  document.querySelector('#emptyAdd')?.addEventListener('click', () => openForm());
  document.querySelector('#notifyBtn').addEventListener('click', enableNotifications);
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.edit)));
  document.querySelectorAll('[data-taken]').forEach(b => b.addEventListener('click', () => markTaken(b.dataset.taken)));
  document.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', () => deleteMedicine(b.dataset.delete)));
}
render();
if (Capacitor.isNativePlatform()) {
  LocalNotifications.createChannel({
    id: 'dose-alerts', name: 'Lembretes de medicamentos',
    description: 'Lembretes dos horários cadastrados no DoseCerta',
    importance: 5, visibility: 1, sound: 'default'
  }).catch(() => {});
  refreshNotifications();
}