
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

