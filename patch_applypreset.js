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
