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
    omega: { label: "🐟 Omega-3 1000mg (Now Foods)", lot: "" },
    multi: { label: "💊 Мультивитамины (Now Foods)", lot: "" },
    d3: { label: "☀️ D3 + K2-MK7 5000IU", lot: "" },
    b2: { label: "💊 Витамин B2 100mg", lot: "" },
    c300: { label: "🍊 Витамин C 300mg", lot: "" },
    gaviscon: { label: "💊 Гавискон 10ml", lot: "" },
    mag: { label: "💊 Магний глицинат 400mg", lot: "" },
    succinic: { label: "💊 Янтарная кислота 50mg", lot: "" }
};

function createDefaultState() {
    return {
        food: { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 },
        todayFoodItems: [],
        water: 0,
        supps: { gaviscon: false, mag: false, succinic: false, omega: false, multi: false, d3: false, b2: false, c300: false },
        suppsInventory: { omega: 30, multi: 30, d3: 30, b2: 30, c300: 30, mag: 30, gaviscon: 20, succinic: 30 },
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
            region: "Чернігівська область"
        },
        apiKeys: {
            trainerKey: "",
            visionKey: "",
            geminiModel: "gemini-4-hydrogen",
            thinkingLevel: "HIGH"
        },
        cnsTriggers: ["Дроны", "Тревога", "Новости", "Недосып", "Тяж. тренировка"],
        activePots: { green: null, white: null },
        customPotIngredients: {},
        potTare: { green: 0, white: 0 },
        potRecipes: { green: null, white: null },
        foodEditErrors: 0
    };
}

window.AppState = createDefaultState();

window.VaultSession = {
    unlocked: false,
    slot: 0,
    pin: ""
};

let saveTimer = null;
let alertPollInterval = null;
let lastAirAlertActive = null;

window.mergeStateWithDefaults = (rawObj) => {
    const def = createDefaultState();
    const merged = Object.assign({}, def, rawObj || {});
    merged.food = Object.assign({}, def.food, merged.food || {});
    merged.supps = Object.assign({}, def.supps, merged.supps || {});
    merged.suppsInventory = Object.assign({}, def.suppsInventory, merged.suppsInventory || {});
    merged.suppMeta = Object.assign({}, def.suppMeta, merged.suppMeta || {});
    merged.dossier = Object.assign({}, def.dossier, merged.dossier || {});
    merged.apiKeys = Object.assign({}, def.apiKeys, merged.apiKeys || {});
    merged.activePots = Object.assign({}, def.activePots, merged.activePots || {});
    merged.potTare = Object.assign({}, def.potTare, merged.potTare || {});
    merged.potRecipes = Object.assign({}, def.potRecipes, merged.potRecipes || {});
    if (!Array.isArray(merged.events)) merged.events = [];
    if (!Array.isArray(merged.sleepLogs)) merged.sleepLogs = [];
    if (!Array.isArray(merged.workoutDays)) merged.workoutDays = [];
    if (!Array.isArray(merged.caffeineDoses)) merged.caffeineDoses = [];
    if (!Array.isArray(merged.todayFoodItems)) merged.todayFoodItems = [];
    if (!Array.isArray(merged.pvtHistory)) merged.pvtHistory = [];
    if (!Array.isArray(merged.cnsTriggers)) merged.cnsTriggers = def.cnsTriggers;
    return merged;
};

window.injectBuildConfigApiDefaults = () => {
    try {
        if (window.AndroidBridge && window.AndroidBridge.getDefaultApiConfig) {
            const cfg = JSON.parse(window.AndroidBridge.getDefaultApiConfig());
            if (!AppState.apiKeys.trainerKey && cfg.trainerKey && !cfg.trainerKey.startsWith("YOUR_")) {
                AppState.apiKeys.trainerKey = cfg.trainerKey;
            }
            if (!AppState.apiKeys.visionKey && cfg.visionKey && !cfg.visionKey.startsWith("YOUR_")) {
                AppState.apiKeys.visionKey = cfg.visionKey;
            }
        }
    } catch (_) {}
};

window.flushVaultNow = () => {
    if (!VaultSession.unlocked) return;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const payload = JSON.stringify(AppState);
    if (window.AndroidBridge && window.AndroidBridge.saveVaultStateAsync && VaultSession.pin) {
        window.AndroidBridge.saveVaultStateAsync(VaultSession.slot, VaultSession.pin, payload, "onVaultSaveAck");
    } else {
        try {
            sessionStorage.setItem(`vt_fallback_slot_${VaultSession.slot}`, payload);
        } catch (_) {}
    }
};

window.onVaultSaveAck = () => {};

window.saveUIState = () => {
    if (!VaultSession.unlocked) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        window.flushVaultNow();
    }, 400);
};

window.addEventListener("pagehide", () => {
    window.flushVaultNow();
});

window.checkDailyReset = () => {
    const today = window.todayKey();
    if (AppState.lastResetDate && AppState.lastResetDate !== today) {
        AppState.dailyHistory[AppState.lastResetDate] = {
            bb: AppState.bodyBattery,
            water: AppState.water,
            kcal: AppState.food.totalKcal
        };
        AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 };
        AppState.todayFoodItems = [];
        AppState.water = 0;
        for (const k in AppState.supps) AppState.supps[k] = false;
        AppState.lastResetDate = today;
        saveUIState();
    }
};

window.hydrateAllUI = () => {
    window.checkDailyReset();
    window.injectBuildConfigApiDefaults();
    if (window.loadDossierUI) window.loadDossierUI();
    if (window.updateFoodUI) window.updateFoodUI();
    if (window.syncWaterFromNative) window.syncWaterFromNative();
    if (window.renderTriggerChips) window.renderTriggerChips();
    if (window.renderSupps) window.renderSupps();
    if (window.updateCaffeineUI) window.updateCaffeineUI();
    if (window.calculateRecoveryScore) window.calculateRecoveryScore();
    if (window.renderHeatmap) window.renderHeatmap();
    if (window.updateWorkoutUI) window.updateWorkoutUI();
    if (window.loadApiKeysUI) window.loadApiKeysUI();
    if (window.updatePvtBaselineUI) window.updatePvtBaselineUI();

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
    const fields = ["foodName", "foodB", "foodF", "foodU", "foodKcal", "smartFoodInput", "chatInput", "steganoPassInput", "tankBackupPassInput", "oldRealPin", "newRealPin", "newDecoyPin", "newPanicPin"];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
};

window.showModule = (id) => {
    const target = document.getElementById(`module-${id}`);
    if (!target) return;
    document.querySelectorAll(".module").forEach(el => el.classList.remove("active"));
    target.classList.add("active");
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active-nav", btn.getAttribute("data-mod") === id);
    });
    if (id === "sleep" && window.renderCnsDashboard) {
        setTimeout(() => {
            window.renderCnsDashboard();
            if (window.renderCnsInsights) window.renderCnsInsights();
        }, 50);
    }
    if (id === "settings" && window.refreshExactAlarmStatus) {
        window.refreshExactAlarmStatus();
    }
};

window.logEvent = (type, payload) => {
    if (!AppState.events) AppState.events = [];
    AppState.events.push({
        id: "evt_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
        type,
        occurred_at: new Date().toISOString(),
        day: window.todayKey(),
        payload: payload || {}
    });
    if (AppState.events.length > 5000) {
        AppState.events = AppState.events.slice(-5000);
    }
    saveUIState();
};

// --- Dossier ---
window.saveDossier = () => {
    AppState.dossier = {
        year: document.getElementById("dossierYear").value,
        blood: document.getElementById("dossierBlood").value,
        height: document.getElementById("dossierHeight").value,
        weight: document.getElementById("dossierWeight").value,
        allergies: document.getElementById("dossierAllergies").value,
        conditions: document.getElementById("dossierConditions").value,
        goal: document.getElementById("dossierGoal").value,
        waterNorm: Math.max(500, safeParseInt(document.getElementById("dossierWaterNorm").value, 3000)),
        region: document.getElementById("dossierRegion").value || "Чернігівська область"
    };
    saveUIState();
    window.syncWaterFromNative();
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
    document.getElementById("dossierRegion").value = d.region || "Чернігівська область";
};

// --- Water & Native Tile Sync ---
window.getWaterNorm = () => (AppState.dossier && AppState.dossier.waterNorm) ? AppState.dossier.waterNorm : 3000;

window.addWater = (ml) => {
    window.haptic(30);
    AppState.water += ml;
    window.logEvent("water", { ml });
    window.syncWaterFromNative(true);
    saveUIState();
    if (window.AndroidBridge && window.AndroidBridge.sendNativeAlarm) {
        window.AndroidBridge.sendNativeAlarm(102, 2 * 60 * 60, "💧 Время пить воду", "Прошло 2 часа. Сделай пару глотков.");
    }
};

window.addCustomWater = () => {
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
                pending.forEach(evt => {
                    if (!knownIds.has(evt.id)) {
                        if (evt.day === today) {
                            AppState.water += (evt.deltaMl || 0);
                        }
                        AppState.events.push({
                            id: "evt_tile_" + evt.id,
                            type: "water",
                            occurred_at: new Date(evt.ts || Date.now()).toISOString(),
                            day: evt.day || today,
                            payload: { ml: evt.deltaMl, source: "qs_tile", nativeId: evt.id }
                        });
                    }
                    ackIds.push(evt.id);
                });
                window.AndroidBridge.ackWaterQueue(JSON.stringify(ackIds), AppState.water);
                saveUIState();
            } else {
                window.AndroidBridge.ackWaterQueue("[]", AppState.water);
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
};

// --- Food Totals ---
window.saveHybridFood = () => {
    window.haptic(30);
    const name = (document.getElementById("foodName").value || "Еда").trim();
    const b = safeParseInt(document.getElementById("foodB").value);
    const f = safeParseInt(document.getElementById("foodF").value);
    const u = safeParseInt(document.getElementById("foodU").value);
    const k = safeParseInt(document.getElementById("foodKcal").value);

    if (k === 0 && b === 0 && f === 0 && u === 0) {
        return showToast("Введи калории или БЖУ!");
    }

    if (window.lastAiFoodPrediction !== null && Math.abs(k - window.lastAiFoodPrediction) > 50) {
        AppState.foodEditErrors = (AppState.foodEditErrors || 0) + 1;
    }
    window.lastAiFoodPrediction = null;

    AppState.food.totalB += b;
    AppState.food.totalF += f;
    AppState.food.totalU += u;
    AppState.food.totalKcal += k;
    AppState.todayFoodItems.push({ name, b, f, u, k, time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) });

    window.logEvent("food", { name, B: b, F: f, U: u, Kcal: k });
    window.updateFoodUI();
    saveUIState();

    ["smartFoodInput", "foodName", "foodB", "foodF", "foodU", "foodKcal"].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById("foodImageStatus").innerText = "";
    showToast(`✅ Добавлено: ${name} (+${k} ккал)`);
};

window.resetBJU = () => {
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
            : items.slice(-10).reverse().map(i => `<div>• [${i.time}] <b>${escapeHtml(i.name)}</b> — ${i.k} ккал (Б:${i.b} Ж:${i.f} У:${i.u})</div>`).join("");
    }
};

window.escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// --- Chernihiv Air Raid Alerts & Weather ---
const REGION_COORDS = {
    "Чернігівська область": [51.4982, 31.2893],
    "м. Київ": [50.4501, 30.5234],
    "Київська область": [50.4501, 30.5234],
    "Сумська область": [50.9077, 34.7981],
    "Харківська область": [49.9935, 36.2304],
    "Дніпропетровська область": [48.4647, 35.0462],
    "Одеська область": [46.4825, 30.7233],
    "Львівська область": [49.8397, 24.0297]
};

window.refreshAirAlerts = (manual = false) => {
    const cbName = "onAirAlertsLoaded";
    if (manual) document.getElementById("airAlertStatus").innerText = "📡 Опрос...";

    if (window.AndroidBridge && window.AndroidBridge.fetchAirAlertsAsync) {
        window.AndroidBridge.fetchAirAlertsAsync(cbName);
    } else {
        fetch("https://ubilling.net.ua/aerialalerts/")
            .then(r => r.text())
            .then(body => window[cbName](JSON.stringify({ ok: true, body })))
            .catch(err => window[cbName](JSON.stringify({ ok: false, error: err.message })));
    }
};

window.onAirAlertsLoaded = (wrapperStr) => {
    const pill = document.getElementById("airAlertStatus");
    const detail = document.getElementById("airAlertDetail");
    try {
        const wrapper = JSON.parse(wrapperStr);
        if (!wrapper.ok) throw new Error(wrapper.error || `HTTP ${wrapper.status}`);
        const data = JSON.parse(wrapper.body);
        const region = (AppState.dossier && AppState.dossier.region) || "Чернігівська область";
        const statesMap = data.states || data.state || data;
        const entry = statesMap[region];
        if (!entry) throw new Error(`Регион "${region}" не найден в ответе`);

        const isActive = Boolean(entry.alertnow ?? entry.alert ?? entry.enabled);
        const changed = entry.changed || "—";

        pill.className = "alert-pill " + (isActive ? "alert-active" : "alert-safe");
        pill.innerText = isActive ? `🚨 ТРЕВОГА` : `🟢 Отбой`;

        detail.innerHTML = isActive
            ? `<span class="text-danger font-bold">АКТИВНА ТРЕВОГА: ${escapeHtml(region)}</span><br><span class="text-xs text-muted">Изменено: ${escapeHtml(changed)}</span>`
            : `<span class="text-success font-bold">Тишина: ${escapeHtml(region)}</span><br><span class="text-xs text-muted">Последний статус: ${escapeHtml(changed)}</span>`;

        if (isActive && lastAirAlertActive === false) {
            window.haptic([250, 100, 250]);
            window.logEvent("stress", { trigger: "Воздушная тревога", region });
            if (window.calculateRecoveryScore) window.calculateRecoveryScore();
            if (window.AndroidBridge && window.AndroidBridge.showNotification) {
                window.AndroidBridge.showNotification("🚨 Воздушная тревога", `${region}: перейди в безопасное место`);
            }
        }
        lastAirAlertActive = isActive;
    } catch (e) {
        pill.className = "alert-pill";
        pill.innerText = "📡 Оффлайн";
        if (detail) detail.innerText = "Радар тревог недоступен (нет сети или блокировка).";
    }
};

window.refreshWeather = (manual = false) => {
    const region = (AppState.dossier && AppState.dossier.region) || "Чернігівська область";
    const coords = REGION_COORDS[region] || [51.4982, 31.2893];
    if (manual) document.getElementById("weatherStatus").innerText = "🌤 Обновляю...";
    if (window.AndroidBridge && window.AndroidBridge.fetchWeatherAsync) {
        window.AndroidBridge.fetchWeatherAsync(coords[0], coords[1], "onWeatherLoaded");
    } else {
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords[0]}&longitude=${coords[1]}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`)
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
            const regionShort = ((AppState.dossier && AppState.dossier.region) || "Чернигов").split(" ")[0];
            document.getElementById("weatherStatus").innerText = `🌤 ${regionShort}: ${temp > 0 ? "+" + temp : temp}°C · ${wind} км/ч`;
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

    // Fallback for desktop browser
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
    window.haptic(30);
    const d = AppState.dossier || {};
    let report = "\uFEFF";
    report += "=== МЕДИЧНИЙ ЗВІТ / ПАЦІЄНТ ===\n\n";
    report += `Дата генерації: ${new Date().toLocaleString("uk-UA")}\n`;
    report += `Рік народження: ${d.year || "—"} | Зріст: ${d.height || "—"} см | Вага: ${d.weight || "—"} кг\n`;
    report += `Група крові: ${d.blood || "—"}\n`;
    report += `Алергії: ${d.allergies || "Не вказано"}\n`;
    report += `Хронічні стани / Травми: ${d.conditions || "Не вказано"}\n\n`;

    report += "--- ПОТОЧНИЙ СТАН (ЦНС / BODY BATTERY) ---\n";
    report += `Оцінка ресурсу: ${AppState.bodyBattery} / 100\n`;
    report += `Вода сьогодні: ${AppState.water} / ${window.getWaterNorm()} мл\n`;
    report += `КБЖУ сьогодні: ${AppState.food.totalKcal} ккал (Б:${AppState.food.totalB} Ж:${AppState.food.totalF} У:${AppState.food.totalU})\n\n`;

    report += "--- БАДИ ТА ПРЕПАРАТИ ---\n";
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    for (const k in meta) {
        const taken = AppState.supps[k] ? "[ПРИЙНЯТО СЬОГОДНІ]" : "[Не прийнято]";
        const stock = AppState.suppsInventory[k] || 0;
        report += `- ${meta[k].label} ${taken} (залишок: ${stock} шт)\n`;
    }

    report += "\n--- ОСТАННІ ПОДІЇ ТА ТРИГЕРИ ---\n";
    const recent = (AppState.events || []).slice(-15).reverse();
    recent.forEach(evt => {
        report += `[${new Date(evt.occurred_at).toLocaleString("uk-UA")}] ${evt.type} | ${JSON.stringify(evt.payload || {})}\n`;
    });

    const filename = `medical_report_${window.todayKey()}.txt`;
    window.saveFileToDownloads(filename, "text/plain;charset=utf-8", report, false);
};

// --- DOM Contract Self-Check ---
window.verifyDomContract = () => {
    const requiredIds = [
        "loginOverlay", "vaultSetupContainer", "calcModeContainer", "calcDisplay",
        "batteryStatus", "airAlertStatus", "weatherStatus",
        "module-dashboard", "module-dossier", "module-nutrition", "module-water",
        "module-sleep", "module-workout", "module-biometrics", "module-pharma",
        "module-chat", "module-stegano", "module-settings", "module-sos",
        "cnsChart", "pvtButton", "suppsContainer", "chatHistory"
    ];
    const missing = requiredIds.filter(id => !document.getElementById(id));
    if (missing.length > 0) {
        console.error("DOM contract missing IDs:", missing);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    window.verifyDomContract();
    if (window.initStealthGate) window.initStealthGate();
});
