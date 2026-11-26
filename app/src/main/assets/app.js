"use strict";

window.haptic = (pattern) => {
    try {
        if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) {}
};

window.safeParseInt = (val, fallback = 0) => {
    const res = parseInt(val, 10);
    return isNaN(res) ? fallback : res;
};

window.todayKey = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
};

window.escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

window.showToast = (msg) => {
    const existing = document.getElementById("vtActiveToast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.id = "vtActiveToast";
    t.innerText = msg;
    t.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--primary);color:#000;padding:11px 18px;border-radius:10px;font-weight:700;font-size:13px;z-index:10000;box-shadow:0 6px 16px rgba(0,0,0,0.6);text-align:center;max-width:88vw;";
    document.body.appendChild(t);
    window.haptic(25);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3500);
};

window.openAppModal = (title, htmlContent) => {
    const modal = document.getElementById("appModal");
    document.getElementById("appModalTitle").innerText = title;
    document.getElementById("appModalBody").innerHTML = htmlContent;
    modal.classList.add("open");
};

window.closeAppModal = () => {
    const modal = document.getElementById("appModal");
    modal.classList.remove("open");
    document.getElementById("appModalBody").innerHTML = "";
};

window.DEFAULT_SUPP_META = {
    mag: { id: "mag", label: "💊 Магний глицинат 400mg", unit: "шт", lot: "", archived: false },
    taurine: { id: "taurine", label: "⚡ Таурин 1000mg", unit: "шт", lot: "", archived: false },
    creatine: { id: "creatine", label: "🏋️ Креатин моногидрат 5г", unit: "порц", lot: "", archived: false },
    omega: { id: "omega", label: "🐟 Omega-3 1000mg", unit: "шт", lot: "", archived: false },
    d3: { id: "d3", label: "☀️ D3 + K2-MK7 5000IU", unit: "шт", lot: "", archived: false },
    multi: { id: "multi", label: "💊 Мультивитамины", unit: "шт", lot: "", archived: false },
    b2: { id: "b2", label: "💊 Витамин B2 100mg", unit: "шт", lot: "", archived: false },
    c300: { id: "c300", label: "🍊 Витамин C 300mg", unit: "шт", lot: "", archived: false },
    gaviscon: { id: "gaviscon", label: "🧴 Гавискон (жидкость / суспензия) 10-20мл", unit: "доз", lot: "", archived: false },
    succinic: { id: "succinic", label: "💊 Янтарная кислота 50mg", unit: "шт", lot: "", archived: false }
};

function createDefaultState() {
    return {
        food: { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 },
        todayFoodItems: [],
        water: 0,
        supps: {
            mag: false, taurine: false, creatine: false, omega: false, d3: false,
            multi: false, b2: false, c300: false, gaviscon: false, succinic: false
        },
        suppTakenTimes: {},
        suppsInventory: {
            mag: 30, taurine: 60, creatine: 60, omega: 30, d3: 30,
            multi: 30, b2: 30, c300: 30, gaviscon: 20, succinic: 30
        },
        suppMeta: JSON.parse(JSON.stringify(window.DEFAULT_SUPP_META)),
        caffeineDoses: [],
        workoutDays: [],
        sleepLogs: [],
        pvtHistory: [],
        dailyHistory: {},
        bodyBattery: 85,
        events: [],
        lastResetDate: window.todayKey(),
        dossier: {
            year: "",
            blood: "",
            height: "",
            weight: "",
            allergies: "",
            conditions: "",
            goal: "maintenance",
            waterNorm: 3000,
            region: "Чернигов",
            fullText: ""
        },
        apiKeys: {
            trainerKey: "",
            trainerModel: "gemini-4-hydrogen",
            trainerModels: ["gemini-4-hydrogen", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
            visionKey: "",
            visionModel: "gemini-4-hydrogen",
            visionModels: ["gemini-4-hydrogen", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
            thinkingLevel: "MEDIUM",
            visionThinkingLevel: "LOW",
            nextDnsHost: "8a5865.dns.nextdns.io",
            alertsInUaToken: ""
        },
        cnsTriggers: ["Дроны", "Тревога", "Новости", "Недосып", "Тяж. тренировка"],
        privacy: {
            hideDossierPrivateFromAi: false
        },
        activePots: { green: null, white: null },
        customPotIngredients: {},
        potTare: { green: 0, white: 0 },
        potRecipes: { green: null, white: null },
        foodEditErrors: 0
    };
}

window.createDefaultState = createDefaultState;
window.AppState = createDefaultState();

window.VaultSession = {
    unlocked: false,
    slot: 0
};

let saveTimer = null;
let alertPollInterval = null;
let lastAirAlertActive = null;

window.assertVaultUnlocked = () => {
    if (!VaultSession.unlocked) {
        showToast("🔒 Сейф заблокирован");
        return false;
    }
    return true;
};

function safePlainAssign(target, src) {
    if (!src || typeof src !== "object" || Array.isArray(src)) return target;
    for (const k of Object.keys(src)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        target[k] = src[k];
    }
    return target;
}

function finiteOr(val, fallback) {
    const n = Number(val);
    return Number.isFinite(n) ? n : fallback;
}

window.mergeStateWithDefaults = (rawObj) => {
    const def = createDefaultState();
    const safeRaw = (rawObj && typeof rawObj === "object" && !Array.isArray(rawObj)) ? rawObj : {};
    const merged = safePlainAssign(Object.assign({}, def), safeRaw);

    const rawFood = safePlainAssign(Object.assign({}, def.food), merged.food);
    merged.food = {
        totalB: Math.max(0, finiteOr(rawFood.totalB, 0)),
        totalF: Math.max(0, finiteOr(rawFood.totalF, 0)),
        totalU: Math.max(0, finiteOr(rawFood.totalU, 0)),
        totalKcal: Math.max(0, finiteOr(rawFood.totalKcal, 0))
    };
    merged.water = Math.max(0, finiteOr(merged.water, 0));
    merged.bodyBattery = Math.max(5, Math.min(100, Math.round(finiteOr(merged.bodyBattery, 85))));
    merged.foodEditErrors = Math.max(0, Math.round(finiteOr(merged.foodEditErrors, 0)));

    merged.supps = safePlainAssign(Object.assign({}, def.supps), merged.supps);
    merged.suppTakenTimes = safePlainAssign({}, merged.suppTakenTimes);
    merged.suppsInventory = safePlainAssign(Object.assign({}, def.suppsInventory), merged.suppsInventory);

    const mergedMeta = Object.assign({}, def.suppMeta);
    if (safeRaw.suppMeta && typeof safeRaw.suppMeta === "object" && !Array.isArray(safeRaw.suppMeta)) {
        for (const k of Object.keys(safeRaw.suppMeta)) {
            if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
            mergedMeta[k] = safePlainAssign(
                Object.assign({ id: k, label: k, unit: "шт", lot: "", archived: false }, mergedMeta[k] || {}),
                safeRaw.suppMeta[k]
            );
        }
    }
    if (mergedMeta.gaviscon) {
        const oldLbl = String(mergedMeta.gaviscon.label || "");
        if (oldLbl.includes("💊 Гавискон") || oldLbl === "Гавискон 10ml") {
            mergedMeta.gaviscon.label = def.suppMeta.gaviscon.label;
        }
        if (!mergedMeta.gaviscon.unit || mergedMeta.gaviscon.unit === "шт") {
            mergedMeta.gaviscon.unit = "доз";
        }
    }
    merged.suppMeta = mergedMeta;

    merged.dossier = safePlainAssign(Object.assign({}, def.dossier), merged.dossier);
    merged.dossier.waterNorm = Math.max(500, Math.round(finiteOr(merged.dossier.waterNorm, 3000)));
    if (merged.dossier.region === "Чернігівська область") merged.dossier.region = "Чернигов";

    merged.apiKeys = safePlainAssign(Object.assign({}, def.apiKeys), merged.apiKeys);
    if (!Array.isArray(merged.apiKeys.trainerModels)) merged.apiKeys.trainerModels = def.apiKeys.trainerModels;
    if (!Array.isArray(merged.apiKeys.visionModels)) merged.apiKeys.visionModels = def.apiKeys.visionModels;

    merged.privacy = safePlainAssign(Object.assign({}, def.privacy), merged.privacy);
    merged.privacy.hideDossierPrivateFromAi = Boolean(merged.privacy.hideDossierPrivateFromAi);

    merged.activePots = safePlainAssign(Object.assign({}, def.activePots), merged.activePots);
    const rawTare = safePlainAssign(Object.assign({}, def.potTare), merged.potTare);
    merged.potTare = {
        green: Math.max(0, finiteOr(rawTare.green, 0)),
        white: Math.max(0, finiteOr(rawTare.white, 0))
    };
    merged.potRecipes = safePlainAssign(Object.assign({}, def.potRecipes), merged.potRecipes);
    merged.customPotIngredients = safePlainAssign({}, merged.customPotIngredients);
    merged.dailyHistory = safePlainAssign({}, merged.dailyHistory);

    if (!Array.isArray(merged.events)) merged.events = [];
    if (!Array.isArray(merged.sleepLogs)) merged.sleepLogs = [];
    if (!Array.isArray(merged.workoutDays)) merged.workoutDays = [];
    if (!Array.isArray(merged.caffeineDoses)) merged.caffeineDoses = [];
    if (!Array.isArray(merged.todayFoodItems)) merged.todayFoodItems = [];
    if (!Array.isArray(merged.pvtHistory)) merged.pvtHistory = [];
    if (!Array.isArray(merged.cnsTriggers)) merged.cnsTriggers = def.cnsTriggers;
    return merged;
};

window.compactAppState = () => {
    const now = Date.now();
    const cutoff180Ms = now - 180 * 24 * 60 * 60 * 1000;
    const cutoff1100Ms = now - 1100 * 24 * 60 * 60 * 1000;
    const d1100 = new Date(cutoff1100Ms);
    const minDay1100 = `${d1100.getFullYear()}-${String(d1100.getMonth() + 1).padStart(2, "0")}-${String(d1100.getDate()).padStart(2, "0")}`;

    if (Array.isArray(AppState.events)) {
        AppState.events = AppState.events
            .filter(e => !e.occurred_at || new Date(e.occurred_at).getTime() >= cutoff180Ms)
            .slice(-3000);
    }

    if (Array.isArray(AppState.pvtHistory)) {
        const recentPvt = [];
        AppState.pvtHistory.forEach(p => {
            if (!p.ts || p.ts >= cutoff180Ms) {
                recentPvt.push(p);
            } else if (p.date) {
                AppState.dailyHistory[p.date] = Object.assign({}, AppState.dailyHistory[p.date] || {}, { pvtMedianMs: p.medianMs });
            }
        });
        AppState.pvtHistory = recentPvt.slice(-500);
    }

    if (Array.isArray(AppState.sleepLogs)) {
        AppState.sleepLogs = AppState.sleepLogs.filter(s => !s.date || s.date >= minDay1100).slice(-1100);
    }

    if (AppState.dailyHistory) {
        Object.keys(AppState.dailyHistory).forEach(day => {
            if (day < minDay1100) delete AppState.dailyHistory[day];
        });
    }
};

window.flushVaultNow = () => {
    if (!VaultSession.unlocked) return;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    window.compactAppState();
    const payload = JSON.stringify(AppState);
    if (window.AndroidBridge && window.AndroidBridge.saveVaultStateAsync) {
        window.AndroidBridge.saveVaultStateAsync(payload, "onVaultSaveAck");
    } else {
        try {
            sessionStorage.setItem(`vt_fallback_slot_${VaultSession.slot}`, payload);
        } catch (_) {}
    }
};

window.onVaultSaveAck = (resStr) => {
    try {
        const res = JSON.parse(resStr);
        if (res.status === "LOCKED") {
            window.lockToStealth();
        } else if (res.status === "ERROR") {
            showToast("⚠️ Ошибка записи сейфа — проверь свободное место!");
        }
    } catch (_) {}
};

window.saveUIState = () => {
    if (!VaultSession.unlocked) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        window.flushVaultNow();
    }, 900);
};

window.addEventListener("pagehide", () => {
    window.flushVaultNow();
});

window.checkDailyReset = () => {
    const today = window.todayKey();
    if (AppState.lastResetDate && AppState.lastResetDate !== today) {
        const prevDay = AppState.lastResetDate;
        AppState.dailyHistory[prevDay] = Object.assign({}, AppState.dailyHistory[prevDay] || {}, {
            bb: AppState.bodyBattery,
            water: (AppState.dailyHistory[prevDay]?.water || 0) + (AppState.water || 0),
            kcal: AppState.food.totalKcal
        });
        AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 };
        AppState.todayFoodItems = [];
        AppState.water = 0;
        for (const k in AppState.supps) AppState.supps[k] = false;
        AppState.suppTakenTimes = {};
        AppState.lastResetDate = today;
        window.compactAppState();
        saveUIState();
    }
};

window.hydrateAllUI = () => {
    // 1. Roll over previous day BEFORE draining QuickSettings tile events
    window.checkDailyReset();
    // 2. Drain queued QuickSettings water events (yesterday's go into dailyHistory, today's into AppState.water)
    if (window.syncWaterFromNative) window.syncWaterFromNative();

    if (window.loadDossierUI) window.loadDossierUI();
    if (window.updateFoodUI) window.updateFoodUI();
    if (window.initVoiceFoodButton) window.initVoiceFoodButton();
    if (window.renderTriggerChips) window.renderTriggerChips();
    if (window.renderMoodChips) window.renderMoodChips();
    if (window.renderSupps) window.renderSupps();
    if (window.updateCaffeineUI) window.updateCaffeineUI();
    if (window.calculateRecoveryScore) window.calculateRecoveryScore();
    if (window.renderHeatmap) window.renderHeatmap();
    if (window.loadApiKeysUI) window.loadApiKeysUI();
    if (window.updatePvtBaselineUI) window.updatePvtBaselineUI();
    if (window.renderDailyStatsLog) window.renderDailyStatsLog();

    window.refreshAirAlerts(false);
    window.refreshWeather(false);

    if (!alertPollInterval) {
        alertPollInterval = setInterval(() => {
            if (VaultSession.unlocked && !document.hidden) {
                window.refreshAirAlerts(false);
            }
        }, 45000);
    }
};

window.wipeRuntimeSensitiveDom = () => {
    lastAirAlertActive = null;
    if (window.clearPhotoMemory) window.clearPhotoMemory();
    const fields = [
        "foodName", "foodB", "foodF", "foodU", "foodKcal", "smartFoodInput",
        "photoContextInput", "photoFoodNameInput", "photoFoodB", "photoFoodF", "photoFoodU", "photoFoodKcal", "photoManualNoteInput",
        "dossierYear", "dossierBlood", "dossierHeight", "dossierWeight", "dossierAllergies", "dossierConditions", "dossierFullText",
        "chatInput", "steganoPassInput", "tankBackupPassInput",
        "oldCurrentPin", "newCurrentPin", "geminiTrainerKey", "geminiVisionKey", "nextDnsHostInput", "alertsInUaToken",
        "customWaterInput", "qrInputText"
    ];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    const clearHtmlIds = [
        "chatHistory", "qrOutput", "hrvResult", "todayFoodList", "todayWaterLog",
        "suppsContainer", "quickSuppsList", "cnsInsightsList", "dailyStatsSummary", "dailyStatsTimeline",
        "dashMoodChips", "cnsMoodChips",
        "sosSubButtons", "foodImageStatus", "photoStatusBox", "photoLocalMlBox", "photoAiComment", "photoUncertainBox",
        "photoItemsBreakdown", "photoFoodTitle", "photoWeightRange", "geminiTestStatus",
        "trainerModelsHint", "visionModelsHint",
        "pvtBaselineInfo", "airAlertDetail", "heatmapGrid"
    ];
    clearHtmlIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
    const privCb = document.getElementById("hidePrivateDossierFromAi");
    if (privCb) privCb.checked = false;

    const hideIds = ["qrOutput", "hrvResult", "photoPreviewWrap", "photoLocalMlBox", "photoResultCard", "photoUncertainBox"];
    hideIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = "none";
    });
    const previewImg = document.getElementById("photoPreviewImg");
    if (previewImg) previewImg.removeAttribute("src");
};

window.activeModuleId = "dashboard";

window.showModule = (id) => {
    const target = document.getElementById(`module-${id}`);
    if (!target) return;
    window.activeModuleId = id;
    document.querySelectorAll(".module").forEach(el => el.classList.remove("active"));
    target.classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active-nav", btn.getAttribute("data-mod") === id);
    });
    if (id === "sleep" && window.renderCnsDashboard) {
        setTimeout(() => {
            window.renderCnsDashboard();
            if (window.renderCnsInsights) window.renderCnsInsights();
            if (window.renderDailyStatsLog) window.renderDailyStatsLog();
        }, 50);
    }
    if ((id === "chat" || id === "photographer") && window.loadApiKeysUI) {
        window.loadApiKeysUI();
    }
    if (id === "settings" && window.refreshExactAlarmStatus) {
        window.refreshExactAlarmStatus();
    }
};

window.handleHardwareBack = () => {
    if (document.body.classList.contains("lockscreen-sos-mode")) {
        if (window.exitLockscreenSOS) window.exitLockscreenSOS();
        return "HANDLED";
    }
    if (!VaultSession.unlocked) {
        return "MINIMIZE";
    }
    const modal = document.getElementById("appModal");
    if (modal && modal.classList.contains("open")) {
        window.closeAppModal();
        return "HANDLED";
    }
    const potCalc = document.getElementById("potCalculator");
    if (window.activeModuleId === "nutrition" && potCalc && potCalc.style.display !== "none") {
        potCalc.style.display = "none";
        return "HANDLED";
    }
    if (window.activeModuleId !== "dashboard") {
        window.showModule("dashboard");
        return "HANDLED";
    }
    return "MINIMIZE";
};

window.buildTimestampForDayTime = (dateStr = null, timeStr = null) => {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    let d = now.getDate();

    if (typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
        const parts = dateStr.trim().split("-").map(Number);
        const test = new Date(parts[0], parts[1] - 1, parts[2]);
        if (!isNaN(test.getTime())) {
            y = test.getFullYear();
            m = test.getMonth() + 1;
            d = test.getDate();
        }
    }

    let hh = now.getHours();
    let mm = now.getMinutes();
    if (typeof timeStr === "string" && /^\d{1,2}:\d{2}/.test(timeStr.trim())) {
        const tParts = timeStr.trim().split(":").map(Number);
        if (tParts[0] >= 0 && tParts[0] <= 23 && tParts[1] >= 0 && tParts[1] <= 59) {
            hh = tParts[0];
            mm = tParts[1];
        }
    }

    const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
    const day = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    const time = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    return { day, time, ts: dt.getTime(), iso: dt.toISOString() };
};

window.logEvent = (type, payload, customWhen = null) => {
    if (!VaultSession.unlocked) return;
    if (!AppState.events) AppState.events = [];
    const when = (customWhen && customWhen.iso && customWhen.day)
        ? customWhen
        : { iso: new Date().toISOString(), day: window.todayKey() };
    AppState.events.push({
        id: "evt_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
        type,
        occurred_at: when.iso,
        day: when.day,
        payload: payload || {}
    });
    if (AppState.events.length > 3500) {
        window.compactAppState();
    }
    if (window.activeModuleId === "sleep" && window.renderDailyStatsLog) {
        window.renderDailyStatsLog();
    }
    saveUIState();
};

// --- Dossier ---
window.saveDossier = () => {
    if (!window.assertVaultUnlocked()) return;
    AppState.dossier = {
        year: document.getElementById("dossierYear").value,
        blood: document.getElementById("dossierBlood").value,
        height: document.getElementById("dossierHeight").value,
        weight: document.getElementById("dossierWeight").value,
        allergies: document.getElementById("dossierAllergies").value,
        conditions: document.getElementById("dossierConditions").value,
        goal: document.getElementById("dossierGoal").value,
        waterNorm: Math.max(500, safeParseInt(document.getElementById("dossierWaterNorm").value, 3000)),
        region: document.getElementById("dossierRegion").value || "Чернигов",
        fullText: (document.getElementById("dossierFullText")?.value || "").trim()
    };
    if (window.flushVaultNow) window.flushVaultNow(); else saveUIState();
    window.syncWaterFromNative(true);
    showToast("Досье сохранено!");
};

window.loadDossierUI = () => {
    const d = AppState.dossier || {};
    document.getElementById("dossierYear").value = d.year || "";
    document.getElementById("dossierBlood").value = d.blood || "";
    document.getElementById("dossierHeight").value = d.height || "";
    document.getElementById("dossierWeight").value = d.weight || "";
    document.getElementById("dossierAllergies").value = d.allergies || "";
    document.getElementById("dossierConditions").value = d.conditions || "";
    document.getElementById("dossierGoal").value = d.goal || "maintenance";
    document.getElementById("dossierWaterNorm").value = d.waterNorm || 3000;
    document.getElementById("dossierRegion").value = d.region || "Чернигов";
    const fullEl = document.getElementById("dossierFullText");
    if (fullEl) fullEl.value = d.fullText || "";
};

// --- Water & Native Tile Sync ---
window.getWaterNorm = () => (AppState.dossier && AppState.dossier.waterNorm) ? AppState.dossier.waterNorm : 3000;

window.addWater = (ml) => {
    if (!window.assertVaultUnlocked()) return;
    window.checkDailyReset();
    window.haptic(30);
    AppState.water += ml;
    window.logEvent("water", { ml });
    window.syncWaterFromNative(true);
    saveUIState();
    if (window.AndroidBridge && window.AndroidBridge.scheduleWaterAlarm) {
        window.AndroidBridge.scheduleWaterAlarm(2 * 60 * 60);
    }
};

window.addCustomWater = () => {
    if (!window.assertVaultUnlocked()) return;
    const input = document.getElementById("customWaterInput");
    const ml = safeParseInt(input.value, 0);
    if (ml > 0) {
        window.addWater(ml);
        input.value = "";
    } else {
        showToast("Укажи объём в мл");
    }
};

window.syncWaterFromNative = (pushOnly = false) => {
    if (!pushOnly && VaultSession.unlocked && VaultSession.slot === 0 && window.AndroidBridge && window.AndroidBridge.peekWaterQueue) {
        try {
            const rawQueue = window.AndroidBridge.peekWaterQueue();
            const pending = JSON.parse(rawQueue || "[]");
            if (Array.isArray(pending) && pending.length > 0) {
                const knownIds = new Set(
                    (AppState.events || [])
                        .filter(e => e.type === "water" && e.payload && e.payload.nativeId)
                        .map(e => e.payload.nativeId)
                );
                const ackIds = [];
                const today = window.todayKey();
                const currentResetDay = AppState.lastResetDate || today;
                pending.forEach(evt => {
                    if (!knownIds.has(evt.id)) {
                        const evtDay = evt.day || today;
                        const delta = evt.deltaMl || 0;
                        if (evtDay === currentResetDay) {
                            AppState.water += delta;
                        } else {
                            AppState.dailyHistory[evtDay] = Object.assign({}, AppState.dailyHistory[evtDay] || {}, {
                                water: (AppState.dailyHistory[evtDay]?.water || 0) + delta
                            });
                        }
                        AppState.events.push({
                            id: "evt_tile_" + evt.id,
                            type: "water",
                            occurred_at: new Date(evt.ts || Date.now()).toISOString(),
                            day: evtDay,
                            payload: { ml: delta, source: "qs_tile", nativeId: evt.id }
                        });
                    }
                    ackIds.push(evt.id);
                });
                const authoritativeToday = (AppState.lastResetDate === today) ? AppState.water : 0;
                window.AndroidBridge.ackWaterQueue(JSON.stringify(ackIds), authoritativeToday);
                saveUIState();
            } else if (window.AndroidBridge.ackWaterQueue) {
                const authoritativeToday = (AppState.lastResetDate === todayKey()) ? AppState.water : 0;
                window.AndroidBridge.ackWaterQueue("[]", authoritativeToday);
            }
        } catch (_) {}
    }

    const norm = window.getWaterNorm();
    if (document.getElementById("waterNormLabel")) document.getElementById("waterNormLabel").innerText = norm;
    if (document.getElementById("waterNormDisplay")) document.getElementById("waterNormDisplay").innerText = norm;
    if (document.getElementById("waterLevel")) document.getElementById("waterLevel").innerText = AppState.water;
    if (document.getElementById("waterBar")) {
        const pct = Math.min(100, (AppState.water / norm) * 100);
        document.getElementById("waterBar").style.width = pct + "%";
    }
    if (window.renderTodayWaterLog) window.renderTodayWaterLog();
};

window.renderTodayWaterLog = () => {
    const box = document.getElementById("todayWaterLog");
    if (!box) return;
    const today = window.todayKey();
    const entries = (AppState.events || [])
        .filter(e => e.type === "water" && (e.day || (e.occurred_at || "").slice(0, 10)) === today)
        .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

    if (entries.length === 0) {
        box.innerHTML = "<span class='text-muted'>Записей воды за сегодня пока нет</span>";
        return;
    }
    box.innerHTML = "<strong class='text-main'>💧 По часам сегодня:</strong>" +
        entries.slice(-14).reverse().map(e => {
            const tm = e.payload?.time || new Date(e.occurred_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
            const src = e.payload?.source === "trainer_ai" ? " · Тренер" : (e.payload?.source === "qs_tile" ? " · Шторка" : "");
            return `<div>• [${escapeHtml(tm)}] <b>+${Math.round(e.payload?.ml || 0)} мл</b>${escapeHtml(src)}</div>`;
        }).join("");
};

window.renderDailyStatsLog = () => {
    const sel = document.getElementById("statsDaySelect");
    const sumEl = document.getElementById("dailyStatsSummary");
    const listEl = document.getElementById("dailyStatsTimeline");
    if (!sel || !sumEl || !listEl) return;

    const today = window.todayKey();
    const daySet = new Set([today]);
    (AppState.events || []).forEach(e => {
        const d = e.day || (e.occurred_at || "").slice(0, 10);
        if (d) daySet.add(d);
    });
    (AppState.sleepLogs || []).forEach(s => { if (s.date) daySet.add(s.date); });
    (AppState.workoutDays || []).forEach(d => { if (d) daySet.add(d); });
    Object.keys(AppState.dailyHistory || {}).forEach(d => { if (d) daySet.add(d); });

    const days = Array.from(daySet).sort().reverse().slice(0, 45);
    const prevSelected = sel.value;
    const chosenDay = days.includes(prevSelected) ? prevSelected : today;

    sel.innerHTML = days.map(d => {
        const label = d === today ? `${d} (сегодня)` : d;
        return `<option value="${escapeHtml(d)}" ${d === chosenDay ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
    sel.value = chosenDay;

    const dayEvents = (AppState.events || [])
        .filter(e => (e.day || (e.occurred_at || "").slice(0, 10)) === chosenDay)
        .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

    const hist = (AppState.dailyHistory && AppState.dailyHistory[chosenDay]) || {};
    const waterEventsSum = dayEvents.filter(e => e.type === "water").reduce((s, e) => s + (Number(e.payload?.ml) || 0), 0);
    const waterTotal = chosenDay === today ? (AppState.water || 0) : Math.max(waterEventsSum, hist.water || 0);

    const foodEvents = dayEvents.filter(e => e.type === "food");
    const foodKcalEvents = foodEvents.reduce((s, e) => s + (Number(e.payload?.Kcal) || 0), 0);
    const foodTotalKcal = chosenDay === today ? (AppState.food?.totalKcal || 0) : Math.max(foodKcalEvents, hist.kcal || 0);
    const foodB = chosenDay === today ? (AppState.food?.totalB || 0) : foodEvents.reduce((s, e) => s + (Number(e.payload?.B) || 0), 0);
    const foodF = chosenDay === today ? (AppState.food?.totalF || 0) : foodEvents.reduce((s, e) => s + (Number(e.payload?.F) || 0), 0);
    const foodU = chosenDay === today ? (AppState.food?.totalU || 0) : foodEvents.reduce((s, e) => s + (Number(e.payload?.U) || 0), 0);

    const suppEvents = dayEvents.filter(e => e.type === "supp_taken");
    const sleepHrs = (AppState.sleepLogs || []).filter(s => s.date === chosenDay).reduce((s, x) => s + (Number(x.hrs) || 0), 0);
    const hadWorkout = (AppState.workoutDays || []).includes(chosenDay) || dayEvents.some(e => e.type === "workout");

    const moodEvents = dayEvents.filter(e => e.type === "mood");
    const lastMood = moodEvents.length > 0 ? moodEvents[moodEvents.length - 1].payload?.mood : "";

    sumEl.innerHTML = `
        <div class="card bg-dark" style="padding:8px;">
            <div>💧 Вода: <b>${Math.round(waterTotal)} мл</b> · 🍗 Еда: <b>${Math.round(foodTotalKcal)} ккал</b> (Б:${Math.round(foodB)} Ж:${Math.round(foodF)} У:${Math.round(foodU)})</div>
            <div class="mt-1">💊 БАДы/фарма: <b>${suppEvents.length}</b> · 🛌 Сон: <b>${sleepHrs > 0 ? sleepHrs + " ч" : "—"}</b> · 🏋️ Трен: <b>${hadWorkout ? "Да" : "Нет"}</b>${lastMood ? ` · 🎭 <b>${escapeHtml(lastMood)}</b>` : ""}</div>
        </div>
    `;

    if (dayEvents.length === 0) {
        listEl.innerHTML = `<div class="text-muted">За ${escapeHtml(chosenDay)} пока нет подробных событий с отметкой времени.</div>`;
        return;
    }

    listEl.innerHTML = dayEvents.map(e => {
        const tm = e.payload?.time || new Date(e.occurred_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const byAi = e.payload?.source === "trainer_ai" ? " <span class='badge-pill'>Тренер</span>" : "";
        let desc = "";
        if (e.type === "water") {
            desc = `💧 Вода: +${Math.round(e.payload?.ml || 0)} мл`;
        } else if (e.type === "food") {
            const notePart = e.payload?.note ? ` · <i>${escapeHtml(e.payload.note)}</i>` : "";
            desc = `🍗 ${escapeHtml(e.payload?.name || "Еда")} — ${Math.round(e.payload?.Kcal || 0)} ккал (Б:${Math.round(e.payload?.B || 0)} Ж:${Math.round(e.payload?.F || 0)} У:${Math.round(e.payload?.U || 0)})${notePart}`;
        } else if (e.type === "supp_taken") {
            desc = `💊 ${escapeHtml(e.payload?.label || e.payload?.key || "БАД")}`;
        } else if (e.type === "caffeine") {
            desc = `☕ Кофеин: +${Math.round(e.payload?.mg || 0)} мг`;
        } else if (e.type === "sleep") {
            desc = `🛌 Сон: ${e.payload?.hrs || 0} ч (кач. ${e.payload?.quality || "—"}/5)${e.payload?.note ? " · " + escapeHtml(e.payload.note) : ""}`;
        } else if (e.type === "workout") {
            desc = `🏋️ Тренировка${e.payload?.note ? ": " + escapeHtml(e.payload.note) : ""}`;
        } else if (e.type === "stress") {
            desc = `⚡ Стресс: ${escapeHtml(e.payload?.trigger || "триггер")}`;
        } else if (e.type === "mood") {
            desc = `🎭 Настроение: ${escapeHtml(e.payload?.mood || "отмечено")}`;
        } else if (e.type === "weight") {
            desc = `⚖️ Вес: ${escapeHtml(String(e.payload?.weightKg || ""))} кг`;
        } else if (e.type === "cns_recovery") {
            desc = `🧘 Восстановление ЦНС (NSDR/отдых)`;
        } else if (e.type === "pvt_series") {
            desc = `🧬 PVT тест: медиана ${Math.round(e.payload?.medianMs || 0)} мс`;
        } else if (e.type === "sos_trigger") {
            desc = `🆘 SOS протокол: ${escapeHtml(e.payload?.type || "")}`;
        } else {
            return "";
        }
        return `<div class="p-2 card bg-dark" style="padding:6px 8px;"><span class="text-primary font-bold">[${escapeHtml(tm)}]</span> ${desc}${byAi}</div>`;
    }).filter(Boolean).join("");
};

// --- Food Totals ---
window.commitFoodEntry = ({ name, b, f, u, kcal, note = "" }) => {
    if (!window.assertVaultUnlocked()) return false;
    window.haptic(30);
    const cleanNote = String(note || "").trim();
    const cleanName = (name || (cleanNote ? cleanNote.slice(0, 60) : "Еда")).trim() || "Еда";
    const pb = Math.max(0, safeParseInt(b, 0));
    const pf = Math.max(0, safeParseInt(f, 0));
    const pu = Math.max(0, safeParseInt(u, 0));
    const pk = Math.max(0, safeParseInt(kcal, 0));

    if (pk === 0 && pb === 0 && pf === 0 && pu === 0) {
        showToast("Введи калории или БЖУ!");
        return false;
    }

    if (window.lastAiFoodPrediction !== null && Math.abs(pk - window.lastAiFoodPrediction) > 50) {
        AppState.foodEditErrors = (AppState.foodEditErrors || 0) + 1;
    }
    window.lastAiFoodPrediction = null;

    AppState.food.totalB += pb;
    AppState.food.totalF += pf;
    AppState.food.totalU += pu;
    AppState.food.totalKcal += pk;
    AppState.todayFoodItems.push({
        name: cleanName,
        b: pb,
        f: pf,
        u: pu,
        k: pk,
        note: cleanNote,
        time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    });

    window.logEvent("food", { name: cleanName, B: pb, F: pf, U: pu, Kcal: pk, note: cleanNote });
    window.updateFoodUI();
    saveUIState();
    showToast(`✅ Добавлено: ${cleanName} (+${pk} ккал)`);
    return true;
};

window.saveHybridFood = () => {
    const ok = window.commitFoodEntry({
        name: document.getElementById("foodName").value,
        b: document.getElementById("foodB").value,
        f: document.getElementById("foodF").value,
        u: document.getElementById("foodU").value,
        kcal: document.getElementById("foodKcal").value
    });
    if (!ok) return;

    ["smartFoodInput", "foodName", "foodB", "foodF", "foodU", "foodKcal"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const imgStat = document.getElementById("foodImageStatus");
    if (imgStat) imgStat.innerText = "";
};

window.resetBJU = () => {
    if (!window.assertVaultUnlocked()) return;
    AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 };
    AppState.todayFoodItems = [];
    saveUIState();
    window.updateFoodUI();
    showToast("Счётчик еды за сегодня обнулён");
};

window.applyFoodPreset = (name, b, f, u, k) => {
    window.haptic(25);
    document.getElementById("foodName").value = name;
    document.getElementById("foodB").value = b;
    document.getElementById("foodF").value = f;
    document.getElementById("foodU").value = u;
    document.getElementById("foodKcal").value = k;
};

window.updateFoodUI = () => {
    document.getElementById("bCount").innerText = `${Math.round(AppState.food.totalB)}г`;
    document.getElementById("fCount").innerText = `${Math.round(AppState.food.totalF)}г`;
    document.getElementById("uCount").innerText = `${Math.round(AppState.food.totalU)}г`;
    document.getElementById("foodTotalKcal").innerText = `${Math.round(AppState.food.totalKcal)} ккал`;

    const list = document.getElementById("todayFoodList");
    if (list) {
        const items = AppState.todayFoodItems || [];
        list.innerHTML = items.length === 0
            ? "<span class='text-muted'>Записей за сегодня пока нет</span>"
            : items.slice(-10).reverse().map(i => `<div>• [${i.time}] <b>${escapeHtml(i.name)}</b> — ${i.k} ккал (Б:${i.b} Ж:${i.f} У:${i.u})${i.note ? ` · <i>${escapeHtml(i.note)}</i>` : ""}</div>`).join("");
    }
};

// --- Chernihiv Air Raid Alerts & Weather ---
const CITY_MAP = {
    "Чернигов": {
        coords: [51.4982, 31.2893],
        oblast: "Чернігівська область",
        raionUid: "140",
        matchKw: "черніг",
        sirenCommunityNames: [
            "чернігівська територіальна громада",
            "чернігівська міська територіальна громада",
            "м. чернігів"
        ],
        sirenDistrictNames: ["чернігівський район"],
        sirenStateNames: ["чернігівська область"]
    },
    "Киев": {
        coords: [50.4501, 30.5234],
        oblast: "м. Київ",
        raionUid: "31",
        matchKw: "київ",
        sirenCommunityNames: ["м. київ"],
        sirenDistrictNames: [],
        sirenStateNames: ["м. київ"]
    },
    "Сумы": {
        coords: [50.9077, 34.7981],
        oblast: "Сумська область",
        raionUid: "",
        matchKw: "сум",
        sirenCommunityNames: ["сумська територіальна громада", "м. суми"],
        sirenDistrictNames: ["сумський район"],
        sirenStateNames: ["сумська область"]
    },
    "Харьков": {
        coords: [49.9935, 36.2304],
        oblast: "Харківська область",
        raionUid: "",
        matchKw: "харків",
        sirenCommunityNames: ["харківська територіальна громада", "м. харків"],
        sirenDistrictNames: ["харківський район"],
        sirenStateNames: ["харківська область"]
    },
    "Днепр": {
        coords: [48.4647, 35.0462],
        oblast: "Дніпропетровська область",
        raionUid: "",
        matchKw: "дніпр",
        sirenCommunityNames: ["дніпровська територіальна громада", "м. дніпро"],
        sirenDistrictNames: ["дніпровський район"],
        sirenStateNames: ["дніпропетровська область"]
    },
    "Одесса": {
        coords: [46.4825, 30.7233],
        oblast: "Одеська область",
        raionUid: "",
        matchKw: "одес",
        sirenCommunityNames: ["одеська територіальна громада", "м. одеса"],
        sirenDistrictNames: ["одеський район"],
        sirenStateNames: ["одеська область"]
    },
    "Львов": {
        coords: [49.8397, 24.0297],
        oblast: "Львівська область",
        raionUid: "",
        matchKw: "львів",
        sirenCommunityNames: ["львівська територіальна громада", "м. львів"],
        sirenDistrictNames: ["львівський район"],
        sirenStateNames: ["львівська область"]
    }
};

const SIREN_THREAT_LABELS = {
    AIR: "Воздушная тревога",
    ARTILLERY: "Угроза артобстрела",
    URBAN_FIGHTS: "Уличные бои",
    CHEMICAL: "Хим. угроза",
    NUCLEAR: "Радиац. угроза",
    INFO: "Предупреждение",
    DRONE: "Угроза БПЛА",
    DRONES: "Угроза БПЛА"
};

const ALERTS_IN_UA_TYPE_LABELS = {
    air_raid: "Воздушная тревога",
    artillery_shelling: "Угроза артобстрела",
    urban_fights: "Уличные бои",
    chemical: "Хим. угроза",
    nuclear: "Радиац. угроза",
    drone: "Угроза БПЛА",
    drones: "Угроза БПЛА"
};

function formatAlertTimestamp(raw) {
    if (!raw) return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const normalized = String(raw).trim().replace(" ", "T");
    const d = new Date(normalized);
    if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) +
            " · " + d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    }
    return String(raw);
}

function getCityInfo() {
    const key = (AppState.dossier && AppState.dossier.region) || "Чернигов";
    return { cityName: CITY_MAP[key] ? key : "Чернигов", ...(CITY_MAP[key] || CITY_MAP["Чернигов"]) };
}

window.refreshAirAlerts = (manual = false) => {
    const cbName = "onAirAlertsLoaded";
    if (manual) {
        const pill = document.getElementById("airAlertStatus");
        const detail = document.getElementById("airAlertDetail");
        if (pill) pill.innerText = "📡 Опрос...";
        if (detail) detail.innerHTML = `<span class="text-primary">🔄 Опрос радаров тревог...</span>`;
    }
    const token = (AppState.apiKeys && AppState.apiKeys.alertsInUaToken) || "";

    if (window.AndroidBridge && window.AndroidBridge.fetchAirAlertsAsync) {
        window.AndroidBridge.fetchAirAlertsAsync(token, cbName);
    } else {
        fetch("https://siren.pp.ua/api/v3/alerts")
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then(body => window[cbName](JSON.stringify({ ok: true, source: "siren.pp.ua", body })))
            .catch(() => {
                fetch("https://ubilling.net.ua/aerialalerts/")
                    .then(r => r.text())
                    .then(body => window[cbName](JSON.stringify({ ok: true, source: "ubilling.net.ua", body })))
                    .catch(err => window[cbName](JSON.stringify({ ok: false, error: err.message })));
            });
    }
};

window.onAirAlertsLoaded = (wrapperStr) => {
    const pill = document.getElementById("airAlertStatus");
    const detail = document.getElementById("airAlertDetail");
    try {
        const wrapper = JSON.parse(wrapperStr);
        if (!wrapper.ok) throw new Error(wrapper.error || `HTTP ${wrapper.status}`);
        const data = JSON.parse(wrapper.body);
        if (
            data &&
            typeof data === "object" &&
            !Array.isArray(data) &&
            data.error &&
            !Array.isArray(data.alerts) &&
            !Array.isArray(data.activeAlerts) &&
            !data.states &&
            !data.state
        ) {
            throw new Error(String(data.error));
        }
        const city = getCityInfo();

        let isActive = false;
        let scopeLabel = `${city.cityName} (обл.)`;
        let changed = "—";
        let threatText = "";
        let extraNote = wrapper.note ? String(wrapper.note) : "";
        let sourceTag = wrapper.source || "";

        if (sourceTag === "alerts.in.ua" || Array.isArray(data.alerts)) {
            // alerts.in.ua v1 format (city/raion/hromada/oblast precision)
            sourceTag = sourceTag || "alerts.in.ua";
            const matched = (data.alerts || []).filter(a => {
                const title = String(a.location_title || "").toLowerCase();
                const uid = String(a.location_uid || "");
                return (city.raionUid && uid === city.raionUid) ||
                    title.includes(city.matchKw);
            });
            const localMatch = matched.find(a => String(a.location_type || "").toLowerCase() !== "oblast");
            const chosen = localMatch || matched[0];
            isActive = Boolean(chosen);
            if (chosen) {
                const locType = String(chosen.location_type || "").toLowerCase();
                scopeLabel = locType === "oblast" ? `${city.cityName} (область)` : `г. ${city.cityName}`;
                const alertType = String(chosen.alert_type || "").toLowerCase();
                if (alertType) threatText = ALERTS_IN_UA_TYPE_LABELS[alertType] || alertType;
                changed = formatAlertTimestamp(chosen.started_at);
            } else {
                scopeLabel = `г. ${city.cityName}`;
                changed = formatAlertTimestamp(null);
            }
        } else if (sourceTag === "siren.pp.ua" || Array.isArray(data) || Array.isArray(data.activeAlerts)) {
            // siren.pp.ua / ukrainealarm v3 format (supports both flat top-level & nested state.activeAlerts[])
            sourceTag = "siren.pp.ua";
            const entries = Array.isArray(data) ? data : (data.activeAlerts || []);
            const idx = (wrapper.regionsIndex && wrapper.regionsIndex[city.cityName]) || {};

            const activeEntries = entries.filter(e => {
                if (!e) return false;
                if (Array.isArray(e.activeAlerts)) return e.activeAlerts.length > 0;
                return e.active !== false;
            });

            // Flatten top-level entries AND nested activeAlerts items that specify their own regionId/regionName
            const flatNodes = [];
            activeEntries.forEach(e => {
                flatNodes.push(e);
                if (Array.isArray(e.activeAlerts)) {
                    e.activeAlerts.forEach(sub => {
                        if (sub && (sub.regionId || sub.regionName || sub.regionType)) {
                            flatNodes.push(sub);
                        }
                    });
                }
            });

            const matchCommunity = e => {
                const rid = String(e.regionId || "");
                const rname = String(e.regionName || "").toLowerCase().trim();
                return (idx.communityId && rid === String(idx.communityId)) ||
                    city.sirenCommunityNames.includes(rname);
            };
            const matchDistrict = e => {
                const rid = String(e.regionId || "");
                const rname = String(e.regionName || "").toLowerCase().trim();
                return (idx.districtId && rid === String(idx.districtId)) ||
                    city.sirenDistrictNames.includes(rname);
            };
            const matchState = e => {
                const rid = String(e.regionId || "");
                const rname = String(e.regionName || "").toLowerCase().trim();
                return (idx.stateId && rid === String(idx.stateId)) ||
                    city.sirenStateNames.includes(rname);
            };

            const commHit = flatNodes.find(matchCommunity);
            const distHit = !commHit ? flatNodes.find(matchDistrict) : null;
            const stateHit = (!commHit && !distHit) ? activeEntries.find(matchState) : null;

            const stateSubAlerts = stateHit && Array.isArray(stateHit.activeAlerts) ? stateHit.activeAlerts : [];
            const stateWideAlert = Boolean(stateHit) && (
                stateSubAlerts.length === 0 ||
                stateSubAlerts.some(a => {
                    const rt = String(a.regionType || "").toLowerCase();
                    return !rt || rt === "state" || rt === "oblast" ||
                        String(a.regionId || "") === String(stateHit.regionId || "");
                })
            );

            const hit = commHit || distHit || (stateWideAlert ? stateHit : null);
            if (hit) {
                isActive = true;
                scopeLabel = commHit
                    ? `г. ${city.cityName} (громада)`
                    : (distHit ? `${city.cityName} / р-н` : `${city.cityName} (вся область)`);
                const sub = Array.isArray(hit.activeAlerts) && hit.activeAlerts.length > 0 ? hit.activeAlerts : [hit];
                const rawTypes = sub.map(a => {
                    const key = String(a.type || "").toUpperCase();
                    return SIREN_THREAT_LABELS[key] || a.type;
                }).filter(Boolean);
                const uniqTypes = Array.from(new Set(rawTypes));
                if (uniqTypes.length > 0) threatText = uniqTypes.join(", ");
                changed = formatAlertTimestamp(sub[0]?.lastUpdate || sub[0]?.lastUpdateDate || hit.lastUpdate || hit.changed);
            } else {
                isActive = false;
                scopeLabel = `г. ${city.cityName} (громада)`;
                changed = formatAlertTimestamp(null);
                if (stateHit) {
                    const otherNames = stateSubAlerts.map(a => a.regionName).filter(Boolean).slice(0, 3);
                    const partialNote = otherNames.length > 0
                        ? `В области локальная тревога: ${otherNames.join(", ")}`
                        : "В области есть локальные тревоги (вне города/р-на)";
                    extraNote = extraNote ? `${extraNote} · ${partialNote}` : partialNote;
                }
            }
        } else {
            // ubilling.net.ua format (oblast fallback)
            sourceTag = sourceTag || "ubilling.net.ua";
            const statesMap = data.states || data.state || data;
            const entry = statesMap[city.oblast];
            if (!entry) throw new Error(`Регион "${city.oblast}" не найден`);
            isActive = Boolean(entry.alertnow ?? entry.alert ?? entry.enabled);
            scopeLabel = `${city.cityName} (область)`;
            changed = formatAlertTimestamp(entry.changed);
        }

        pill.className = "alert-pill " + (isActive ? "alert-active" : "alert-safe");
        pill.innerText = isActive ? "🚨 ТРЕВОГА" : "🟢 Отбой";

        const threatLine = threatText ? ` · ${escapeHtml(threatText)}` : "";
        const viaNote = wrapper.via ? ` (${escapeHtml(wrapper.via)})` : "";
        const sourceLine = sourceTag ? ` · ${escapeHtml(sourceTag)}${viaNote}` : "";
        const noteLine = extraNote ? `<br><span class="text-xs text-warning">${escapeHtml(extraNote)}</span>` : "";

        detail.innerHTML = isActive
            ? `<span class="text-danger font-bold">АКТИВНА ТРЕВОГА: ${escapeHtml(scopeLabel)}${threatLine}</span><br><span class="text-xs text-muted">Обновлено: ${escapeHtml(changed)}${sourceLine}</span>${noteLine}`
            : `<span class="text-success font-bold">Тишина: ${escapeHtml(scopeLabel)}</span><br><span class="text-xs text-muted">Проверено: ${escapeHtml(changed)}${sourceLine}</span>${noteLine}`;

        if (isActive && lastAirAlertActive === false) {
            window.haptic([250, 100, 250]);
            const nowMs = Date.now();
            const recentSameAlert = (AppState.events || []).some(e =>
                e.type === "stress" &&
                e.payload?.trigger === "Воздушная тревога" &&
                e.occurred_at &&
                (nowMs - new Date(e.occurred_at).getTime()) < 30 * 60 * 1000
            );
            if (!recentSameAlert) {
                window.logEvent("stress", { trigger: "Воздушная тревога", region: scopeLabel });
                if (window.calculateRecoveryScore) window.calculateRecoveryScore();
            }
            if (window.AndroidBridge && window.AndroidBridge.showNotification) {
                window.AndroidBridge.showNotification("🚨 Воздушная тревога", `${scopeLabel}: перейди в укрытие`);
            }
        }
        lastAirAlertActive = isActive;
    } catch (err) {
        pill.className = "alert-pill";
        pill.innerText = "📡 Оффлайн";
        if (detail) {
            const reason = err?.message ? ` (${escapeHtml(err.message)})` : "";
            detail.innerHTML = `<span class="text-danger">Радар тревог недоступен${reason}.</span><br><span class="text-xs text-muted">Проверь в ⚙️ Настройки → 🌐 Проверка связи.</span>`;
        }
    }
};

let lastWeatherFetchMs = 0;
let lastWeatherCity = "";
let lastWeatherSummary = "";
const WEATHER_CACHE_TTL_MS = 30 * 60 * 1000;

window.refreshWeather = (manual = false) => {
    const city = getCityInfo();
    const now = Date.now();
    if (!manual && lastWeatherSummary && lastWeatherCity === city.cityName && (now - lastWeatherFetchMs) < WEATHER_CACHE_TTL_MS) {
        const el = document.getElementById("weatherStatus");
        if (el) el.innerText = lastWeatherSummary;
        return;
    }
    if (manual) document.getElementById("weatherStatus").innerText = `🌤 ${city.cityName}...`;
    if (window.AndroidBridge && window.AndroidBridge.fetchWeatherAsync) {
        window.AndroidBridge.fetchWeatherAsync(city.coords[0], city.coords[1], "onWeatherLoaded");
    } else {
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.coords[0]}&longitude=${city.coords[1]}&current=temperature_2m,wind_speed_10m,weather_code&timezone=Europe%2FKyiv`)
            .then(r => r.text())
            .then(body => window.onWeatherLoaded(JSON.stringify({ ok: true, body })))
            .catch(() => {});
    }
};

window.onWeatherLoaded = (wrapperStr) => {
    try {
        const wrapper = JSON.parse(wrapperStr);
        if (!wrapper.ok) return;
        const data = JSON.parse(wrapper.body);
        if (data.current) {
            const temp = Math.round(data.current.temperature_2m);
            const wind = Math.round(data.current.wind_speed_10m);
            const city = getCityInfo();
            const text = `🌤 ${city.cityName}: ${temp > 0 ? "+" + temp : temp}°C · ${wind} км/ч`;
            lastWeatherFetchMs = Date.now();
            lastWeatherCity = city.cityName;
            lastWeatherSummary = text;
            document.getElementById("weatherStatus").innerText = text;
        }
    } catch (_) {}
};

// --- Native File Save Helper ---
window.saveFileToDownloads = (filename, mimeType, bytesOrBase64, isAlreadyBase64 = false) => {
    let b64 = bytesOrBase64;
    if (!isAlreadyBase64) {
        const bytes = bytesOrBase64 instanceof Uint8Array ? bytesOrBase64 : new TextEncoder().encode(bytesOrBase64);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        b64 = btoa(bin);
    }

    if (window.AndroidBridge && window.AndroidBridge.saveExportFileBase64) {
        const ok = window.AndroidBridge.saveExportFileBase64(filename, mimeType, b64);
        if (ok) {
            showToast(`✅ Сохранено в Download/VeinyTank/${filename}`);
            return true;
        }
    }

    const byteChars = atob(b64);
    const arr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) arr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([arr], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`✅ Файл ${filename} скачан`);
    return true;
};

// --- Medical Report Export (.txt with UTF-8 BOM) ---
window.exportMedicalReportTxt = () => {
    if (!window.assertVaultUnlocked()) return;
    window.haptic(30);
    const d = AppState.dossier || {};
    let report = "\uFEFF";
    report += "=== МЕДИЧНИЙ ЗВІТ / ПАЦІЄНТ ===\n\n";
    report += `Дата генерації: ${new Date().toLocaleString("uk-UA")}\n`;
    report += `Місто: ${d.region || "Чернигов"}\n`;
    report += `Рік народження: ${d.year || "—"} | Зріст: ${d.height || "—"} см | Вага: ${d.weight || "—"} кг\n`;
    report += `Група крові: ${d.blood || "—"}\n`;
    report += `Алергії: ${d.allergies || "Не вказано"}\n`;
    report += `Хронічні стани / Травми: ${d.conditions || "Не вказано"}\n\n`;
    if (d.fullText && d.fullText.trim()) {
        report += "--- ПОВНЕ ТЕКСТОВЕ ДОСЬЄ ---\n";
        report += `${d.fullText.trim()}\n\n`;
    }

    report += "--- ПОТОЧНИЙ СТАН (ЦНС / BODY BATTERY) ---\n";
    report += `Оцінка ресурсу: ${AppState.bodyBattery} / 100\n`;
    report += `Вода сьогодні: ${AppState.water} / ${window.getWaterNorm()} мл\n`;
    report += `КБЖУ сьогодні: ${AppState.food.totalKcal} ккал (Б:${AppState.food.totalB} Ж:${AppState.food.totalF} У:${AppState.food.totalU})\n\n`;

    report += "--- БАДИ ТА ПРЕПАРАТИ ---\n";
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    for (const k in meta) {
        if (meta[k].archived) continue;
        const takenTime = AppState.suppTakenTimes?.[k] ? ` о ${AppState.suppTakenTimes[k]}` : "";
        const taken = AppState.supps[k] ? `[ПРИЙНЯТО СЬОГОДНІ${takenTime}]` : "[Не прийнято]";
        const stock = AppState.suppsInventory[k] || 0;
        const unit = meta[k].unit || "шт";
        report += `- ${meta[k].label} ${taken} (залишок: ${stock} ${unit})\n`;
    }

    report += "\n--- ОСТАННІ ПОДІЇ ТА ТРИГЕРИ ---\n";
    const recent = (AppState.events || []).slice(-15).reverse();
    recent.forEach(evt => {
        report += `[${new Date(evt.occurred_at).toLocaleString("uk-UA")}] ${evt.type} | ${JSON.stringify(evt.payload || {})}\n`;
    });

    const filename = `medical_report_${window.todayKey()}.txt`;
    window.saveFileToDownloads(filename, "text/plain;charset=utf-8", report, false);
};

window.verifyDomContract = () => {
    const requiredIds = [
        "loginOverlay", "vaultSetupContainer", "calcModeContainer", "calcDisplay",
        "batteryStatus", "airAlertStatus", "weatherStatus",
        "module-dashboard", "module-dossier", "module-nutrition", "module-photographer",
        "module-water", "module-sleep", "module-workout", "module-biometrics",
        "module-pharma", "module-chat", "module-stegano", "module-settings", "module-sos",
        "cnsChart", "pvtButton", "suppsContainer", "chatHistory", "chatSendBtn",
        "btnVoiceFood", "btnVoicePhoto", "btnVoicePhotoNote", "btnVoiceDossier", "btnVoiceChat", "todayWaterLog",
        "statsDaySelect", "dailyStatsSummary", "dailyStatsTimeline",
        "dashMoodChips", "cnsMoodChips", "hidePrivateDossierFromAi",
        "photoPreviewImg", "photoResultCard", "photoManualNoteInput", "dossierFullText",
        "trainerModelSelect", "visionModelSelect", "appVersionBadge"
    ];
    const missing = requiredIds.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
        console.error("DOM contract missing IDs:", missing);
    }
    const requiredFns = ["lockToStealth", "saveDossier", "analyzePhotographerTextNote", "runGlobalNetworkDiagnosticsUI"];
    const missingFns = requiredFns.filter(fn => typeof window[fn] !== "function");
    if (missingFns.length > 0) {
        console.error("JS contract missing functions:", missingFns);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    window.verifyDomContract();
    if (window.initStealthGate) window.initStealthGate();
});
