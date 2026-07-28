/* ═══════════════════════════════════════════════════════════════
   TTS HELPER — UdeA Posible · Track Discapacidad Visual
   ───────────────────────────────────────────────────────────────
   Reglas de la experta en tiflotecnología (2026-04-27):
   1. Ortografía impecable.
   2. Sin acrónimos sueltos: expandirlos al leer.
   3. Lenguaje matemático perfeccionado: "un medio", no "uno barra dos".
   4. Reanudar desde donde se quedó (persistencia con localStorage).
   5. Audio que salga por audífonos (selección de output por defecto).
   6. Una sola voz a la vez (cancel previo a cada speak).
   7. Voz preferida: Eloquence de JAWS si está disponible.
   8. Recuadro "cómo usar" arriba.

   Sesión 7 (2026-05): se añadió expansión de notación combinatoria
   (C(n,k), P(n,k), V(n,k), n!, P(A), P(A|B)) para que el TTS lea
   "combinaciones de 6 en 2" en vez de "C abre paréntesis 6 coma 2".
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'tts_pos_v1';
  var SPEED_KEY = 'tts_speed_v1';
  var VOICE_KEY = 'tts_voice_v1';

  var state = {
    currentBtn: null,
    currentBlockId: null,
    voices: [],
    voicesLoaded: false,
    onVoicesReady: []
  };

  /* ───────── Mapa de reemplazos matemáticos y de acrónimos ───────── */
  // El orden importa: notación combinatoria ANTES de fracciones y operadores
  // para que C(6,2), C(n,k), P(5,3), V(n,k), P(A|B), n!, (n-k)! no se rompan.
  var ACRONYMS = [
    // Factorial de expresión entre paréntesis: (n-k)! → "n menos k factorial"
    [/\(([^()]+)\)!/g, '$1 factorial'],
    // Notación combinatoria — acepta dígitos o letras (n, k, etc.)
    [/\bC\s*\(\s*([a-zA-Z]+|\d+)\s*,\s*([a-zA-Z]+|\d+)\s*\)/g, 'combinaciones de $1 en $2'],
    [/\bV\s*\(\s*([a-zA-Z]+|\d+)\s*,\s*([a-zA-Z]+|\d+)\s*\)/g, 'variaciones de $1 en $2'],
    [/\bP\s*\(\s*([a-zA-Z]+|\d+)\s*,\s*([a-zA-Z]+|\d+)\s*\)/g, 'permutaciones de $1 en $2'],
    // P(A|B) y P(A) con letra MAYÚSCULA → probabilidad
    [/\bP\s*\(\s*([A-Z])\s*\|\s*([A-Z])\s*\)/g, 'probabilidad de $1 dado $2'],
    [/\bP\s*\(\s*([A-Z])\s*\)/g, 'probabilidad de $1'],
    // P(letra minúscula o número) → permutaciones (P(n), P(4))
    [/\bP\s*\(\s*([a-z]+|\d+)\s*\)/g, 'permutaciones de $1'],
    // Factorial de número o letra de variable matemática (n!, k!, 5!)
    [/(\d+)!/g, '$1 factorial'],
    [/\b([nkmjxy])!/g, '$1 factorial'],
    // Acrónimos del proyecto
    [/\bMCD\b/g, 'máximo común divisor'],
    [/\bMCM\b/g, 'mínimo común múltiplo'],
    [/\bm\.c\.d\.\b/gi, 'máximo común divisor'],
    [/\bm\.c\.m\.\b/gi, 'mínimo común múltiplo'],
    [/\bUdeA\b/g, 'Universidad de Antioquia'],
    [/\bICFES\b/g, 'I C F E S'],
    [/\bDV\b/g, 'discapacidad visual'],
    [/\bTTS\b/g, 'lectura por voz']
  ];

  // Fracciones simples a palabras. Orden importa: más larga primero.
  var FRACTION_NAMES = {
    '1/2': 'un medio', '1/3': 'un tercio', '2/3': 'dos tercios',
    '1/4': 'un cuarto', '3/4': 'tres cuartos',
    '1/5': 'un quinto', '2/5': 'dos quintos', '3/5': 'tres quintos', '4/5': 'cuatro quintos',
    '1/6': 'un sexto', '5/6': 'cinco sextos',
    '1/7': 'un séptimo',
    '1/8': 'un octavo', '3/8': 'tres octavos', '5/8': 'cinco octavos', '7/8': 'siete octavos',
    '1/9': 'un noveno',
    '1/10': 'un décimo', '3/10': 'tres décimos', '7/10': 'siete décimos', '9/10': 'nueve décimos'
  };

  function expandFractions(text) {
    // Fracciones nombradas
    Object.keys(FRACTION_NAMES).forEach(function (frac) {
      var re = new RegExp('(?<![\\d/])' + frac.replace('/', '\\/') + '(?![\\d/])', 'g');
      text = text.replace(re, FRACTION_NAMES[frac]);
    });
    // Fracciones genéricas a/b → "a sobre b"
    text = text.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, '$1 sobre $2');
    return text;
  }

  function expandPowersAndRoots(text) {
    // x^2 → equis al cuadrado, x^3 → equis al cubo, x^n → equis a la n
    text = text.replace(/([a-zA-Z0-9])\^2\b/g, '$1 al cuadrado');
    text = text.replace(/([a-zA-Z0-9])\^3\b/g, '$1 al cubo');
    text = text.replace(/([a-zA-Z0-9])\^(\d+)\b/g, '$1 a la $2');
    // √n → raíz cuadrada de n
    text = text.replace(/√\s*(\d+)/g, 'raíz cuadrada de $1');
    text = text.replace(/√\s*([a-zA-Z])/g, 'raíz cuadrada de $1');
    return text;
  }

  function expandSymbols(text) {
    // Operadores y símbolos comunes
    text = text.replace(/·/g, ' por ');
    text = text.replace(/×/g, ' por ');
    text = text.replace(/÷/g, ' dividido entre ');
    text = text.replace(/≤/g, ' menor o igual que ');
    text = text.replace(/≥/g, ' mayor o igual que ');
    text = text.replace(/≠/g, ' distinto de ');
    text = text.replace(/⟹|⇒|→/g, ' entonces ');
    text = text.replace(/⟺|⇔/g, ' si y solo si ');
    text = text.replace(/∈/g, ' pertenece a ');
    text = text.replace(/∉/g, ' no pertenece a ');
    return text;
  }

  function expandForTTS(text) {
    if (!text) return '';
    // Normalizar espacios y saltos
    text = String(text).replace(/\s+/g, ' ').trim();
    // Acrónimos primero (antes de números pegados)
    ACRONYMS.forEach(function (pair) { text = text.replace(pair[0], pair[1]); });
    // Fracciones, potencias, símbolos
    text = expandFractions(text);
    text = expandPowersAndRoots(text);
    text = expandSymbols(text);
    return text;
  }

  /* ───────── Selección y preferencia de voz ───────── */
  function pickVoice(voices) {
    if (!voices || !voices.length) return null;
    var saved = lsGet(VOICE_KEY);
    if (saved) {
      var v = voices.find(function (vv) { return vv.name === saved; });
      if (v) return v;
    }
    // Preferencia 1: Eloquence (JAWS) en español
    var elocuence = voices.find(function (v) {
      return /eloquence/i.test(v.name) && /es|spa/i.test(v.lang + v.name);
    });
    if (elocuence) return elocuence;
    // Preferencia 2: voz "premium"/"enhanced" en español
    var premium = voices.find(function (v) {
      return /es/i.test(v.lang) && /(premium|enhanced|natural|neural)/i.test(v.name);
    });
    if (premium) return premium;
    // Preferencia 3: es-CO, es-MX, es-ES en ese orden
    var prefLangs = ['es-CO', 'es-MX', 'es-ES', 'es-419', 'es-US'];
    for (var i = 0; i < prefLangs.length; i++) {
      var v = voices.find(function (vv) { return vv.lang === prefLangs[i]; });
      if (v) return v;
    }
    // Fallback: cualquier es*
    return voices.find(function (v) { return /^es/i.test(v.lang); }) || voices[0];
  }

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    var v = window.speechSynthesis.getVoices();
    if (v && v.length) {
      state.voices = v;
      state.voicesLoaded = true;
      state.onVoicesReady.forEach(function (cb) { cb(); });
      state.onVoicesReady = [];
    }
  }

  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  /* ───────── Persistencia: posición y velocidad ───────── */
  // Wrappers tolerantes a fallos: si localStorage está deshabilitado
  // (modo privado, política del navegador), las funciones no crashean.
  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* ignorar */ }
  }

  function getSpeed() {
    var saved = parseFloat(lsGet(SPEED_KEY));
    if (saved && saved >= 0.5 && saved <= 1.5) return saved;
    var slider = document.getElementById('speedSlider');
    return slider ? parseFloat(slider.value) : 0.9;
  }

  function setSpeed(v) {
    lsSet(SPEED_KEY, String(v));
  }

  function savePosition(blockId) {
    if (!blockId) return;
    var data = {};
    try { data = JSON.parse(lsGet(STORAGE_KEY) || '{}'); } catch (e) { data = {}; }
    data[location.pathname] = { blockId: blockId, ts: Date.now() };
    lsSet(STORAGE_KEY, JSON.stringify(data));
  }

  function loadPosition() {
    var data = {};
    try { data = JSON.parse(lsGet(STORAGE_KEY) || '{}'); } catch (e) { data = {}; }
    var entry = data[location.pathname];
    return entry ? entry.blockId : null;
  }

  /* ───────── Reproducción ───────── */
  function stopCurrent() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (state.currentBtn) {
      state.currentBtn.classList.remove('playing');
      var label = state.currentBtn.getAttribute('data-label-play') || '▶ Reproducir';
      state.currentBtn.innerHTML = label;
    }
    state.currentBtn = null;
    state.currentBlockId = null;
  }

  function speakBlock(btn, opts) {
    if (!('speechSynthesis' in window)) {
      alert('Esta página requiere lectura por voz. Abrí en Chrome, Safari o Edge.');
      return;
    }
    // Si el mismo botón está sonando, lo paramos.
    if (state.currentBtn === btn) { stopCurrent(); return; }
    // Cancelar cualquier voz previa SIEMPRE — regla 6.
    stopCurrent();

    var card = btn.closest('.card, .bloque, [data-block]') || btn.parentElement;
    var blockId = card && (card.id || card.getAttribute('data-block')) || null;
    var rawText = '';
    if (opts && opts.text) {
      rawText = opts.text;
    } else if (card) {
      var enun = card.querySelector('.enunciado, .contenido, [data-tts]');
      rawText = enun ? enun.innerText : card.innerText;
      var ops = card.querySelector('.opciones');
      if (ops) {
        rawText += '\nLas opciones son:\n';
        ops.querySelectorAll('.opcion').forEach(function (op) {
          rawText += op.innerText.trim() + '. ';
        });
      }
    } else {
      rawText = btn.getAttribute('aria-label') || '';
    }

    var text = expandForTTS(rawText);
    if (!text) return;

    var doSpeak = function () {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-CO';
      u.rate = getSpeed();
      u.pitch = 1.0;
      u.volume = 1.0;
      var v = pickVoice(state.voices);
      if (v) { u.voice = v; u.lang = v.lang; }

      state.currentBtn = btn;
      state.currentBlockId = blockId;
      btn.classList.add('playing');
      // Mantener el foco en el botón para que el usuario de teclado/lector no lo pierda
      // tras la actualización visual (cambio de clase y label).
      if (document.activeElement !== btn) {
        try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
      }
      var stopLabel = btn.getAttribute('data-label-stop') || '<span class="playing-dot"></span> Detener';
      btn.setAttribute('data-label-play', btn.innerHTML);
      btn.innerHTML = stopLabel;

      if (blockId) savePosition(blockId);

      u.onend = function () { stopCurrent(); };
      u.onerror = function () { stopCurrent(); };
      window.speechSynthesis.speak(u);
    };

    if (state.voicesLoaded) doSpeak();
    else {
      state.onVoicesReady.push(doSpeak);
      // Forzar un getVoices por si el evento ya pasó
      loadVoices();
      if (state.voicesLoaded) {
        state.onVoicesReady = state.onVoicesReady.filter(function (f) { return f !== doSpeak; });
        doSpeak();
      }
    }
  }

  /* ───────── API pública ───────── */
  function play(btnOrEvent, opts) {
    var btn = btnOrEvent;
    if (btnOrEvent && btnOrEvent.target) btn = btnOrEvent.target.closest('.btn-play, [data-tts-play]');
    if (!btn) return;
    speakBlock(btn, opts || {});
  }

  function bindSpeedSlider(sliderId, displayId) {
    var slider = document.getElementById(sliderId);
    var display = displayId ? document.getElementById(displayId) : null;
    if (!slider) return;
    var saved = parseFloat(lsGet(SPEED_KEY));
    if (saved && saved >= parseFloat(slider.min) && saved <= parseFloat(slider.max)) {
      slider.value = String(saved);
    }
    if (display) display.textContent = parseFloat(slider.value).toFixed(2) + 'x';
    slider.addEventListener('input', function () {
      setSpeed(parseFloat(slider.value));
      if (display) display.textContent = parseFloat(slider.value).toFixed(2) + 'x';
    });
  }

  function buildVoiceSelector(selectId) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    var fill = function () {
      sel.innerHTML = '';
      var spanish = state.voices.filter(function (v) { return /^es/i.test(v.lang); });
      var others = state.voices.filter(function (v) { return !/^es/i.test(v.lang); });
      var saved = lsGet(VOICE_KEY);
      [].concat(spanish, others).forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.name + ' (' + v.lang + ')';
        if (v.name === saved) opt.selected = true;
        sel.appendChild(opt);
      });
    };
    if (state.voicesLoaded) fill();
    else state.onVoicesReady.push(fill);
    sel.addEventListener('change', function () {
      lsSet(VOICE_KEY, sel.value);
    });
  }

  function setupResume(buttonId) {
    var btn = document.getElementById(buttonId);
    if (!btn) return;
    var lastId = loadPosition();
    if (!lastId) { btn.style.display = 'none'; return; }
    btn.addEventListener('click', function () {
      var target = document.getElementById(lastId);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var play = target.querySelector('.btn-play, [data-tts-play]');
      if (play) play.focus();
    });
  }

  function stopOnEsc() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') stopCurrent();
    });
  }

  global.TTS = {
    play: play,
    stop: stopCurrent,
    expand: expandForTTS,
    bindSpeedSlider: bindSpeedSlider,
    buildVoiceSelector: buildVoiceSelector,
    setupResume: setupResume,
    stopOnEsc: stopOnEsc,
    savePosition: savePosition,
    loadPosition: loadPosition
  };

  // Activar Esc por defecto
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', stopOnEsc);
    } else {
      stopOnEsc();
    }
  }
})(window);
