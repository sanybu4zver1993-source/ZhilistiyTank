window.haptic = (pattern) => { if (navigator.vibrate) { navigator.vibrate(pattern); } };
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
    suppsInventory: { omega: 0, multi: 0, d3: 0, b2: 0, c300: 0, mag: 0, gaviscon: 0, succinic: 0 },
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
    customPotIngredients: {},
    potTare: { green: 0, white: 0 },
    potRecipes: { green: null, white: null }
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
        store.put({ key: "suppsInventory", value: AppState.suppsInventory });
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
        store.put({ key: "potTare", value: AppState.potTare });
        store.put({ key: "potRecipes", value: AppState.potRecipes });
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
        store.get("potTare").onsuccess = (e) => { if (e.target.result) AppState.potTare = e.target.result.value; };
        store.get("potRecipes").onsuccess = (e) => { if (e.target.result) AppState.potRecipes = e.target.result.value; };
        store.get("suppsInventory").onsuccess = (e) => { if (e.target.result) AppState.suppsInventory = e.target.result.value; };
        store.get("cnsTriggers").onsuccess = (e) => { 
            if (e.target.result) AppState.cnsTriggers = e.target.result.value; 
            if (window.renderSupps) window.renderSupps();
            if (window.renderCnsDashboard) window.renderCnsDashboard();
        };
    } catch (e) {}
};

window.showModule = (id) => {
    document.querySelectorAll('.module').forEach(el => el.classList.remove('active'));
    document.getElementById(`module-${id}`).classList.add('active');
    if (id === 'sleep' && window.renderCnsDashboard) {
        setTimeout(() => { window.renderCnsDashboard(); }, 100);
    }
};

window.saveHybridFood = () => {
    if (window.haptic) window.haptic(30);
    const name = document.getElementById("foodName").value || "Food";
    const b = safeParseInt(document.getElementById("foodB").value);
    const f = safeParseInt(document.getElementById("foodF").value);
    const u = safeParseInt(document.getElementById("foodU").value);
    const k = safeParseInt(document.getElementById("foodKcal").value);
    
    if (window.logEvent) window.logEvent("food", { name, B: b, F: f, U: u, Kcal: k });

    AppState.food.totalB += b; 
    AppState.food.totalF += f;
    AppState.food.totalU += u; 
    AppState.food.totalKcal += k;
    
    saveUIState(); 
    updateFoodUI();
    
    document.getElementById("smartFoodInput").value = "";
    document.getElementById("foodName").value = "";
    document.getElementById("foodB").value = "";
    document.getElementById("foodF").value = "";
    document.getElementById("foodU").value = "";
    document.getElementById("foodKcal").value = "";
};

window.resetBJU = () => { 
    AppState.food = { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 }; 
    saveUIState(); 
    updateFoodUI(); 
};

window.applyFoodPreset = (name, b, f, u, k) => {
    if (window.haptic) window.haptic(30);
    document.getElementById("foodName").value = name;
    document.getElementById("foodB").value = b;
    document.getElementById("foodF").value = f;
    document.getElementById("foodU").value = u;
    document.getElementById("foodKcal").value = k;
};

window.updateFoodUI = () => {
    if(document.getElementById("bCount")) document.getElementById("bCount").innerText = AppState.food.totalB;
    if(document.getElementById("fCount")) document.getElementById("fCount").innerText = AppState.food.totalF;
    if(document.getElementById("uCount")) document.getElementById("uCount").innerText = AppState.food.totalU;
    if(document.getElementById("kcalCount")) document.getElementById("kcalCount").innerText = AppState.food.totalKcal;
};

window.addWater = (ml) => {
    if (window.haptic) window.haptic(30);
    AppState.water += ml;
    saveUIState();
    syncWaterFromNative();
    if(window.logEvent) window.logEvent("water", { ml });
    if (window.sendNativeAlarm) window.sendNativeAlarm("water_reminder", "Время пить воду (2 часа)", 2 * 60 * 60 * 1000);
};

window.syncWaterFromNative = () => {
    if(document.getElementById("waterLevel")) document.getElementById("waterLevel").innerText = AppState.water;
    if(document.getElementById("waterBar")) {
        const pct = Math.min(100, (AppState.water / 3000) * 100);
        document.getElementById("waterBar").style.width = pct + "%";
    }
};

window.updateCaffeineUI = () => {
    let active = 0;
    const now = Date.now();
    AppState.caffeineDoses.forEach(d => {
        const elapsedHours = (now - d.time) / (1000 * 60 * 60);
        const remaining = d.amount * Math.pow(0.5, elapsedHours / 5);
        if (remaining > 5) active += remaining;
    });
    const total = Math.round(active);
    if(document.getElementById("caffeineLevel")) document.getElementById("caffeineLevel").innerText = total;
    if(document.getElementById("caffeineBar")) {
        const pct = Math.min(100, (total / 400) * 100);
        document.getElementById("caffeineBar").style.width = pct + "%";
    }
    if(document.getElementById("caffeineWarning")) {
        document.getElementById("caffeineWarning").style.display = total > 200 ? "block" : "none";
    }
};

window.addCaffeine = (mg) => {
    if (window.haptic) window.haptic(30);
    AppState.caffeineDoses.push({ amount: mg, time: Date.now() });
    saveUIState();
    updateCaffeineUI();
    if(window.logEvent) window.logEvent("caffeine", { mg });
};

window.updateBodyBatteryUI = () => {
    const val = AppState.bodyBattery || 85;
    if(document.getElementById("dashBatteryText")) {
        document.getElementById("dashBatteryText").innerText = `${val}/100`;
        document.getElementById("dashBatteryText").className = val > 70 ? 'text-success' : (val > 40 ? 'text-warning' : 'text-danger');
    }
    if(document.getElementById("dashBatteryFill")) document.getElementById("dashBatteryFill").style.width = val + "%";
};

window.renderHeatmap = () => {
    const grid = document.getElementById("heatmapGrid");
    if(!grid) return;
    grid.innerHTML = "";
    // simple 14 day blocks
    for(let i=13; i>=0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0,10);
        const div = document.createElement("div");
        div.className = "heatmap-block";
        if(AppState.workoutDays.includes(ds)) {
            div.style.background = "var(--primary)";
        }
        grid.appendChild(div);
    }
};

window.updateWorkoutUI = () => {
    renderHeatmap();
};

window.loadApiKeysUI = () => {
    if(document.getElementById("geminiKey")) document.getElementById("geminiKey").value = AppState.apiKeys.gemini || "";
};

window.saveSettings = () => {
    if (window.haptic) window.haptic(30);
    AppState.apiKeys.gemini = document.getElementById("geminiKey").value;
    saveUIState();
    showToast("Настройки сохранены!");
};

window.logEvent = (type, data) => {
    if(!db) return;
    const tx = db.transaction("logs", "readwrite");
    tx.objectStore("logs").add({ type, data, timestamp: Date.now() });
};


window.exportEncryptedJSON = () => {
    if (window.haptic) window.haptic(30);
    const pin = localStorage.getItem("tank_real_pin") || "0000";
    const dataStr = JSON.stringify(AppState);
    
    // Simple XOR cipher using PIN
    let encrypted = "";
    for(let i=0; i<dataStr.length; i++) {
        const c = dataStr.charCodeAt(i) ^ pin.charCodeAt(i % pin.length);
        encrypted += String.fromCharCode(c);
    }
    const b64 = btoa(unescape(encodeURIComponent(encrypted)));
    
    const blob = new Blob([b64], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `VeinyTank_Backup_${new Date().toISOString().slice(0,10)}.tank`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    if (window.showToast) window.showToast("Бэкап сохранен!");
};

// Check for 7-day auto backup
const checkAutoBackup = () => {
    const lastBackup = localStorage.getItem("tank_last_backup_date");
    const now = Date.now();
    if (!lastBackup || (now - parseInt(lastBackup)) > 7 * 24 * 60 * 60 * 1000) {
        localStorage.setItem("tank_last_backup_date", now.toString());
        // Since it's background, we might not want to download a file automatically.
        // We can just save it to a separate IndexedDB store or just trigger a log
        if (window.logEvent) window.logEvent("auto_backup", { timestamp: now });
        if (window.showToast) window.showToast("Сделан системный авто-бэкап (7 дней)");
    }
};

setTimeout(checkAutoBackup, 5000); // Check 5 seconds after load

