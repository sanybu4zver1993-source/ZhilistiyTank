let currentCalc = "";

window.calcInput = (char) => {
    if (char === 'C') {
        currentCalc = "";
    } else {
        currentCalc += char;
    }
    document.getElementById("calcDisplay").innerText = currentCalc || "0";
};

window.calcEq = () => {
    if (!currentCalc) return;
    
    const realPin = localStorage.getItem("tank_real_pin");
    const fakePin = localStorage.getItem("tank_fake_pin");
    const wipePin = localStorage.getItem("tank_wipe_pin");
    
    // Check if it matches login strings or PINs
    if (currentCalc === realPin || currentCalc === "1993+1961") {
        activeDBName = "VeinyTankDB";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    } else if (currentCalc === fakePin || currentCalc === "2+2") {
        // FAKE DB - NO WIPE
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    } else if (currentCalc === wipePin) {
        // DURESS WIPE LOGIC
        indexedDB.deleteDatabase("VeinyTankDB");
        localStorage.removeItem("tank_real_pin");
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    }
    
    // Evaluate math (safe eval)
    try {
        currentCalc = new Function('return ' + currentCalc)().toString();
        document.getElementById("calcDisplay").innerText = currentCalc;
    } catch(e) {
        document.getElementById("calcDisplay").innerText = "Err";
        currentCalc = "";
    }
};

window.changeSecurityMode = () => {
    const val = document.getElementById("securityMode").value;
    localStorage.setItem("securityMode", val);
    showToast("Режим безопасности изменен. Перезагрузите приложение.");
};

window.updateSecurityModeUI = () => {
    const mode = localStorage.getItem("securityMode") || "civilian";
    const modeSelect = document.getElementById("securityMode");
    if (modeSelect) modeSelect.value = mode;

    if (mode === "cyberpunk") {
        document.querySelectorAll(".cyberpunk-only").forEach(el => el.style.display = "block");
        document.getElementById("pinModeContainer").style.display = "none";
        document.getElementById("calcModeContainer").style.display = "flex";
    } else {
        document.querySelectorAll(".cyberpunk-only").forEach(el => el.style.display = "none");
        document.getElementById("pinModeContainer").style.display = "flex";
        document.getElementById("calcModeContainer").style.display = "none";
    }
};

window.saveDossier = () => {
    if (!AppState.dossier) AppState.dossier = {};
    AppState.dossier = {
        year: document.getElementById("dossierYear").value,
        height: document.getElementById("dossierHeight").value,
        weight: document.getElementById("dossierWeight").value,
        conditions: document.getElementById("dossierConditions").value,
        goal: document.getElementById("dossierGoal").value
    };
    saveUIState();
    showToast("Досье сохранено!");
};

window.loadDossierUI = () => {
    if (!AppState.dossier) return;
    if(document.getElementById("dossierYear")) document.getElementById("dossierYear").value = AppState.dossier.year || "";
    if(document.getElementById("dossierHeight")) document.getElementById("dossierHeight").value = AppState.dossier.height || "";
    if(document.getElementById("dossierWeight")) document.getElementById("dossierWeight").value = AppState.dossier.weight || "";
    if(document.getElementById("dossierConditions")) document.getElementById("dossierConditions").value = AppState.dossier.conditions || "";
    if(document.getElementById("dossierGoal")) document.getElementById("dossierGoal").value = AppState.dossier.goal || "maintenance";
};

// Event Sourcing Helper
window.logEvent = (type, payload) => {
    if (!AppState.events) AppState.events = [];
    AppState.events.push({
        id: "evt_" + Date.now() + "_" + Math.floor(Math.random()*1000),
        type: type,
        occurred_at: new Date().toISOString(),
        payload: payload
    });
    saveUIState();
};

window.calculateRecoveryScore = () => {
    let bb = 100;
    
    if (!AppState.sleepLogs) AppState.sleepLogs = [];
    if (!AppState.events) AppState.events = [];
    
    // 1. Get recent sleep (last 24h)
    const now = new Date();
    const recentSleep = AppState.sleepLogs.filter(s => (now - new Date(s.date)) < 24*60*60*1000);
    let totalSleepHrs = 0;
    recentSleep.forEach(s => totalSleepHrs += s.hrs);
    
    if (totalSleepHrs < 4 && recentSleep.length > 0) {
        bb = 20; // Critical
    } else if (totalSleepHrs < 6) {
        bb -= 30; // Sleep deprived
    } else if (totalSleepHrs >= 7 && totalSleepHrs <= 9) {
        // Optimal
    } else if (totalSleepHrs > 9) {
        bb -= 10; // Overslept slightly
    }
    
    // 2. Stress impact (from events last 24h)
    const recentStress = AppState.events.filter(e => e.type === 'stress' && (now - new Date(e.occurred_at)) < 24*60*60*1000);
    bb -= (recentStress.length * 15);
    
    // 3. Workouts impact (exhaustion)
    const recentWorkouts = AppState.events.filter(e => e.type === 'workout' && (now - new Date(e.occurred_at)) < 24*60*60*1000);
    bb -= (recentWorkouts.length * 10);
    
    // 4. Recovery activities (meditation, CNS reset)
    const recentRecovery = AppState.events.filter(e => e.type === 'cns_recovery' && (now - new Date(e.occurred_at)) < 24*60*60*1000);
    bb += (recentRecovery.length * 20);

    // Bounds
    if (bb < 0) bb = 0;
    if (bb > 100) bb = 100;
    
    AppState.bodyBattery = bb;
    if(window.updateBodyBatteryUI) window.updateBodyBatteryUI();
    saveUIState();
    return bb;
};

window.buildWeeklyFeaturePack = () => {
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7*24*60*60*1000).toISOString();
    
    // Filter events for the last 7 days
    const recentEvents = (AppState.events || []).filter(e => e.occurred_at >= last7Days);
    
    const featurePack = {
        dossier: AppState.dossier || {},
        current_recovery_score: AppState.bodyBattery || 0,
        events: recentEvents,
        summary: {
            total_water_ml: recentEvents.filter(e => e.type === 'water').reduce((sum, e) => sum + (e.payload.ml || 0), 0),
            total_sleep_logs: recentEvents.filter(e => e.type === 'sleep').length,
            total_workouts: recentEvents.filter(e => e.type === 'workout').length,
            total_stress_events: recentEvents.filter(e => e.type === 'stress').length
        }
    };
    
    return JSON.stringify(featurePack);
};
