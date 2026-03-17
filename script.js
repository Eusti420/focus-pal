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
      html += '<div class="tdr"><span class="dif ' + diffCls + '">' + diffLbl + '</span><span class="tdx">' + xpLbl + '</span></div>';
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
    var now = new Date(today);
    var diff = Math.round((now - prev) / 86400000);
    S.streak = diff === 1 ? S.streak + 1 : 1;
    S.lastActive = today;
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
    S.todos.forEach(function(t) { if (t.scope === 'day') t.done = false; });
  }

  // Weekly todo reset (Monday)
  if (S.lastWeekReset !== mon) {
    S.lastWeekReset = mon;
    S.todos.forEach(function(t) { if (t.scope === 'week') t.done = false; });
  }

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
  var el = document.getElementById('remList');
  var rlab = {daily:'Täglich', weekdays:'Mo–Fr', weekly:'Wöchentlich', once:'Einmalig'};
  if (!S.reminders.length) {
    el.innerHTML = '<div class="empty">Noch keine Erinnerungen</div>';
    return;
  }
  var h = '';
  S.reminders.forEach(function(r) {
    h += '<div class="ritem ' + (r.active ? '' : 'paused') + '">';
    h += '<span class="ric">' + r.icon + '</span>';
    h += '<div class="rinfo"><div class="rname">' + r.name + '</div><div class="rwhen">🕐 ' + r.time + ' – ' + rlab[r.repeat] + '</div></div>';
    h += '<div class="ract">';
    h += '<button class="rbtn rbtog" onclick="togRem(' + r.id + ')">' + (r.active ? '⏸' : '▶') + '</button>';
    h += '<button class="rbtn rbdel" onclick="delRem(' + r.id + ')">✕</button>';
    h += '</div></div>';
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
// INIT
// ═══════════════════════════════════════════
window.addEventListener('load', function() {
  if (load() && S.name) {
    document.getElementById('ob').style.display = 'none';
    document.getElementById('app').classList.add('show');
    checkDailyReset();
    updateUI();
    renderTodos('day');
    restoreQWUI();
    renderRems();
    renderMilestones();
    renderMotPrev();
    renderInbox();
    startChecker();
    chkAch();
  }
});