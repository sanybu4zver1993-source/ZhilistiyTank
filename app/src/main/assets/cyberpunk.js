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
    
    // Check if it matches login strings
    if (currentCalc === "1993+1961") {
        activeDBName = "VeinyTankDB";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    } else if (currentCalc === "2+2") {
        // FAKE DB - NO WIPE
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    } else if (currentCalc === "999+999") {
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
