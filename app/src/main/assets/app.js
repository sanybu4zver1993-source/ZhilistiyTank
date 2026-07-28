"use strict";

const safeParseInt = (val, fallback = 0) => {
    const res = parseInt(val, 10);
    return isNaN(res) ? fallback : res;
};

// --- State Core ---
const AppState = {
    food: { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 },
    water: 0,
    supps: { gaviscon: false, mag: false, omega: false, multi: false, d3: false },
    workoutDays: [], // Array of timestamp strings "YYYY-MM-DD"
    logs: [],
    lastResetDate: new Date().toISOString().slice(0,10)
};

const suppLabels = {
    gaviscon: "💊 Гавискон",
    mag: "💊 Магний глицинат",
    omega: "🐟 Omega-3 (NOW)",
    multi: "💊 Мультивитамины (NOW)",
    d3: "☀️ D3 + K2-MK7"
};

let db = null;
const initDB = () => {
    return new Promise((resolve, reject) => {
        const req = window.indexedDB.open("VeinyTankDB", 3);
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
        store.get("supps").onsuccess = (e) => { 
            if (e.target.result) AppState.supps = e.target.result.value; 
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
        // New Day! Reset daily stats.
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
}

// --- Module Navigation ---
window.showModule = (id) => {
    document.querySelectorAll('.module').forEach(el => el.classList.remove('active'));
    document.getElementById(`module-${id}`).classList.add('active');
};

// ==========================================
// 1. HYBRID KBJU
// ==========================================
const foodDB = {
    "гречк": { b: 12, f: 3, u: 68, kcal: 343 }, 
    "яйц": { b: 13, f: 11, u: 1, kcal: 155, unit: 50 }, 
    "колбас": { b: 12, f: 20, u: 2, kcal: 250 },
    "пшенк": { b: 11, f: 3, u: 73, kcal: 348 },
    "печен": { b: 19, f: 4, u: 0, kcal: 130 },
    "хлеб": { b: 8, f: 1, u: 49, kcal: 265, unit: 25 },
    "каш": { b: 12, f: 3, u: 68, kcal: 343 }
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
    const b = safeParseInt(document.getElementById("foodB").value);
    const f = safeParseInt(document.getElementById("foodF").value);
    const u = safeParseInt(document.getElementById("foodU").value);
    const k = safeParseInt(document.getElementById("foodKcal").value);
    const name = document.getElementById("foodName").value || "Еда";

    AppState.food.totalB += b;
    AppState.food.totalF += f;
    AppState.food.totalU += u;
    AppState.food.totalKcal += k;
    
    saveUIState();
    updateFoodUI();
    
    // Clear inputs
    document.getElementById("smartFoodInput").value = "";
    document.getElementById("foodName").value = "";
    document.getElementById("foodB").value = "";
    document.getElementById("foodF").value = "";
    document.getElementById("foodU").value = "";
    document.getElementById("foodKcal").value = "";
};

window.resetBJU = () => { AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 }; saveUIState(); updateFoodUI(); };

function updateFoodUI() {
    document.getElementById("totalB").innerText = Math.round(AppState.food.totalB);
    document.getElementById("totalF").innerText = Math.round(AppState.food.totalF);
    document.getElementById("totalU").innerText = Math.round(AppState.food.totalU);
    document.getElementById("totalKcal").innerText = Math.round(AppState.food.totalKcal);
}

// ==========================================
// 2. DASHBOARD (Supps, Heatmap, Battery)
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
        chk.checked = AppState.supps[key];
        chk.onchange = (e) => {
            AppState.supps[key] = e.target.checked;
            saveUIState();
        };
        
        const lbl = document.createElement("label");
        lbl.htmlFor = `supp_${key}`;
        lbl.innerText = suppLabels[key];
        
        div.appendChild(chk); div.appendChild(lbl); list.appendChild(div);
    });
}

window.takeGaviscon = () => {
    AppState.supps.gaviscon = true;
    saveUIState();
    renderSupps();
    if(navigator.vibrate) navigator.vibrate([100]);
};

function renderHeatmap() {
    const grid = document.getElementById("heatmapGrid");
    grid.innerHTML = "";
    // Draw 28 squares
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
// 3. ANDROID NATIVE WATER BRIDGE
// ==========================================
window.syncWaterFromNative = () => {
    if(window.AndroidBridge) {
        AppState.water = window.AndroidBridge.getWater();
    }
    updateWaterUI();
};

window.addWater = (ml) => {
    if(window.AndroidBridge) {
        window.AndroidBridge.addWater(ml);
        syncWaterFromNative();
    } else {
        AppState.water += ml;
        saveUIState(); updateWaterUI();
    }
};

window.addCustomWater = () => {
    const val = safeParseInt(document.getElementById("customWater").value);
    if(val > 0) window.addWater(val);
    document.getElementById("customWater").value = "";
};

window.resetWater = () => {
    if(window.AndroidBridge) window.AndroidBridge.resetWater();
    AppState.water = 0;
    saveUIState(); updateWaterUI();
};

function updateWaterUI() {
    let perc = (AppState.water / 3000) * 100;
    if (perc > 100) perc = 100;
    document.getElementById("waterFill").style.width = `${perc}%`;
    document.getElementById("waterText").innerText = `${AppState.water} / 3000 мл`;
}

// Refresh when app comes to foreground
document.addEventListener("visibilitychange", () => {
    if(!document.hidden) {
        checkDailyReset();
        syncWaterFromNative();
    }
});

// ==========================================
// 4. WORKOUT (Iso Timer & Tracking)
// ==========================================
let isoTimer;
window.startIsoTimer = (seconds) => {
    stopIsoTimer();
    const display = document.getElementById("isoTimerDisplay");
    let time = seconds;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    
    display.style.backgroundColor = "var(--danger)";
    display.innerText = `РАБОТА: ${time}с`;

    isoTimer = setInterval(() => {
        time--;
        display.innerText = `РАБОТА: ${time}с`;
        if (time <= 0) {
            stopIsoTimer();
            display.style.backgroundColor = "var(--success)";
            display.innerText = "ОТДЫХ!";
            if (navigator.vibrate) navigator.vibrate([500]); 
        }
    }, 1000);
};

window.stopIsoTimer = () => {
    if (isoTimer) clearInterval(isoTimer);
    const display = document.getElementById("isoTimerDisplay");
    display.innerText = "ОСТАНОВЛЕНО";
    display.style.backgroundColor = "var(--nav-bg)";
};

let currentReps = 0;
window.addRep = () => {
    currentReps++;
    if(navigator.vibrate) navigator.vibrate(50);
    if(currentReps >= 3) {
        currentReps = 0;
        // Mark today as workout day
        const todayStr = new Date().toISOString().slice(0,10);
        if(!AppState.workoutDays.includes(todayStr)) {
            AppState.workoutDays.push(todayStr);
            saveUIState();
            renderHeatmap();
        }
    }
    document.getElementById("repCounter").innerText = `${currentReps} / 3`;
};

// ==========================================
// 5. SMART BODY BATTERY & WEATHER
// ==========================================
function calcBodyBattery(pressureDrop = false) {
    let base = 85;
    if(pressureDrop) base -= 40; // Метеоудар
    
    const fill = document.getElementById("dashBatteryFill");
    const txt = document.getElementById("dashBatteryText");
    const sos = document.getElementById("sosSuggestion");
    
    fill.style.width = `${base}%`;
    txt.innerText = `${base}/100`;
    
    if(base < 50) {
        fill.style.backgroundColor = "var(--danger)";
        sos.style.display = "block";
    } else {
        fill.style.backgroundColor = "var(--success)";
        sos.style.display = "none";
    }
}

// ==========================================
// 6. SOS ANIMATIONS
// ==========================================
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
// EXPORT
// ==========================================
window.exportToTxt = () => {
    let txt = "ЗВІТ ДЛЯ ЛІКАРЯ (МЕДИЧНА ВИПИСКА)\n=================================\n\n";
    txt += `Дата формування: ${new Date().toLocaleString("uk-UA")}\n\n`;
    txt += "📊 ЗЖИВАННЯ БЖУ (ОСТАННІ ДАНІ):\n";
    txt += `- Білки: ${Math.round(AppState.food.totalB)} г\n`;
    txt += `- Жири: ${Math.round(AppState.food.totalF)} г\n`;
    txt += `- Вуглеводи: ${Math.round(AppState.food.totalU)} г\n`;
    txt += `- Калорії: ${Math.round(AppState.food.totalKcal)} ккал\n\n`;
    
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Медичний_Звіт_Танк_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

// Init
document.addEventListener("DOMContentLoaded", () => {
    initDB().catch(console.error);
    // Fake weather API pressure drop call for Body Battery demo
    setTimeout(() => calcBodyBattery(true), 2000);
});
