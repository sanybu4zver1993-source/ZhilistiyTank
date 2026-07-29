window.eatActivePotGrams = (type) => {
    const pot = AppState.activePots[type];
    if (!pot) return;
    
    const input = document.getElementById('eatenPotGramsActive');
    const eaten = parseFloat(input.value);
    
    if (isNaN(eaten) || eaten <= 0) return showToast("Укажи сколько съел!");
    if (eaten > pot.remainingWeight) return showToast(`В кастрюле осталось только ${pot.remainingWeight} г!`);
    
    // Calculate macros for eaten portion
    const k = Math.round((pot.k100 * eaten) / 100);
    const b = Math.round((pot.b100 * eaten) / 100);
    const f = Math.round((pot.f100 * eaten) / 100);
    const u = Math.round((pot.u100 * eaten) / 100);
    
    const label = `${pot.name} [${eaten}г]`;

    // Write directly to daily totals
    AppState.food.totalB += b;
    AppState.food.totalF += f;
    AppState.food.totalU += u;
    AppState.food.totalKcal += k;
    if (window.updateFoodUI) window.updateFoodUI();
    
    // Log event to Event Store
    if (window.logEvent) {
        window.logEvent("food", { name: label, B: b, F: f, U: u, Kcal: k, type: "batch_portion_eaten" });
    }
    
    // Deduct from remaining
    pot.remainingWeight -= eaten;
    if (pot.remainingWeight <= 0) {
        AppState.activePots[type] = null;
        showToast(`✅ Съедено ${eaten}г! Кастрюля пуста и удалена.`);
        document.getElementById("potCalculator").style.display = "none";
    } else {
        showToast(`✅ Съедено ${eaten}г! Добавлено в дневник. Осталось ${pot.remainingWeight} г.`);
        renderActivePot(type);
    }
    
    saveUIState();
};
