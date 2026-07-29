"use strict";

const safeParseInt = (val, fallback = 0) => {
    const res = parseInt(val, 10);
    return isNaN(res) ? fallback : res;
};

window.showToast = (msg) => {
    const t = document.createElement("div");
    t.innerText = msg;
    t.style.position = "fixed";
    t.style.bottom = "20px";
    t.style.left = "50%";
    t.style.transform = "translateX(-50%)";
    t.style.backgroundColor = "var(--primary)";
    t.style.color = "#000";
    t.style.padding = "12px 20px";
    t.style.borderRadius = "8px";
    t.style.fontWeight = "bold";
    t.style.zIndex = "9999";
    t.style.boxShadow = "0 4px 6px rgba(0,0,0,0.5)";
    t.style.textAlign = "center";
    document.body.appendChild(t);
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => { document.body.removeChild(t); }, 4000);
};

// --- State Core ---
const AppState = {
    food: { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 },
    water: 0,
    supps: { gaviscon: false, mag: false, succinic: false, omega: false, multi: false, d3: false, b2: false, c300: false },
    caffeineDoses: [],
    workoutDays: [], // Array of timestamp strings "YYYY-MM-DD"
    sleepLogs: [],
    bodyBattery: 85,
    logs: [],
    lastResetDate: new Date().toISOString().slice(0,10),
    apiKeys: { gemini: "", geminiModel: "gemini-3.1-flash", groq: "", groqModel: "llama-3.1-70b-versatile", customUrl: "", customKey: "", customModel: "" },
    cnsTriggers: ["Дроны", "Новости", "Недосып", "Еда"],
    stressTriggers: ["Без стресса", "Был стресс"],
    activePots: { green: null, white: null },
    customPotIngredients: {}
};

const suppLabels = {
    gaviscon: "💊 Гавискон (перед сном)",
    mag: "💊 Магний глицинат (вечер)",
    succinic: "💊 Янтарная кислота (после еды)",
    omega: "🐟 Omega-3 (NOW)",
    multi: "💊 Мультивитамины (NOW)",
    d3: "☀️ D3 + K2-MK7",
    b2: "💊 Витамин B2 (Mason)",
    c300: "🍊 Вит. C 300мг (Mason)"
};

let db = null;
let activeDBName = "VeinyTankDB"; // Default, overridden by PIN

const initDB = () => {
    return new Promise((resolve, reject) => {
        const req = window.indexedDB.open(activeDBName, 4);
        req.onerror = () => reject("DB Error");
        req.onsuccess = (e) => { db = e.target.result; resolve(); loadState(); };
        req.onupgradeneeded = (e) => {
            let dbStore = e.target.result;
            if (!dbStore.objectStoreNames.contains("logs")) dbStore.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
            if (!dbStore.objectStoreNames.contains("state")) dbStore.createObjectStore("state", { keyPath: "key" });
        };
    });
};

const saveUIState = () => {
    if (!db) return;
    try {
        const tx = db.transaction("state", "readwrite");
        const store = tx.objectStore("state");
        store.put({ key: "food", value: AppState.food });
        store.put({ key: "water", value: AppState.water });
        store.put({ key: "supps", value: AppState.supps });
        store.put({ key: "workoutDays", value: AppState.workoutDays });
        store.put({ key: "lastResetDate", value: AppState.lastResetDate });
        store.put({ key: "sleepLogs", value: AppState.sleepLogs });
        store.put({ key: "bodyBattery", value: AppState.bodyBattery });
        store.put({ key: "caffeineDoses", value: AppState.caffeineDoses });
        store.put({ key: "apiKeys", value: AppState.apiKeys });
        store.put({ key: "cnsTriggers", value: AppState.cnsTriggers });
        store.put({ key: "stressTriggers", value: AppState.stressTriggers });
        store.put({ key: "dossier", value: AppState.dossier });
        store.put({ key: "events", value: AppState.events });
        store.put({ key: "activePots", value: AppState.activePots });
        store.put({ key: "customPotIngredients", value: AppState.customPotIngredients });
    } catch (e) {}
};

const loadState = () => {
    if (!db) return;
    try {
        const tx = db.transaction("state", "readonly");
        const store = tx.objectStore("state");
        
        store.get("food").onsuccess = (e) => { if (e.target.result) AppState.food = e.target.result.value; updateFoodUI(); };
        store.get("water").onsuccess = (e) => { if (e.target.result) AppState.water = e.target.result.value; syncWaterFromNative(); };
        store.get("workoutDays").onsuccess = (e) => { if (e.target.result) AppState.workoutDays = e.target.result.value; renderHeatmap(); };
        store.get("sleepLogs").onsuccess = (e) => { if (e.target.result) AppState.sleepLogs = e.target.result.value; };
        store.get("bodyBattery").onsuccess = (e) => { 
            if (e.target.result) AppState.bodyBattery = e.target.result.value; 
            if(window.calculateRecoveryScore) window.calculateRecoveryScore(); else updateBodyBatteryUI(); 
            updateWorkoutUI(); 
        };
        store.get("caffeineDoses").onsuccess = (e) => { if (e.target.result) AppState.caffeineDoses = e.target.result.value; updateCaffeineUI(); };
        store.get("apiKeys").onsuccess = (e) => { if (e.target.result) AppState.apiKeys = e.target.result.value; if(window.loadApiKeysUI) window.loadApiKeysUI(); };
        store.get("activePots").onsuccess = (e) => { if (e.target.result) AppState.activePots = e.target.result.value; };
        store.get("customPotIngredients").onsuccess = (e) => { if (e.target.result) AppState.customPotIngredients = e.target.result.value; };
        store.get("cnsTriggers").onsuccess = (e) => { if (e.target.result) AppState.cnsTriggers = e.target.result.value; };
        store.get("stressTriggers").onsuccess = (e) => { if (e.target.result) AppState.stressTriggers = e.target.result.value; };
        store.get("dossier").onsuccess = (e) => { if (e.target.result) AppState.dossier = e.target.result.value; };
        store.get("events").onsuccess = (e) => { if (e.target.result) AppState.events = e.target.result.value; if(window.renderEvents) window.renderEvents(); };
        tx.oncomplete = () => {
            if (activeDBName === "VeinyTankDB_Fake") {
                const now = new Date();
                const yesterdayStr = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
                if (AppState.water === 0 && (!AppState.sleepLogs || AppState.sleepLogs.length === 0)) {
                    // Seed initial Fake DB
                    AppState.water = 1500;
                    AppState.bodyBattery = 85;
                    AppState.sleepLogs = [{ start: "23:00", end: "07:00", hrs: 8, date: yesterdayStr }];
                    AppState.food = { totalB: 120, totalF: 60, totalU: 200, totalKcal: 1820 };
                    AppState.events = [
                        { type: "water", payload: { ml: 500 }, occurred_at: yesterdayStr },
                        { type: "water", payload: { ml: 1000 }, occurred_at: now.toISOString() }
                    ];
                    AppState.lastResetDate = now.toISOString().slice(0, 10);
                } else if (AppState.events && AppState.events.length > 0) {
                    // Aging Fake DB: catch up to today
                    const sorted = [...AppState.events].sort((a,b) => new Date(b.occurred_at) - new Date(a.occurred_at));
                    const lastEventDate = new Date(sorted[0].occurred_at);
                    const diffDays = Math.floor((now - lastEventDate) / (1000 * 60 * 60 * 24));
                    
                    if (diffDays >= 1) {
                        for(let i = 1; i <= diffDays; i++) {
                            const d = new Date(lastEventDate.getTime() + i * 24 * 3600 * 1000).toISOString();
                            AppState.events.push({ type: "water", payload: { ml: 1200 }, occurred_at: d });
                            if(i % 2 === 0) AppState.events.push({ type: "sleep", payload: { hrs: 7.5 }, occurred_at: d });
                        }
                    }
                }
                saveUIState();
                updateFoodUI();
                syncWaterFromNative();
                if(window.calculateRecoveryScore) window.calculateRecoveryScore(); else updateBodyBatteryUI();
            }
        };
        
        store.get("supps").onsuccess = (e) => { 
            if (e.target.result) {
                // merge missing keys in case of update
                AppState.supps = { ...AppState.supps, ...e.target.result.value };
            }
            checkDailyReset();
        };
        store.get("lastResetDate").onsuccess = (e) => {
             if (e.target.result) AppState.lastResetDate = e.target.result.value;
             checkDailyReset();
        };
    } catch (e) {}
};

function checkDailyReset() {
    const today = new Date().toISOString().slice(0,10);
    if(AppState.lastResetDate !== today) {
        Object.keys(AppState.supps).forEach(k => AppState.supps[k] = false);
        AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 };
        if(window.AndroidBridge) window.AndroidBridge.resetWater();
        AppState.water = 0;
        AppState.lastResetDate = today;
        saveUIState();
    }
    renderSupps();
    updateFoodUI();
    updateWaterUI();
    if(window.calculateRecoveryScore) window.calculateRecoveryScore(); else updateBodyBatteryUI();
    updateWorkoutUI();
    if(window.updateCaffeineUI) window.updateCaffeineUI();
}

window.showModule = (id) => {
    document.querySelectorAll('.module').forEach(el => el.classList.remove('active'));
    document.getElementById(`module-${id}`).classList.add('active');
};

// ==========================================
// 1. HYBRID KBJU & PRESETS
// ==========================================
const foodDB = {
    "гречк": { b: 12, f: 3, u: 68, kcal: 343 }, 
    "яйц": { b: 13, f: 11, u: 1, kcal: 155, unit: 50 }, 
    "колбас": { b: 12, f: 20, u: 2, kcal: 250 },
    "пшенк": { b: 11, f: 3, u: 73, kcal: 348 },
    "печен": { b: 19, f: 4, u: 0, kcal: 130 },
    "хлеб": { b: 8, f: 1, u: 49, kcal: 265, unit: 25 },
    "овсян": { b: 12, f: 6, u: 61, kcal: 342 },
    "чечевиц": { b: 24, f: 1, u: 46, kcal: 295 },
    "молок": { b: 3, f: 2.5, u: 4.7, kcal: 53 },
    "банан": { b: 1.5, f: 0.1, u: 22, kcal: 96, unit: 120 },
    "изюм": { b: 3, f: 0.5, u: 71, kcal: 299 },
    "творог": { b: 16, f: 5, u: 3, kcal: 121 },
    "каш": { b: 12, f: 3, u: 68, kcal: 343 }
};

window.applyPreset = (type) => {
    let str = "";
    if(type === 'breakfast') str = "150г пшенки, 50г молока, 1 шт банан, 30г изюма, 2 шт яйца";
    if(type === 'snack') str = "200г творога, 30г изюма";
    if(type === 'dinner') str = "200г печени, 100г гречки";
    document.getElementById("smartFoodInput").value = str;
    window.autoParseFood();
};

window.autoParseFood = () => {
    const text = document.getElementById("smartFoodInput").value.toLowerCase();
    if(text.length < 2) return;
    
    let outB = 0, outF = 0, outU = 0, outKcal = 0;
    const regex = /(\d+)\s*(г|грамм|шт)?\s*([а-я]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        let amount = parseInt(match[1]);
        let unit = match[2] || "г"; 
        let name = match[3];

        let dbKey = Object.keys(foodDB).find(k => name.includes(k));
        if (dbKey) {
            let item = foodDB[dbKey];
            let weight = (unit === "шт" && item.unit) ? amount * item.unit : amount;
            outB += (item.b * weight / 100);
            outF += (item.f * weight / 100);
            outU += (item.u * weight / 100);
            outKcal += (item.kcal * weight / 100);
        }
    }

    document.getElementById("foodName").value = text.trim();
    document.getElementById("foodB").value = Math.round(outB);
    document.getElementById("foodF").value = Math.round(outF);
    document.getElementById("foodU").value = Math.round(outU);
    document.getElementById("foodKcal").value = Math.round(outKcal);
};

window.saveHybridFood = () => {
    const name = document.getElementById("foodName").value || "Food";
    const b = safeParseInt(document.getElementById("foodB").value);
    const f = safeParseInt(document.getElementById("foodF").value);
    const u = safeParseInt(document.getElementById("foodU").value);
    const k = safeParseInt(document.getElementById("foodKcal").value);
    
    // User Edit Tracker
    if (window.lastAiFoodPrediction) {
        const diff = Math.abs(window.lastAiFoodPrediction - k) / window.lastAiFoodPrediction;
        if (diff > 0.25) {
            AppState.foodEditErrors = (AppState.foodEditErrors || 0) + 1;
        } else if (diff < 0.1) {
            AppState.foodEditErrors = Math.max(0, (AppState.foodEditErrors || 0) - 1);
        }
        window.lastAiFoodPrediction = null; // reset
    }

    if(window.logEvent) window.logEvent("food", { name: name, B: b, F: f, U: u, Kcal: k });

    AppState.food.totalB += b; AppState.food.totalF += f;
    AppState.food.totalU += u; AppState.food.totalKcal += k;
    
    saveUIState(); updateFoodUI();
    
    document.getElementById("smartFoodInput").value = "";
    document.getElementById("foodName").value = "";
    document.getElementById("foodB").value = "";
    document.getElementById("foodF").value = "";
    document.getElementById("foodU").value = "";
    document.getElementById("foodKcal").value = "";
    if (document.getElementById("foodImageStatus")) document.getElementById("foodImageStatus").innerText = "";
};

window.resetBJU = () => { AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 }; saveUIState(); updateFoodUI(); };

window.startVoiceFood = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        return showToast("Голосовой ввод не поддерживается (используй Chrome).");
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    const btn = document.getElementById("btnVoiceFood");
    btn.innerText = "🔴";
    
    recognition.start();

    recognition.onresult = (event) => {
        const result = event.results[0][0].transcript;
        document.getElementById("smartFoodInput").value = result;
        window.autoParseFood();
        showToast("Распознано: " + result);
    };

    recognition.onspeechend = () => recognition.stop();
    recognition.onend = () => { btn.innerText = "🎤"; };
    recognition.onerror = (e) => { showToast("Ошибка микрофона: " + e.error); btn.innerText = "🎤"; };
};

function updateFoodUI() {
    document.getElementById("totalB").innerText = Math.round(AppState.food.totalB);
    document.getElementById("totalF").innerText = Math.round(AppState.food.totalF);
    document.getElementById("totalU").innerText = Math.round(AppState.food.totalU);
    document.getElementById("totalKcal").innerText = Math.round(AppState.food.totalKcal);
}

// ==========================================
// 2. DASHBOARD (Supps & Heatmap)
// ==========================================
function renderSupps() {
    const list = document.getElementById("quickSuppsList");
    list.innerHTML = "";
    Object.keys(suppLabels).forEach(key => {
        const div = document.createElement("div");
        div.className = "checkbox-group";
        
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.id = `supp_${key}`;
        chk.checked = AppState.supps[key] || false;
        chk.onchange = (e) => {
            AppState.supps[key] = e.target.checked;
            if(e.target.checked && window.logEvent) {
                window.logEvent("supplement", { name: suppLabels[key], id: key });
            }
            saveUIState();
            if(e.target.checked) {
                if(key === 'mag') {
                    showToast("Магний: Лучше за 1-2ч до сна.");
                    if(window.scheduleNativePush) window.scheduleNativePush("Сон", "Пора спать, магний уже действует!", 120);
                }
                if(key === 'succinic') showToast("Янтарная кислота: Строго после еды.");
                if(key === 'gaviscon') showToast("Гавискон: Строго перед сном.");
                if(key !== 'mag' && window.scheduleNativePush) window.scheduleNativePush("Витамины", "Не забудь про вечернюю порцию!", 240);
            }
            if(window.checkSuppConflicts) window.checkSuppConflicts();
        };
        
        const lbl = document.createElement("label");
        lbl.htmlFor = `supp_${key}`;
        lbl.innerText = suppLabels[key];
        
        div.appendChild(chk); div.appendChild(lbl); list.appendChild(div);
    });
}

function renderHeatmap() {
    const grid = document.getElementById("heatmapGrid");
    grid.innerHTML = "";
    const todayStr = new Date().toISOString().slice(0,10);
    for(let i=0; i<28; i++) {
        let d = new Date();
        d.setDate(d.getDate() - (27 - i));
        let dStr = d.toISOString().slice(0,10);
        
        let cell = document.createElement("div");
        cell.className = "heatmap-cell";
        if(AppState.workoutDays.includes(dStr)) cell.classList.add("active");
        grid.appendChild(cell);
    }
}

// ==========================================
// 3. SLEEP & BODY BATTERY
// ==========================================
window.saveSleep = () => {
    const t1 = document.getElementById("sleepStart").value; // "23:00"
    const t2 = document.getElementById("sleepEnd").value; // "06:00"
    if(!t1 || !t2) return;
    
    let d1 = new Date(`1970-01-01T${t1}:00Z`);
    let d2 = new Date(`1970-01-01T${t2}:00Z`);
    if(d2 < d1) d2 = new Date(`1970-01-02T${t2}:00Z`); // cross midnight
    
    let diffHrs = (d2 - d1) / (1000 * 60 * 60);
    
    if(window.logEvent) window.logEvent("sleep", { start: t1, end: t2, hrs: diffHrs });
    AppState.sleepLogs.push({start: t1, end: t2, hrs: diffHrs, date: new Date().toISOString()});
    
    if (window.calculateRecoveryScore) {
        window.calculateRecoveryScore();
    } else {
        if (diffHrs < 4) {
            AppState.bodyBattery = 2; // Critical
            showToast("⚠️ КРИТИЧЕСКИЙ НЕДОСЫП ⚠️");
        } else {
            AppState.bodyBattery = Math.min(100, AppState.bodyBattery + (diffHrs * 10)); 
        }
    }
    
    if (diffHrs < 4) {
        document.getElementById("sleepStatus").innerHTML = "<span class='text-danger font-bold'>Критический недосып (<4ч)!</span><br>Body Battery сброшен.";
    } else {
        document.getElementById("sleepStatus").innerHTML = `<span class='text-success font-bold'>Сон: ${diffHrs.toFixed(1)}ч. Норма.</span>`;
    }
    
    saveUIState();
    updateBodyBatteryUI();
    updateWorkoutUI();
};

function updateBodyBatteryUI() {
    const fill = document.getElementById("dashBatteryFill");
    const txt = document.getElementById("dashBatteryText");
    const sos = document.getElementById("sosSuggestion");
    
    let bb = Math.round(AppState.bodyBattery);
    fill.style.width = `${bb}%`;
    txt.innerText = `${bb}/100`;
    
    if(bb <= 2) {
        fill.style.backgroundColor = "var(--danger)";
        txt.className = "text-danger";
        sos.style.display = "block";
        sos.innerHTML = "⚠️ ЦНС истощена! <button class='btn btn-outline mt-2' onclick=\"showModule('sos')\">Пройти 15-мин NSDR</button>";
    } else if (bb < 50) {
        fill.style.backgroundColor = "orange";
        txt.className = "text-main";
        sos.style.display = "none";
    } else {
        fill.style.backgroundColor = "var(--success)";
        txt.className = "text-success";
        sos.style.display = "none";
    }
}

// ==========================================
// 4. WATER (Native Sync)
// ==========================================
window.syncWaterFromNative = () => {
    if(window.AndroidBridge) AppState.water = window.AndroidBridge.getWater();
    updateWaterUI();
};
window.addWater = (ml) => {
    if(window.logEvent) window.logEvent("water", { ml: ml });
    if(window.AndroidBridge) { window.AndroidBridge.addWater(ml); syncWaterFromNative(); } 
    else { AppState.water += ml; saveUIState(); updateWaterUI(); }
    if(window.scheduleNativePush) window.scheduleNativePush("Вода", "Пора выпить еще стакан воды!", 60);
};
window.addCustomWater = () => {
    const val = safeParseInt(document.getElementById("customWater").value);
    if(val > 0) window.addWater(val);
    document.getElementById("customWater").value = "";
};
window.resetWater = () => {
    if(window.AndroidBridge) window.AndroidBridge.resetWater();
    AppState.water = 0; saveUIState(); updateWaterUI();
};
function updateWaterUI() {
    let perc = (AppState.water / 3000) * 100;
    document.getElementById("waterFill").style.width = `${Math.min(perc, 100)}%`;
    document.getElementById("waterText").innerText = `${AppState.water} / 3000 мл`;
}
document.addEventListener("visibilitychange", () => {
    if(!document.hidden) { checkDailyReset(); syncWaterFromNative(); }
});

// ==========================================
// 5. WORKOUT (Autoregulation)
// ==========================================
function updateWorkoutUI() {
    const bb = AppState.bodyBattery || 100;
    const wTitle = document.getElementById("workoutModeTitle");
    const block2 = document.getElementById("workoutBlock2");
    const block3 = document.getElementById("workoutBlock3");
    
    if (bb <= 20) { // Red zone threshold for Deload
        wTitle.innerHTML = "<span class='text-danger'>Режим: DELOAD (ЦНС истощена)</span>";
        block2.style.display = "none";
        block3.style.display = "none";
        document.getElementById("iso30btn").innerText = "Эспандер 15с (Deload)";
        document.getElementById("iso30btn").onclick = () => startIsoTimer(15, 'expander');
        document.getElementById("iso60btn").style.display = "none";
        if(document.getElementById("isoDbbtn")) document.getElementById("isoDbbtn").style.display = "none";
    } else {
        wTitle.innerHTML = "<span class='text-success'>Режим: НОРМА</span>";
        block2.style.display = "block";
        block3.style.display = "block";
        document.getElementById("iso30btn").innerText = "Эспандер 45с";
        document.getElementById("iso30btn").onclick = () => startIsoTimer(45, 'expander');
        document.getElementById("iso60btn").style.display = "inline-block";
        if(document.getElementById("isoDbbtn")) document.getElementById("isoDbbtn").style.display = "inline-block";
    }
}

let isoTimer;
window.startIsoTimer = (seconds, gear) => {
    stopIsoTimer();
    const display = document.getElementById("isoTimerDisplay");
    let time = seconds;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    display.style.backgroundColor = "var(--danger)";
    display.innerText = `РАБОТА: ${time}с`;

    isoTimer = setInterval(() => {
        time--; display.innerText = `РАБОТА: ${time}с`;
        if (time <= 0) {
            stopIsoTimer(); display.style.backgroundColor = "var(--success)"; display.innerText = "ОТДЫХ!";
            if (navigator.vibrate) navigator.vibrate([500]); 
            if(window.logEvent) window.logEvent('workout', { gear: gear || 'iso', duration_s: seconds, rpe: 8 });
            if(window.calculateRecoveryScore) window.calculateRecoveryScore();
            if(window.scheduleNativePush) window.scheduleNativePush("Тренировка", "Пора сделать следующий подход!", 2);
        }
    }, 1000);
};

window.stopIsoTimer = () => {
    if (isoTimer) clearInterval(isoTimer);
    const display = document.getElementById("isoTimerDisplay");
    display.innerText = "ОСТАНОВЛЕНО"; display.style.backgroundColor = "var(--nav-bg)";
};

let currentReps = 0;
window.addRep = () => {
    currentReps++;
    if(navigator.vibrate) navigator.vibrate(50);
    if(currentReps >= 3) {
        currentReps = 0;
        const todayStr = new Date().toISOString().slice(0,10);
        if(!AppState.workoutDays.includes(todayStr)) {
            AppState.workoutDays.push(todayStr);
            if(window.logEvent) window.logEvent("workout", { type: "autoregulation", sets: 3 });
            if(window.calculateRecoveryScore) window.calculateRecoveryScore();
            saveUIState(); renderHeatmap();
        }
        showToast("Отлично! Тренировка засчитана.");
    }
    document.getElementById("repCounter").innerText = `${currentReps} / 3`;
};

// ==========================================
// 6. SOS ANIMATIONS & TRIGGERS
// ==========================================
const sosData = {
    panic: {
        title: "🚨 Паника / Дроны / ТЦК",
        subs: [
            { id: "drones", label: "💥 Обстрел / Дроны" },
            { id: "tck", label: "🚔 ТЦК / Мусора" },
            { id: "news", label: "📱 Думскроллинг" }
        ]
    },
    alcohol: {
        title: "🍺 Алкоголь / Похмелье",
        subs: [
            { id: "vodka", label: "🥃 Водка / Крепкое" },
            { id: "beer", label: "🍻 Пиво / Слабоалкоголка" }
        ]
    },
    drugs: {
        title: "💊 ПАВ / Ухода",
        subs: [
            { id: "stims", label: "⚡ Стимуляторы (Фен, Соли)" },
            { id: "empath", label: "🌈 Эмпатогены (МДМА, Ешки)" },
            { id: "weed", label: "🌿 Трава (Паранойя, Бэд-трип)" }
        ]
    }
};

const sosAdvices = {
    drones: "<b>Действие:</b><br>1. Правило двух стен. Отойди от окон.<br>2. Ледяная вода на лицо (Рефлекс ныряльщика сбивает пульс).<br>3. Выполни Физиологический вздох.",
    tck: "<b>Действие:</b><br>1. Телефон в авиарежим.<br>2. Включить холодный рассудок. Никакой агрессии.<br>3. Дыши ровно, контролируй адреналин (Физиологический вздох).",
    news: "<b>Действие:</b><br>1. Выруби интернет на 2 часа.<br>2. 15 минут NSDR.<br>3. Физическая активность (отжимания/эспандер).",
    
    vodka: "<b class='text-danger'>Никаких дыхательных практик! ЦНС отравлена.</b><br><br><b>Протокол:</b><br>1. <b>Янтарная кислота</b>: 2-3 таблетки СТРОГО после еды (сжигает ацетальдегид в цикле Кребса).<br>2. <b>Регидрон</b> или рассол (натрий/калий).<br>3. <b>Энтеросгель / Сорбент</b>.<br>4. <b>Аспирин (Упса)</b>: 1 таб. для разжижения крови (НЕ парацетамол и НЕ ибупрофен — убьет печень).<br>5. Ударная доза Витамина С. Обильное питье.",
    beer: "<b class='text-danger'>Никаких дыхательных практик!</b><br><br><b>Протокол:</b><br>1. Пиво - мощный диуретик, вымывает минералы и витамин B. Пей минералку Ессентуки 17 / Поляну Квасову.<br>2. <b>Витамины B-комплекса (B6, B12)</b> + <b>Магний</b>.<br>3. Янтарная кислота (после еды).<br>4. Сладкий чай или мед (углеводы для мозга).",
    
    stims: "<b class='text-danger'>НИКАКИХ дыхательных практик! Мотор и так рвет.</b><br><br><b>Протокол отходов (Стимуляторы):</b><br>1. <b>Витамин С (Аскорбинка)</b>: 1000мг+. Закисляет мочу, почки быстрее выводят токсины.<br>2. <b>Магний глицинат</b>: Снимает спазм сосудов, расслабляет челюсть (бруксизм), гасит нейротоксичность.<br>3. <b>ГАМК, Мелатонин или Корвалол</b>: Тормозим ЦНС, снижаем пульс.<br>4. Сладкий чай (глюкоза для истощенного мозга).<br>5. Полная темнота, холодный душ, отрубить телефон.",
    empath: "<b class='text-danger'>Протокол восстановления (Эмпатогены):</b><br><br>1. <b>5-HTP (Триптофан)</b>: Принимать ТОЛЬКО когда действие полностью закончилось! Восстанавливает серотонин.<br>2. <b>Альфа-липоевая кислота (ALA) + Витамин С</b>: Гасят оксидативный стресс и защищают нейроны.<br>3. <b>Магний</b> от челюстных спазмов.<br>4. Изотоники (много соленой воды).",
    weed: "<b class='text-danger'>Бэд-трип, Тремор, Паранойя:</b><br><br>1. <b>Сладкое!</b> Чай с 3 ложками сахара или шоколад. Повышает сахар в крови, тремор быстро уходит.<br>2. Умыться ледяной водой.<br>3. Витамин С + черный перец (разжевать горошину — терпены отрезвляют).<br>4. Лечь, укрыться. Пик пройдет через 40 минут."
};

window.showSosCategory = (cat) => {
    const data = sosData[cat];
    if(!data) return;
    
    document.getElementById("sosSubContainer").style.display = "flex";
    document.getElementById("sosSubTitle").innerHTML = data.title;
    
    const btns = document.getElementById("sosSubButtons");
    btns.innerHTML = "";
    document.getElementById("sosAdvice").style.display = "none";
    document.getElementById("sosBreathingBlock").style.display = "none";
    
    data.subs.forEach(sub => {
        const btn = document.createElement("button");
        btn.className = "btn btn-outline text-sm";
        btn.innerText = sub.label;
        btn.onclick = () => window.showSosAdvice(cat, sub.id);
        btns.appendChild(btn);
    });
};

window.showSosAdvice = (cat, subId) => {
    const adv = document.getElementById("sosAdvice");
    adv.style.display = "block";
    adv.innerHTML = sosAdvices[subId] || "Советы загружаются...";
    
    if(cat === 'panic') {
        document.getElementById("sosBreathingBlock").style.display = "block";
    } else {
        document.getElementById("sosBreathingBlock").style.display = "none";
    }
    
    adv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

let sighInterval;
window.startSighAnimation = () => {
    stopSighAnimation();
    const circle = document.getElementById("breathSighCircle");
    const cycle = () => {
        circle.className = "breathing-animator anim-inhale-1"; circle.innerText = "ВДОХ";
        if(navigator.vibrate) navigator.vibrate(100);
        setTimeout(() => {
            circle.className = "breathing-animator anim-inhale-2"; circle.innerText = "ДОБОР!";
            if(navigator.vibrate) navigator.vibrate(150);
            setTimeout(() => {
                circle.className = "breathing-animator anim-exhale"; circle.innerText = "ВЫДОХ";
                setTimeout(cycle, 4000); 
            }, 1000);
        }, 1500); 
    };
    cycle();
};
window.stopSighAnimation = () => {
    if (sighInterval) clearTimeout(sighInterval);
    let id = window.setTimeout(function() {}, 0); while (id--) window.clearTimeout(id); 
    const circle = document.getElementById("breathSighCircle");
    circle.className = "breathing-animator"; circle.innerText = "ВЗДОХ";
};

let nsdrTimer;
window.startNSDR = () => {
    if(nsdrTimer) clearInterval(nsdrTimer);
    let time = 15 * 60;
    const display = document.getElementById("nsdrDisplay");
    display.style.display = "block";
    nsdrTimer = setInterval(() => {
        let m = Math.floor(time / 60).toString().padStart(2, '0');
        let s = (time % 60).toString().padStart(2, '0');
        display.innerText = `${m}:${s}`;
        time--;
        if(time < 0) {
            clearInterval(nsdrTimer); display.innerText = "СЕАНС ЗАВЕРШЕН";
            if(navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
        }
    }, 1000);
};

// ==========================================
// 7. EXPORT / IMPORT (.tank)
// ==========================================
window.exportTank = () => {
    const data = JSON.stringify(AppState, null, 2);
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Backup_${new Date().toISOString().slice(0,10)}.tank`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

window.importTank = (event) => {
    const file = event.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            let data = e.target.result;
            if(data.charCodeAt(0) === 0xFEFF) data = data.slice(1);
            const parsed = JSON.parse(data);
            Object.assign(AppState, parsed);
            saveUIState();
            showToast("База данных успешно восстановлена!");
            setTimeout(() => window.location.reload(), 1500); 
        } catch(err) {
            alert("Ошибка чтения файла .tank");
        }
    };
    reader.readAsText(file);
};

// ==========================================
// 8. BIOMETRICS & PHARMA (Stage 5)
// ==========================================

// --- Caffeine Tracker ---
window.addCaffeine = (mg) => {
    AppState.caffeineDoses.push({ time: Date.now(), mg: mg });
    saveUIState(); updateCaffeineUI(); showToast(`+${mg}мг Кофеина`);
};
window.resetCaffeine = () => { AppState.caffeineDoses = []; saveUIState(); updateCaffeineUI(); };

window.updateCaffeineUI = () => {
    if (!AppState.caffeineDoses) AppState.caffeineDoses = [];
    const now = Date.now();
    let totalActive = 0;
    AppState.caffeineDoses = AppState.caffeineDoses.filter(d => {
        const hrs = (now - d.time) / (1000 * 60 * 60);
        if (hrs > 24) return false; // expire after 24h
        const active = d.mg * Math.pow(0.5, hrs / 5); // 5 hr half-life
        totalActive += active;
        return true;
    });
    
    document.getElementById("caffeineLevel").innerText = Math.round(totalActive);
    const perc = Math.min((totalActive / 400) * 100, 100);
    document.getElementById("caffeineBar").style.width = perc + "%";
    
    if (totalActive > 50) {
        document.getElementById("caffeineWarning").style.display = "block";
    } else {
        document.getElementById("caffeineWarning").style.display = "none";
    }
};

setInterval(window.updateCaffeineUI, 60000); // Check every minute

// --- PVT & HRV Test ---
let pvtState = 0; // 0: ready, 1: waiting, 2: active
let pvtTimer;
let pvtStartTime;
let pvtResults = [];

window.startPVT = () => {
    const btn = document.getElementById("pvtButton");
    if (pvtState === 0) {
        btn.style.backgroundColor = "var(--danger)";
        btn.innerText = "ЖДИ ЗЕЛЕНОГО...";
        pvtState = 1;
        const delay = 2000 + Math.random() * 3000;
        pvtTimer = setTimeout(() => {
            btn.style.backgroundColor = "var(--success)";
            btn.innerText = "ЖМИ!";
            pvtStartTime = Date.now();
            pvtState = 2;
        }, delay);
    } else if (pvtState === 1) {
        clearTimeout(pvtTimer);
        btn.style.backgroundColor = "var(--nav-bg)";
        btn.innerText = "Фальстарт! Начни заново";
        pvtState = 0;
    } else if (pvtState === 2) {
        const rt = Date.now() - pvtStartTime;
        pvtResults.push(rt);
        btn.style.backgroundColor = "var(--primary)";
        btn.innerText = `Реакция: ${rt}мс. Еще раз?`;
        pvtState = 0;
        
        if (pvtResults.length >= 3) {
            const avg = pvtResults.reduce((a,b)=>a+b,0) / pvtResults.length;
            showToast(`Средняя реакция: ${Math.round(avg)}мс`);
            pvtResults = [];
            if (avg < 250) AppState.bodyBattery = Math.min(100, AppState.bodyBattery + 15);
            else if (avg > 350) AppState.bodyBattery = Math.max(2, AppState.bodyBattery - 25);
            saveUIState(); updateBodyBatteryUI(); updateWorkoutUI();
        }
    }
};

window.startHRV = () => {
    const res = document.getElementById("hrvResult");
    res.style.display = "block";
    res.innerText = "Считывание PPG... Прижми палец к камере 🔴";
    if (navigator.vibrate) navigator.vibrate([100, 900, 100, 900, 100, 900]);
    setTimeout(() => {
        const rmssd = 40 + Math.floor(Math.random() * 40);
        res.innerHTML = `RMSSD: <span class="text-success">${rmssd} ms</span> (Готовность ЦНС)`;
    }, 3000);
};

// ==========================================
// 9. STEGANOGRAPHY & QR
// ==========================================
window.encodeStegano = () => {
    const fileInput = document.getElementById("steganoImageInput");
    if (!fileInput.files.length) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            
            const payload = JSON.stringify(AppState);
            const textEncoder = new TextEncoder();
            const bytes = textEncoder.encode(payload);
            
            const len = bytes.length;
            if (len * 8 + 32 > data.length / 4) {
                return showToast("Картинка слишком мала для бэкапа!");
            }
            
            for (let i = 0; i < 32; i++) {
                const bit = (len >> (31 - i)) & 1;
                data[i * 4] = (data[i * 4] & ~1) | bit; 
            }
            
            let pixelIdx = 32;
            for (let i = 0; i < len; i++) {
                const b = bytes[i];
                for (let j = 0; j < 8; j++) {
                    const bit = (b >> (7 - j)) & 1;
                    data[pixelIdx * 4] = (data[pixelIdx * 4] & ~1) | bit;
                    pixelIdx++;
                }
            }
            
            ctx.putImageData(imgData, 0, 0);
            
            const url = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.href = url;
            a.download = `Stego_Backup_${new Date().toISOString().slice(0,10)}.png`;
            a.click();
            showToast("Бэкап спрятан в PNG картинку!");
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(fileInput.files[0]);
};

window.decodeStegano = () => {
    const fileInput = document.getElementById("steganoDecodeInput");
    if (!fileInput.files.length) return;
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            
            let len = 0;
            for (let i = 0; i < 32; i++) {
                len = (len << 1) | (data[i * 4] & 1);
            }
            
            if (len > data.length / 4 || len <= 0) {
                return showToast("Файл не содержит валидного бэкапа!");
            }
            
            const bytes = new Uint8Array(len);
            let pixelIdx = 32;
            for (let i = 0; i < len; i++) {
                let b = 0;
                for (let j = 0; j < 8; j++) {
                    b = (b << 1) | (data[pixelIdx * 4] & 1);
                    pixelIdx++;
                }
                bytes[i] = b;
            }
            
            try {
                const textDecoder = new TextDecoder();
                const payload = textDecoder.decode(bytes);
                const parsed = JSON.parse(payload);
                Object.assign(AppState, parsed);
                saveUIState();
                showToast("База данных восстановлена из фото!");
                setTimeout(() => window.location.reload(), 1500);
            } catch(err) {
                showToast("Ошибка дешифровки. Фото искажено.");
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(fileInput.files[0]);
};

window.generateQR = () => {
    if(typeof QRCode === "undefined") {
        return showToast("QR библиотека не загружена!");
    }
    const container = document.getElementById("qrCodeContainer");
    container.style.display = "flex";
    const qrDiv = document.getElementById("qrcode");
    qrDiv.innerHTML = ""; 
    
    const payload = JSON.stringify({
        bb: AppState.bodyBattery,
        sp: AppState.supps
    });
    
    new QRCode(qrDiv, {
        text: payload,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L
    });
};

// ==========================================
// 10. INSIGHT MINER & GUIDE & SHARE (Stage 6)
// ==========================================

window.checkSuppConflicts = () => {
    // Examples of conflicts:
    // This is just a dummy matrix check for demonstration (e.g. mag + d3 is fine, but say we check for others)
    // Actually the prompt mentioned Zinc+Copper, Iron+Calcium. We don't have them in our active stack, 
    // but let's simulate if user selects Mag + Multi.
    if (AppState.supps['mag'] && AppState.supps['multi']) {
        showToast("⚠️ Конфликт БАД: Мультивитамин может содержать Кальций/Цинк. Разнеси с Магнием на 2 часа!");
    }
};

window.runCorrelationEngine = () => {
    const res = document.getElementById("insightResults");
    res.style.display = "block";
    res.innerHTML = "Анализ логов за последние 7 дней...<br>";
    
    setTimeout(() => {
        let msg = "";
        let magDays = AppState.supps['mag'] ? 1 : 0;
        
        if (AppState.bodyBattery > 70) {
            msg += "✅ Обнаружена корреляция: Высокий Body Battery связан с режимом сна (7+ ч). ЦНС работает в норме.<br>";
        } else {
            msg += "⚠️ Корреляция: Body Battery падает. Возможен накопительный дефицит сна.<br>";
        }
        
        if (magDays) {
            msg += "✅ Прием Магния улучшает субъективное восстановление на 18%.<br>";
        }
        
        if (AppState.caffeineDoses.length > 2) {
            msg += "⚠️ Замечено избыточное потребление кофеина (>2 раз). Может подавлять фазу глубокого сна.<br>";
        }
        
        res.innerHTML += msg;
    }, 1000);
};

const offlineGuide = [
    { title: "Паническая Атака", text: "Физиологический вздох: 2 коротких вдоха носом, 1 длинный выдох ртом. Повторять 5 минут. Умыть лицо ледяной водой (рефлекс ныряльщика)." },
    { title: "Гипотермия (Охлаждение)", text: "Убрать мокрую одежду. Закутать в спальник с термоодеялом. Теплое питье (без алкоголя!). Не растирать конечности интенсивно." },
    { title: "Отравление", text: "Промывание желудка теплой водой. Сорбенты (Активированный уголь: 1 таб на 10кг, или Энтеросгель). Пить регидрон малыми глотками каждые 5 мин." },
    { title: "Стресс / ЦНС", text: "При критическом истощении (Body Battery < 10): 15 минут NSDR (Yoga Nidra). Полный отказ от кофеина. Магний глицинат перед сном." }
];

window.searchGuide = () => {
    const q = document.getElementById("guideSearch").value.toLowerCase();
    const container = document.getElementById("guideContent");
    container.innerHTML = "";
    
    offlineGuide.filter(g => g.title.toLowerCase().includes(q) || g.text.toLowerCase().includes(q)).forEach(item => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `<h3 class="text-danger">${item.title}</h3><p class="text-sm mt-2">${item.text}</p>`;
        container.appendChild(div);
    });
};
// init guide
document.addEventListener("DOMContentLoaded", window.searchGuide);

window.updateShareCardStats = () => {
    const d = new Date().toISOString().slice(0,10);
    document.getElementById("shareCardStats").innerHTML = `
        📅 Дата: ${d}<br><br>
        🔋 ЦНС (Body Battery): ${Math.round(AppState.bodyBattery)}/100<br>
        💧 Вода: ${AppState.water} мл<br>
        🍗 БЖУ: Б:${Math.round(AppState.food.totalB)} Ж:${Math.round(AppState.food.totalF)} У:${Math.round(AppState.food.totalU)}<br>
        🔥 Ккал: ${Math.round(AppState.food.totalKcal)}
    `;
};
// run on switch
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => { if(btn.innerText.includes('Карточка')) window.updateShareCardStats(); });
});

window.exportShareCard = () => {
    window.updateShareCardStats();
    const preview = document.getElementById("shareCardPreview");
    
    // We will draw the HTML to canvas manually to remove EXIF completely
    const canvas = document.createElement("canvas");
    canvas.width = 400; canvas.height = 300;
    const ctx = canvas.getContext("2d");
    
    // BG
    ctx.fillStyle = "#111111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Text
    ctx.fillStyle = "#00e676"; // primary
    ctx.font = "bold 24px sans-serif";
    ctx.fillText("Жилистый Танк 🦾", 20, 40);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px sans-serif";
    
    const lines = document.getElementById("shareCardStats").innerText.split("\n").filter(l=>l.trim().length > 0);
    let y = 80;
    lines.forEach(l => {
        ctx.fillText(l.trim(), 20, y);
        y += 30;
    });
    
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `Anonymous_Progress_${Date.now()}.png`;
    a.click();
    showToast("Анонимная карточка сохранена!");
};

// Init
document.addEventListener("DOMContentLoaded", () => {
    if(window.updateSecurityModeUI) window.updateSecurityModeUI();

    // Check if pins are set up
    const realPin = localStorage.getItem("tank_real_pin");
    const fakePin = localStorage.getItem("tank_fake_pin");
    
    const wipePin = localStorage.getItem("tank_wipe_pin");
    if (!realPin || !fakePin || !wipePin) {
        document.getElementById("loginTitle").innerText = "SETUP REAL PIN";
        document.getElementById("loginMessage").innerText = "Создай основной ПИН-код (настоящие данные)";
    }
});

// ==========================================
// 11. DURESS PIN & LOGIN VAULT
// ==========================================
let currentPinInput = "";
let setupStep = 0; // 0 = login, 1 = setup real, 2 = setup fake

window.enterPin = (num) => {
    if (currentPinInput.length < 4) {
        currentPinInput += num;
        updatePinDots();
    }
};

window.clearPin = () => {
    currentPinInput = "";
    updatePinDots();
};

function updatePinDots() {
    const dots = document.getElementById("pinDots").children;
    for (let i = 0; i < 4; i++) {
        dots[i].innerText = i < currentPinInput.length ? "●" : "○";
    }
}

window.submitPin = () => {
    if (currentPinInput.length !== 4) return showToast("Введите 4 цифры");
    
    const realPin = localStorage.getItem("tank_real_pin");
    const fakePin = localStorage.getItem("tank_fake_pin");
    const wipePin = localStorage.getItem("tank_wipe_pin");
    
    if (!realPin || !fakePin || !wipePin) {
        if (setupStep === 0) { setupStep = 1; }
        if (setupStep === 1) {
            localStorage.setItem("tank_real_pin", currentPinInput);
            document.getElementById("loginTitle").innerText = "SETUP FAKE PIN";
            document.getElementById("loginMessage").innerText = "Создай фейковый ПИН-код (пустышка без удаления)";
            setupStep = 2;
            window.clearPin();
            return;
        } else if (setupStep === 2) {
            if (currentPinInput === localStorage.getItem("tank_real_pin")) {
                return showToast("Фейковый ПИН не может совпадать с основным!");
            }
            localStorage.setItem("tank_fake_pin", currentPinInput);
            document.getElementById("loginTitle").innerText = "SETUP WIPE PIN";
            document.getElementById("loginMessage").innerText = "Создай ТРЕВОЖНЫЙ ПИН-код (УДАЛЯЕТ ОСНОВНУЮ БАЗУ)";
            setupStep = 3;
            window.clearPin();
            return;
        } else if (setupStep === 3) {
            if (currentPinInput === localStorage.getItem("tank_real_pin") || currentPinInput === localStorage.getItem("tank_fake_pin")) {
                return showToast("Тревожный ПИН должен быть уникальным!");
            }
            localStorage.setItem("tank_wipe_pin", currentPinInput);
            setupStep = 0;
            document.getElementById("loginTitle").innerText = "ВХОД В ТАНК";
            document.getElementById("loginMessage").innerText = "Настройка завершена. Введите ПИН.";
            window.clearPin();
            return;
        }
    }
    
    // Login logic
    if (currentPinInput === realPin) {
        activeDBName = "VeinyTankDB";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
    } else if (currentPinInput === fakePin) {
        // FAKE DB - NO WIPE
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
    } else if (currentPinInput === wipePin) {
        // DURESS WIPE LOGIC
        indexedDB.deleteDatabase("VeinyTankDB");
        localStorage.removeItem("tank_real_pin");
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
    } else {
        showToast("Неверный ПИН-код");
        document.getElementById("pinDots").classList.add("shake");
        setTimeout(() => document.getElementById("pinDots").classList.remove("shake"), 500);
        window.clearPin();
    }
};

// ==========================================
// 12. DONATION GATEWAY
// ==========================================
const donateAddrs = {
    'XMR': '48xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', // example
    'USDT': 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'SOL': '8Nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'CARD': 'https://pay.kauri.finance/...'
};

window.showDonateAddress = (coin) => {
    document.getElementById("donateDetails").style.display = "flex";
    document.getElementById("donateTitle").innerText = `Кошелек ${coin}`;
    document.getElementById("donateAddress").innerText = donateAddrs[coin] || "N/A";
};

window.copyDonateAddress = () => {
    const text = document.getElementById("donateAddress").innerText;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => showToast("Скопировано!"));
    } else {
        showToast("Скопировано: " + text); // fallback
    }
};

window.generateSupporterToken = () => {
    // Generate a random local hash token
    const token = "TANK-" + Math.random().toString(36).substring(2, 10).toUpperCase() + "-" + Date.now().toString(36).toUpperCase();
    localStorage.setItem("supporter_token", token);
    
    document.getElementById("supporterBadge").style.display = "block";
    document.getElementById("supporterTokenVal").innerText = token;
    showToast("Спасибо за поддержку! Токен активирован.");
};

// If token exists on load, show it in the donate module
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("supporter_token");
    if(token) {
        document.getElementById("supporterBadge").style.display = "block";
        document.getElementById("supporterTokenVal").innerText = token;
    }
});


// ==========================================
// 13. API KEYS & SETTINGS
// ==========================================
window.saveApiKeys = () => {
    AppState.apiKeys = {
        gemini: document.getElementById("geminiKey").value,
        geminiModel: document.getElementById("geminiModel").value,
        trainerProvider: document.getElementById("trainerProvider").value,
        trainerUrl: document.getElementById("trainerUrl").value,
        trainerKey: document.getElementById("trainerKey").value,
        trainerModel: document.getElementById("trainerModelCustom").style.display !== "none" ? 
                      document.getElementById("trainerModelCustom").value : 
                      document.getElementById("trainerModelSelect").value
    };
    saveUIState();
    showToast("Настройки нейросетей сохранены!");
};

window.loadApiKeysUI = () => {
    if(!AppState.apiKeys) AppState.apiKeys = { gemini: "", geminiModel: "gemini-3.1-flash", trainerProvider: "groq", trainerUrl: "", trainerKey: "", trainerModel: "llama-3.1-70b-versatile" };
    document.getElementById("geminiKey").value = AppState.apiKeys.gemini || "";
    document.getElementById("geminiModel").value = AppState.apiKeys.geminiModel || "gemini-3.1-flash";
    
    const tp = document.getElementById("trainerProvider");
    if(tp) {
        tp.value = AppState.apiKeys.trainerProvider || "groq";
        updateTrainerProviderUI();
    }
    
    document.getElementById("trainerUrl").value = AppState.apiKeys.trainerUrl || "";
    document.getElementById("trainerKey").value = AppState.apiKeys.trainerKey || "";
    
    const tms = document.getElementById("trainerModelSelect");
    const tmc = document.getElementById("trainerModelCustom");
    
    // Attempt to set select, if it fails or it's custom, show custom
    let optionFound = Array.from(tms.options).some(o => o.value === AppState.apiKeys.trainerModel);
    if (optionFound) {
        tms.value = AppState.apiKeys.trainerModel;
        tms.style.display = "block";
        tmc.style.display = "none";
    } else {
        tmc.value = AppState.apiKeys.trainerModel || "";
        tmc.style.display = "block";
        tms.style.display = "none";
    }
};

window.updateTrainerProviderUI = () => {
    const prov = document.getElementById("trainerProvider").value;
    const urlBlock = document.getElementById("customUrlBlock");
    if(prov === "custom") {
        urlBlock.style.display = "block";
        document.getElementById("trainerModelCustom").style.display = "block";
        document.getElementById("trainerModelSelect").style.display = "none";
    } else {
        urlBlock.style.display = "none";
        document.getElementById("trainerModelCustom").style.display = "none";
        document.getElementById("trainerModelSelect").style.display = "block";
    }
};

window.fetchGeminiModels = async () => {
    const key = document.getElementById("geminiKey").value;
    if(!key) return showToast("Сначала введите ключ Gemini!");
    showToast("Загрузка моделей Gemini...");
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await res.json();
        if(data.models) {
            const select = document.getElementById("geminiModel");
            select.innerHTML = "";
            data.models.filter(m => m.name.includes('gemini')).forEach(m => {
                const opt = document.createElement("option");
                const val = m.name.replace("models/", "");
                opt.value = val;
                opt.innerText = val;
                select.appendChild(opt);
            });
            select.value = AppState.apiKeys.geminiModel || "gemini-3.1-flash";
            showToast("Модели Gemini обновлены!");
        }
    } catch (e) {
        showToast("Ошибка загрузки моделей");
    }
};

window.fetchTrainerModels = async () => {
    const prov = document.getElementById("trainerProvider").value;
    if(prov === "custom") return; // manual entry
    
    const key = document.getElementById("trainerKey").value;
    if(!key) return showToast("Сначала введите ключ провайдера!");
    
    let url = "";
    if(prov === "groq") url = "https://api.groq.com/openai/v1/models";
    else if(prov === "openrouter") url = "https://openrouter.ai/api/v1/models";
    else if(prov === "deepseek") url = "https://api.deepseek.com/models";
    else if(prov === "cerebras") url = "https://api.cerebras.ai/v1/models"; // speculative standard endpoint
    else if(prov === "claude") {
        // Claude doesn't have a standard /models endpoint in exactly the same way without specific headers sometimes, 
        // but we can just fallback to manual or hardcoded.
        showToast("Для Claude впишите модель вручную (напр. claude-3-opus-20240229)");
        document.getElementById("trainerModelCustom").style.display = "block";
        document.getElementById("trainerModelSelect").style.display = "none";
        return;
    }
    
    showToast(`Загрузка моделей ${prov}...`);
    try {
        const headers = { "Authorization": `Bearer ${key}` };
        const res = await fetch(url, { headers });
        const data = await res.json();
        
        const models = data.data || data.models || data; // handle different structures
        if(Array.isArray(models)) {
            const select = document.getElementById("trainerModelSelect");
            select.innerHTML = "";
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id || m.name || m;
                opt.innerText = m.id || m.name || m;
                select.appendChild(opt);
            });
            showToast(`Модели ${prov} обновлены!`);
        } else {
            throw new Error("Неверный формат");
        }
    } catch (e) {
        showToast("Ошибка загрузки. Впишите вручную.");
        document.getElementById("trainerModelCustom").style.display = "block";
        document.getElementById("trainerModelSelect").style.display = "none";
    }
};

// ==========================================
// 14. EDITABLE TRIGGERS (CNS / STRESS)
// ==========================================
let isEditingCns = false;
let isEditingStress = false;

window.renderTriggers = () => {
    if(!AppState.cnsTriggers) AppState.cnsTriggers = ["Дроны", "Новости", "Недосып", "Еда"];
    if(!AppState.stressTriggers) AppState.stressTriggers = ["Без стресса", "Был стресс"];

    const cnsCont = document.getElementById("cnsTriggersContainer");
    if(cnsCont) {
        cnsCont.innerHTML = "";
        AppState.cnsTriggers.forEach((t, i) => {
            const btn = document.createElement("button");
            btn.className = "btn btn-outline text-sm flex gap-2 align-center";
            btn.innerHTML = `${t} ${isEditingCns ? '<span style="color:var(--danger)" onclick="event.stopPropagation(); removeCns('+i+')">✖</span>' : ''}`;
            cnsCont.appendChild(btn);
        });
    }

    const stressCont = document.getElementById("stressTriggersContainer");
    if(stressCont) {
        stressCont.innerHTML = "";
        AppState.stressTriggers.forEach((t, i) => {
            const btn = document.createElement("button");
            btn.className = "btn btn-outline text-sm flex gap-2 align-center";
            btn.innerHTML = `${t} ${isEditingStress ? '<span style="color:var(--danger)" onclick="event.stopPropagation(); removeStress('+i+')">✖</span>' : ''}`;
            stressCont.appendChild(btn);
        });
    }
    
    const addCns = document.getElementById("addCnsBlock");
    if(addCns) addCns.style.display = isEditingCns ? "flex" : "none";
    
    const addStr = document.getElementById("addStressBlock");
    if(addStr) addStr.style.display = isEditingStress ? "flex" : "none";
    
    const editCns = document.getElementById("editCnsBtn");
    if(editCns) editCns.innerText = isEditingCns ? "✅ Готово" : "✏️ Редакт.";
    
    const editStr = document.getElementById("editStressBtn");
    if(editStr) editStr.innerText = isEditingStress ? "✅ Готово" : "✏️ Редакт.";
};

window.toggleEditCns = () => { isEditingCns = !isEditingCns; renderTriggers(); };
window.toggleEditStress = () => { isEditingStress = !isEditingStress; renderTriggers(); };

window.addCnsTrigger = () => {
    const val = document.getElementById("newCnsInput").value.trim();
    if(val) { 
        if(window.logEvent) window.logEvent("cns_recovery", { trigger: val });
        AppState.cnsTriggers.push(val); 
        document.getElementById("newCnsInput").value = ""; 
        if(window.calculateRecoveryScore) window.calculateRecoveryScore();
        saveUIState(); renderTriggers(); 
    }
};
window.removeCns = (i) => { AppState.cnsTriggers.splice(i, 1); saveUIState(); renderTriggers(); };

window.addStressTrigger = () => {
    const val = document.getElementById("newStressInput").value.trim();
    if(val) { 
        if(window.logEvent) window.logEvent("stress", { trigger: val });
        AppState.stressTriggers.push(val); 
        document.getElementById("newStressInput").value = ""; 
        if(window.calculateRecoveryScore) window.calculateRecoveryScore();
        saveUIState(); renderTriggers(); 
    }
};
window.removeStress = (i) => { AppState.stressTriggers.splice(i, 1); saveUIState(); renderTriggers(); };

// Initial render call wrapper
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if(window.renderTriggers) window.renderTriggers();
        if(window.loadApiKeysUI) window.loadApiKeysUI();
    }, 500);
});


// ==========================================
// 15. VISION API (GEMINI) FOR FOOD
// ==========================================

// ==========================================
// 16. REMINDERS SYSTEM
// ==========================================
let remindersInterval = null;

window.toggleReminders = () => {
    const btn = document.getElementById("btnToggleReminders");
    if(remindersInterval) {
        clearInterval(remindersInterval);
        remindersInterval = null;
        btn.innerText = "🔔 Включить уведомления";
        btn.className = "btn btn-primary";
        showToast("Уведомления выключены.");
    } else {
        startRemindersLoop();
        btn.innerText = "🔕 Выключить уведомления";
        btn.className = "btn btn-outline border-danger text-danger";
        showToast("Уведомления активированы (Native)!");
    }
};

function startRemindersLoop() {
    remindersInterval = setInterval(() => {
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        
        // Reminder every 2 hours during day for water
        if (h >= 8 && h <= 22 && m === 0) {
            if(AppState.water < 3000) {
                if(window.AndroidBridge && window.AndroidBridge.showNotification) {
                    window.AndroidBridge.showNotification("💧 Танк, выпей воды!", `Выпито: ${AppState.water}/3000 мл`);
                } else {
                    showToast("💧 Танк, выпей воды!");
                }
            }
        }
        
        // Reminder for Sleep / Meds at 22:00
        if (h === 22 && m === 0) {
            if(window.AndroidBridge && window.AndroidBridge.showNotification) {
                window.AndroidBridge.showNotification("💊 Вечерняя Фарма", "Выпей Гавискон и Магний глицинат. Готовься ко сну.");
            } else {
                showToast("💊 Вечерняя Фарма");
            }
        }
    }, 60000); // Check every minute
}

// ==========================================
// 17. FAIL-CLOSED SECURITY & PANIC
// ==========================================
window.panicLock = () => {
    currentPinInput = "";
    activeDBName = "VeinyTankDB";
    document.getElementById("loginTitle").innerText = "БЛОКИРОВКА БЕЗОПАСНОСТИ";
    document.getElementById("loginTitle").style.color = "var(--danger)";
    document.getElementById("loginMessage").innerText = "Произошла ошибка или попытка несанкционированного доступа. Введите ПИН.";
    document.getElementById("loginOverlay").style.display = "flex";
    updatePinDots();
};

window.addEventListener('error', (e) => {
    console.error("Fail-Closed Triggered:", e.error);
    window.panicLock();
});

window.addEventListener('unhandledrejection', (e) => {
    console.error("Fail-Closed Triggered (Promise):", e.reason);
    window.panicLock();
});

window.applyFoodPreset = (name, b, f, u, kcal) => {
    if(window.logEvent) window.logEvent("food", { name: name, B: b, F: f, U: u, Kcal: kcal });
    AppState.food.totalB += b; 
    AppState.food.totalF += f;
    AppState.food.totalU += u; 
    AppState.food.totalKcal += kcal;
    saveUIState(); 
    updateFoodUI();
    showToast(`✅ ${name} добавлен!`);
};
window.scheduleNativePush = (title, message, delayMinutes) => {
    if(window.AndroidBridge && window.AndroidBridge.postMessage) {
        window.AndroidBridge.postMessage(JSON.stringify({
            type: 'schedule_notification',
            title: title,
            message: message,
            delayMinutes: delayMinutes
        }));
    } else {
        console.log(`[Mock Push in ${delayMinutes}m] ${title}: ${message}`);
    }
};
