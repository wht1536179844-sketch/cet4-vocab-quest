(() => {
  "use strict";

  const STORAGE_KEY = "cet4_vocab_quest_v1";
  const WORDS = window.CET4_WORDS || [];
  const LEVELS = window.CET4_LEVELS || [];
  const CHAPTERS = window.CET4_CHAPTERS || [];
  const MINI_DICT = window.CET4_MINI_DICT || {};

  const WORDS_BY_ID = new Map(WORDS.map((w) => [w.id, w]));
  const WORDS_BY_WORD = new Map(WORDS.map((w) => [w.word.toLowerCase(), w]));

  const defaultState = () => ({
    xp: 0,
    streakDays: 1,
    lastStudyDate: todayKey(),
    dailyCount: 0,
    dailyGoal: 10,
    highestUnlockedLevel: 1,
    levelStars: {},      // { [levelId]: 1..3 }
    levelBestAcc: {},    // { [levelId]: 0..100 }
    masteredIds: [],     // [wordId]
    mistakeIds: [],      // [wordId]
    mistakeCounts: {},   // { [wordId]: number }
    favoriteWords: [],     // [{ word, phonetic, pos, meaning, cet4Id? }]
    favoriteSentences: [], // [{ en, zh, source, focusWord }]
    totalAnswered: 0,
    totalCorrect: 0,
    bestCombo: 0,
    settings: {
      sound: true,
      dark: false,
      autoSpeak: true,
      unlockAll: false
    }
  });

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function dateDiffDays(aStr, bStr) {
    if (!aStr || !bStr) return 0;
    const a = new Date(`${aStr}T00:00:00`);
    const b = new Date(`${bStr}T00:00:00`);
    return Math.round((b - a) / 86400000);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      const merged = {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) }
      };
      const today = todayKey();
      const diff = dateDiffDays(merged.lastStudyDate, today);
      if (diff === 1) {
        merged.streakDays = (merged.streakDays || 1) + 1;
        merged.dailyCount = 0;
        merged.lastStudyDate = today;
      } else if (diff > 1) {
        merged.streakDays = 1;
        merged.dailyCount = 0;
        merged.lastStudyDate = today;
      }
      return merged;
    } catch {
      return defaultState();
    }
  }

  let state = loadState();

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }

  // ===== Audio & Speech =====
  let audioCtx = null;
  function playTone(type) {
    if (!state.settings.sound) return;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === "correct") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.start(now);
        osc.stop(now + 0.23);
      } else if (type === "wrong") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.18);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "win") {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = "sine";
          o.frequency.setValueAtTime(freq, now + idx * 0.08);
          g.gain.setValueAtTime(0.12, now + idx * 0.08);
          g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
          o.connect(g);
          g.connect(audioCtx.destination);
          o.start(now + idx * 0.08);
          o.stop(now + idx * 0.08 + 0.26);
        });
      }
    } catch {
      // Ignore audio errors
    }
  }

  function speakWord(text) {
    if (!("speechSynthesis" in window)) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = 0.92;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore TTS errors
    }
  }

  // ===== Toast =====
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  // ===== Helpers =====
  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function blankWordInSentence(sentence, word) {
    const w = escapeRegex(word);
    const lastChar = escapeRegex(word.slice(-1));
    const patterns = [
      new RegExp(`\\b${w}\\b`, "i"),
      new RegExp(`\\b${w}(?:s|es|ed|d|ing|ly)\\b`, "i"),
      new RegExp(`\\b${w}${lastChar}(?:ed|ing)\\b`, "i")
    ];
    if (word.endsWith("e") || word.endsWith("y")) {
      const stem = escapeRegex(word.slice(0, -1));
      patterns.push(new RegExp(`\\b${stem}(?:ing|ied|ies|ed|d|s)\\b`, "i"));
    }
    for (const re of patterns) {
      if (re.test(sentence)) {
        return sentence.replace(re, "______");
      }
    }
    return null;
  }

  function isLevelUnlocked(levelId) {
    return state.settings.unlockAll || levelId <= state.highestUnlockedLevel;
  }

  function addMistake(wordId) {
    if (!state.mistakeIds.includes(wordId)) {
      state.mistakeIds.push(wordId);
    }
    state.mistakeCounts[wordId] = (state.mistakeCounts[wordId] || 0) + 1;
  }

  function removeMistake(wordId) {
    state.mistakeIds = state.mistakeIds.filter((id) => id !== wordId);
  }

  function markMastered(wordId) {
    if (!state.masteredIds.includes(wordId)) {
      state.masteredIds.push(wordId);
    }
    removeMistake(wordId);
  }

  function incrementDaily(n = 1) {
    const today = todayKey();
    if (state.lastStudyDate !== today) {
      const diff = dateDiffDays(state.lastStudyDate, today);
      state.streakDays = diff === 1 ? state.streakDays + 1 : 1;
      state.dailyCount = 0;
      state.lastStudyDate = today;
    }
    state.dailyCount += n;
  }

  // ===== Theme & Header =====
  function applyTheme() {
    document.documentElement.setAttribute(
      "data-theme",
      state.settings.dark ? "dark" : "light"
    );
    document.getElementById("btn-theme").textContent = state.settings.dark ? "☀️" : "🌙";
    document.getElementById("btn-sound").textContent = state.settings.sound ? "🔊" : "🔇";
  }

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateHeaderAndBadges() {
    document.getElementById("hdr-streak").textContent = state.streakDays;
    document.getElementById("hdr-xp").textContent = state.xp;
    document.getElementById("hdr-mastered").textContent = state.masteredIds.length;
    const totalEl = document.getElementById("hdr-total");
    if (totalEl) totalEl.textContent = WORDS.length;
    const chipAll = document.getElementById("chip-all-label");
    if (chipAll) chipAll.textContent = `全部 (${WORDS.length})`;

    const badge = document.getElementById("nav-mistake-badge");
    if (state.mistakeIds.length > 0) {
      badge.textContent = state.mistakeIds.length;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }

    const favBadge = document.getElementById("nav-fav-badge");
    const totalFavs = (state.favoriteWords?.length || 0) + (state.favoriteSentences?.length || 0);
    if (favBadge) {
      if (totalFavs > 0) {
        favBadge.textContent = totalFavs;
        favBadge.classList.remove("hidden");
      } else {
        favBadge.classList.add("hidden");
      }
    }
  }

  // ===== Favorites & Sentence Word Lookup Helpers =====
  function isWordFavorited(wordStr) {
    const low = String(wordStr || "").toLowerCase();
    return (state.favoriteWords || []).some((x) => x.word.toLowerCase() === low);
  }

  function toggleFavoriteWord(entry) {
    if (!state.favoriteWords) state.favoriteWords = [];
    const low = String(entry.word || "").toLowerCase();
    const exists = state.favoriteWords.some((x) => x.word.toLowerCase() === low);
    if (exists) {
      state.favoriteWords = state.favoriteWords.filter((x) => x.word.toLowerCase() !== low);
      showToast(`已取消收藏单词：${entry.word}`);
    } else {
      state.favoriteWords.unshift({
        word: entry.word,
        phonetic: entry.phonetic || "",
        pos: entry.pos || "",
        meaning: entry.meaning || "",
        cet4Id: entry.id || entry.cet4Id || null
      });
      showToast(`已收藏单词 ⭐ ${entry.word}`);
    }
    saveState();
    updateHeaderAndBadges();
    return !exists;
  }

  function isSentenceFavorited(enStr) {
    return (state.favoriteSentences || []).some((s) => s.en === enStr);
  }

  function toggleFavoriteSentence(item) {
    if (!state.favoriteSentences) state.favoriteSentences = [];
    const exists = state.favoriteSentences.some((s) => s.en === item.en);
    if (exists) {
      state.favoriteSentences = state.favoriteSentences.filter((s) => s.en !== item.en);
      showToast("已取消收藏该句子");
    } else {
      state.favoriteSentences.unshift({
        en: item.en,
        zh: item.zh || "",
        source: item.source || "四级真题例句",
        focusWord: item.focusWord || ""
      });
      showToast("已收藏真题句子 ⭐");
    }
    saveState();
    updateHeaderAndBadges();
    return !exists;
  }

  function lookupTapWord(rawToken) {
    const clean = String(rawToken || "").replace(/[’‘]/g, "'").trim();
    const low = clean.toLowerCase();

    const fromCet4 = (w) => {
      const obj = WORDS_BY_WORD.get(w);
      if (!obj) return null;
      return {
        displayWord: clean,
        phonetic: obj.phonetic,
        pos: obj.pos,
        meaning: obj.meaning,
        base: w !== low ? obj.word : "",
        cet4WordObj: obj
      };
    };

    const fromMini = (w, explicitBase = "") => {
      const arr = MINI_DICT[w];
      if (!arr) return null;
      const base = explicitBase || arr[3] || "";
      const cet4Obj = WORDS_BY_WORD.get(base || w) || null;
      return {
        displayWord: clean,
        phonetic: arr[0] || (cet4Obj ? cet4Obj.phonetic : ""),
        pos: arr[1] || (cet4Obj ? cet4Obj.pos : ""),
        meaning: arr[2] || (cet4Obj ? cet4Obj.meaning : ""),
        base,
        cet4WordObj: cet4Obj
      };
    };

    if (MINI_DICT[low]) return fromMini(low);
    if (WORDS_BY_WORD.has(low)) return fromCet4(low);

    // Strip common inflections for tokens not directly in MINI_DICT
    const cands = [];
    if (low.endsWith("'s")) cands.push(low.slice(0, -2));
    if (low.endsWith("ies") && low.length > 4) cands.push(low.slice(0, -3) + "y");
    if (low.endsWith("ied") && low.length > 4) cands.push(low.slice(0, -3) + "y");
    if (low.endsWith("ing") && low.length > 5) {
      cands.push(low.slice(0, -3), low.slice(0, -3) + "e");
      if (low.length > 6 && low[low.length - 4] === low[low.length - 5]) cands.push(low.slice(0, -4));
    }
    if (low.endsWith("ed") && low.length > 4) {
      cands.push(low.slice(0, -2), low.slice(0, -1));
      if (low.length > 5 && low[low.length - 3] === low[low.length - 4]) cands.push(low.slice(0, -3));
    }
    if (low.endsWith("es") && low.length > 4) cands.push(low.slice(0, -2), low.slice(0, -1));
    if (low.endsWith("s") && low.length > 3) cands.push(low.slice(0, -1));
    if (low.endsWith("ly") && low.length > 4) cands.push(low.slice(0, -2), low.slice(0, -2) + "e");

    for (const c of cands) {
      if (MINI_DICT[c]) return fromMini(c, c);
      if (WORDS_BY_WORD.has(c)) return fromCet4(c);
    }

    return {
      displayWord: clean,
      phonetic: "",
      pos: "",
      meaning: "人名/专有名词或特殊写法，可点击右侧按钮听发音",
      base: "",
      cet4WordObj: null
    };
  }

  function buildInteractiveSentenceHTML(sentence, opts = {}) {
    const skipBlank = !!opts.skipBlank;
    const text = String(sentence || "");
    const parts = text.split(/(______|[A-Za-z]+(?:['’][A-Za-z]+)?)/g);
    return parts
      .map((part) => {
        if (!part) return "";
        if (skipBlank && part === "______") {
          return `<span class="q-blank">______</span>`;
        }
        if (/^[A-Za-z]+(?:['’][A-Za-z]+)?$/.test(part)) {
          return `<button type="button" class="tap-word" data-tap="${esc(part)}">${esc(part)}</button>`;
        }
        return esc(part);
      })
      .join("");
  }

  let activeTapBtn = null;
  let currentLookupItem = null;

  function closeWordLookup() {
    document.getElementById("word-lookup-pop").classList.add("hidden");
    if (activeTapBtn) {
      activeTapBtn.classList.remove("active");
      activeTapBtn = null;
    }
    currentLookupItem = null;
  }

  function openWordLookup(rawWord, btnEl) {
    const info = lookupTapWord(rawWord);
    if (activeTapBtn) activeTapBtn.classList.remove("active");
    activeTapBtn = btnEl;
    if (btnEl) btnEl.classList.add("active");

    currentLookupItem = info;
    document.getElementById("wlp-word").textContent = info.displayWord;
    document.getElementById("wlp-phonetic").textContent = info.phonetic || "";
    const baseEl = document.getElementById("wlp-base");
    if (info.base && info.base.toLowerCase() !== info.displayWord.toLowerCase()) {
      baseEl.textContent = `原形: ${info.base}`;
      baseEl.classList.remove("hidden");
    } else {
      baseEl.classList.add("hidden");
    }
    document.getElementById("wlp-pos").textContent = info.pos ? `${info.pos} ` : "";
    document.getElementById("wlp-cn").textContent = info.meaning;

    const favWord = info.cet4WordObj ? info.cet4WordObj.word : (info.base || info.displayWord);
    const favBtn = document.getElementById("wlp-fav");
    const isFav = isWordFavorited(favWord);
    favBtn.textContent = isFav ? "⭐ 已收藏" : "☆ 收藏";
    favBtn.classList.toggle("is-fav", isFav);

    const errBtn = document.getElementById("wlp-add-mistake");
    if (info.cet4WordObj) {
      errBtn.classList.remove("hidden");
      const inErr = state.mistakeIds.includes(info.cet4WordObj.id);
      errBtn.textContent = inErr ? "✓ 已在错题" : "+ 错题";
    } else {
      errBtn.classList.add("hidden");
    }

    document.getElementById("word-lookup-pop").classList.remove("hidden");
    if (state.settings.autoSpeak) speakWord(info.displayWord);
  }

  // ===== View Navigation =====
  let activeView = "map";
  function switchView(viewName) {
    closeWordLookup();
    activeView = viewName;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`).classList.add("active");
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
    if (viewName === "map") renderMap();
    if (viewName === "flashcards") renderFlashcards();
    if (viewName === "favorites") renderFavorites();
    if (viewName === "mistakes") renderMistakes();
    if (viewName === "stats") renderStats();
  }

  // ===== View 1: Stage Map =====
  const expandedChapters = new Set([Math.floor((Math.min(state.highestUnlockedLevel, LEVELS.length) - 1) / 20) + 1]);

  function renderMap() {
    updateHeaderAndBadges();

    const nextLevelId = Math.min(state.highestUnlockedLevel, LEVELS.length);
    const nextLvl = LEVELS.find((l) => l.id === nextLevelId) || LEVELS[0];
    document.getElementById("hero-next-title").textContent = nextLvl.name;
    document.getElementById("hero-next-sub").textContent =
      state.masteredIds.length >= WORDS.length
        ? `全部 ${WORDS.length} 个四级阅读高频词已掌握，随时开启随机巩固！`
        : `目标：${nextLvl.desc}（15 词闯关）`;

    const pct = Math.round((state.masteredIds.length / WORDS.length) * 100);
    document.getElementById("hero-pct").textContent = `${pct}%`;

    const goal = state.dailyGoal || 10;
    const dailyPct = Math.min(100, Math.round((state.dailyCount / goal) * 100));
    document.getElementById("daily-goal-text").textContent = `${state.dailyCount} / ${goal} 词`;
    document.getElementById("daily-goal-fill").style.width = `${dailyPct}%`;

    const quickNav = document.getElementById("chapter-quick-nav");
    quickNav.innerHTML = "";
    CHAPTERS.forEach((chap) => {
      const btn = document.createElement("button");
      btn.className = "chip" + (expandedChapters.has(chap.id) ? " active" : "");
      btn.textContent = `第${chap.id}幕 (${chap.levels[0]}-${chap.levels[chap.levels.length - 1]}关)`;
      btn.addEventListener("click", () => {
        expandedChapters.clear();
        expandedChapters.add(chap.id);
        renderMap();
        const targetEl = document.getElementById(`chapter-block-${chap.id}`);
        if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      quickNav.appendChild(btn);
    });

    const container = document.getElementById("chapters-container");
    container.innerHTML = "";

    CHAPTERS.forEach((chap) => {
      const block = document.createElement("div");
      block.id = `chapter-block-${chap.id}`;
      block.className = "chapter-block";
      block.style.setProperty("--chapter-color", chap.color);

      const passedInChap = chap.levels.filter((lid) => (state.levelStars[lid] || 0) > 0).length;
      const isExpanded = expandedChapters.has(chap.id);

      const banner = document.createElement("div");
      banner.className = "chapter-banner";
      banner.innerHTML = `
        <div>
          <h2>${esc(chap.title)}</h2>
          <p>${esc(chap.subtitle)}</p>
        </div>
        <div class="chapter-banner-right">
          <span class="chapter-progress-pill">${passedInChap} / ${chap.levels.length} 关</span>
          <span class="chapter-chevron">${isExpanded ? "▾" : "▸"}</span>
        </div>
      `;
      banner.addEventListener("click", () => {
        if (expandedChapters.has(chap.id)) expandedChapters.delete(chap.id);
        else expandedChapters.add(chap.id);
        renderMap();
      });
      block.appendChild(banner);

      if (!isExpanded) {
        container.appendChild(block);
        return;
      }

      const path = document.createElement("div");
      path.className = "level-path";

      chap.levels.forEach((lid) => {
        const lvl = LEVELS.find((l) => l.id === lid);
        const unlocked = isLevelUnlocked(lid);
        const stars = state.levelStars[lid] || 0;
        const isCurrent = unlocked && stars === 0 && lid === state.highestUnlockedLevel;

        const card = document.createElement("div");
        card.className = "level-card";
        if (!unlocked) card.classList.add("locked");
        else if (stars > 0) card.classList.add("passed");
        if (isCurrent) card.classList.add("current");

        const starHtml = [1, 2, 3]
          .map((n) => `<span class="${n <= stars ? "lit" : ""}">★</span>`)
          .join("");

        let statusText = "待挑战";
        if (!unlocked) statusText = "🔒 未解锁";
        else if (stars > 0) statusText = `最佳 ${state.levelBestAcc[lid] || 100}%`;
        else if (isCurrent) statusText = "当前推进 →";

        card.innerHTML = `
          <div class="level-left">
            <div class="level-badge">${unlocked ? lid : "🔒"}</div>
            <div class="level-info">
              <h3>${esc(lvl.name)}</h3>
              <p>${esc(lvl.desc)}</p>
            </div>
          </div>
          <div class="level-right">
            <div class="level-stars">${starHtml}</div>
            <div class="level-status-tag">${statusText}</div>
          </div>
        `;

        card.addEventListener("click", () => {
          if (!unlocked) {
            showToast(`通关第 ${lid - 1} 关即可解锁（或去战绩页开启全关解锁）`);
            return;
          }
          openStagePreview(lid);
        });

        path.appendChild(card);
      });

      block.appendChild(path);
      container.appendChild(block);
    });
  }

  // ===== Stage Preview Modal =====
  let previewLevelId = 1;
  function openStagePreview(levelId) {
    previewLevelId = levelId;
    const lvl = LEVELS.find((l) => l.id === levelId);
    const words = WORDS.filter((w) => w.level === levelId);

    document.getElementById("preview-tag").textContent = `第 ${levelId} 关`;
    document.getElementById("preview-title").textContent = lvl.name.replace(/^第 \d+ 关 · /, "");
    document.getElementById("preview-desc").textContent = `${lvl.desc} · 点击任意单词可发音`;

    const list = document.getElementById("preview-words-list");
    list.innerHTML = "";
    words.forEach((w) => {
      const item = document.createElement("div");
      item.className = "preview-word-item";
      item.innerHTML = `
        <div>
          <strong>${w.word}</strong>
          <small>${w.phonetic}</small>
        </div>
        <div class="preview-word-meaning">${w.pos} ${w.meaning}</div>
      `;
      item.addEventListener("click", () => speakWord(w.word));
      list.appendChild(item);
    });

    document.getElementById("modal-preview").classList.remove("hidden");
  }

  function closeStagePreview() {
    document.getElementById("modal-preview").classList.add("hidden");
  }

  // ===== View 2: Pocket Flashcards =====
  let fcFilter = "all";
  let fcLevel = "all";
  let fcSearch = "";
  let fcMode = "card"; // "card" | "list"
  let fcIndex = 0;
  let fcCustomOrder = null;

  function initFlashcardLevelSelect() {
    const sel = document.getElementById("fc-level-select");
    LEVELS.forEach((lvl) => {
      const opt = document.createElement("option");
      opt.value = String(lvl.id);
      opt.textContent = lvl.name;
      sel.appendChild(opt);
    });
  }

  function getFilteredFlashcards() {
    const q = fcSearch.trim().toLowerCase();
    let list = WORDS.filter((w) => {
      if (fcLevel !== "all" && w.level !== Number(fcLevel)) return false;
      if (fcFilter === "unmastered" && state.masteredIds.includes(w.id)) return false;
      if (fcFilter === "mastered" && !state.masteredIds.includes(w.id)) return false;
      if (fcFilter === "mistakes" && !state.mistakeIds.includes(w.id)) return false;
      if (q) {
        const matchWord = w.word.toLowerCase().includes(q);
        const matchMeaning = w.meaning.includes(q);
        if (!matchWord && !matchMeaning) return false;
      }
      return true;
    });

    if (fcCustomOrder) {
      const orderMap = new Map(fcCustomOrder.map((id, idx) => [id, idx]));
      list = list.slice().sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    }
    return list;
  }

  function renderFlashcards(autoPronounce = false) {
    const list = getFilteredFlashcards();
    document.getElementById("fc-count-badge").textContent = `${list.length} 词`;

    const cardStage = document.getElementById("fc-card-stage");
    const listStage = document.getElementById("fc-list-stage");

    if (fcMode === "list") {
      cardStage.classList.add("hidden");
      listStage.classList.remove("hidden");
      renderFlashcardList(list);
      return;
    }

    listStage.classList.add("hidden");
    cardStage.classList.remove("hidden");

    const flipCard = document.getElementById("flip-card");
    flipCard.classList.remove("flipped");

    if (list.length === 0) {
      document.getElementById("fc-index-indicator").textContent = "0 / 0";
      document.getElementById("fc-word").textContent = "暂无匹配单词";
      document.getElementById("fc-phonetic").textContent = "请更换筛选条件";
      document.getElementById("fc-level-badge").textContent = "-";
      document.getElementById("fc-freq").textContent = "";
      document.getElementById("fc-back-word").textContent = "-";
      document.getElementById("fc-pos").textContent = "";
      document.getElementById("fc-meaning").textContent = "没有符合条件的词条";
      document.getElementById("fc-tip").textContent = "点击上方筛选切换为“全部”即可浏览 150 词";
      document.getElementById("fc-example").textContent = "";
      document.getElementById("fc-translation").textContent = "";
      return;
    }

    if (fcIndex >= list.length) fcIndex = 0;
    if (fcIndex < 0) fcIndex = list.length - 1;

    const w = list[fcIndex];
    document.getElementById("fc-index-indicator").textContent = `${fcIndex + 1} / ${list.length}`;
    document.getElementById("fc-level-badge").textContent = `Lv.${w.level}`;
    document.getElementById("fc-freq").textContent = `高频 ${"★".repeat(w.freq)}${"☆".repeat(3 - w.freq)}`;
    document.getElementById("fc-word").textContent = w.word;
    document.getElementById("fc-phonetic").textContent = w.phonetic;

    document.getElementById("fc-back-word").textContent = w.word;
    document.getElementById("fc-pos").textContent = w.pos;
    document.getElementById("fc-meaning").textContent = w.meaning;
    document.getElementById("fc-tip").textContent = `💡 ${w.tip}`;
    document.getElementById("fc-example-src").textContent = w.exampleSource || "四级真题例句";
    document.getElementById("fc-example").innerHTML = buildInteractiveSentenceHTML(w.example);
    document.getElementById("fc-translation").textContent = w.translation;

    const wFav = isWordFavorited(w.word);
    ["btn-fc-fav-front", "btn-fc-fav-back"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = wFav ? "★" : "☆";
      el.classList.toggle("active", wFav);
    });
    const sFav = isSentenceFavorited(w.example);
    const sBtn = document.getElementById("btn-fc-fav-sent");
    if (sBtn) {
      sBtn.textContent = sFav ? "⭐ 已藏句" : "☆ 藏句";
      sBtn.classList.toggle("is-fav", sFav);
    }

    if (autoPronounce && state.settings.autoSpeak) {
      speakWord(w.word);
    }
  }

  let fcListLimit = 50;

  function renderFlashcardList(list) {
    const container = document.getElementById("fc-list-stage");
    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state">没有找到匹配的单词，试试清空搜索词或切换筛选。</div>`;
      return;
    }

    container.innerHTML = "";
    const slice = list.slice(0, fcListLimit);
    slice.forEach((w) => {
      const mastered = state.masteredIds.includes(w.id);
      const wFav = isWordFavorited(w.word);
      const sFav = isSentenceFavorited(w.example);
      const card = document.createElement("div");
      card.className = "word-row-card";
      card.innerHTML = `
        <div class="word-row-head">
          <div>
            <div class="word-row-title">
              <strong>${esc(w.word)}</strong>
              <span>${esc(w.phonetic)}</span>
              <span>Lv.${w.level}</span>
            </div>
            <div class="word-row-meaning">${esc(w.pos)} ${esc(w.meaning)}</div>
          </div>
          <div class="word-row-actions">
            <button class="speak-pill small js-speak" type="button">🔊</button>
            <button class="speak-pill small js-fav-word ${wFav ? "is-fav" : ""}" type="button">${wFav ? "★" : "☆"}</button>
            <button class="speak-pill small js-toggle-master" type="button">${mastered ? "✓ 已斩" : "斩词"}</button>
          </div>
        </div>
        <div class="word-row-extra">
          <div>💡 ${esc(w.tip)}</div>
          <div class="fc-example-head" style="margin-top:6px">
            <span class="exam-src-tag">${esc(w.exampleSource || "真题例句")}</span>
            <div class="fc-example-btns">
              <button class="speak-pill mini js-speak-sent" type="button">🔊 读句</button>
              <button class="speak-pill mini js-fav-sent ${sFav ? "is-fav" : ""}" type="button">${sFav ? "⭐ 已藏句" : "☆ 藏句"}</button>
            </div>
          </div>
          <div style="margin-top:4px;color:var(--text);font-weight:600">${buildInteractiveSentenceHTML(w.example)}</div>
          <div style="margin-top:2px">${esc(w.translation)}</div>
        </div>
      `;
      card.querySelector(".js-speak").addEventListener("click", () => speakWord(w.word));
      card.querySelector(".js-speak-sent").addEventListener("click", () => speakWord(w.example));
      card.querySelector(".js-fav-word").addEventListener("click", () => {
        toggleFavoriteWord(w);
        renderFlashcardList(getFilteredFlashcards());
      });
      card.querySelector(".js-fav-sent").addEventListener("click", () => {
        toggleFavoriteSentence({ en: w.example, zh: w.translation, source: w.exampleSource || "真题例句", focusWord: w.word });
        renderFlashcardList(getFilteredFlashcards());
      });
      card.querySelector(".js-toggle-master").addEventListener("click", () => {
        if (state.masteredIds.includes(w.id)) {
          state.masteredIds = state.masteredIds.filter((id) => id !== w.id);
          showToast(`已取消掌握：${w.word}`);
        } else {
          markMastered(w.id);
          incrementDaily(1);
          showToast(`已斩词：${w.word}`);
        }
        saveState();
        updateHeaderAndBadges();
        renderFlashcardList(getFilteredFlashcards());
      });
      container.appendChild(card);
    });

    if (list.length > fcListLimit) {
      const moreBtn = document.createElement("button");
      moreBtn.className = "btn btn-secondary btn-tactile load-more-btn";
      moreBtn.textContent = `加载更多（还有 ${list.length - fcListLimit} 词）`;
      moreBtn.addEventListener("click", () => {
        fcListLimit += 60;
        renderFlashcardList(list);
      });
      container.appendChild(moreBtn);
    }
  }

  // ===== View 3: Favorites =====
  let activeFavTab = "words"; // "words" | "sentences"

  function renderFavorites() {
    updateHeaderAndBadges();
    const favWords = state.favoriteWords || [];
    const favSents = state.favoriteSentences || [];

    document.getElementById("fav-tab-words").textContent = `收藏单词 (${favWords.length})`;
    document.getElementById("fav-tab-sentences").textContent = `收藏句子 (${favSents.length})`;
    document.querySelectorAll("[data-favtab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.favtab === activeFavTab);
    });

    const btnPractice = document.getElementById("btn-practice-favorites");
    btnPractice.disabled = favWords.length === 0;
    btnPractice.style.opacity = favWords.length === 0 ? "0.5" : "1";

    document.getElementById("favorites-summary").textContent =
      `已收藏 ${favWords.length} 个单词 · ${favSents.length} 句真题例句`;

    const listEl = document.getElementById("favorites-list");
    listEl.innerHTML = "";

    if (activeFavTab === "words") {
      if (favWords.length === 0) {
        listEl.innerHTML = `<div class="empty-state">还没有收藏单词 ⭐<br/>在词卡、解析或点击句子查词时点「☆ 收藏」即可添加！</div>`;
        return;
      }
      favWords.forEach((fw) => {
        const fullObj = (fw.cet4Id && WORDS_BY_ID.get(fw.cet4Id)) || WORDS_BY_WORD.get(fw.word.toLowerCase());
        const card = document.createElement("div");
        card.className = "word-row-card";
        card.innerHTML = `
          <div class="word-row-head">
            <div>
              <div class="word-row-title">
                <strong>${esc(fw.word)}</strong>
                <span>${esc(fw.phonetic || (fullObj ? fullObj.phonetic : ""))}</span>
                ${fullObj ? `<span>Lv.${fullObj.level}</span>` : ""}
              </div>
              <div class="word-row-meaning">${esc(fw.pos || (fullObj ? fullObj.pos : ""))} ${esc(fw.meaning || (fullObj ? fullObj.meaning : ""))}</div>
            </div>
            <div class="word-row-actions">
              <button class="speak-pill small js-speak" type="button">🔊</button>
              <button class="speak-pill small js-unfav" type="button">移除</button>
            </div>
          </div>
          ${fullObj ? `
            <div class="word-row-extra">
              <div><span class="exam-src-tag">${esc(fullObj.exampleSource || "真题例句")}</span></div>
              <div style="margin-top:4px;color:var(--text);font-weight:600">${buildInteractiveSentenceHTML(fullObj.example)}</div>
              <div>${esc(fullObj.translation)}</div>
            </div>
          ` : ""}
        `;
        card.querySelector(".js-speak").addEventListener("click", () => speakWord(fw.word));
        card.querySelector(".js-unfav").addEventListener("click", () => {
          toggleFavoriteWord(fw);
          renderFavorites();
        });
        listEl.appendChild(card);
      });
      return;
    }

    if (favSents.length === 0) {
      listEl.innerHTML = `<div class="empty-state">还没有收藏真题句子 ⭐<br/>翻开词卡背面或闯关看解析时，点击「☆ 藏句」即可收藏！</div>`;
      return;
    }
    favSents.forEach((fs) => {
      const card = document.createElement("div");
      card.className = "word-row-card";
      card.innerHTML = `
        <div class="fc-example-head">
          <div>
            <span class="exam-src-tag">${esc(fs.source || "四级真题")}</span>
            ${fs.focusWord ? `<span class="fc-badge" style="margin-left:4px">${esc(fs.focusWord)}</span>` : ""}
          </div>
          <div class="fc-example-btns">
            <button class="speak-pill mini js-speak-sent" type="button">🔊 听整句</button>
            <button class="speak-pill mini js-unfav-sent" type="button">移除</button>
          </div>
        </div>
        <div style="margin-top:6px;font-size:15px;font-weight:700;line-height:1.55">${buildInteractiveSentenceHTML(fs.en)}</div>
        <div style="margin-top:6px;font-size:13px;color:var(--text-muted)">${esc(fs.zh)}</div>
      `;
      card.querySelector(".js-speak-sent").addEventListener("click", () => speakWord(fs.en));
      card.querySelector(".js-unfav-sent").addEventListener("click", () => {
        toggleFavoriteSentence(fs);
        renderFavorites();
      });
      listEl.appendChild(card);
    });
  }

  // ===== View 4: Mistake Book =====
  function renderMistakes() {
    updateHeaderAndBadges();
    const listEl = document.getElementById("mistakes-list");
    const btnPractice = document.getElementById("btn-practice-mistakes");
    const words = state.mistakeIds.map((id) => WORDS_BY_ID.get(id)).filter(Boolean);

    document.getElementById("mistakes-summary").textContent =
      words.length > 0
        ? `当前有 ${words.length} 个错词待复盘，闯关答对即可自动移出`
        : "太棒了！目前错题本已清空";

    btnPractice.disabled = words.length === 0;
    btnPractice.style.opacity = words.length === 0 ? "0.5" : "1";

    if (words.length === 0) {
      listEl.innerHTML = `<div class="empty-state">暂无错题 🎉<br/>继续去闯关挑战或浏览词卡吧！</div>`;
      return;
    }

    listEl.innerHTML = "";
    words.forEach((w) => {
      const count = state.mistakeCounts[w.id] || 1;
      const wFav = isWordFavorited(w.word);
      const card = document.createElement("div");
      card.className = "word-row-card";
      card.innerHTML = `
        <div class="word-row-head">
          <div>
            <div class="word-row-title">
              <strong>${esc(w.word)}</strong>
              <span>${esc(w.phonetic)}</span>
              <span style="color:var(--danger);font-weight:700;">错 ${count} 次</span>
            </div>
            <div class="word-row-meaning">${esc(w.pos)} ${esc(w.meaning)}</div>
          </div>
          <div class="word-row-actions">
            <button class="speak-pill small js-speak" type="button">🔊</button>
            <button class="speak-pill small js-fav ${wFav ? "is-fav" : ""}" type="button">${wFav ? "★" : "☆"}</button>
            <button class="speak-pill small js-clear" type="button">✓ 已会</button>
          </div>
        </div>
        <div class="word-row-extra">
          <div>💡 ${esc(w.tip)}</div>
          <div style="margin-top:6px;color:var(--text);font-weight:600">${buildInteractiveSentenceHTML(w.example)}</div>
          <div style="margin-top:2px">${esc(w.translation)}</div>
        </div>
      `;
      card.querySelector(".js-speak").addEventListener("click", () => speakWord(w.word));
      card.querySelector(".js-fav").addEventListener("click", () => {
        toggleFavoriteWord(w);
        renderMistakes();
      });
      card.querySelector(".js-clear").addEventListener("click", () => {
        markMastered(w.id);
        saveState();
        showToast(`已将 ${w.word} 移出错题本`);
        renderMistakes();
      });
      listEl.appendChild(card);
    });
  }

  // ===== View 4: Stats =====
  function renderStats() {
    updateHeaderAndBadges();
    const totalStars = Object.values(state.levelStars).reduce((a, b) => a + b, 0);
    const acc = state.totalAnswered > 0
      ? Math.round((state.totalCorrect / state.totalAnswered) * 100)
      : 0;

    document.getElementById("stat-mastered").textContent = `${state.masteredIds.length}`;
    document.getElementById("stat-stars").textContent = `${totalStars} / ${LEVELS.length * 3}`;
    document.getElementById("stat-accuracy").textContent = `${acc}%`;
    document.getElementById("stat-combo").textContent = `x${state.bestCombo}`;

    const barsEl = document.getElementById("chapter-stats-bars");
    barsEl.innerHTML = "";
    CHAPTERS.forEach((chap) => {
      const chapWords = WORDS.filter((w) => chap.levels.includes(w.level));
      const masteredCount = chapWords.filter((w) => state.masteredIds.includes(w.id)).length;
      const pct = Math.round((masteredCount / chapWords.length) * 100);
      const row = document.createElement("div");
      row.innerHTML = `
        <div class="cs-row-top">
          <span>${chap.title}</span>
          <span>${masteredCount} / ${chapWords.length} (${pct}%)</span>
        </div>
        <div class="progress-track light">
          <div class="progress-fill" style="width:${pct}%;background:${chap.color}"></div>
        </div>
      `;
      barsEl.appendChild(row);
    });

    document.getElementById("opt-auto-speak").checked = !!state.settings.autoSpeak;
    document.getElementById("opt-unlock-all").checked = !!state.settings.unlockAll;
    document.getElementById("opt-daily-goal").value = String(state.dailyGoal || 10);
  }

  // ===== Quiz Engine =====
  let quizSession = null;

  function pickDistractors(targetWord, count = 3) {
    const samePos = WORDS.filter((w) => w.id !== targetWord.id && w.pos === targetWord.pos);
    const others = WORDS.filter((w) => w.id !== targetWord.id && w.pos !== targetWord.pos);
    const pool = [...shuffle(samePos), ...shuffle(others)];
    return pool.slice(0, count);
  }

  function buildQuestions(wordsList) {
    const ordered = shuffle(wordsList);
    return ordered.map((target, idx) => {
      const distractors = pickDistractors(target, 3);
      const optionsWords = shuffle([target, ...distractors]);
      let type = idx % 3; // 0: word->meaning, 1: meaning->word, 2: cloze
      let blanked = null;
      if (type === 2) {
        blanked = blankWordInSentence(target.example, target.word);
        if (!blanked) type = 0;
      }
      return {
        target,
        type,
        blanked,
        options: optionsWords,
        answered: false
      };
    });
  }

  function startQuiz({ mode, levelId = null, words }) {
    if (!words || words.length === 0) {
      showToast("没有可用的练习单词");
      return;
    }
    const questions = buildQuestions(words);
    const maxH = mode === "mistakes" ? 5 : 4;
    quizSession = {
      mode, // "level" | "blitz" | "mistakes"
      levelId,
      questions,
      index: 0,
      hearts: maxH,
      maxHearts: maxH,
      combo: 0,
      maxCombo: 0,
      correctCount: 0,
      answeredCount: 0,
      xpEarned: 0,
      wrongWords: [],
      failedOut: false
    };

    closeStagePreview();
    document.getElementById("overlay-result").classList.add("hidden");
    document.getElementById("overlay-quiz").classList.remove("hidden");
    renderCurrentQuestion();
  }

  function renderCurrentQuestion() {
    const s = quizSession;
    const q = s.questions[s.index];
    const total = s.questions.length;

    document.getElementById("quiz-progress-fill").style.width = `${Math.round((s.index / total) * 100)}%`;
    document.getElementById("quiz-step-text").textContent = `${s.index + 1} / ${total}`;

    const comboEl = document.getElementById("quiz-combo-pill");
    if (s.combo >= 2) {
      comboEl.textContent = `🔥 x${s.combo}`;
      comboEl.classList.remove("hidden");
    } else {
      comboEl.classList.add("hidden");
    }

    const heartsStr = "❤️".repeat(Math.max(0, s.hearts)) + "🤍".repeat(Math.max(0, s.maxHearts - s.hearts));
    document.getElementById("quiz-hearts").textContent = heartsStr;

    const feedbackEl = document.getElementById("quiz-feedback");
    feedbackEl.classList.add("hidden");
    feedbackEl.classList.remove("is-correct", "is-wrong");

    const typeBadge = document.getElementById("quiz-type-badge");
    const promptCard = document.getElementById("quiz-prompt-card");
    const optionsEl = document.getElementById("quiz-options");
    optionsEl.innerHTML = "";

    closeWordLookup();
    const w = q.target;

    if (q.type === 0) {
      typeBadge.textContent = "看词选义";
      promptCard.innerHTML = `
        <div class="q-main-word">${esc(w.word)}</div>
        <div class="q-phonetic-row">
          <span>${esc(w.phonetic)}</span>
          <button id="q-speak-btn" class="speak-pill small" type="button">🔊 发音</button>
          <button id="q-tip-btn" class="speak-pill small" type="button">💡 看考频提示</button>
        </div>
        <div id="q-letter-hint" class="q-letter-hint hidden"></div>
      `;
      document.getElementById("q-speak-btn").addEventListener("click", () => speakWord(w.word));
      document.getElementById("q-tip-btn").addEventListener("click", () => {
        const hintEl = document.getElementById("q-letter-hint");
        hintEl.textContent = `💡 ${w.tip}`;
        hintEl.classList.remove("hidden");
      });
      if (state.settings.autoSpeak) speakWord(w.word);
    } else if (q.type === 1) {
      typeBadge.textContent = "看义选词";
      const safeTip = w.tip.replace(new RegExp(escapeRegex(w.word), "gi"), "____");
      promptCard.innerHTML = `
        <div class="q-target-cn-label">请根据中文意思选出对应英文单词</div>
        <div class="q-meaning-prompt">${esc(w.pos)} ${esc(w.meaning)}</div>
        <div class="q-hint-sub">💡 ${esc(safeTip)}</div>
      `;
    } else {
      typeBadge.textContent = `真题语境填空 · ${w.exampleSource || "真题例句"}`;
      const interactiveBlanked = buildInteractiveSentenceHTML(q.blanked, { skipBlank: true });
      promptCard.innerHTML = `
        <div class="q-target-cn-box">
          <div class="q-target-cn-label">空格要填单词的中文意思（零基础提示）</div>
          <div class="q-target-cn-val">${esc(w.pos)} ${esc(w.meaning)}</div>
        </div>
        <div class="q-sentence">${interactiveBlanked}</div>
        <div class="q-sentence-zh">整句译文：${esc(w.translation)}</div>
        <div class="q-helper-row">
          <span class="tap-hint-inline">💡 点击句子里任意单词可查中文</span>
          <div style="display:flex;gap:6px">
            <button id="q-speak-sent-btn" class="speak-pill mini" type="button">🔊 听整句</button>
            <button id="q-hint-letter-btn" class="speak-pill mini" type="button">首字母提示</button>
          </div>
        </div>
        <div id="q-letter-hint" class="q-letter-hint hidden"></div>
      `;
      document.getElementById("q-speak-sent-btn").addEventListener("click", () => speakWord(w.example));
      document.getElementById("q-hint-letter-btn").addEventListener("click", () => {
        const hintEl = document.getElementById("q-letter-hint");
        hintEl.textContent = `首字母提示：${w.word[0]}${"_".repeat(Math.max(2, w.word.length - 1))}（共 ${w.word.length} 字母） ${w.phonetic}`;
        hintEl.classList.remove("hidden");
        speakWord(w.word);
      });
    }

    const keys = ["A", "B", "C", "D"];
    q.options.forEach((optWord, idx) => {
      const btn = document.createElement("button");
      btn.className = "option-btn";
      btn.type = "button";
      const label = q.type === 0 ? `${optWord.pos} ${optWord.meaning}` : optWord.word;
      btn.innerHTML = `<span class="option-key">${keys[idx]}</span><span>${label}</span>`;
      btn.addEventListener("click", () => handleQuizAnswer(optWord.id, btn));
      optionsEl.appendChild(btn);
    });
  }

  function handleQuizAnswer(selectedId, clickedBtn) {
    const s = quizSession;
    const q = s.questions[s.index];
    if (q.answered) return;
    q.answered = true;

    const isCorrect = selectedId === q.target.id;
    s.answeredCount += 1;
    state.totalAnswered += 1;
    incrementDaily(1);

    const optionBtns = Array.from(document.querySelectorAll("#quiz-options .option-btn"));
    optionBtns.forEach((btn, idx) => {
      btn.disabled = true;
      const optId = q.options[idx].id;
      if (optId === q.target.id) {
        btn.classList.add("correct");
      } else if (btn === clickedBtn && !isCorrect) {
        btn.classList.add("wrong");
      }
    });

    const fb = document.getElementById("quiz-feedback");
    const fbStatus = document.getElementById("fb-status");

    if (isCorrect) {
      s.correctCount += 1;
      s.combo += 1;
      if (s.combo > s.maxCombo) s.maxCombo = s.combo;
      if (s.combo > state.bestCombo) state.bestCombo = s.combo;
      state.totalCorrect += 1;

      const gain = 10 + Math.min(10, (s.combo - 1) * 2);
      s.xpEarned += gain;
      state.xp += gain;

      if (s.mode === "mistakes") {
        removeMistake(q.target.id);
      }
      if (!state.masteredIds.includes(q.target.id)) {
        state.masteredIds.push(q.target.id);
      }

      playTone("correct");
      fb.classList.add("is-correct");
      fbStatus.textContent = s.combo >= 2 ? `✓ 回答正确！${s.combo} 连击 +${gain} XP` : `✓ 回答正确！+${gain} XP`;
    } else {
      s.combo = 0;
      s.hearts -= 1;
      addMistake(q.target.id);
      if (!s.wrongWords.some((item) => item.id === q.target.id)) {
        s.wrongWords.push(q.target);
      }

      playTone("wrong");
      fb.classList.add("is-wrong");
      fbStatus.textContent = "✕ 记错了，已收入错题本";

      const heartsStr = "❤️".repeat(Math.max(0, s.hearts)) + "🤍".repeat(Math.max(0, s.maxHearts - s.hearts));
      document.getElementById("quiz-hearts").textContent = heartsStr;
    }

    document.getElementById("fb-word").textContent = q.target.word;
    document.getElementById("fb-phonetic").textContent = q.target.phonetic;
    document.getElementById("fb-meaning").textContent = `${q.target.pos} ${q.target.meaning}`;
    document.getElementById("fb-tip").textContent = `💡 ${q.target.tip}`;
    document.getElementById("fb-example-src").textContent = q.target.exampleSource || "四级真题例句";
    document.getElementById("fb-example").innerHTML = `${buildInteractiveSentenceHTML(q.target.example)} <span style="margin-left:4px">${esc(q.target.translation)}</span>`;
    document.getElementById("fb-speak-btn").onclick = () => speakWord(q.target.word);

    const fbFavWord = document.getElementById("fb-fav-word");
    const syncFbFavWord = () => {
      const f = isWordFavorited(q.target.word);
      fbFavWord.textContent = f ? "⭐ 已藏词" : "☆ 藏词";
      fbFavWord.classList.toggle("is-fav", f);
    };
    syncFbFavWord();
    fbFavWord.onclick = () => {
      toggleFavoriteWord(q.target);
      syncFbFavWord();
    };

    const fbFavSent = document.getElementById("fb-fav-sent");
    const syncFbFavSent = () => {
      const f = isSentenceFavorited(q.target.example);
      fbFavSent.textContent = f ? "⭐ 已藏句" : "☆ 藏句";
      fbFavSent.classList.toggle("is-fav", f);
    };
    syncFbFavSent();
    fbFavSent.onclick = () => {
      toggleFavoriteSentence({
        en: q.target.example,
        zh: q.target.translation,
        source: q.target.exampleSource || "四级真题例句",
        focusWord: q.target.word
      });
      syncFbFavSent();
    };

    const nextBtn = document.getElementById("btn-quiz-next");
    if (s.hearts <= 0) {
      nextBtn.textContent = "体力耗尽 · 查看本轮战绩";
    } else if (s.index === s.questions.length - 1) {
      nextBtn.textContent = "完成闯关 · 查看战绩 🎉";
    } else {
      nextBtn.textContent = "继续下一题 →";
    }

    fb.classList.remove("hidden");
    saveState();
    updateHeaderAndBadges();
  }

  function advanceQuiz() {
    const s = quizSession;
    if (!s) return;
    if (s.hearts <= 0) {
      s.failedOut = true;
      finishQuiz();
      return;
    }
    if (s.index < s.questions.length - 1) {
      s.index += 1;
      renderCurrentQuestion();
    } else {
      finishQuiz();
    }
  }

  function finishQuiz() {
    const s = quizSession;
    document.getElementById("overlay-quiz").classList.add("hidden");

    const acc = s.answeredCount > 0 ? Math.round((s.correctCount / s.answeredCount) * 100) : 0;
    let stars = 0;
    if (!s.failedOut) {
      if (acc >= 90 && s.hearts === s.maxHearts) stars = 3;
      else if (acc >= 80 && s.hearts >= 2) stars = 2;
      else stars = 1;
    }

    if (stars > 0) {
      playTone("win");
      const bonus = stars * 15;
      s.xpEarned += bonus;
      state.xp += bonus;
    }

    if (s.mode === "level" && s.levelId && stars > 0) {
      const prevStars = state.levelStars[s.levelId] || 0;
      state.levelStars[s.levelId] = Math.max(prevStars, stars);
      const prevAcc = state.levelBestAcc[s.levelId] || 0;
      state.levelBestAcc[s.levelId] = Math.max(prevAcc, acc);

      if (s.levelId >= state.highestUnlockedLevel && s.levelId < LEVELS.length) {
        state.highestUnlockedLevel = s.levelId + 1;
      }
    }

    saveState();
    updateHeaderAndBadges();

    const starStr = [1, 2, 3]
      .map((n) => `<span style="color:${n <= stars ? "var(--amber)" : "#CBD5E1"}">★</span>`)
      .join("");
    document.getElementById("result-stars").innerHTML = starStr;

    const titleEl = document.getElementById("result-title");
    const subEl = document.getElementById("result-subtitle");
    if (stars === 0) {
      titleEl.textContent = "体力耗尽，再接再厉！";
      subEl.textContent = "错词已自动保存进错题本，复习后再来冲星吧";
    } else if (s.mode === "mistakes") {
      titleEl.textContent = "错题突击完成！";
      subEl.textContent = `已清理 ${s.correctCount} 个错词，继续保持！`;
    } else if (s.mode === "blitz") {
      titleEl.textContent = "10 词速刷通关！";
      subEl.textContent = "碎片时间高效巩固完毕";
    } else {
      titleEl.textContent = stars === 3 ? "完美三星通关！" : "闯关成功！";
      const unlockedNext = s.levelId < LEVELS.length ? `，第 ${s.levelId + 1} 关已解锁` : "，全 15 关已通关！";
      subEl.textContent = `第 ${s.levelId} 关完成${unlockedNext}`;
    }

    document.getElementById("res-xp").textContent = `+${s.xpEarned}`;
    document.getElementById("res-acc").textContent = `${acc}%`;
    document.getElementById("res-combo").textContent = `x${s.maxCombo}`;

    const wrongBox = document.getElementById("result-wrong-box");
    const wrongChips = document.getElementById("result-wrong-chips");
    if (s.wrongWords.length > 0) {
      wrongBox.classList.remove("hidden");
      wrongChips.innerHTML = s.wrongWords
        .map((w) => `<span class="wrong-chip">${w.word} · ${w.meaning}</span>`)
        .join("");
    } else {
      wrongBox.classList.add("hidden");
    }

    const nextBtn = document.getElementById("btn-res-next");
    if (s.mode === "level" && s.levelId < LEVELS.length && stars > 0) {
      nextBtn.classList.remove("hidden");
      nextBtn.textContent = `挑战第 ${s.levelId + 1} 关 →`;
    } else {
      nextBtn.classList.add("hidden");
    }

    document.getElementById("overlay-result").classList.remove("hidden");
  }

  // ===== Event Wiring =====
  function bindEvents() {
    // Bottom nav
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // Header toggles
    document.getElementById("btn-theme").addEventListener("click", () => {
      state.settings.dark = !state.settings.dark;
      applyTheme();
      saveState();
    });

    document.getElementById("btn-sound").addEventListener("click", () => {
      state.settings.sound = !state.settings.sound;
      applyTheme();
      saveState();
      showToast(state.settings.sound ? "已开启音效" : "已静音");
    });

    // Hero buttons
    document.getElementById("btn-continue-quest").addEventListener("click", () => {
      const nextId = Math.min(state.highestUnlockedLevel, LEVELS.length);
      openStagePreview(nextId);
    });

    document.getElementById("btn-blitz-quest").addEventListener("click", () => {
      const pool = shuffle(WORDS).slice(0, 15);
      startQuiz({ mode: "blitz", words: pool });
    });

    // Preview modal
    document.getElementById("btn-close-preview").addEventListener("click", closeStagePreview);
    document.getElementById("modal-preview").addEventListener("click", (e) => {
      if (e.target.id === "modal-preview") closeStagePreview();
    });
    document.getElementById("btn-preview-flashcards").addEventListener("click", () => {
      closeStagePreview();
      fcLevel = String(previewLevelId);
      fcFilter = "all";
      fcIndex = 0;
      document.getElementById("fc-level-select").value = fcLevel;
      document.querySelectorAll("#fc-filter-chips .chip").forEach((c) => {
        c.classList.toggle("active", c.dataset.filter === "all");
      });
      switchView("flashcards");
    });
    document.getElementById("btn-preview-start").addEventListener("click", () => {
      const lvlWords = WORDS.filter((w) => w.level === previewLevelId);
      startQuiz({ mode: "level", levelId: previewLevelId, words: lvlWords });
    });

    // Flashcards controls
    document.getElementById("fc-search").addEventListener("input", (e) => {
      fcSearch = e.target.value;
      fcIndex = 0;
      fcListLimit = 50;
      renderFlashcards(false);
    });

    document.querySelectorAll("#fc-filter-chips .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        fcFilter = chip.dataset.filter;
        fcIndex = 0;
        fcListLimit = 50;
        document.querySelectorAll("#fc-filter-chips .chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        renderFlashcards(false);
      });
    });

    document.getElementById("fc-level-select").addEventListener("change", (e) => {
      fcLevel = e.target.value;
      fcIndex = 0;
      fcListLimit = 50;
      renderFlashcards(false);
    });

    document.getElementById("btn-fc-mode-card").addEventListener("click", () => {
      fcMode = "card";
      document.getElementById("btn-fc-mode-card").classList.add("active");
      document.getElementById("btn-fc-mode-list").classList.remove("active");
      renderFlashcards(false);
    });

    document.getElementById("btn-fc-mode-list").addEventListener("click", () => {
      fcMode = "list";
      document.getElementById("btn-fc-mode-list").classList.add("active");
      document.getElementById("btn-fc-mode-card").classList.remove("active");
      renderFlashcards(false);
    });

    document.getElementById("btn-fc-shuffle").addEventListener("click", () => {
      fcCustomOrder = shuffle(WORDS.map((w) => w.id));
      fcIndex = 0;
      showToast("词卡顺序已随机打乱");
      renderFlashcards(true);
    });

    const flipCard = document.getElementById("flip-card");
    flipCard.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest(".tap-word")) return;
      flipCard.classList.toggle("flipped");
    });

    // Global delegation for tap-to-translate sentence words
    document.addEventListener("click", (e) => {
      const tapBtn = e.target.closest(".tap-word");
      if (tapBtn) {
        e.stopPropagation();
        openWordLookup(tapBtn.dataset.tap, tapBtn);
        return;
      }
      if (!e.target.closest("#word-lookup-pop")) {
        const pop = document.getElementById("word-lookup-pop");
        if (pop && !pop.classList.contains("hidden")) {
          closeWordLookup();
        }
      }
    });

    document.getElementById("wlp-close").addEventListener("click", closeWordLookup);
    document.getElementById("wlp-speak").addEventListener("click", () => {
      if (currentLookupItem) speakWord(currentLookupItem.displayWord);
    });
    document.getElementById("wlp-fav").addEventListener("click", () => {
      if (!currentLookupItem) return;
      const item = currentLookupItem.cet4WordObj || {
        word: currentLookupItem.base || currentLookupItem.displayWord,
        phonetic: currentLookupItem.phonetic,
        pos: currentLookupItem.pos,
        meaning: currentLookupItem.meaning
      };
      const added = toggleFavoriteWord(item);
      const favBtn = document.getElementById("wlp-fav");
      favBtn.textContent = added ? "⭐ 已收藏" : "☆ 收藏";
      favBtn.classList.toggle("is-fav", added);
      if (activeView === "favorites") renderFavorites();
    });
    document.getElementById("wlp-add-mistake").addEventListener("click", () => {
      if (!currentLookupItem || !currentLookupItem.cet4WordObj) return;
      const obj = currentLookupItem.cet4WordObj;
      if (state.mistakeIds.includes(obj.id)) {
        showToast(`${obj.word} 已在错题本中`);
      } else {
        addMistake(obj.id);
        saveState();
        updateHeaderAndBadges();
        showToast(`已将 ${obj.word} 加入错题本`);
        document.getElementById("wlp-add-mistake").textContent = "✓ 已在错题";
      }
    });

    // Touch swipe on flashcard
    let touchStartX = 0;
    let touchStartY = 0;
    const flipWrap = document.getElementById("flip-card-wrap");
    flipWrap.addEventListener("touchstart", (e) => {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });
    flipWrap.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        fcIndex += dx < 0 ? 1 : -1;
        renderFlashcards(true);
      }
    }, { passive: true });

    const speakCurrentFc = () => {
      const list = getFilteredFlashcards();
      if (list[fcIndex]) speakWord(list[fcIndex].word);
    };
    document.getElementById("btn-fc-speak").addEventListener("click", speakCurrentFc);
    document.getElementById("btn-fc-speak-back").addEventListener("click", speakCurrentFc);

    const toggleCurrentFcFav = () => {
      const list = getFilteredFlashcards();
      const w = list[fcIndex];
      if (!w) return;
      const f = toggleFavoriteWord(w);
      ["btn-fc-fav-front", "btn-fc-fav-back"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = f ? "★" : "☆";
        el.classList.toggle("active", f);
      });
    };
    document.getElementById("btn-fc-fav-front").addEventListener("click", toggleCurrentFcFav);
    document.getElementById("btn-fc-fav-back").addEventListener("click", toggleCurrentFcFav);

    document.getElementById("btn-fc-speak-sent").addEventListener("click", () => {
      const list = getFilteredFlashcards();
      if (list[fcIndex]) speakWord(list[fcIndex].example);
    });

    document.getElementById("btn-fc-fav-sent").addEventListener("click", () => {
      const list = getFilteredFlashcards();
      const w = list[fcIndex];
      if (!w) return;
      const f = toggleFavoriteSentence({
        en: w.example,
        zh: w.translation,
        source: w.exampleSource || "四级真题例句",
        focusWord: w.word
      });
      const btn = document.getElementById("btn-fc-fav-sent");
      btn.textContent = f ? "⭐ 已藏句" : "☆ 藏句";
      btn.classList.toggle("is-fav", f);
    });

    // Favorites view sub-tabs & practice
    document.querySelectorAll("[data-favtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFavTab = btn.dataset.favtab;
        renderFavorites();
      });
    });

    document.getElementById("btn-practice-favorites").addEventListener("click", () => {
      const favWords = state.favoriteWords || [];
      if (favWords.length === 0) return;
      const quizWords = favWords
        .map((fw, idx) => {
          const full = (fw.cet4Id && WORDS_BY_ID.get(fw.cet4Id)) || WORDS_BY_WORD.get(fw.word.toLowerCase());
          if (full) return full;
          return {
            id: 90000 + idx,
            level: 0,
            word: fw.word,
            phonetic: fw.phonetic || "",
            pos: fw.pos || "",
            meaning: fw.meaning || "",
            tip: "来自个人收藏夹单词",
            example: "",
            translation: "",
            freq: 2
          };
        })
        .slice(0, 15);
      startQuiz({ mode: "blitz", words: quizWords });
    });

    document.getElementById("btn-fc-prev").addEventListener("click", () => {
      fcIndex -= 1;
      renderFlashcards(true);
    });
    document.getElementById("btn-fc-next").addEventListener("click", () => {
      fcIndex += 1;
      renderFlashcards(true);
    });

    document.getElementById("btn-fc-forgot").addEventListener("click", () => {
      const list = getFilteredFlashcards();
      const w = list[fcIndex];
      if (!w) return;
      addMistake(w.id);
      state.masteredIds = state.masteredIds.filter((id) => id !== w.id);
      saveState();
      updateHeaderAndBadges();
      showToast(`已将 ${w.word} 加入错题本`);
      fcIndex += 1;
      renderFlashcards(true);
    });

    document.getElementById("btn-fc-master").addEventListener("click", () => {
      const list = getFilteredFlashcards();
      const w = list[fcIndex];
      if (!w) return;
      markMastered(w.id);
      incrementDaily(1);
      saveState();
      updateHeaderAndBadges();
      showToast(`已掌握 ${w.word} ✓`);
      if (fcFilter === "unmastered" || fcFilter === "mistakes") {
        // Current item leaves list, keep index
      } else {
        fcIndex += 1;
      }
      renderFlashcards(true);
    });

    // Mistakes Practice
    document.getElementById("btn-practice-mistakes").addEventListener("click", () => {
      const words = state.mistakeIds.map((id) => WORDS_BY_ID.get(id)).filter(Boolean);
      if (words.length === 0) return;
      startQuiz({ mode: "mistakes", words: words.slice(0, 15) });
    });

    // Quiz Controls
    document.getElementById("btn-quiz-exit").addEventListener("click", () => {
      document.getElementById("overlay-quiz").classList.add("hidden");
      quizSession = null;
      if (activeView === "map") renderMap();
      if (activeView === "mistakes") renderMistakes();
    });

    document.getElementById("btn-quiz-next").addEventListener("click", advanceQuiz);

    // Keyboard shortcut in quiz (Enter/Space for next)
    document.addEventListener("keydown", (e) => {
      const quizOpen = !document.getElementById("overlay-quiz").classList.contains("hidden");
      const fbOpen = !document.getElementById("quiz-feedback").classList.contains("hidden");
      if (quizOpen && fbOpen && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        advanceQuiz();
      }
    });

    // Result Screen Controls
    document.getElementById("btn-res-next").addEventListener("click", () => {
      if (!quizSession || !quizSession.levelId) return;
      const nextId = Math.min(quizSession.levelId + 1, LEVELS.length);
      const lvlWords = WORDS.filter((w) => w.level === nextId);
      startQuiz({ mode: "level", levelId: nextId, words: lvlWords });
    });

    document.getElementById("btn-res-retry").addEventListener("click", () => {
      if (!quizSession) return;
      if (quizSession.mode === "level" && quizSession.levelId) {
        const lvlWords = WORDS.filter((w) => w.level === quizSession.levelId);
        startQuiz({ mode: "level", levelId: quizSession.levelId, words: lvlWords });
      } else if (quizSession.mode === "mistakes") {
        const words = state.mistakeIds.map((id) => WORDS_BY_ID.get(id)).filter(Boolean);
        startQuiz({ mode: "mistakes", words: words.length ? words.slice(0, 15) : shuffle(WORDS).slice(0, 10) });
      } else {
        startQuiz({ mode: "blitz", words: shuffle(WORDS).slice(0, 15) });
      }
    });

    document.getElementById("btn-res-home").addEventListener("click", () => {
      document.getElementById("overlay-result").classList.add("hidden");
      quizSession = null;
      switchView("map");
    });

    // Stats / Settings
    document.getElementById("opt-auto-speak").addEventListener("change", (e) => {
      state.settings.autoSpeak = e.target.checked;
      saveState();
    });

    document.getElementById("opt-unlock-all").addEventListener("change", (e) => {
      state.settings.unlockAll = e.target.checked;
      saveState();
      showToast(e.target.checked ? `已解锁全部 ${LEVELS.length} 关` : "已恢复逐关解锁模式");
    });

    document.getElementById("opt-daily-goal").addEventListener("change", (e) => {
      state.dailyGoal = Number(e.target.value) || 10;
      saveState();
      showToast(`每日目标已设为 ${state.dailyGoal} 词`);
    });

    document.getElementById("btn-export-data").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cet4-quest-backup-${todayKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("进度备份已导出");
    });

    document.getElementById("input-import-data").addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result));
          if (typeof parsed !== "object" || parsed === null) throw new Error("invalid");
          state = { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...(parsed.settings || {}) } };
          saveState();
          applyTheme();
          renderStats();
          showToast("进度已成功恢复 ✓");
        } catch {
          showToast("备份文件格式无效");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    document.getElementById("btn-reset-data").addEventListener("click", () => {
      if (!window.confirm("确定要清空所有闯关进度、经验值与错题记录吗？")) return;
      state = defaultState();
      saveState();
      applyTheme();
      renderStats();
      showToast("学习进度已重置");
    });
  }

  // ===== Service Worker (when served via http/https) =====
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.protocol === "http:")) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then((reg) => reg.update()).catch(() => {});
    });
  }

  // ===== Init =====
  initFlashcardLevelSelect();
  applyTheme();
  bindEvents();
  renderMap();
})();
