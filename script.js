'use strict';

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
var S = {
  name:'', avatar:{emoji:'🦊',name:'Fuchs'}, focuses:[],
  xp:0, level:1, prestige:0, streak:0, totalDone:0,
  todos:[], xpLog:[], reminders:[], motivTime:'09:00',
  inbox:[], lastActive:null,
  lastQWReset:null, lastDayReset:null, lastWeekReset:null,
  qwDone:{}
};

// ═══════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ═══════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/focus-pal/sw.js')
      .then(function(reg) { console.log('SW registriert:', reg.scope); })
      .catch(function(err) { console.log('SW Fehler:', err); });
  });
}

// ═══════════════════════════════════════════
// LEVEL SYSTEM — 50 levels then prestige
// ═══════════════════════════════════════════
var MAX_LVL = 50;

function xpForLvl(l) {
  if (l <= 1) return 0;
  return Math.floor(80 * Math.pow(l - 1, 1.35));
}
function xpForNext(l) {
  if (l >= MAX_LVL) return xpForLvl(MAX_LVL) + 9999;
  return xpForLvl(l + 1);
}
function calcLvl(xp) {
  var l = 1;
  while (l < MAX_LVL && xp >= xpForNext(l)) l++;
  return l;
}

var TITLES = ['Anfänger','Entdecker','Kämpfer','Fokus-Profi','Stratege','Meister','Grandmaster','Champion','Legende','Mythos'];
var EMOJIS = ['🌱','🔍','⚔️','🎯','🗺️','🏆','🌟','💎','👑','🌌'];
function getTitle(l) { return TITLES[Math.floor((l-1)/5) % TITLES.length]; }
function getEmoji(l) { return EMOJIS[Math.floor((l-1)/5) % EMOJIS.length]; }

var MILESTONES = [
  {l:10,n:'Zehn-Hoch',i:'🎖️'},
  {l:20,n:'Zwanziger',i:'🥈'},
  {l:30,n:'Dreißiger',i:'🥇'},
  {l:40,n:'Vierzig Elite',i:'💠'},
  {l:50,n:'Prestige-Kandidat',i:'👑'}
];

// ═══════════════════════════════════════════
// MOTIVATIONS
// ═══════════════════════════════════════════
var MOVS = [
  'Dein ADHS-Gehirn ist kein Fehler – es ist anders verdrahtet. Das ist deine Superkraft! 🧠⚡',
  'Heute muss nicht perfekt sein. Gut genug ist gut genug. 💛',
  'Jeder erledigte Task ist ein Dopamin-Treffer, den du dir verdient hast! 🎯',
  'Du hast gestern weitergemacht. Das zählt mehr als Perfektion. 🔥',
  'Kleine Schritte summieren sich zu großen Veränderungen. 🌱',
  'Dein Begleiter glaubt an dich – auch an schwierigen Tagen. 💜',
  'ADHS bedeutet nicht, du schaffst nichts. Du schaffst es anders. ✨',
  'Heute: Eine Aufgabe. Nur eine. Das reicht. 🎯',
  'Du weißt, wie du dir Dopamin holst. Mach es! ⚡',
  'Schau zurück – wie weit bist du schon gekommen! 🗺️'
];

// ═══════════════════════════════════════════
// AUDIO — iOS-compatible alarm sound via AudioContext
// ═══════════════════════════════════════════
var audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) { return null; }
  }
  return audioCtx;
}

function playAlarmSound() {
  var ctx = getAudioCtx();
  if (!ctx) return;
  // Resume if suspended (iOS requires user gesture first)
  if (ctx.state === 'suspended') ctx.resume();

  var pattern = [0, 0.3, 0.6, 0.9, 1.2]; // 5 beeps
  pattern.forEach(function(t) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime + t);
    osc.frequency.setValueAtTime(660, ctx.currentTime + t + 0.1);
    gain.gain.setValueAtTime(0.4, ctx.currentTime + t);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.25);
    osc.start(ctx.currentTime + t);
    osc.stop(ctx.currentTime + t + 0.25);
  });
}

function playSuccessSound() {
  var ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  var notes = [523, 659, 784, 1047];
  notes.forEach(function(freq, i) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
    osc.start(ctx.currentTime + i * 0.12);
    osc.stop(ctx.currentTime + i * 0.12 + 0.2);
  });
}

// Unlock audio on first touch (iOS requirement)
document.addEventListener('touchstart', function() {
  var ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}, {once: true});

// ═══════════════════════════════════════════
// ALARM MODAL
// ═══════════════════════════════════════════
var alarmActive = false;

function showAlarm(icon, title, body) {
  alarmActive = true;
  document.getElementById('alarmIcon').textContent = icon;
  document.getElementById('alarmTitle').textContent = title;
  document.getElementById('alarmBody').textContent = body;
  document.getElementById('alarmOverlay').classList.add('show');
  playAlarmSound();
  if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
}

function dismissAlarm() {
  alarmActive = false;
  document.getElementById('alarmOverlay').classList.remove('show');
}

// ═══════════════════════════════════════════
// TOAST — lightweight, non-blocking feedback
// ═══════════════════════════════════════════
var toastTimer = null;

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() {
    t.classList.remove('show');
  }, 2800);
}

// ═══════════════════════════════════════════
// ONBOARDING
// ═══════════════════════════════════════════
var _selAv = {emoji:'🦊', name:'Fuchs'};
var _selFoc = [];

function selAv(el, emoji, name) {
  document.querySelectorAll('.avo').forEach(function(a) { a.classList.remove('sel'); });
  el.classList.add('sel');
  _selAv = {emoji: emoji, name: name};
}

function togFoc(el, key) {
  el.classList.toggle('sel');
  if (el.classList.contains('sel')) {
    _selFoc.push(key);
  } else {
    _selFoc = _selFoc.filter(function(f) { return f !== key; });
  }
}

function ns(n) {
  if (n === 1) {
    var v = document.getElementById('nmi').value.trim();
    if (!v) { document.getElementById('nmi').style.borderColor = 'var(--a1)'; return; }
    S.name = v;
  }
  document.getElementById('s' + n).classList.remove('act');
  document.getElementById('s' + (n + 1)).classList.add('act');
}

function startApp() {
  S.avatar = _selAv;
  S.focuses = _selFoc;
  S.lastActive = new Date().toDateString();
  S.streak = 1;
  save();
  document.getElementById('ob').style.display = 'none';
  document.getElementById('app').classList.add('show');
  checkDailyReset();
  updateUI();
  addDefTodos();
  renderRems();
  renderMilestones();
  renderMotPrev();
  startChecker();
  addInbox('👋 Willkommen!', 'Hey ' + S.name + '! ' + S.avatar.emoji + ' freut sich auf die Reise mit dir!');
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showS(id, btn) {
  document.querySelectorAll('.sec').forEach(function(s) { s.classList.remove('act'); });
  document.querySelectorAll('.nb').forEach(function(b) { b.classList.remove('act'); });
  document.getElementById('sec-' + id).classList.add('act');
  btn.classList.add('act');
  if (id === 'ach') updAch();
  if (id === 'todos') renderTodos(curTab);
}

// ═══════════════════════════════════════════
// TODOS
// ═══════════════════════════════════════════
var CC = {focus:'var(--a4)',home:'var(--a3)',health:'var(--a1)',social:'var(--a5)',work:'var(--a2)'};
var CI = {focus:'🎯',home:'🏠',health:'💚',social:'👥',work:'💼'};
var XM = {easy:10, medium:20, hard:35};
var curTab = 'day';

function togAF() { document.getElementById('addf').classList.toggle('open'); }

function swTab(t, btn) {
  curTab = t;
  document.querySelectorAll('.tbtn').forEach(function(b) { b.classList.remove('act'); });
  btn.classList.add('act');
  renderTodos(t);
}

function addTodo() {
  var tx = document.getElementById('ttxt').value.trim();
  if (!tx) return;
  S.todos.push({
    id: Date.now(),
    text: tx,
    cat: document.getElementById('tcat').value,
    diff: document.getElementById('tdif').value,
    scope: document.getElementById('tsc').value,
    done: false
  });
  document.getElementById('ttxt').value = '';
  document.getElementById('addf').classList.remove('open');
  save();
  renderTodos(curTab);
}

function addDefTodos() {
  var defs = [
    {text:'Tagesplan erstellen',cat:'focus',diff:'easy',scope:'day'},
    {text:'Medikamente nehmen',cat:'health',diff:'easy',scope:'day'},
    {text:'Bewegung (20 Min)',cat:'health',diff:'medium',scope:'day'},
    {text:'Wichtige Aufgabe erledigen',cat:'work',diff:'hard',scope:'day'},
    {text:'Wohnung aufräumen',cat:'home',diff:'medium',scope:'week'},
    {text:'Rechnungen prüfen',cat:'home',diff:'medium',scope:'week'}
  ];
  defs.forEach(function(t) {
    S.todos.push({id: Date.now() + Math.random(), text:t.text, cat:t.cat, diff:t.diff, scope:t.scope, done:false});
  });
  save();
  renderTodos('day');
}

function renderTodos(scope) {
  var el = document.getElementById('todoList');
  var items = S.todos.filter(function(t) { return t.scope === scope; });
  if (!items.length) {
    el.innerHTML = '<div class="empty">Keine Aufgaben – füge deine erste hinzu! ✨</div>';
    return;
  }
  var cats = [];
  items.forEach(function(t) { if (cats.indexOf(t.cat) === -1) cats.push(t.cat); });

  var html = '';
  cats.forEach(function(cat) {
    var its = items.filter(function(t) { return t.cat === cat; });
    html += '<div class="cl"><span class="cd" style="background:' + CC[cat] + '"></span>' + CI[cat] + ' ' + cat[0].toUpperCase() + cat.slice(1) + '</div>';
    its.forEach(function(t) {
      var diffLbl = t.diff === 'easy' ? 'Leicht' : t.diff === 'medium' ? 'Mittel' : 'Schwer';
      var diffCls = t.diff === 'easy' ? 'de' : t.diff === 'medium' ? 'dm' : 'dh';
      var metaLbl = t.done ? '✅ Erledigt' : (scope === 'week' ? 'Diese Woche' : 'Heute');
      var xpLbl = t.done ? '🔒' : '+' + XM[t.diff];
      var clickAttr = t.done ? '' : ' onclick="togTodo(' + t.id + ')"';
      var tapCls = t.done ? '' : ' tap';

      html += '<div class="tdi' + (t.done ? ' done' : '') + tapCls + '" style="border-left-color:' + CC[t.cat] + ';' + (t.done ? 'cursor:default' : '') + '"' + clickAttr + '>';
      html += '<div class="tdcb">' + (t.done ? '✓' : '') + '</div>';
      html += '<div class="tdc"><div class="tdtx">' + t.text + '</div><div class="tdm">' + metaLbl + '</div></div>';
      html += '<div class="tdr">';
      html += '<span class="dif ' + diffCls + '">' + diffLbl + '</span>';
      html += '<span class="tdx">' + xpLbl + '</span>';
      // Edit + Delete – nur wenn nicht erledigt
      if (!t.done) {
        html += '<div class="td-actions">';
        html += '<button class="td-btn td-edit" onclick="editTodo(' + t.id + ');event.stopPropagation()">✏️</button>';
        html += '<button class="td-btn td-del" onclick="delTodo(' + t.id + ');event.stopPropagation()">✕</button>';
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';
});
  });
  el.innerHTML = html;
}

function togTodo(id) {
  var t = null;
  S.todos.forEach(function(td) { if (td.id === id) t = td; });
  if (!t || t.done) return; // locked
  t.done = true;
  addXP(XM[t.diff], '✅ ' + t.text);
  S.totalDone++;
  playSuccessSound();
  save();
  renderTodos(curTab);
  updateUI();
}

function editTodo(id) {
  var t = null;
  S.todos.forEach(function(td) { if (td.id === id) t = td; });
  if (!t) return;

  // Inline-Edit: Formular mit aktuellen Werten vorbelegen
  document.getElementById('ttxt').value = t.text;
  document.getElementById('tcat').value = t.cat;
  document.getElementById('tdif').value = t.diff;
  document.getElementById('tsc').value = t.scope;

  // Speichern-Button umschalten auf Update-Modus
  var btn = document.querySelector('.btsv');
  btn.textContent = '✓ Aktualisieren';
  btn.onclick = function() { updateTodo(id); };

  // Formular öffnen und scrollen
  document.getElementById('addf').classList.add('open');
  document.getElementById('addf').scrollIntoView({ behavior: 'smooth' });
}

function updateTodo(id) {
  var tx = document.getElementById('ttxt').value.trim();
  if (!tx) return;

  S.todos.forEach(function(t) {
    if (t.id === id) {
      t.text = tx;
      t.cat  = document.getElementById('tcat').value;
      t.diff = document.getElementById('tdif').value;
      t.scope = document.getElementById('tsc').value;
      // Kein XP – nur Daten ändern
    }
  });

  // Formular zurücksetzen
  document.getElementById('ttxt').value = '';
  document.getElementById('addf').classList.remove('open');
  var btn = document.querySelector('.btsv');
  btn.textContent = '✓ Speichern';
  btn.onclick = addTodo;

  save();
  renderTodos(curTab);
  showToast('✏️ Aufgabe aktualisiert');
}

function delTodo(id) {
  S.todos = S.todos.filter(function(t) { return t.id !== id; });
  save();
  renderTodos(curTab);
  showToast('🗑️ Aufgabe gelöscht');
}

// ═══════════════════════════════════════════
// QUICK WINS
// ═══════════════════════════════════════════
function cqw(el, xp) {
  if (el.classList.contains('done')) return;
  var key = el.querySelector('.qwt').textContent;
  if (!S.qwDone) S.qwDone = {};
  if (S.qwDone[key]) return;
  S.qwDone[key] = true;
  el.classList.add('done');
  el.querySelector('.qwc').textContent = '✓';
  addXP(xp, '⚡ ' + key);
  playSuccessSound();
  save();
  updateUI();
}

function restoreQWUI() {
  if (!S.qwDone) return;
  document.querySelectorAll('.qwi').forEach(function(el) {
    var key = el.querySelector('.qwt').textContent;
    if (S.qwDone[key]) {
      el.classList.add('done');
      el.querySelector('.qwc').textContent = '✓';
    }
  });
}

function resetQWUI() {
  document.querySelectorAll('.qwi').forEach(function(el) {
    el.classList.remove('done');
    el.querySelector('.qwc').textContent = '';
  });
}

// ═══════════════════════════════════════════
// DAILY / WEEKLY RESET
// ═══════════════════════════════════════════
function getMondayStr() {
  var d = new Date();
  var day = d.getDay();
  var diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff).toDateString();
}

function checkDailyReset() {
  var today = new Date().toDateString();
  var mon = getMondayStr();

  // Streak
  if (!S.lastActive) {
    S.streak = 1;
    S.lastActive = today;
  } else if (S.lastActive !== today) {
    var prev = new Date(S.lastActive);
    var now2 = new Date(today);
    var diff = Math.round((now2 - prev) / 86400000);
    S.streak = diff === 1 ? S.streak + 1 : 1;
    S.lastActive = today;
  }

  // Carry-over BEVOR reset – unerledigte sammeln
  if (S.lastDayReset && S.lastDayReset !== today) {
    buildCarryOver();
  }

  // Daily QW reset
  if (S.lastQWReset !== today) {
    S.lastQWReset = today;
    S.qwDone = {};
    resetQWUI();
  }

  // Daily todo reset
  if (S.lastDayReset !== today) {
    S.lastDayReset = today;
    S.todos.forEach(function(t) {
      if (t.scope === 'day') t.done = false;
    });
  }

  // Weekly todo reset
  if (S.lastWeekReset !== mon) {
    S.lastWeekReset = mon;
    S.todos.forEach(function(t) {
      if (t.scope === 'week') t.done = false;
    });
  }

  save();
}

// ═══════════════════════════════════════════
// CARRY-OVER – unerledigte Todos vom Vortag
// ═══════════════════════════════════════════

var CO_MESSAGES = [
  'Gestern war viel los – kein Problem!',
  'Manchmal läuft der Tag anders als geplant.',
  'Nicht geschafft? Macht nichts – neuer Tag, neue Chance!',
  'Dein Gehirn hat gestern sein Bestes gegeben. 💪',
  'Jeder Tag ist ein Neustart!'
];

function checkCarryOver() {
  // Wurden Todos beim Reset auf done:false gesetzt aber nicht neu erstellt?
  // Wir schauen ob es Todos gibt die gestern waren und nicht erledigt wurden
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var yesterdayStr = yesterday.toDateString();

  // Todos die scope:'day' haben, nicht erledigt sind und deren
  // lastResetDate gestern war
  var carryTodos = S.todos.filter(function(t) {
    return t.scope === 'day' && !t.done && t.createdDate && t.createdDate !== new Date().toDateString();
  });

  // Simpler Ansatz: nach dem daily reset gibt es unerledigte day-todos
  // die vom Vortag stammen – wir tracken das über ein Flag
  if (!S.pendingCarryOver || !S.pendingCarryOver.length) return;

  showCarryOver(S.pendingCarryOver);
}

function buildCarryOver() {
  // Wird in checkDailyReset aufgerufen BEVOR todos resettet werden
  var undone = S.todos.filter(function(t) {
    return t.scope === 'day' && !t.done;
  });
  if (undone.length > 0) {
    S.pendingCarryOver = undone.map(function(t) {
      return { id: t.id, text: t.text, cat: t.cat, diff: t.diff };
    });
  } else {
    S.pendingCarryOver = [];
  }
}

function showCarryOver(items) {
  if (!items || !items.length) return;

  document.getElementById('coAvatar').textContent = S.avatar.emoji;
  document.getElementById('coBadge').textContent = items.length + ' offen';

  var msg = CO_MESSAGES[Math.floor(Math.random() * CO_MESSAGES.length)];
  document.getElementById('coTitle').textContent = msg;
  document.getElementById('coSub').textContent =
    items.length + ' Aufgabe' + (items.length > 1 ? 'n' : '') +
    ' von gestern – was soll damit passieren?';

  var html = '';
  items.forEach(function(t) {
    var catColor = { focus:'var(--a4)', home:'var(--a3)', health:'var(--a1)', social:'var(--a5)', work:'var(--a2)' };
    html += '<div class="co-item" style="border-left-color:' + (catColor[t.cat] || 'var(--s3)') + '" id="co-item-' + t.id + '">';
    html += '<div class="co-item-text">' + t.text + '</div>';
    html += '<div class="co-item-actions">';
    html += '<button class="co-btn co-btn-done" onclick="coMarkDone(' + t.id + ')">✓ War erledigt</button>';
    html += '<button class="co-btn co-btn-move" onclick="coMoveOne(' + t.id + ')">→ Auf heute</button>';
    html += '<button class="co-btn co-btn-del" onclick="coDeleteOne(' + t.id + ')">✕</button>';
    html += '</div></div>';
  });
  document.getElementById('coList').innerHTML = html;
  document.getElementById('carryoverOverlay').classList.add('show');
}

function coRemoveItem(id) {
  var el = document.getElementById('co-item-' + id);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    el.style.transition = 'all .25s ease';
    setTimeout(function() { el.remove(); }, 250);
  }
  S.pendingCarryOver = (S.pendingCarryOver || []).filter(function(t) {
    return t.id !== id;
  });
  var badge = document.getElementById('coBadge');
  var remaining = document.querySelectorAll('[id^="co-item-"]').length - 1;
  if (remaining <= 0) {
    setTimeout(closeCarryOver, 300);
  } else {
    badge.textContent = remaining + ' offen';
  }
}

function coMarkDone(id) {
  // Rückwirkend als erledigt markieren – XP trotzdem geben
  S.todos.forEach(function(t) {
    if (t.id === id) { t.done = true; }
  });
  addXP(5, '✓ Nachträglich erledigt');
  coRemoveItem(id);
  save();
}

function coMoveOne(id) {
  // Auf heute verschieben – done bleibt false
  S.todos.forEach(function(t) {
    if (t.id === id) {
      t.done = false;
      t.createdDate = new Date().toDateString();
    }
  });
  coRemoveItem(id);
  save();
  showToast('→ Auf heute verschoben');
}

function coDeleteOne(id) {
  S.todos = S.todos.filter(function(t) { return t.id !== id; });
  coRemoveItem(id);
  save();
}

function coMoveAll() {
  (S.pendingCarryOver || []).forEach(function(ct) {
    S.todos.forEach(function(t) {
      if (t.id === ct.id) {
        t.done = false;
        t.createdDate = new Date().toDateString();
      }
    });
  });
  S.pendingCarryOver = [];
  save();
  closeCarryOver();
  renderTodos('day');
  showToast('→ Alle auf heute verschoben');
}

function coSkipAll() {
  S.pendingCarryOver = [];
  save();
  closeCarryOver();
}

function closeCarryOver() {
  document.getElementById('carryoverOverlay').classList.remove('show');
  S.pendingCarryOver = [];
  save();
}

// ═══════════════════════════════════════════
// XP & LEVELS
// ═══════════════════════════════════════════
function addXP(amt, desc) {
  S.xp += amt;
  S.xpLog.unshift({amt: amt, desc: desc, time: new Date().toLocaleTimeString('de', {hour:'2-digit', minute:'2-digit'})});
  if (S.xpLog.length > 25) S.xpLog.pop();

  var newLvl = calcLvl(S.xp);
  if (newLvl > S.level) {
    if (newLvl >= MAX_LVL && S.level < MAX_LVL) {
      S.prestige++;
      trigConf();
      setTimeout(function() { showXPP('🏆 PRESTIGE ' + S.prestige + '! Wahnsinn!'); }, 400);
      addInbox('✦ Prestige ' + S.prestige + '!', 'Du hast Level 50 erreicht und steigst ins Prestige ' + S.prestige + ' auf!');
    } else {
      trigConf();
      setTimeout(function() { showXPP('🎉 Level ' + newLvl + ' – ' + getTitle(newLvl) + '!'); }, 300);
      checkMSRewards(newLvl);
    }
    S.level = newLvl;
  } else {
    showXPP('+' + amt + ' XP');
  }
  save();
  updXPBar();
  chkAch();
}

function updXPBar() {
  var curr = xpForLvl(S.level);
  var next = xpForNext(S.level);
  var range = next - curr;
  var pct = S.level >= MAX_LVL ? 100 : Math.min(100, Math.round(((S.xp - curr) / range) * 100));
  document.getElementById('xpf').style.width = pct + '%';
  document.getElementById('xpl').textContent = (S.xp - curr) + '/' + range;
}

function checkMSRewards(lvl) {
  MILESTONES.forEach(function(ms) {
    if (ms.l === lvl) {
      trigConf();
      addInbox('🏅 Meilenstein: ' + ms.n, 'Du hast Level ' + ms.l + ' erreicht! ' + ms.i);
    }
  });
}

// ═══════════════════════════════════════════
// UI UPDATE
// ═══════════════════════════════════════════
function updateUI() {
  var t = getTitle(S.level);
  var e = getEmoji(S.level);
  document.getElementById('tav').textContent = S.avatar.emoji;
  document.getElementById('tnm').textContent = S.name;
  document.getElementById('tlv').textContent = 'Lv.' + S.level + ' • ' + t;
  document.getElementById('sbd').textContent = '🔥 ' + S.streak;
  document.getElementById('bav').textContent = S.avatar.emoji;
  document.getElementById('dname').textContent = S.name;
  document.getElementById('dcomp').textContent = S.avatar.emoji + ' ' + S.avatar.name + ' ist an deiner Seite';
  document.getElementById('dlvl').textContent = 'Level ' + S.level;
  document.getElementById('dtit').textContent = t;
  document.getElementById('stxp').textContent = S.xp;
  document.getElementById('stdn').textContent = S.totalDone;
  document.getElementById('stst').textContent = S.streak;

  var showP = S.prestige > 0;
  document.getElementById('psb').classList.toggle('show', showP);
  document.getElementById('psbn').textContent = S.prestige;

  updXPBar();
  updDP();
}

function updDP() {
  var day = S.todos.filter(function(t) { return t.scope === 'day'; });
  var doneTodos = day.filter(function(t) { return t.done; }).length;
  var qwDone = document.querySelectorAll('.qwi.done').length;
  var qwTotal = document.querySelectorAll('.qwi').length;
  var total = day.length + qwTotal;
  var done = doneTodos + qwDone;
  var pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('dpf').style.width = pct + '%';
  document.getElementById('dpp').textContent = pct + '%';
}

// ═══════════════════════════════════════════
// ACHIEVEMENTS
// ═══════════════════════════════════════════
function chkAch() {
  var cs = document.querySelectorAll('#achg .ac');
  if (S.totalDone >= 10 && cs[1]) cs[1].classList.replace('locked','unlocked');
  if (S.streak >= 3 && cs[2]) cs[2].classList.replace('locked','unlocked');
  if (S.xp >= 500 && cs[3]) cs[3].classList.replace('locked','unlocked');
  if (S.totalDone >= 25 && cs[4]) cs[4].classList.replace('locked','unlocked');
  if (S.level >= 10 && cs[5]) cs[5].classList.replace('locked','unlocked');
  if (S.xp >= 2000 && cs[6]) cs[6].classList.replace('locked','unlocked');
  if (S.prestige >= 1 && cs[7]) cs[7].classList.replace('locked','unlocked');
}

function updAch() {
  var t = getTitle(S.level);
  var e = getEmoji(S.level);
  document.getElementById('scnum').textContent = S.xp;
  document.getElementById('achlv').textContent = 'Level ' + S.level + ' – ' + t + ' ' + e;
  var curr = xpForLvl(S.level), next = xpForNext(S.level);
  var pct = S.level >= MAX_LVL ? 100 : Math.min(100, Math.round(((S.xp-curr)/(next-curr))*100));
  document.getElementById('achxpb').style.width = pct + '%';
  document.getElementById('achnxt').textContent = S.level >= MAX_LVL ? 'Max Level! Prestige wartet…' : (next - S.xp) + ' XP bis nächstes Level';
  document.getElementById('achpsb').classList.toggle('show', S.prestige > 0);
  document.getElementById('achpsbn').textContent = S.prestige;
  chkAch();
  renderMilestones();
  var el = document.getElementById('xlog');
  if (!S.xpLog.length) { el.innerHTML = '<div class="empty">Noch keine XP – leg los! 🚀</div>'; return; }
  var h = '';
  S.xpLog.forEach(function(e2) {
    h += '<div class="li"><span class="lic">⭐</span><span class="lid">' + e2.desc + '</span><span class="lx">+' + e2.amt + '</span><span class="lt">' + e2.time + '</span></div>';
  });
  el.innerHTML = h;
}

function renderMilestones() {
  var h = '';
  MILESTONES.forEach(function(ms) {
    var done = S.level >= ms.l;
    h += '<div class="msi"><span class="msic">' + ms.i + '</span>';
    h += '<div class="msin"><div class="msnm">' + ms.n + '</div><div class="msds">Level ' + ms.l + ' erreichen</div></div>';
    h += '<span class="msbg ' + (done ? 'msd' : 'msl') + '">' + (done ? '✓ Erreicht' : 'Lv.' + ms.l) + '</span></div>';
  });
  document.getElementById('mslist').innerHTML = h;
}

// ═══════════════════════════════════════════
// STRATEGIES & INFO
// ═══════════════════════════════════════════
function tgsc(c) { c.classList.toggle('open'); }
function fstr(cat, btn) {
  document.querySelectorAll('.stb').forEach(function(b) { b.classList.remove('act'); });
  btn.classList.add('act');
  document.querySelectorAll('.scc').forEach(function(c) {
    c.style.display = (cat === 'all' || c.dataset.c === cat) ? 'block' : 'none';
  });
}
function tgac(el) { el.classList.toggle('open'); }

// ═══════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════
var tSec = 25*60, tRun = false, tLbl = 'Fokus-Phase', tInt = null;

function setTim(m, l) {
  clearInterval(tInt);
  tRun = false; tSec = m * 60; tLbl = l;
  document.getElementById('tl').textContent = l;
  document.getElementById('tsb').textContent = '▶ Start';
  document.getElementById('tc').classList.remove('run');
  renderTim();
}

function togTim() {
  if (tRun) {
    clearInterval(tInt); tRun = false;
    document.getElementById('tsb').textContent = '▶ Fortsetzen';
    document.getElementById('tc').classList.remove('run');
  } else {
    tRun = true;
    document.getElementById('tsb').textContent = '⏸ Pause';
    document.getElementById('tc').classList.add('run');
    tInt = setInterval(function() {
      tSec--;
      renderTim();
      if (tSec <= 0) {
        clearInterval(tInt); tRun = false;
        document.getElementById('tsb').textContent = '▶ Start';
        document.getElementById('tc').classList.remove('run');
        addXP(20, '⏱️ ' + tLbl + ' abgeschlossen');
        showToast('⏱️ ' + tLbl + ' fertig! +20 XP');
        playAlarmSound();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        updateUI();
      }
    }, 1000);
  }
}

function renderTim() {
  var m = String(Math.floor(tSec / 60)).padStart(2, '0');
  var s = String(tSec % 60).padStart(2, '0');
  document.getElementById('td').textContent = m + ':' + s;
}

// ═══════════════════════════════════════════
// NOTIFICATION PANEL
// ═══════════════════════════════════════════
var npOpen = false;

function toggleNP() {
  npOpen = !npOpen;
  var panel = document.getElementById('npanel');
  panel.classList.toggle('open', npOpen);
  if (npOpen) {
    document.getElementById('ndot').classList.remove('show');
    renderInbox();
    // iOS: prevent body scroll when panel open
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

function npOutside(e) {
  if (e.target === document.getElementById('npanel')) {
    npOpen = false;
    document.getElementById('npanel').classList.remove('open');
    document.body.style.overflow = '';
  }
}

function switchNTab(tab, btn) {
  document.querySelectorAll('.nptab').forEach(function(b) { b.classList.remove('act'); });
  document.querySelectorAll('[id^="npt-"]').forEach(function(c) { c.style.display = 'none'; });
  btn.classList.add('act');
  document.getElementById('npt-' + tab).style.display = 'block';
  if (tab === 'inbox') renderInbox();
}

// ═══════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════
function addRem() {
  var n = document.getElementById('rname').value.trim();
  var t = document.getElementById('rtime').value;
  if (!n || !t) { showToast('⚠️ Name und Uhrzeit angeben!'); return; }
  S.reminders.push({
    id: Date.now(),
    name: n,
    icon: document.getElementById('rico').value,
    time: t,
    repeat: document.getElementById('rrep').value,
    active: true,
    lastFired: null
  });
  document.getElementById('rname').value = '';
  save();
  renderRems();
  showToast('✅ ' + n + ' um ' + t + ' Uhr gespeichert');
}

function renderRems() {
  var el   = document.getElementById('remList');
  var wrap = document.getElementById('icsExportWrap');
  var rlab = {
    daily:'Täglich', weekdays:'Mo–Fr',
    weekly:'Wöchentlich', once:'Einmalig'
  };

  if (!S.reminders.length) {
    el.innerHTML = '<div class="empty">Noch keine Erinnerungen</div>';
    wrap.style.display = 'none';
    return;
  }

  // Export-Button nur zeigen wenn mind. 1 aktive Erinnerung
  var hasActive = S.reminders.some(function(r) { return r.active; });
  wrap.style.display = hasActive ? 'block' : 'none';

  var h = '';
  S.reminders.forEach(function(r) {
    h += '<div class="ritem ' + (r.active ? '' : 'paused') + '">';
    h += '<span class="ric">' + r.icon + '</span>';
    h += '<div class="rinfo">';
    h += '<div class="rname">' + r.name + '</div>';
    h += '<div class="rwhen">🕐 ' + r.time + ' – ' + rlab[r.repeat] + '</div>';
    h += '</div>';
    h += '<div class="ract">';
    h += '<button class="rbtn rbtog" onclick="togRem(' + r.id + ')">' + (r.active ? '⏸' : '▶') + '</button>';
    h += '<button class="rbtn rbdel" onclick="delRem(' + r.id + ')">✕</button>';
    h += '</div>';
    h += '</div>';
  });
  el.innerHTML = h;
}

function togRem(id) {
  S.reminders.forEach(function(r) { if (r.id === id) r.active = !r.active; });
  save(); renderRems();
}

function delRem(id) {
  S.reminders = S.reminders.filter(function(r) { return r.id !== id; });
  save(); renderRems();
}

function editRem(id) {
  var r = null;
  S.reminders.forEach(function(rem) { if (rem.id === id) r = rem; });
  if (!r) return;

  // Formular mit aktuellen Werten vorbelegen
  document.getElementById('rname').value = r.name;
  document.getElementById('rico').value  = r.icon;
  document.getElementById('rtime').value = r.time;
  document.getElementById('rrep').value  = r.repeat;

  // Speichern-Button auf Update schalten
  var btn = document.querySelector('.btnrem');
  btn.textContent = 'Aktualisieren';
  btn.onclick = function() { updateRem(id); };
}

function updateRem(id) {
  var n = document.getElementById('rname').value.trim();
  var t = document.getElementById('rtime').value;
  if (!n || !t) { showToast('⚠️ Name und Uhrzeit angeben!'); return; }

  S.reminders.forEach(function(r) {
    if (r.id === id) {
      r.name   = n;
      r.icon   = document.getElementById('rico').value;
      r.time   = t;
      r.repeat = document.getElementById('rrep').value;
      r.lastFired = null; // Reset damit sie neu feuern kann
    }
  });

  // Button zurücksetzen
  var btn = document.querySelector('.btnrem');
  btn.textContent = 'Speichern';
  btn.onclick = addRem;

  save();
  renderRems();
  showToast('✏️ Erinnerung aktualisiert');
}

// ═══════════════════════════════════════════
// REMINDER CHECKER — runs every 30s
// ═══════════════════════════════════════════
function startChecker() {
  checkRems();
  setInterval(checkRems, 30000);
  setInterval(checkMotPush, 60000);
}

function checkRems() {
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var hhmm = hh + ':' + mm;
  var day = now.getDay();
  var today = now.toDateString();

  S.reminders.forEach(function(r) {
    if (!r.active) return;
    if (r.time !== hhmm) return;
    if (r.lastFired === today) return;
    var fire = r.repeat === 'daily' ||
               (r.repeat === 'weekdays' && day >= 1 && day <= 5) ||
               r.repeat === 'once' ||
               (r.repeat === 'weekly' && day === 1);
    if (fire) {
      r.lastFired = today;
      showAlarm(r.icon, r.name, 'Es ist ' + r.time + ' Uhr – Zeit für: ' + r.name);
      addInbox(r.icon + ' ' + r.name, 'Erinnerung um ' + r.time + ' Uhr');
      addXP(5, r.icon + ' Erinnerung: ' + r.name);
      updateUI();
      if (r.repeat === 'once') r.active = false;
      save();
      renderRems();
    }
  });
}

function saveMotTime() {
  S.motivTime = document.getElementById('mottime').value;
  save();
  showToast('💪 Täglich um ' + S.motivTime + ' Uhr');
}

function checkMotPush() {
  var now = new Date();
  var hhmm = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  if (hhmm === S.motivTime) {
    var msg = MOVS[Math.floor(Math.random() * MOVS.length)];
    showAlarm(S.avatar.emoji, 'Tages-Motivation', msg);
    addInbox(S.avatar.emoji + ' Motivation', msg);
    document.getElementById('ndot').classList.add('show');
  }
}

function renderMotPrev() {
  var h = '';
  MOVS.slice(0, 4).forEach(function(m) {
    h += '<div class="mitem"><div class="mitxt">"' + m + '"</div><div class="mim">' + S.avatar.emoji + ' ' + (S.avatar.name || 'Dein Begleiter') + '</div></div>';
  });
  document.getElementById('motprev').innerHTML = h;
}

// ═══════════════════════════════════════════
// INBOX
// ═══════════════════════════════════════════
function addInbox(title, body) {
  S.inbox.unshift({
    title: title, body: body,
    time: new Date().toLocaleString('de', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}),
    unread: true
  });
  if (S.inbox.length > 30) S.inbox.pop();
  save();
  document.getElementById('ndot').classList.add('show');
}

function renderInbox() {
  var el = document.getElementById('inboxList');
  if (!S.inbox.length) {
    el.innerHTML = '<div class="empty">Noch keine Nachrichten 📭</div>';
    return;
  }
  var h = '';
  S.inbox.forEach(function(item) {
    h += '<div class="iitem ' + (item.unread ? 'unread' : '') + '">';
    h += '<span class="iiic">📬</span>';
    h += '<div class="iii"><div class="iit">' + item.title + '</div><div class="iib">' + item.body + '</div><div class="iitm">' + item.time + '</div></div>';
    h += '</div>';
  });
  el.innerHTML = h;
  S.inbox.forEach(function(i) { i.unread = false; });
  save();
}

// ═══════════════════════════════════════════
// XP POPUP
// ═══════════════════════════════════════════
function showXPP(txt) {
  var p = document.createElement('div');
  p.className = 'xpp';
  p.textContent = txt;
  document.body.appendChild(p);
  setTimeout(function() {
    p.style.opacity = '0';
    p.style.transition = 'opacity .3s';
    setTimeout(function() { p.remove(); }, 300);
  }, 1700);
}

// ═══════════════════════════════════════════
// CONFETTI
// ═══════════════════════════════════════════
function trigConf() {
  var cv = document.getElementById('cvc');
  var ctx = cv.getContext('2d');
  cv.width = window.innerWidth;
  cv.height = window.innerHeight;
  var cols = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#c77dff'];
  var pts = [];
  for (var i = 0; i < 80; i++) {
    pts.push({
      x: Math.random() * cv.width, y: -10,
      r: Math.random() * 5 + 3, d: Math.random() * 2.5 + 1,
      col: cols[Math.floor(Math.random() * 5)],
      t: 0, ts: Math.random() * .07 + .04
    });
  }
  var f = 0;
  function run() {
    if (f++ > 150) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
    ctx.clearRect(0, 0, cv.width, cv.height);
    pts.forEach(function(p) {
      p.t += p.ts; p.y += p.d * 3; p.x += Math.sin(p.t) * 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.col; ctx.fill();
    });
    requestAnimationFrame(run);
  }
  run();
}

// ═══════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════
function save() {
  try { localStorage.setItem('fp4', JSON.stringify(S)); } catch(e) {}
}

function load() {
  try {
    var d = localStorage.getItem('fp4');
    if (d) {
      var parsed = JSON.parse(d);
      // Merge with defaults to handle new keys
      Object.keys(parsed).forEach(function(k) { S[k] = parsed[k]; });
      return true;
    }
  } catch(e) {}
  return false;
}

// ═══════════════════════════════════════════
// SELBSTCHECK
// ═══════════════════════════════════════════

var CHECK_P1 = [
  // Unaufmerksamkeit (Items 1-9 ADHS-SB angelehnt)
  { id:'p1_1',  cat:'Unaufmerksamkeit', text:'Ich bin unaufmerksam gegenüber Details oder mache Flüchtigkeitsfehler bei der Arbeit.' },
  { id:'p1_2',  cat:'Unaufmerksamkeit', text:'Es fällt mir schwer, bei Aufgaben oder Aktivitäten konzentriert zu bleiben.' },
  { id:'p1_3',  cat:'Unaufmerksamkeit', text:'Ich höre Gesprächspartnern nicht richtig zu.' },
  { id:'p1_4',  cat:'Unaufmerksamkeit', text:'Ich habe Schwierigkeiten, Aufgaben so auszuführen wie erklärt oder angewiesen.' },
  { id:'p1_5',  cat:'Unaufmerksamkeit', text:'Es fällt mir schwer, Aufgaben, Vorhaben oder Aktivitäten zu organisieren.' },
  { id:'p1_6',  cat:'Unaufmerksamkeit', text:'Ich gehe Aufgaben, die geistige Anstrengung erfordern, am liebsten aus dem Weg.' },
  { id:'p1_7',  cat:'Unaufmerksamkeit', text:'Ich verlege oder verliere wichtige Gegenstände (z.B. Schlüssel, Handy, Dokumente).' },
  { id:'p1_8',  cat:'Unaufmerksamkeit', text:'Ich lasse mich bei Tätigkeiten leicht ablenken.' },
  { id:'p1_9',  cat:'Unaufmerksamkeit', text:'Ich vergesse Verabredungen, Termine oder wichtige Aufgaben.' },
  // Hyperaktivität (Items 10-14)
  { id:'p1_10', cat:'Hyperaktivität', text:'Ich bin zappelig oder fühle mich innerlich unruhig.' },
  { id:'p1_11', cat:'Hyperaktivität', text:'Es fällt mir schwer, längere Zeit ruhig zu sitzen (z.B. bei Meetings, im Kino).' },
  { id:'p1_12', cat:'Hyperaktivität', text:'Ich fühle mich innerlich unruhig oder angespannt.' },
  { id:'p1_13', cat:'Hyperaktivität', text:'Ich kann mich schlecht leise oder ruhig beschäftigen.' },
  { id:'p1_14', cat:'Hyperaktivität', text:'Ich bin ständig auf Achse und fühle mich wie von einem Motor angetrieben.' },
  // Impulsivität (Items 15-18)
  { id:'p1_15', cat:'Impulsivität', text:'Mir fällt es schwer abzuwarten – ich falle anderen ins Wort oder beende Sätze.' },
  { id:'p1_16', cat:'Impulsivität', text:'Ich bin ungeduldig und kann schlecht warten (z.B. in der Schlange, im Gespräch).' },
  { id:'p1_17', cat:'Impulsivität', text:'Ich unterbreche oder störe andere bei dem, was sie gerade tun.' },
  { id:'p1_18', cat:'Impulsivität', text:'Ich rede viel, auch wenn die Situation es nicht erfordert.' },
  // Validierung (Items 19-22)
  { id:'p1_19', cat:'Verlauf', text:'Diese Schwierigkeiten hatte ich bereits in der Schul- oder Jugendzeit.' },
  { id:'p1_20', cat:'Verlauf', text:'Diese Schwierigkeiten zeigen sich nicht nur bei der Arbeit, sondern auch privat.' },
  { id:'p1_21', cat:'Verlauf', text:'Ich leide unter diesen Schwierigkeiten.' },
  { id:'p1_22', cat:'Verlauf', text:'Diese Schwierigkeiten haben mir im Beruf oder in Beziehungen Probleme bereitet.' }
];

var CHECK_P2 = [
  // Unaufmerksamkeit
  { id:'p2_1',  cat:'Unaufmerksamkeit', text:'Ich habe Schwierigkeiten, meine Aufmerksamkeit bei der Arbeit aufrechtzuerhalten.' },
  { id:'p2_2',  cat:'Unaufmerksamkeit', text:'Dinge, die ich sehe oder höre, lenken mich leicht von dem ab, was ich gerade tue.' },
  { id:'p2_3',  cat:'Unaufmerksamkeit', text:'Im Alltag bin ich vergesslich.' },
  { id:'p2_4',  cat:'Unaufmerksamkeit', text:'Ich habe Schwierigkeiten, mehrere Dinge gleichzeitig im Blick zu behalten.' },
  { id:'p2_5',  cat:'Unaufmerksamkeit', text:'Ich kann mich nur schwer konzentrieren, außer wenn etwas wirklich interessant ist.' },
  { id:'p2_6',  cat:'Unaufmerksamkeit', text:'Ich bin schlecht organisiert.' },
  { id:'p2_7',  cat:'Unaufmerksamkeit', text:'Ich verliere Dinge, die ich für Aufgaben oder Aktivitäten brauche.' },
  { id:'p2_8',  cat:'Unaufmerksamkeit', text:'Ich habe Schwierigkeiten, mit einer Aufgabe zu beginnen.' },
  // Hyperaktivität
  { id:'p2_9',  cat:'Hyperaktivität', text:'Ich bin immer auf Achse, wie von einem Motor angetrieben.' },
  { id:'p2_10', cat:'Hyperaktivität', text:'Ich kann nur schwer für sehr lange Zeit an einem Platz bleiben.' },
  { id:'p2_11', cat:'Hyperaktivität', text:'Ich bin immer in Bewegung, auch wenn ich eigentlich ruhig sein sollte.' },
  { id:'p2_12', cat:'Hyperaktivität', text:'Ich fühle mich innerlich unruhig, selbst wenn ich still sitze.' },
  { id:'p2_13', cat:'Hyperaktivität', text:'Ich neige dazu, herumzurutschen oder zu zappeln.' },
  // Impulsivität
  { id:'p2_14', cat:'Impulsivität', text:'Ich platze mit Dingen heraus, ohne vorher nachzudenken.' },
  { id:'p2_15', cat:'Impulsivität', text:'Ich sage Dinge, ohne darüber nachzudenken.' },
  { id:'p2_16', cat:'Impulsivität', text:'Ich antworte auf Fragen, bevor diese zu Ende gestellt sind.' },
  { id:'p2_17', cat:'Impulsivität', text:'Ich bin leicht aufbrausend oder reizbar.' },
  { id:'p2_18', cat:'Impulsivität', text:'Viele Dinge können mich leicht irritieren.' },
  // Emotionales Erleben
  { id:'p2_19', cat:'Emotionales Erleben', text:'Ich bin übermäßig selbstkritisch.' },
  { id:'p2_20', cat:'Emotionales Erleben', text:'Ich bin nicht selbstsicher.' },
  { id:'p2_21', cat:'Emotionales Erleben', text:'Ich vermeide neue Herausforderungen, weil ich meinen Fähigkeiten nicht vertraue.' },
  { id:'p2_22', cat:'Emotionales Erleben', text:'Mein Versagen in der Vergangenheit macht es mir schwer, an mich selbst zu glauben.' },
  { id:'p2_23', cat:'Emotionales Erleben', text:'Ich wünschte, ich hätte mehr Vertrauen in meine Fähigkeiten.' },
  { id:'p2_24', cat:'Emotionales Erleben', text:'Meine Launen sind unvorhersehbar und wechseln schnell.' },
  { id:'p2_25', cat:'Emotionales Erleben', text:'Ich bin schnell gelangweilt.' },
  // Alltag
  { id:'p2_26', cat:'Unaufmerksamkeit', text:'Ich beende angefangene Tätigkeiten oft nicht.' },
  { id:'p2_27', cat:'Unaufmerksamkeit', text:'Ich erledige Dinge oft nur unter hohem äußerem Termindruck.' },
  { id:'p2_28', cat:'Hyperaktivität', text:'Ich suche mir schnelle, aufregende Aktivitäten.' }
];

var checkAnswers1 = {};
var checkAnswers2 = {};

var P1_LABELS = ['Trifft nicht zu', 'Selten', 'Oft', 'Fast immer'];
var P2_LABELS = ['Überhaupt nicht', 'Ein wenig', 'Stark/häufig', 'Sehr stark'];

// Render Fragen
var CAT_META = {
  'Unaufmerksamkeit':     { icon: '🎯', color: 'var(--a4)' },
  'Hyperaktivität':       { icon: '⚡', color: 'var(--a2)' },
  'Impulsivität':         { icon: '🌊', color: 'var(--a1)' },
  'Emotionales Erleben':  { icon: '💭', color: 'var(--a5)' },
  'Verlauf':              { icon: '📅', color: 'var(--tm)' }
};

function renderCheckQuestions(questions, answers, containerId, labels) {
  var el = document.getElementById(containerId);
  var html = '';
  var currentCat = null;
  var catCounts = {};

  // Vorzählen pro Kategorie
  questions.forEach(function(q) {
    catCounts[q.cat] = (catCounts[q.cat] || 0) + 1;
  });
  var catSeen = {};

  questions.forEach(function(q, idx) {
    // Neuer Kategorie-Block
    if (q.cat !== currentCat) {
      currentCat = q.cat;
      catSeen[q.cat] = 0;
      var meta = CAT_META[q.cat] || { icon: '📋', color: 'var(--a4)' };
      html += '<div class="cq-cat-header" style="border-left-color:' + meta.color + '">';
      html += '<span class="cq-cat-icon">' + meta.icon + '</span>';
      html += '<span class="cq-cat-title">' + q.cat + '</span>';
      html += '<span class="cq-cat-count">' + catCounts[q.cat] + ' Fragen</span>';
      html += '</div>';
    }

    catSeen[q.cat]++;
    var answered = answers[q.id] !== undefined;
    var qNumInCat = catSeen[q.cat];

    html += '<div class="cq-card ' + (answered ? 'answered' : '') + '" id="cq-' + q.id + '">';
    html += '<div class="cq-num">Frage ' + qNumInCat + ' / ' + catCounts[q.cat] + '</div>';
    html += '<div class="cq-text">' + q.text + '</div>';
    html += '<div class="cq-options">';

    for (var v = 0; v < labels.length; v++) {
      var sel = answers[q.id] === v ? ' sel-' + v : '';
      html += '<button class="cq-opt' + sel + '" ';
      html += 'onclick="selectAnswer(\'' + q.id + '\',' + v + ',\'' + containerId + '\')">';
      html += '<span style="font-size:1rem;display:block;margin-bottom:2px">' + v + '</span>';
      html += labels[v];
      html += '</button>';
    }

    html += '</div></div>';
  });

  el.innerHTML = html;
}

function selectAnswer(qid, val, part) {
  var isPart1 = part === 'part1Questions';
  var answers = isPart1 ? checkAnswers1 : checkAnswers2;
  var questions = isPart1 ? CHECK_P1 : CHECK_P2;
  var labels = isPart1 ? P1_LABELS : P2_LABELS;

  answers[qid] = val;

  // Update this card visually
  var card = document.getElementById('cq-' + qid);
  if (card) {
    card.classList.add('answered');
    var opts = card.querySelectorAll('.cq-opt');
    opts.forEach(function(opt, i) {
      opt.className = 'cq-opt' + (i === val ? ' sel-' + val : '');
    });
  }

  updateCheckProgress(questions, answers, isPart1);
}

function updateCheckProgress(questions, answers, isPart1) {
  var done = Object.keys(answers).length;
  // Count only relevant questions for current part
  var relevant = isPart1 ? CHECK_P1.length : CHECK_P2.length;
  var total = CHECK_P1.length + CHECK_P2.length;
  var p1done = Object.keys(checkAnswers1).length;
  var p2done = Object.keys(checkAnswers2).length;
  var allDone = p1done + p2done;

  document.getElementById('checkProgressCard').style.display = 'block';
  var pct = Math.round((allDone / total) * 100);
  document.getElementById('checkProgressBar').style.width = pct + '%';
  document.getElementById('checkProgressPct').textContent = pct + '%';
  document.getElementById('checkProgressLabel').textContent =
    isPart1 ? ('Teil 1: ' + p1done + ' / ' + CHECK_P1.length + ' beantwortet')
            : ('Teil 2: ' + p2done + ' / ' + CHECK_P2.length + ' beantwortet');
}

function submitPart1() {
  var missing = CHECK_P1.filter(function(q) {
    return checkAnswers1[q.id] === undefined;
  });
  if (missing.length > 0) {
    showToast('⚠️ Noch ' + missing.length + ' Fragen offen!');
    // Scroll to first unanswered
    var firstMissing = document.getElementById('cq-' + missing[0].id);
    if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  document.getElementById('checkPart1').style.display = 'none';
  document.getElementById('checkPart2').style.display = 'block';
  renderCheckQuestions(CHECK_P2, checkAnswers2, 'part2Questions', P2_LABELS);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backToPart1() {
  document.getElementById('checkPart2').style.display = 'none';
  document.getElementById('checkPart1').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function submitPart2() {
  var missing = CHECK_P2.filter(function(q) {
    return checkAnswers2[q.id] === undefined;
  });
  if (missing.length > 0) {
    showToast('⚠️ Noch ' + missing.length + ' Fragen offen!');
    var firstMissing = document.getElementById('cq-' + missing[0].id);
    if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  showCheckResult();
}

// ── AUSWERTUNG ──
function calcCheckScores() {
  var cats = {
    'Unaufmerksamkeit': { sum: 0, max: 0 },
    'Hyperaktivität':   { sum: 0, max: 0 },
    'Impulsivität':     { sum: 0, max: 0 },
    'Emotionales Erleben': { sum: 0, max: 0 },
    'Verlauf':          { sum: 0, max: 0 }
  };

  CHECK_P1.forEach(function(q) {
    var v = checkAnswers1[q.id];
    if (v !== undefined && cats[q.cat]) {
      cats[q.cat].sum += v;
      cats[q.cat].max += 3;
    }
  });
  CHECK_P2.forEach(function(q) {
    var v = checkAnswers2[q.id];
    if (v !== undefined && cats[q.cat]) {
      cats[q.cat].sum += v;
      cats[q.cat].max += 3;
    }
  });

  var result = {};
  Object.keys(cats).forEach(function(cat) {
    var c = cats[cat];
    result[cat] = c.max > 0 ? Math.round((c.sum / c.max) * 100) : 0;
  });
  return result;
}

function getLevel(pct) {
  if (pct < 30) return 'low';
  if (pct < 60) return 'mid';
  return 'high';
}

function getLevelLabel(pct) {
  if (pct < 30) return 'Gering';
  if (pct < 60) return 'Mittel';
  return 'Stark ausgeprägt';
}

function showCheckResult() {
  document.getElementById('checkPart2').style.display = 'none';
  document.getElementById('checkResult').style.display = 'block';
  document.getElementById('checkProgressCard').style.display = 'none';

  var scores = calcCheckScores();

  // Overall assessment
  var mainCats = ['Unaufmerksamkeit', 'Hyperaktivität', 'Impulsivität'];
  var avg = 0;
  mainCats.forEach(function(c) { avg += scores[c]; });
  avg = Math.round(avg / 3);

  var emoji, title, summary;
  if (avg < 30) {
    emoji = '✅';
    title = 'Wenig Auffälligkeiten';
    summary = 'In den Kernbereichen zeigen sich aktuell wenige typische ADHS-Muster. Das bedeutet nicht zwingend, dass keine ADHS vorliegt – es können auch ausgeprägte Kompensationsstrategien vorliegen.';
  } else if (avg < 55) {
    emoji = '🔶';
    title = 'Einige Muster erkennbar';
    summary = 'Es zeigen sich einige Muster, die typisch für ADHS sein können. Eine professionelle Abklärung könnte sinnvoll sein, insbesondere wenn du dich durch diese Schwierigkeiten belastet fühlst.';
  } else {
    emoji = '🔴';
    title = 'Viele Muster stark ausgeprägt';
    summary = 'Es zeigen sich viele und teils stark ausgeprägte Muster, die auf ADHS hinweisen können. Wir empfehlen eine professionelle Abklärung bei einem Psychiater oder einer ADHS-Ambulanz.';
  }

  document.getElementById('resultEmoji').textContent = emoji;
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultSummary').textContent = summary;

  // Balken
  var barsHtml = '';
  var catIcons = {
    'Unaufmerksamkeit': '🎯',
    'Hyperaktivität': '⚡',
    'Impulsivität': '🌊',
    'Emotionales Erleben': '💭',
    'Verlauf': '📅'
  };
  Object.keys(scores).forEach(function(cat) {
    var pct = scores[cat];
    var level = getLevel(pct);
    var lbl = getLevelLabel(pct);
    barsHtml += '<div class="result-bar-wrap">';
    barsHtml += '<div class="rb-header">';
    barsHtml += '<span class="rb-label">' + (catIcons[cat] || '') + ' ' + cat + '</span>';
    barsHtml += '<span class="rb-pct">' + pct + '% – ' + lbl + '</span>';
    barsHtml += '</div>';
    barsHtml += '<div class="rb-track"><div class="rb-fill rb-' + level + '" style="width:' + pct + '%"></div></div>';
    barsHtml += '</div>';
  });
  document.getElementById('resultBars').innerHTML = barsHtml;

  // Hinweise
  var hints = {
    'Unaufmerksamkeit': {
      low:  { title: 'Unaufmerksamkeit: Gering', text: 'Konzentration und Organisation bereiten dir aktuell wenig Probleme.' },
      mid:  { title: 'Unaufmerksamkeit: Mittel', text: 'Du merkst, dass Fokus und Organisation manchmal anstrengend sind. Strategien wie Pomodoro oder ALPEN-Methode können helfen.' },
      high: { title: 'Unaufmerksamkeit: Stark', text: 'Ablenkbarkeit, Vergesslichkeit und Organisationsprobleme scheinen deinen Alltag deutlich zu belasten. Das ist ein häufiges Kernmerkmal von ADHS.' }
    },
    'Hyperaktivität': {
      low:  { title: 'Hyperaktivität: Gering', text: 'Innere Unruhe und Bewegungsdrang spielen aktuell eine geringe Rolle.' },
      mid:  { title: 'Hyperaktivität: Mittel', text: 'Du erlebst manchmal innere Unruhe oder den Drang zur Bewegung. Regelmäßige Bewegung und Pausen können stark helfen.' },
      high: { title: 'Hyperaktivität: Stark', text: 'Das Gefühl, ständig „auf Achse" zu sein und sich schwer beruhigen zu können, ist belastend und typisch für ADHS.' }
    },
    'Impulsivität': {
      low:  { title: 'Impulsivität: Gering', text: 'Impulsives Verhalten zeigt sich aktuell kaum.' },
      mid:  { title: 'Impulsivität: Mittel', text: 'Manchmal handelst oder sprichst du schneller als gewollt. Die Stopp-Technik und Impulskontroll-Übungen können hier helfen.' },
      high: { title: 'Impulsivität: Stark', text: 'Impulsivität belastet dich im Alltag deutlich – im Gespräch, bei Entscheidungen oder im sozialen Miteinander.' }
    },
    'Emotionales Erleben': {
      low:  { title: 'Emotionales Erleben: Stabil', text: 'Selbstzweifel und emotionale Schwankungen sind aktuell wenig ausgeprägt.' },
      mid:  { title: 'Emotionales Erleben: Mittel', text: 'Du erlebst phasenweise Selbstzweifel oder Stimmungsschwankungen. Das ist bei ADHS häufig und gut behandelbar.' },
      high: { title: 'Emotionales Erleben: Belastend', text: 'Starke Selbstkritik, Stimmungsschwankungen und Selbstzweifel können auf emotionale Dysregulation hinweisen – ein häufiges Begleitmerkmal bei ADHS.' }
    },
    'Verlauf': {
      low:  { title: 'Verlauf: Aktuell begrenzt', text: 'Die Schwierigkeiten scheinen aktuell weniger ausgeprägt oder beeinträchtigen dich wenig.' },
      mid:  { title: 'Verlauf: Vorhanden', text: 'Die Schwierigkeiten zeigen sich in mehreren Lebensbereichen und belasten dich.' },
      high: { title: 'Verlauf: Durchgängig', text: 'Die Schwierigkeiten sind schon lange vorhanden, zeigen sich in vielen Lebensbereichen und belasten dich erheblich. Das ist ein wichtiger Hinweis für eine Fachperson.' }
    }
  };

  var hintHtml = '';
  Object.keys(scores).forEach(function(cat) {
    var level = getLevel(scores[cat]);
    var h = hints[cat][level];
    hintHtml += '<div class="hint-item ' + level + '">';
    hintHtml += '<div class="hint-title">' + h.title + '</div>';
    hintHtml += '<div class="hint-text">' + h.text + '</div>';
    hintHtml += '</div>';
  });
  document.getElementById('resultHintContent').innerHTML = hintHtml;

  // Empfehlung
  var rec = '';
  if (avg < 30) {
    rec = 'Aktuell zeigen sich wenige Muster. Wenn du trotzdem das Gefühl hast, dass etwas nicht stimmt, kann ein Gespräch mit einem Arzt oder Psychologen sinnvoll sein. Manchmal kompensieren Betroffene sehr stark, sodass Fragebögen die tatsächliche Belastung unterschätzen.';
  } else if (avg < 55) {
    rec = 'Einige Muster sind erkennbar. Wenn du dich durch diese Schwierigkeiten belastet fühlst, empfehlen wir ein Gespräch mit einem Psychiater oder einer ADHS-Ambulanz. Viele Menschen profitieren bereits von Psychoedukation und Strategien – unabhängig von einer formalen Diagnose.';
  } else {
    rec = 'Es zeigen sich viele und deutliche Muster. Wir empfehlen dringend eine professionelle Abklärung. Wende dich an einen Facharzt für Psychiatrie, einen Psychologen mit ADHS-Erfahrung oder eine spezialisierte ADHS-Ambulanz. Eine Diagnose öffnet Türen zu effektiver Behandlung und Unterstützung.';
  }
  document.getElementById('resultRecContent').textContent = rec;

  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadSavedResults();
}

function resetCheck() {
  checkAnswers1 = {};
  checkAnswers2 = {};
  document.getElementById('checkResult').style.display = 'none';
  document.getElementById('checkPart2').style.display = 'none';
  document.getElementById('checkProgressCard').style.display = 'none';
  document.getElementById('checkPart1').style.display = 'block';
  renderCheckQuestions(CHECK_P1, checkAnswers1, 'part1Questions', P1_LABELS);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function saveCheckResult() {
  var scores = calcCheckScores();
  if (!S.checkResults) S.checkResults = [];
  S.checkResults.unshift({
    date: new Date().toLocaleDateString('de', { day:'2-digit', month:'2-digit', year:'numeric' }),
    scores: scores
  });
  if (S.checkResults.length > 5) S.checkResults.pop();
  save();
  showToast('💾 Ergebnis gespeichert!');
  loadSavedResults();
}

function loadSavedResults() {
  var card = document.getElementById('savedResultsCard');
  var list = document.getElementById('savedResultsList');
  if (!S.checkResults || !S.checkResults.length) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';
  var mainCats = ['Unaufmerksamkeit', 'Hyperaktivität', 'Impulsivität', 'Emotionales Erleben'];
  var catColors = {
    'Unaufmerksamkeit': 'var(--a4)',
    'Hyperaktivität': 'var(--a2)',
    'Impulsivität': 'var(--a1)',
    'Emotionales Erleben': 'var(--a5)'
  };
  var html = '';
  S.checkResults.forEach(function(r) {
    html += '<div class="saved-entry">';
    html += '<span class="saved-date">📅 ' + r.date + '</span>';
    html += '<div class="saved-bars">';
    mainCats.forEach(function(cat) {
      var pct = r.scores[cat] || 0;
      html += '<div style="flex:1;display:flex;flex-direction:column;gap:2px;align-items:center">';
      html += '<div style="width:100%;height:6px;background:var(--s3);border-radius:3px;overflow:hidden">';
      html += '<div style="width:' + pct + '%;height:100%;background:' + catColors[cat] + ';border-radius:3px"></div>';
      html += '</div>';
      html += '<span style="font-size:.58rem;color:var(--tm)">' + pct + '%</span>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
  });
  list.innerHTML = html;
}

// ═══════════════════════════════════════════
// ICS KALENDER EXPORT
// ═══════════════════════════════════════════

function generateICS() {
  if (!S.reminders || !S.reminders.length) {
    showToast('⚠️ Keine aktiven Erinnerungen vorhanden');
    return;
  }

  var active = S.reminders.filter(function(r) { return r.active; });
  if (!active.length) {
    showToast('⚠️ Keine aktiven Erinnerungen');
    return;
  }

  var lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FocusPal//ADHS Begleiter//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:FocusPal Erinnerungen',
    'X-WR-TIMEZONE:Europe/Berlin'
  ];

  active.forEach(function(r) {
    var uid = 'focuspal-' + r.id + '@focuspal.app';
    var now = icsDateNow();
    var times = r.time.split(':');
    var hh = times[0];
    var mm = times[1];

    // Nächstes Datum berechnen
    var nextDate = getNextOccurrence(r.repeat, hh, mm);
    var dtstart = nextDate + 'T' + hh + mm + '00';
    var dtend   = nextDate + 'T' + hh + mm + '00';

    // RRULE je nach Wiederholung
    var rrule = '';
    if (r.repeat === 'daily') {
      rrule = 'RRULE:FREQ=DAILY';
    } else if (r.repeat === 'weekdays') {
      rrule = 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    } else if (r.repeat === 'weekly') {
      rrule = 'RRULE:FREQ=WEEKLY';
    }
    // 'once' → kein RRULE

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + uid);
    lines.push('DTSTAMP:' + now);
    lines.push('DTSTART;TZID=Europe/Berlin:' + dtstart);
    lines.push('DTEND;TZID=Europe/Berlin:' + dtend);
    lines.push('SUMMARY:' + r.icon + ' ' + r.name);
    lines.push('DESCRIPTION:FocusPal Erinnerung – ' + r.name);
    lines.push('CATEGORIES:FOCUSPAL');

    // Alarm 0 Minuten vorher = genau zur Zeit
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:PT0S');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:' + r.icon + ' ' + r.name);
    lines.push('END:VALARM');

    // Zweiter Alarm mit Sound
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:PT0S');
    lines.push('ACTION:AUDIO');
    lines.push('END:VALARM');

    if (rrule) lines.push(rrule);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  var icsContent = lines.join('\r\n');
  downloadICS(icsContent, 'focuspal-erinnerungen.ics');
  showToast('📅 Kalender-Datei exportiert!');
}

function getNextOccurrence(repeat, hh, mm) {
  var now = new Date();
  var d = new Date();

  if (repeat === 'weekly') {
    // Nächsten Montag finden
    var day = d.getDay();
    var daysUntilMon = day === 1 ? 0 : (8 - day) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMon);
  } else if (repeat === 'weekdays') {
    // Nächsten Wochentag finden
    var wd = d.getDay();
    if (wd === 0) d.setDate(d.getDate() + 1); // Sonntag → Montag
    if (wd === 6) d.setDate(d.getDate() + 2); // Samstag → Montag
  }
  // daily / once → heute oder morgen
  // Wenn Uhrzeit heute schon vorbei → morgen
  var targetHour = parseInt(hh, 10);
  var targetMin  = parseInt(mm, 10);
  if (
    repeat === 'daily' || repeat === 'once'
  ) {
    if (
      now.getHours() > targetHour ||
      (now.getHours() === targetHour && now.getMinutes() >= targetMin)
    ) {
      d.setDate(d.getDate() + 1);
    }
  }

  var y = d.getFullYear();
  var mo = String(d.getMonth() + 1).padStart(2, '0');
  var da = String(d.getDate()).padStart(2, '0');
  return y + '' + mo + '' + da;
}

function icsDateNow() {
  var d = new Date();
  var y  = d.getUTCFullYear();
  var mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  var da = String(d.getUTCDate()).padStart(2, '0');
  var hh = String(d.getUTCHours()).padStart(2, '0');
  var mm = String(d.getUTCMinutes()).padStart(2, '0');
  var ss = String(d.getUTCSeconds()).padStart(2, '0');
  return y + mo + da + 'T' + hh + mm + ss + 'Z';
}

function downloadICS(content, filename) {
  var blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Init check on first load
function initCheck() {
  renderCheckQuestions(CHECK_P1, checkAnswers1, 'part1Questions', P1_LABELS);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
window.addEventListener('load', function() {
  if (load() && S.name) {
    document.getElementById('ob').style.display = 'none';
    document.getElementById('app').classList.add('show');
    checkDailyReset();
    setTimeout(function() {
    checkCarryOver();
    }, 800);
    updateUI();
    renderTodos('day');
    restoreQWUI();
    renderRems();
    renderMilestones();
    renderMotPrev();
    renderInbox();
    startChecker();
    chkAch();
    initCheck();
  }
});