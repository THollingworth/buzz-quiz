"use strict";

let currentUser = null;
let toastTimer = null;

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function avatarUrl(avatar) {
  return avatar ? '/avatars/' + avatar : null;
}

function initials(pseudo) {
  return (pseudo || '?').slice(0, 2).toUpperCase();
}

function renderAvatar(imgEl, fallbackEl, user) {
  const url = avatarUrl(user.avatar);
  if (url) {
    imgEl.src = url; imgEl.style.display = 'block';
    fallbackEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none';
    fallbackEl.style.display = 'flex';
    fallbackEl.textContent = initials(user.pseudo);
  }
}

function applyUser(user) {
  currentUser = user;
  document.getElementById('headerPseudo').textContent = user.pseudo;
  renderAvatar(document.getElementById('headerAvatar'), document.getElementById('avatarFallback'), user);
  renderAvatar(document.getElementById('profileAvatarImg'), document.getElementById('profileAvatarFallback'), user);
  document.getElementById('pseudoInput').value = user.pseudo;
}

async function loadMe() {
  const r = await fetch('/api/auth/me');
  const { user } = await r.json();
  if (!user) { window.location.href = '/auth.html'; return; }
  applyUser(user);
}

async function loadHistory() {
  const r = await fetch('/api/profile/history');
  const { games } = await r.json();
  const list = document.getElementById('historyList');
  if (!games || games.length === 0) { list.innerHTML = '<span class="empty">Aucune partie jouée.</span>'; return; }
  list.innerHTML = '';
  games.forEach(g => {
    const date = new Date(g.played_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    const gameName = g.game_type === 'blindzik' ? 'BlindZik' : g.game_type;
    const scoresStr = (g.scores || []).map(s => s.name + ' ' + s.points + 'pt').join(' · ');
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `
      <div class="hr-top">
        <span class="hr-game">${gameName}</span>
        ${g.winner ? '<span class="hr-winner">🏆 ' + escHtml(g.winner) + '</span>' : ''}
        <span class="hr-date">${date}</span>
      </div>
      <div class="hr-scores">${scoresStr || 'Pas de scores'}</div>
    `;
    list.appendChild(row);
  });
}

function escHtml(t) {
  return (t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Ouvrir profil
document.getElementById('avatarBtn').onclick = () => {
  document.getElementById('profileModal').classList.remove('hidden');
  loadHistory();
};
document.getElementById('closeProfile').onclick = () => {
  document.getElementById('profileModal').classList.add('hidden');
};
document.getElementById('profileModal').addEventListener('click', e => {
  if (e.target.id === 'profileModal') document.getElementById('profileModal').classList.add('hidden');
});

// Sauvegarder pseudo
document.getElementById('savePseudo').onclick = async () => {
  const pseudo = document.getElementById('pseudoInput').value.trim();
  const msg = document.getElementById('pseudoMsg');
  const r = await fetch('/api/profile/pseudo', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo })
  });
  const data = await r.json();
  if (r.ok) {
    currentUser.pseudo = pseudo;
    applyUser(currentUser);
    msg.textContent = 'Pseudo mis à jour !'; msg.className = 'hint ok';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  } else {
    msg.textContent = data.error || 'Erreur'; msg.className = 'hint err';
  }
};

// Upload avatar
document.getElementById('avatarFile').addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const fd = new FormData(); fd.append('avatar', file);
  const r = await fetch('/api/profile/avatar', { method: 'POST', body: fd });
  const data = await r.json();
  if (r.ok) {
    currentUser.avatar = data.avatar;
    applyUser(currentUser);
    toast('Photo de profil mise à jour !');
  } else {
    toast('Erreur upload : ' + (data.error || '?'));
  }
});

// Logout
document.getElementById('logoutBtn').onclick = async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/auth.html';
};

// Init
loadMe();
