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
