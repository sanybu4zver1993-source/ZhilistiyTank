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
