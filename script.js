'use strict';

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2 = n => String(n).padStart(2, '0');

const DAYS = ['Duminică', 'Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă'];
const SHORT = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];

const program = {
    0: [
        { t: '19:00', a: 'Trio de duminică', s: 'Standarde clasice', p: 'Intrare liberă' },
        { t: '21:00', a: 'Mara Voicu Trio', s: 'Balade', p: '50 lei' }
    ],
    1: [],
    2: [
        { t: '20:00', a: 'Open Jam', s: 'Jam session', p: 'Intrare liberă' },
        { t: '22:00', a: 'Mara Voicu Trio', s: 'Bebop', p: '45 lei' }
    ],
    3: [{ t: '20:30', a: 'Quartet Noir', s: 'Hard bop', p: '60 lei' }],
    4: [
        { t: '20:00', a: 'Andrei Pop Quintet', s: 'Post-bop', p: '65 lei' },
        { t: '22:00', a: 'Late Night Keys', s: 'Pian solo', p: '40 lei' }
    ],
    5: [{ t: '20:30', a: 'Aurora Big Band', s: 'Swing', p: '80 lei' }],
    6: [
        { t: '20:00', a: 'Sofia Lăzărescu Quartet', s: 'Jazz vocal', p: '75 lei' },
        { t: '22:30', a: 'Blue Hour Collective', s: 'Fuziune', p: '70 lei' }
    ]
};

const dateAt = (offset, time) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (time) {
        const [h, m] = time.split(':').map(Number);
        d.setHours(h, m, 0, 0);
    }
    return d;
};

const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const upcoming = () => {
    const now = new Date();
    const list = [];
    for (let i = 0; i < 8; i++) {
        const day = dateAt(i);
        (program[day.getDay()] || []).forEach(s => {
            const start = dateAt(i, s.t);
            list.push({ ...s, start, end: new Date(start.getTime() + 90 * 60000), offset: i });
        });
    }
    return list.filter(x => x.end > now);
};

const tween = (el, to, fmt, ms = 1600) => {
    if (reduce) {
        el.textContent = fmt(to);
        return;
    }
    const t0 = performance.now();
    const tick = now => {
        const p = Math.min((now - t0) / ms, 1);
        el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
};

const header = $('#header');
const progress = $('#progress');
const onScroll = () => {
    header.classList.toggle('solid', scrollY > 40);
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

let ctx = null;
let master = null;
let analyser = null;
let scopeData = null;
let noiseBuf = null;
let soundOn = true;
let sustain = false;
let pulse = 0;

try {
    soundOn = localStorage.getItem('bemol-sound') !== 'off';
} catch (e) {}

const ensureAudio = () => {
    if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.7;
        const comp = ctx.createDynamicsCompressor();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        scopeData = new Uint8Array(analyser.fftSize);
        const len = Math.floor(ctx.sampleRate * 2.2);
        const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const ch = impulse.getChannelData(c);
            for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
        }
        const conv = ctx.createConvolver();
        conv.buffer = impulse;
        const wet = ctx.createGain();
        wet.gain.value = 0.22;
        master.connect(comp);
        master.connect(conv);
        conv.connect(wet);
        wet.connect(comp);
        comp.connect(analyser);
        analyser.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
        const nd = noiseBuf.getChannelData(0);
        for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
};

const freq = m => 440 * Math.pow(2, (m - 69) / 12);
const voices = new Map();

const releaseVoice = (v, tc) => {
    if (!v || v.done) return;
    const now = ctx.currentTime;
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.setTargetAtTime(0, now, tc);
};

const noteOn = (m, vel, dur) => {
    if (!soundOn) return;
    ensureAudio();
    const old = voices.get(m);
    if (old) releaseVoice(old, 0.06);
    const t = ctx.currentTime;
    const f = freq(m);
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, f * 5 + 1800 * vel), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(700, f * 1.6), t + 1.4);
    const ring = 3.4 - ((m - 48) / 40) * 1.6;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(vel * 0.42, t + 0.006);
    out.gain.exponentialRampToValueAtTime(vel * 0.14, t + 0.4);
    out.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    lp.connect(out);
    out.connect(master);
    const oscs = [];
    [[1, 1, 0], [2, 0.45, 0], [3, 0.22, 0], [4, 0.1, 0], [1, 0.5, 4]].forEach(([mult, g, cents]) => {
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult * (1 + 0.0004 * mult * mult);
        o.detune.value = cents;
        og.gain.value = g;
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(t + ring + 0.1);
        oscs.push(o);
    });
    const click = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const cg = ctx.createGain();
    click.buffer = noiseBuf;
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(6000, f * 3);
    cg.gain.value = vel * 0.18;
    click.connect(bp);
    bp.connect(cg);
    cg.connect(out);
    click.start(t);
    const voice = { out, done: false };
    oscs[0].onended = () => { voice.done = true; };
    voices.set(m, voice);
    if (dur) {
        out.gain.setTargetAtTime(0, t + dur, 0.22);
    }
};

const sustained = new Set();
const down = new Map();
const names = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const noteName = m => names[m % 12] + ' ' + (Math.floor(m / 12) - 1);

const hero = $('#top');
const bump = amount => {
    pulse = Math.min(1, pulse + amount);
};

const LOW = 48;
const HIGH = 76;
const lowerRow = ['z', 's', 'x', 'd', 'c', 'v', 'g', 'b', 'h', 'n', 'j', 'm', ',', 'l', '.', ';', '/'];
const upperRow = ['q', '2', 'w', '3', 'e', 'r', '5', 't', '6', 'y', '7', 'u', 'i', '9', 'o', '0', 'p'];
const keyMap = {};
lowerRow.forEach((k, i) => { keyMap[k] = 48 + i; });
upperRow.forEach((k, i) => { keyMap[k] = 60 + i; });
const hintFor = {};
lowerRow.forEach((k, i) => { hintFor[48 + i] = k; });
upperRow.forEach((k, i) => { if (60 + i > 64) hintFor[60 + i] = k; });

const piano = $('#piano');
const inner = piano.parentElement;
const keyEls = new Map();
const blackSet = [1, 3, 6, 8, 10];
const whiteCount = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i).filter(m => !blackSet.includes(m % 12)).length;
let whiteIndex = -1;

for (let m = LOW; m <= HIGH; m++) {
    const black = blackSet.includes(m % 12);
    const el = document.createElement('div');
    el.className = 'key ' + (black ? 'b' : 'w');
    el.dataset.m = m;
    el.setAttribute('aria-label', noteName(m));
    if (black) {
        el.style.left = ((whiteIndex + 1) / whiteCount) * 100 + '%';
        el.style.width = (100 / whiteCount) * 0.62 + '%';
    } else {
        whiteIndex++;
    }
    if (hintFor[m]) {
        const hint = document.createElement('i');
        hint.textContent = hintFor[m].toUpperCase();
        el.appendChild(hint);
    }
    piano.appendChild(el);
    keyEls.set(m, el);
}

const readout = $('#readout');

const spark = m => {
    if (inner.querySelectorAll('.spark').length > 50) return;
    const el = keyEls.get(m);
    const r = el.getBoundingClientRect();
    const base = inner.getBoundingClientRect();
    const s = document.createElement('span');
    s.className = 'spark';
    s.style.left = r.left - base.left + r.width / 2 + 'px';
    s.style.setProperty('--c', blackSet.includes(m % 12) ? 'var(--accent2)' : 'var(--accent)');
    s.style.setProperty('--dx', (Math.random() * 40 - 20).toFixed(0) + 'px');
    s.addEventListener('animationend', () => s.remove());
    inner.appendChild(s);
};

const keyOn = (m, vel = 0.75) => {
    const c = (down.get(m) || 0) + 1;
    down.set(m, c);
    if (c > 1) return;
    keyEls.get(m).classList.add('on');
    sustained.delete(m);
    noteOn(m, vel);
    readout.textContent = noteName(m);
    bump(0.3 * vel);
    if (!reduce) spark(m);
};

const keyOff = m => {
    const c = (down.get(m) || 0) - 1;
    if (c > 0) {
        down.set(m, c);
        return;
    }
    down.delete(m);
    keyEls.get(m).classList.remove('on');
    if (!ctx) return;
    if (sustain) sustained.add(m);
    else releaseVoice(voices.get(m), 0.22);
};

const setSustain = on => {
    sustain = on;
    $('#pedalBtn').setAttribute('aria-pressed', on);
    if (!on && ctx) {
        sustained.forEach(m => { if (!down.has(m)) releaseVoice(voices.get(m), 0.3); });
        sustained.clear();
    }
};

const rec = { on: false, t0: 0, events: [], last: [] };
const press = (m, vel) => {
    if (rec.on) rec.events.push({ t: performance.now() - rec.t0, m, on: true, vel });
    keyOn(m, vel);
};
const lift = m => {
    if (rec.on) rec.events.push({ t: performance.now() - rec.t0, m, on: false });
    keyOff(m);
};

const pointers = new Map();
const keyAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const k = el && el.closest ? el.closest('.key') : null;
    return k && piano.contains(k) ? k : null;
};
const velAt = (k, y) => {
    const r = k.getBoundingClientRect();
    return Math.max(0.35, Math.min(1, 0.45 + ((y - r.top) / r.height) * 0.55));
};

piano.addEventListener('pointerdown', e => {
    e.preventDefault();
    ensureAudio();
    piano.setPointerCapture(e.pointerId);
    const k = keyAt(e.clientX, e.clientY);
    if (!k) return;
    const m = +k.dataset.m;
    pointers.set(e.pointerId, m);
    press(m, velAt(k, e.clientY));
});

piano.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const k = keyAt(e.clientX, e.clientY);
    const m = k ? +k.dataset.m : null;
    const prev = pointers.get(e.pointerId);
    if (m === prev) return;
    if (prev !== null) lift(prev);
    if (m !== null) press(m, velAt(k, e.clientY));
    pointers.set(e.pointerId, m);
});

const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (prev !== null) lift(prev);
};
piano.addEventListener('pointerup', endPointer);
piano.addEventListener('pointercancel', endPointer);

let pianoInView = false;
const heldKeys = new Set();
const typing = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);

addEventListener('keydown', e => {
    if (!pianoInView || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) setSustain(true);
        return;
    }
    const m = keyMap[e.key.toLowerCase()];
    if (m === undefined || e.repeat || heldKeys.has(e.key.toLowerCase())) return;
    heldKeys.add(e.key.toLowerCase());
    ensureAudio();
    press(m, 0.75);
});

addEventListener('keyup', e => {
    if (e.code === 'Space' && pianoInView) {
        setSustain(false);
        return;
    }
    const k = e.key.toLowerCase();
    if (!heldKeys.has(k)) return;
    heldKeys.delete(k);
    lift(keyMap[k]);
});

$('#pedalBtn').addEventListener('click', () => setSustain(!sustain));

const timers = new Set();
const playing = new Set();
let mode = null;

const later = (ms, fn) => {
    const id = setTimeout(() => {
        timers.delete(id);
        fn();
    }, ms);
    timers.add(id);
};

const stopPlayback = () => {
    timers.forEach(clearTimeout);
    timers.clear();
    playing.forEach(m => keyOff(m));
    playing.clear();
    mode = null;
    $('#demoBtn').textContent = 'Ascultă o frază de jazz';
    $('#replayBtn').textContent = 'Redă înregistrarea';
};

const playEvents = (events, onEnd) => {
    ensureAudio();
    let end = 0;
    events.forEach(ev => {
        end = Math.max(end, ev.t);
        later(ev.t, () => {
            if (ev.on) {
                playing.add(ev.m);
                keyOn(ev.m, ev.vel || 0.7);
            } else {
                playing.delete(ev.m);
                keyOff(ev.m);
            }
        });
    });
    later(end + 600, () => {
        stopPlayback();
        if (onEnd) onEnd();
    });
};

const buildDemo = () => {
    const beat = 60000 / 92;
    const swing = b => (b % 1 === 0.5 ? b + 0.17 : b);
    const bars = [
        { chord: [50, 57, 60, 64], mel: [[74, 0, 0.5], [72, 0.5, 0.5], [69, 1, 1], [72, 2, 0.5], [74, 2.5, 0.5], [76, 3, 1]] },
        { chord: [55, 59, 62, 65], mel: [[74, 0, 0.75], [71, 0.75, 0.25], [67, 1, 1], [65, 2, 0.5], [67, 2.5, 0.5], [71, 3, 1]] },
        { chord: [48, 55, 59, 64], mel: [[72, 0, 1], [71, 1, 0.5], [67, 1.5, 0.5], [64, 2, 1.5], [67, 3.5, 0.5]] },
        { chord: [57, 61, 64, 67], mel: [[69, 0, 0.5], [67, 0.5, 0.5], [64, 1, 1], [61, 2, 1], [64, 3, 1]] }
    ];
    const events = [];
    const add = (m, startBeat, durBeats, vel) => {
        const t = swing(startBeat) * beat;
        events.push({ t, m, on: true, vel });
        events.push({ t: t + durBeats * beat * 0.92, m, on: false });
    };
    bars.forEach((bar, i) => {
        const o = i * 4;
        bar.chord.forEach((m, k) => add(m, o + k * 0.03, 1.4, 0.5));
        bar.chord.slice(1).forEach((m, k) => add(m, o + 1.5 + k * 0.02, 0.45, 0.42));
        bar.mel.forEach(([m, s, d]) => add(m, o + s, d, 0.78));
    });
    [48, 55, 59, 62, 64, 72].forEach((m, k) => add(m, 16 + k * 0.04, 4, 0.6));
    return events.sort((a, b) => a.t - b.t);
};

$('#demoBtn').addEventListener('click', () => {
    if (mode === 'demo') {
        stopPlayback();
        return;
    }
    stopPlayback();
    mode = 'demo';
    $('#demoBtn').textContent = 'Oprește';
    playEvents(buildDemo());
});

const recBtn = $('#recBtn');
const replayBtn = $('#replayBtn');
recBtn.addEventListener('click', () => {
    if (!rec.on) {
        stopPlayback();
        ensureAudio();
        rec.on = true;
        rec.events = [];
        rec.t0 = performance.now();
        recBtn.setAttribute('aria-pressed', 'true');
        $('span', recBtn).textContent = 'Oprește înregistrarea';
        return;
    }
    rec.on = false;
    recBtn.setAttribute('aria-pressed', 'false');
    $('span', recBtn).textContent = 'Înregistrează';
    rec.last = rec.events.slice();
    replayBtn.disabled = rec.last.length === 0;
});

replayBtn.addEventListener('click', () => {
    if (mode === 'replay') {
        stopPlayback();
        return;
    }
    if (!rec.last.length) return;
    stopPlayback();
    mode = 'replay';
    replayBtn.textContent = 'Oprește redarea';
    playEvents(rec.last);
});

const soundBtn = $('#soundBtn');
const setSound = on => {
    soundOn = on;
    soundBtn.setAttribute('aria-pressed', on);
    soundBtn.setAttribute('aria-label', on ? 'Sunet activat' : 'Sunet dezactivat');
    try {
        localStorage.setItem('bemol-sound', on ? 'on' : 'off');
    } catch (e) {}
};
soundBtn.addEventListener('click', () => setSound(!soundOn));
setSound(soundOn);

const scope = $('#scope');
const sg = scope.getContext('2d');
let sw = 0;
let sh = 0;
const sizeScope = () => {
    const r = scope.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    sw = r.width;
    sh = r.height;
    scope.width = sw * dpr;
    scope.height = sh * dpr;
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
};
let colors = { a: '#ffb347', b: '#e8455f', dark: true };
const readColors = () => {
    const s = getComputedStyle(root);
    colors = {
        a: s.getPropertyValue('--accent').trim(),
        b: s.getPropertyValue('--accent2').trim(),
        dark: root.dataset.theme === 'dark'
    };
};

const drawScope = time => {
    sg.clearRect(0, 0, sw, sh);
    const grad = sg.createLinearGradient(0, 0, sw, 0);
    grad.addColorStop(0, colors.b);
    grad.addColorStop(1, colors.a);
    sg.strokeStyle = grad;
    sg.lineWidth = 2.2;
    sg.shadowColor = colors.a;
    sg.shadowBlur = 10;
    sg.beginPath();
    const n = 160;
    if (analyser) analyser.getByteTimeDomainData(scopeData);
    for (let i = 0; i <= n; i++) {
        let v = 0;
        if (analyser) v = (scopeData[Math.floor((i / n) * (scopeData.length - 1))] - 128) / 128;
        else v = Math.sin(i * 0.2 + time / 600) * 0.02;
        const x = (i / n) * sw;
        const y = sh / 2 + v * sh * 0.9;
        if (i) sg.lineTo(x, y);
        else sg.moveTo(x, y);
    }
    sg.stroke();
    sg.shadowBlur = 0;
};

const dust = $('#dust');
const dg = dust.getContext('2d');
let dw = 0;
let dh = 0;
let motes = [];
const makeMote = (randomY = true) => ({
    x: Math.random() * dw,
    y: randomY ? Math.random() * dh : dh + 10,
    r: 0.6 + Math.random() * 1.8,
    s: 0.12 + Math.random() * 0.4,
    ph: Math.random() * Math.PI * 2,
    c: Math.random() < 0.25 ? 1 : 0
});
const sizeDust = () => {
    const r = dust.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    dw = r.width;
    dh = r.height;
    dust.width = dw * dpr;
    dust.height = dh * dpr;
    dg.setTransform(dpr, 0, 0, dpr, 0, 0);
    motes = Array.from({ length: Math.min(140, Math.floor((dw * dh) / 9000)) }, () => makeMote());
};

const drawDust = time => {
    dg.clearRect(0, 0, dw, dh);
    dg.globalCompositeOperation = colors.dark ? 'lighter' : 'source-over';
    motes.forEach((p, i) => {
        p.y -= p.s * (1 + pulse * 2);
        p.x += Math.sin(time / 1800 + p.ph) * 0.25;
        if (p.y < -10) motes[i] = makeMote(false);
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(time / 900 + p.ph));
        dg.globalAlpha = (colors.dark ? 0.55 : 0.4) * tw;
        dg.fillStyle = p.c ? colors.b : colors.a;
        dg.beginPath();
        dg.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        dg.fill();
    });
    dg.globalAlpha = 1;
    dg.globalCompositeOperation = 'source-over';
};

let heroInView = true;
let scopeInView = false;
const loop = time => {
    requestAnimationFrame(loop);
    if (pulse > 0.001) {
        pulse *= 0.94;
        hero.style.setProperty('--pulse', pulse.toFixed(3));
    } else if (pulse !== 0) {
        pulse = 0;
        hero.style.setProperty('--pulse', 0);
    }
    if (heroInView) drawDust(time);
    if (scopeInView) drawScope(time);
};

sizeDust();
sizeScope();
readColors();
let rz = null;
addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
        sizeDust();
        sizeScope();
    }, 200);
});
if (reduce) {
    drawDust(0);
    drawScope(0);
} else {
    requestAnimationFrame(loop);
}

const themeBtn = $('#themeBtn');
const wipe = $('#wipe');
const WHITES = 14;
const blackAfter = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];

for (let i = 0; i < WHITES; i++) {
    const k = document.createElement('i');
    k.className = 'wk';
    k.style.left = (i / WHITES) * 100 + '%';
    k.style.width = 100 / WHITES + 0.2 + '%';
    wipe.appendChild(k);
}
blackAfter.forEach(i => {
    const k = document.createElement('i');
    k.className = 'bk';
    k.style.left = ((i + 1) / WHITES) * 100 + '%';
    k.style.width = (100 / WHITES) * 0.62 + '%';
    wipe.appendChild(k);
});

const applyTheme = theme => {
    root.dataset.theme = theme;
    themeBtn.setAttribute('aria-checked', theme === 'light');
    readColors();
    try {
        localStorage.setItem('bemol-theme', theme);
    } catch (e) {}
};

let switching = false;
const scale = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83];

const switchTheme = async () => {
    if (switching) return;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    if (reduce) {
        applyTheme(next);
        return;
    }
    switching = true;
    const whites = $$('.wk', wipe);
    const blacks = $$('.bk', wipe);
    const ease = 'cubic-bezier(.5,0,.75,0)';
    const fall = [
        ...whites.map((k, i) => k.animate(
            [{ transform: 'translateY(-102%)' }, { transform: 'translateY(0)' }],
            { duration: 380, delay: i * 30, easing: ease, fill: 'forwards' }
        )),
        ...blacks.map((k, i) => k.animate(
            [{ transform: 'translate(-50%,-110%)' }, { transform: 'translate(-50%,0)' }],
            { duration: 380, delay: blackAfter[i] * 30 + 140, easing: ease, fill: 'forwards' }
        ))
    ];
    if (soundOn) {
        ensureAudio();
        scale.forEach((m, i) => later(i * 30 + 300, () => noteOn(m, 0.4, 0.35)));
    }
    await Promise.all(fall.map(a => a.finished));
    applyTheme(next);
    await sleep(140);
    const away = [
        ...whites.map((k, i) => k.animate(
            [{ transform: 'translateY(0)' }, { transform: 'translateY(102%)' }],
            { duration: 420, delay: (WHITES - 1 - i) * 30, easing: 'cubic-bezier(.25,.25,.5,1)', fill: 'forwards' }
        )),
        ...blacks.map((k, i) => k.animate(
            [{ transform: 'translate(-50%,0)' }, { transform: 'translate(-50%,170%)' }],
            { duration: 420, delay: (WHITES - 1 - blackAfter[i]) * 30, easing: 'cubic-bezier(.25,.25,.5,1)', fill: 'forwards' }
        ))
    ];
    await Promise.all(away.map(a => a.finished));
    fall.concat(away).forEach(a => a.cancel());
    switching = false;
};
themeBtn.addEventListener('click', switchTheme);

let startTheme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
try {
    startTheme = localStorage.getItem('bemol-theme') || startTheme;
} catch (e) {}
applyTheme(startTheme);

hero.addEventListener('pointermove', e => {
    if (reduce) return;
    const nx = e.clientX / innerWidth - 0.5;
    $$('.beam', hero).forEach((b, i) => { b.style.translate = nx * (18 + i * 10) + 'px 0'; });
});

const mag = $('.mag');
if (mag && !reduce) {
    mag.addEventListener('pointermove', e => {
        const r = mag.getBoundingClientRect();
        mag.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.22}px, ${(e.clientY - r.top - r.height / 2) * 0.3}px)`;
    });
    mag.addEventListener('pointerleave', () => { mag.style.transform = ''; });
}

const tonight = $('.tonight');
const updateTonight = () => {
    const next = upcoming()[0];
    if (!next) return;
    const now = new Date();
    const live = next.start <= now;
    tonight.classList.toggle('live', live);
    $('#tLabel').textContent = live ? 'Live acum' : 'Următorul concert';
    $('#tName').textContent = next.a;
    const dayText = next.offset === 0 ? 'Azi' : next.offset === 1 ? 'Mâine' : DAYS[next.start.getDay()];
    $('#tMeta').textContent = `${dayText}, ${next.t}, ${next.s}`;
    if (!live) {
        const diff = Math.max(0, Math.floor((next.start - now) / 1000));
        const hours = Math.floor(diff / 3600);
        $('#cH').textContent = pad2(hours);
        $('#cM').textContent = pad2(Math.floor((diff % 3600) / 60));
        $('#cS').textContent = pad2(diff % 60);
    }
};
updateTonight();
setInterval(updateTonight, 1000);

const trackEl = $('#tickerTrack');
const tickerItems = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const first = program[d][0];
    return first ? `<span><b>${SHORT[d]}</b>${first.a}<i>♪</i></span>` : '';
}).join('');
trackEl.innerHTML = tickerItems + tickerItems;

const daysEl = $('#days');
const setsEl = $('#sets');
let selectedOffset = 0;

const renderSets = () => {
    const day = dateAt(selectedOffset);
    const list = program[day.getDay()] || [];
    setsEl.innerHTML = '';
    if (!list.length) {
        const li = document.createElement('li');
        li.className = 'none';
        li.textContent = 'Luni suntem închiși. Revenim marți la 19:00.';
        setsEl.appendChild(li);
        return;
    }
    list.forEach((s, idx) => {
        const li = document.createElement('li');
        li.className = 'set';
        li.innerHTML = `<span class="time">${s.t}</span><div><h3></h3><small></small></div><span class="price"></span><button type="button" class="btn btn-sm btn-ghost">Rezervă</button>`;
        $('h3', li).textContent = s.a;
        $('small', li).textContent = s.s;
        $('.price', li).textContent = s.p;
        $('button', li).addEventListener('click', () => prefillBooking(selectedOffset, idx));
        setsEl.appendChild(li);
    });
};

for (let i = 0; i < 7; i++) {
    const d = dateAt(i);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', i === 0);
    if (!(program[d.getDay()] || []).length) btn.classList.add('closed');
    btn.innerHTML = `<small>${i === 0 ? 'Azi' : SHORT[d.getDay()]}</small><b>${d.getDate()}</b>`;
    btn.setAttribute('aria-label', `${DAYS[d.getDay()]}, ${d.getDate()}`);
    btn.addEventListener('click', () => {
        selectedOffset = i;
        $$('button', daysEl).forEach(b => b.setAttribute('aria-pressed', b === btn));
        renderSets();
    });
    daysEl.appendChild(btn);
}
renderSets();

const menu = {
    cocktails: [
        ['Bemol Negroni', 'Gin, vermut roșu, bitter, coajă de portocală arsă', 34],
        ['Old Fashioned afumat', 'Bourbon, zahăr brun, bitter, fum de lemn de cireș', 38],
        ['Blue Hour', 'Gin, lavandă, lămâie, albuș, petale de floare', 36],
        ['Espresso Martini', 'Vodcă, espresso proaspăt, lichior de cafea', 32],
        ['Fără alcool: Midnight', 'Ceai negru rece, cireșe, ghimbir, apă minerală', 22]
    ],
    wine: [
        ['Fetească Neagră, Dealu Mare', 'Prune coapte, condimente fine. Pahar sau sticlă', 28],
        ['Riesling de Rin, Alsacia', 'Mineral, citrice, aciditate vie', 30],
        ['Pinot Noir, Burgundia', 'Cireșe, pământ umed, tanini fini', 42],
        ['Spumant brut, Cramele Recaș', 'Mere verzi, brioșă, bule fine', 26]
    ],
    bites: [
        ['Platou de brânzeturi', 'Cinci sortimente, miere de salcâm, nuci', 52],
        ['Crostini cu ricotta', 'Roșii confiate, busuioc, ulei de măsline', 24],
        ['Mezeluri artizanale', 'Salam de bivol, pastramă de oaie, murături', 48],
        ['Tartă cu ciocolată', 'Ciocolată amăruie, sare de mare, smântână', 22]
    ]
};
const menuEl = $('#menuList');
const renderMenu = cat => {
    menuEl.innerHTML = '';
    menu[cat].forEach(([name, desc, price]) => {
        const li = document.createElement('li');
        li.innerHTML = '<div class="top"><h3></h3><span class="dots"></span><b></b></div><p></p>';
        $('h3', li).textContent = name;
        $('b', li).textContent = price + ' lei';
        $('p', li).textContent = desc;
        menuEl.appendChild(li);
    });
};
$$('#menuTabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('#menuTabs button').forEach(b => b.setAttribute('aria-pressed', b === btn));
        renderMenu(btn.dataset.cat);
    });
});
renderMenu('cocktails');

const form = $('#form');
const fDate = $('#fDate');
const fSet = $('#fSet');
const ticket = $('#ticket');
let guests = 2;
let zone = 'Lângă scenă';
fDate.min = isoDate(dateAt(0));

const dateFromInput = () => {
    if (!fDate.value) return null;
    const [y, m, d] = fDate.value.split('-').map(Number);
    return new Date(y, m - 1, d);
};

const fillSets = () => {
    const d = dateFromInput();
    fSet.innerHTML = '';
    const add = (value, text, disabled) => {
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        if (disabled) o.disabled = true;
        fSet.appendChild(o);
    };
    if (!d) {
        add('', 'Alege mai întâi data');
        return;
    }
    const list = program[d.getDay()] || [];
    if (!list.length) {
        add('', 'Închis luni, alege altă zi');
        return;
    }
    add('', 'Alege concertul');
    list.forEach((s, i) => add(String(i), `${s.t} – ${s.a}`));
};
fDate.addEventListener('change', fillSets);

const prefillBooking = (offset, idx) => {
    fDate.value = isoDate(dateAt(offset));
    fillSets();
    fSet.value = String(idx);
    $('#rezervari').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
};

$('#gMinus').addEventListener('click', () => {
    guests = Math.max(1, guests - 1);
    $('#gOut').textContent = guests;
});
$('#gPlus').addEventListener('click', () => {
    guests = Math.min(8, guests + 1);
    $('#gOut').textContent = guests;
});
$$('#zone button').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('#zone button').forEach(b => b.setAttribute('aria-pressed', b === btn));
        zone = btn.dataset.z;
    });
});

const setError = (input, msg) => {
    const label = input.closest('label');
    label.classList.toggle('invalid', !!msg);
    $('small', label).textContent = msg;
    return !msg;
};

form.addEventListener('submit', e => {
    e.preventDefault();
    const d = dateFromInput();
    const name = form.elements.name;
    const email = form.elements.email;
    const results = [
        setError(fDate, !d ? 'Alege o dată.' : d.getDay() === 1 ? 'Luni suntem închiși.' : ''),
        setError(fSet, fSet.value === '' ? 'Alege un concert.' : ''),
        setError(name, name.value.trim().length < 2 ? 'Scrie numele tău.' : ''),
        setError(email, /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()) ? '' : 'Introdu un email valid.')
    ];
    if (results.includes(false)) {
        const bad = $('.invalid input, .invalid select', form);
        if (bad) bad.focus();
        return;
    }
    const set = program[d.getDay()][+fSet.value];
    const code = 'BM-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    ticket.innerHTML = '<h3></h3><p></p><p></p><p><b></b></p>';
    $('h3', ticket).textContent = 'Locul tău e păstrat, ' + name.value.trim().split(' ')[0] + '.';
    const ps = $$('p', ticket);
    ps[0].textContent = `${DAYS[d.getDay()]}, ${d.getDate()}.${pad2(d.getMonth() + 1)}, ${set.t}, ${set.a}`;
    ps[1].textContent = `${guests} ${guests === 1 ? 'persoană' : 'persoane'}, ${zone.toLowerCase()}`;
    $('b', ticket).textContent = code;
    ticket.hidden = false;
    ticket.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
    form.reset();
    fillSets();
    guests = 2;
    $('#gOut').textContent = 2;
});

const openPill = $('#openPill');
const updateOpen = () => {
    const now = new Date();
    const day = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    const openNow = (day !== 1 && mins >= 19 * 60) || ((day + 6) % 7 !== 1 && mins < 2 * 60);
    openPill.classList.toggle('open', openNow);
    if (openNow) openPill.textContent = 'Deschis acum, până la 02:00';
    else if (day !== 1 && mins < 19 * 60) openPill.textContent = 'Închis acum, deschidem azi la 19:00';
    else openPill.textContent = 'Închis azi, revenim marți la 19:00';
};
updateOpen();

const hoursEl = $('#hours');
[1, 2, 3, 4, 5, 6, 0].forEach(d => {
    const li = document.createElement('li');
    if (d === new Date().getDay()) li.className = 'today';
    li.innerHTML = '<span></span><span></span>';
    $$('span', li)[0].textContent = DAYS[d];
    $$('span', li)[1].textContent = d === 1 ? 'Închis' : '19:00 – 02:00';
    hoursEl.appendChild(li);
});

new IntersectionObserver(entries => { heroInView = entries[0].isIntersecting; }).observe(hero);
new IntersectionObserver(entries => {
    pianoInView = entries[0].isIntersecting;
    scopeInView = pianoInView;
}, { threshold: 0.25 }).observe($('#pian'));

const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add('in');
        if (el.classList.contains('stats')) {
            $$('[data-count]', el).forEach(c => tween(c, +c.dataset.count, v => String(Math.round(v))));
        }
        observer.unobserve(el);
    });
}, { threshold: 0.15 });
$$('.reveal, .stats').forEach(el => observer.observe(el));