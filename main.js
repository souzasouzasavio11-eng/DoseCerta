import './style.css';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'dosecerta.v1';
const HISTORY_KEY = 'dosecerta.history.v1';
const app = document.querySelector('#app');

let medicines = load(STORAGE_KEY, []);
let history = load(HISTORY_KEY, []);
let channelReady = false;

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

function pad(n) {
  return String(n).padStart(2, '0');
}

function toLocalInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLocal(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nextDose(lastDose, intervalHours) {
  const intervalMs = Number(intervalHours) * 60 * 60 * 1000;

  if (!lastDose || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return null;
  }

  return new Date(lastDose.getTime() + intervalMs);
}

function fmt(date) {
  if (!date) return '—';

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function fmtTime(date) {
  if (!date) return '—';

  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function relative(date) {
  if (!date) return '';

  const diff = date.getTime() - Date.now();

  if (diff <= 0) return 'Horário já passou';

  const mins = Math.ceil(diff / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;

  if (h === 0) return `Daqui a ${m} min`;
  if (m === 0) return `Daqui a ${h} h`;

  return `Daqui a ${h} h e ${m} min`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  })[c]);
}

// Atualiza somente a contagem regressiva,
// sem reconstruir toda a tela.
function updateCountdowns() {
  document.querySelectorAll('[data-countdown]').forEach(element => {
    const value = element.dataset.next;

    if (!value) {
      element.textContent = '';
      return;
    }

    const timestamp = Number(value);

    if (!Number.isFinite(timestamp)) return;

    const date = new Date(timestamp);

    element.textContent = relative(date);
    element.classList.toggle(
      'overdue',
      date.getTime() <= Date.now()
    );
  });
}

function persistAndRender() {
  save();
  render();
  refreshNotifications();
}

function hash(str) {
  let h = 0;

  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }

  return h;
}

function notificationId(key, usedIds) {
  let id = Math.abs(hash(key)) % 2147483647;

  if (id === 0) id = 1;

  while (usedIds.has(id)) {
    id = id >= 2147483647 ? 1 : id + 1;
  }

  usedIds.add(id);
  return id;
}

async function ensureNotificationChannel() {
  if (channelReady) return;

  await LocalNotifications.createChannel({
    id: 'dose-alerts',
    name: 'Lembretes de medicamentos',
    description: 'Lembretes dos horários cadastrados no DoseCerta',
    importance: 5,
    visibility: 1,
    sound: 'default'
  });

  channelReady = true;
}

async function refreshNotifications() {
  if (!Capacitor.isNativePlatform()) {
    return {
      ok: false,
      message: 'O aplicativo precisa estar instalado no Android.'
    };
  }

  try {
    const permission = await LocalNotifications.checkPermissions();

    if (permission.display !== 'granted') {
      return {
        ok: false,
        message: 'A permissão para mostrar notificações não está concedida.'
      };
    }

    const exact = await LocalNotifications.checkExactNotificationSetting();

    if (exact.exact_alarm !== 'granted') {
      return {
        ok: false,
        message: 'A autorização para alarmes exatos não está concedida.'
      };
    }

    await ensureNotificationChannel();

    const pending = await LocalNotifications.getPending();

    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications
      });
    }

    const notifications = [];
    const usedIds = new Set();
    const now = Date.now();

    medicines.forEach(med => {
      const last = parseLocal(med.lastDose);
      const intervalMs = Number(med.intervalHours) * 3600000;

      if (!last || !Number.isFinite(intervalMs) || intervalMs <= 0) {
        return;
      }

      const elapsed = now - last.getTime();

      let occurrenceNumber = Math.max(
        1,
        Math.floor(elapsed / intervalMs) + 1
      );

      for (let i = 0; i < 20; i++) {
        const occurrence = new Date(
          last.getTime() + occurrenceNumber * intervalMs
        );

        occurrenceNumber++;

        if (occurrence.getTime() <= now) continue;

        const id = notificationId(
          `${med.id}-${occurrence.getTime()}`,
          usedIds
        );

        notifications.push({
          id,
          title: `Hora do medicamento: ${med.name}`,
          body: 'Lembrete de horário cadastrado no DoseCerta.',
          channelId: 'dose-alerts',
          schedule: {
            at: occurrence,
            allowWhileIdle: true
          },
          extra: {
            medicineId: med.id
          }
        });
      }
    });

    if (notifications.length === 0) {
      return {
        ok: true,
        scheduled: 0,
        message: 'Não há horários futuros para agendar.'
      };
    }

    const result = await LocalNotifications.schedule({
      notifications
    });

    const confirmed = result.notifications?.length ?? 0;

    const after = await LocalNotifications.getPending();

    return {
      ok: confirmed > 0,
      scheduled: confirmed,
      pending: after.notifications.length,
      message: confirmed > 0
        ? `${confirmed} lembrete(s) agendado(s).`
        : 'O sistema não confirmou nenhum agendamento.'
    };

  } catch (err) {
    console.warn('Erro ao atualizar notificações:', err);

    return {
      ok: false,
      message: `Erro ao agendar: ${err?.message || 'erro desconhecido'}.`
    };
  }
}

async function enableNotifications() {
  if (!Capacitor.isNativePlatform()) {
    alert('As notificações ficam disponíveis quando o DoseCerta estiver instalado como aplicativo Android.');
    return;
  }

  try {
    let permission = await LocalNotifications.checkPermissions();

    if (permission.display !== 'granted') {
      permission = await LocalNotifications.requestPermissions();
    }

    if (permission.display !== 'granted') {
      alert('A permissão para mostrar notificações não foi concedida. Ative-a nas configurações do Android.');
      return;
    }

    let exact = await LocalNotifications.checkExactNotificationSetting();

    if (exact.exact_alarm !== 'granted') {
      alert(
        'O Android precisa autorizar os alarmes exatos para que os lembretes funcionem nos horários cadastrados. Na próxima tela, ative essa autorização e volte ao DoseCerta.'
      );

      await LocalNotifications.changeExactNotificationSetting();

      exact = await LocalNotifications.checkExactNotificationSetting();

      if (exact.exact_alarm !== 'granted') {
        alert('A autorização de alarmes exatos ainda não está ativa. Ative-a e toque novamente em Lembretes.');
        return;
      }
    }

    const result = await refreshNotifications();

    if (!result.ok) {
      alert(result.message);
      return;
    }

    if (result.scheduled === 0) {
      alert('Não encontrei horários futuros para agendar. Confira os horários cadastrados.');
      return;
    }

    alert(
      `Tudo certo! O DoseCerta confirmou ${result.scheduled} lembrete(s) agendado(s).`
    );

  } catch (err) {
    console.warn('Erro ao ativar notificações:', err);

    alert(
      `Não foi possível ativar os lembretes: ${err?.message || 'erro desconhecido'}.`
    );
  }
}

function addHistory(med, date) {
  history.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    medicineId: med.id,
    medicineName: med.name,
    takenAt: date.toISOString()
  });

  history = history.slice(0, 100);
}

function openForm(id = null) {
  const med = medicines.find(m => m.id === id);
  const now = new Date();
  const modal = document.querySelector('#modal');

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <span class="eyebrow">${med ? 'EDITAR CADASTRO' : 'NOVO CADASTRO'}</span>
          <h2>${med ? 'Editar medicamento' : 'Adicionar medicamento'}</h2>
        </div>
        <button class="icon-btn" id="closeModal" aria-label="Fechar">×</button>
      </div>

      <form id="medicineForm">
        <label>
          Nome do medicamento
          <input name="name" required maxlength="60"
            placeholder="Ex.: Medicamento"
            value="${escapeHtml(med?.name || '')}">
        </label>

        <label>
          Última dose
          <input name="lastDose" type="datetime-local" required
            value="${med?.lastDose || toLocalInput(now)}">
        </label>

        <label>
          Intervalo entre as doses (em horas)
          <input name="intervalHours" type="number"
            min="0.25" max="168" step="0.25" required
            placeholder="Ex.: 8"
            value="${med?.intervalHours ?? 8}">
        </label>

        <label>
          Observação (opcional)
          <input name="note" maxlength="100"
            placeholder="Ex.: conforme orientação recebida"
            value="${escapeHtml(med?.note || '')}">
        </label>

        <p class="form-note">
          Cadastre somente os horários e intervalos indicados na sua prescrição ou orientação profissional.
        </p>

        <button class="primary-btn full" type="submit">
          ${med ? 'Salvar alterações' : 'Salvar medicamento'}
        </button>
      </form>
    </div>`;

  modal.classList.remove('hidden');

  document.querySelector('#closeModal').addEventListener('click', closeForm);

  modal.addEventListener('click', e => {
    if (e.target === modal) closeForm();
  }, { once: true });

  document.querySelector('#medicineForm').addEventListener('submit', e => {
    e.preventDefault();

    const data = new FormData(e.currentTarget);
    const name = String(data.get('name')).trim();
    const lastDose = String(data.get('lastDose'));
    const intervalHours = Number(data.get('intervalHours'));

    if (
      !name ||
      !parseLocal(lastDose) ||
      !Number.isFinite(intervalHours) ||
      intervalHours <= 0 ||
      intervalHours > 168
    ) {
      alert('Confira os dados informados.');
      return;
    }

    const payload = {
      id: med?.id || (
        crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
      ),
      name,
      lastDose,
      intervalHours,
      note: String(data.get('note')).trim()
    };

    if (med) {
      medicines = medicines.map(m => m.id === med.id ? payload : m);
    } else {
      medicines.unshift(payload);
    }

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

  if (
    !med ||
    !confirm(`Excluir ${med.name}? O histórico já registrado será mantido.`)
  ) {
    return;
  }

  medicines = medicines.filter(m => m.id !== id);

  persistAndRender();
}

function render() {
  const upcoming = medicines
    .map(m => ({
      ...m,
      next: nextDose(parseLocal(m.lastDose), m.intervalHours)
    }))
    .sort((a, b) =>
      (a.next?.getTime() ?? Infinity) -
      (b.next?.getTime() ?? Infinity)
    );

  const featured = upcoming[0];
  const featuredOverdue = featured?.next &&
    featured.next.getTime() <= Date.now();

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="DoseCerta início">
        <span class="brand-mark">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <g transform="rotate(-45 24 24)">
              <rect x="11" y="5" width="26" height="38" rx="13"></rect>
              <path d="M11 24h26"></path>
            </g>
          </svg>
        </span>
        <span>Dose<span class="brand-light">Certa</span></span>
      </a>

      <button class="notify-btn" id="notifyBtn">
        <svg class="bell" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path>
          <path d="M10 21h4"></path>
        </svg>
        <span>Lembretes</span>
      </button>
    </header>

    <main>
      ${
        featured
          ? `<section class="next-dose-card">
              <div class="next-dose-top">
                <span class="eyebrow">PRÓXIMA DOSE</span>
                <span class="dose-status ${featuredOverdue ? 'status-overdue' : ''}">
                  <span class="status-dot"></span>
                  ${featuredOverdue ? 'HORÁRIO PASSADO' : 'AGENDADA'}
                </span>
              </div>

              <div class="next-dose-content">
                <div class="next-dose-info">
                  <h1>${escapeHtml(featured.name)}</h1>
                  <p>${escapeHtml(
                    featured.note || `Intervalo cadastrado: ${featured.intervalHours}h`
                  )}</p>
                </div>

                <div class="next-dose-time">
                  ${fmtTime(featured.next)}
                </div>

                <div class="countdown-row">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="13" r="8"></circle>
                    <path d="M12 9v4l2.5 1.5M9 2h6M12 2v3"></path>
                  </svg>
                  <span
                    class="main-countdown ${featuredOverdue ? 'overdue' : ''}"
                    data-countdown
                    data-next="${featured.next ? featured.next.getTime() : ''}"
                  >${relative(featured.next)}</span>
                  <span class="next-dose-date">${fmt(featured.next)}</span>
                </div>
              </div>
            </section>`
          : `<section class="next-dose-card next-dose-empty">
              <span class="eyebrow">DOSECERTA</span>
              <h1>Seus horários, sob controle.</h1>
              <p>Cadastre um medicamento para acompanhar a próxima dose e organizar seus lembretes.</p>
              <button class="primary-btn" id="heroAdd">
                ＋ Adicionar medicamento
              </button>
            </section>`
      }

      <section class="section-head">
        <div>
          <span class="eyebrow">ACOMPANHAMENTO</span>
          <h2>Seus medicamentos</h2>
        </div>
        <button class="primary-btn add-btn" id="addBtn">
          ＋ Adicionar
        </button>
      </section>

      ${
        upcoming.length
          ? `<div class="med-list">
              ${upcoming.map(m => {
                const next = m.next;
                const overdue = next && next.getTime() <= Date.now();

                return `
                  <article class="med-card">
                    <div class="med-card-top">
                      <div class="med-icon">
                        <svg viewBox="0 0 48 48" aria-hidden="true">
                          <g transform="rotate(-45 24 24)">
                            <rect x="11" y="5" width="26" height="38" rx="13"></rect>
                            <path d="M11 24h26"></path>
                          </g>
                        </svg>
                      </div>

                      <div class="med-title">
                        <h3>${escapeHtml(m.name)}</h3>
                        <span>
                          ${escapeHtml(
                            m.note || 'Intervalo cadastrado: ' + m.intervalHours + 'h'
                          )}
                        </span>
                      </div>

                      <button class="dots" data-edit="${m.id}" aria-label="Editar">
                        •••
                      </button>
                    </div>

                    <div class="dose-info">
                      <div>
                        <span class="eyebrow">PRÓXIMO HORÁRIO</span>
                        <strong>${fmt(next)}</strong>
                        <small
                          class="relative-time ${overdue ? 'overdue' : ''}"
                          data-countdown
                          data-next="${next ? next.getTime() : ''}"
                        >${relative(next)}</small>
                      </div>

                      <div class="interval">
                        <span class="eyebrow">INTERVALO</span>
                        <strong>${m.intervalHours}h</strong>
                      </div>
                    </div>

                    <div class="last-dose">
                      Última dose cadastrada: ${fmt(parseLocal(m.lastDose))}
                    </div>

                    <div class="card-actions">
                      <button class="taken-btn" data-taken="${m.id}">
                        ✓ Registrar dose tomada
                      </button>
                      <button class="text-btn" data-delete="${m.id}">
                        Excluir
                      </button>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>`
          : `<div class="empty-state">
              <div class="empty-icon">＋</div>
              <h3>Nenhum medicamento cadastrado</h3>
              <p>Adicione o primeiro para começar a organizar seus horários.</p>
              <button class="primary-btn" id="emptyAdd">
                Adicionar medicamento
              </button>
            </div>`
      }

      <section class="history-section">
        <div class="section-head history-head">
          <div>
            <span class="eyebrow">REGISTROS</span>
            <h2>Histórico recente</h2>
          </div>
          <span class="history-count">${history.length} registro(s)</span>
        </div>

        ${
          history.length
            ? `<div class="history-list">
                ${history.slice(0, 8).map(item => `
                  <div class="history-item">
                    <span class="history-check">✓</span>
                    <div>
                      <strong>${escapeHtml(item.medicineName)}</strong>
                      <small>${fmt(new Date(item.takenAt))}</small>
                    </div>
                  </div>
                `).join('')}
              </div>`
            : `<p class="muted">
                As doses registradas por você aparecerão aqui.
              </p>`
        }
      </section>

      <p class="disclaimer">
        <strong>Atenção:</strong> DoseCerta é um organizador de horários.
        Não indica medicamentos, doses ou intervalos. Siga sempre a
        prescrição e as orientações do profissional de saúde.
        Confirme os lembretes no próprio aparelho.
      </p>
    </main>

    <footer>
      <span class="footer-mark">DOSECERTA</span>
      <span class="footer-separator">•</span>
      ORGANIZAÇÃO DE HORÁRIOS
    </footer>

    <div id="modal" class="modal hidden"></div>
  `;

  document.querySelector('#addBtn')
    ?.addEventListener('click', () => openForm());

    document.querySelector('#emptyAdd')
    ?.addEventListener('click', () => openForm());

  document.querySelector('#heroAdd')
    ?.addEventListener('click', () => openForm());

  document.querySelector('#notifyBtn')
    ?.addEventListener('click', enableNotifications);

  document.querySelector('.brand')
    ?.addEventListener('click', e => e.preventDefault());

  document.querySelectorAll('[data-edit]').forEach(button => {
    button.addEventListener('click', () => {
      openForm(button.dataset.edit);
    });
  });

  document.querySelectorAll('[data-taken]').forEach(button => {
    button.addEventListener('click', () => {
      markTaken(button.dataset.taken);
    });
  });

  document.querySelectorAll('[data-delete]').forEach(button => {
    button.addEventListener('click', () => {
      deleteMedicine(button.dataset.delete);
    });
  });

  updateCountdowns();
}

render();

setInterval(updateCountdowns, 1000);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    updateCountdowns();
    refreshNotifications();
  }
});

if (Capacitor.isNativePlatform()) {
  refreshNotifications();
}