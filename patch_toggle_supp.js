window.toggleSupp = (key) => {
    if (window.haptic) window.haptic(30);
    const checkbox = document.getElementById(`supp_${key}`);
    const isChecked = checkbox.checked;
    
    if (isChecked) {
        if (AppState.suppsInventory[key] <= 0) {
            checkbox.checked = false;
            if (window.showToast) window.showToast(`❌ Ошибка: ${suppLabels[key]} закончился! Пополните инвентарь.`);
            if (window.haptic) window.haptic([50, 100, 50]);
            return;
        }
        
        AppState.supps[key] = true;
        AppState.suppsInventory[key] -= 1;
        if (window.sendNativeAlarm) window.sendNativeAlarm("supp_reminder", "Время следующего приема БАДов", 4 * 60 * 60 * 1000);
        
        if (window.logEvent) window.logEvent("supp_taken", { key, remaining: AppState.suppsInventory[key] });
        
        if (AppState.suppsInventory[key] < 10) {
            if (window.showToast) window.showToast(`⚠️ Заканчивается ${suppLabels[key]}! Осталось ${AppState.suppsInventory[key]} шт.`);
        }
    } else {
        AppState.supps[key] = false;
        // Do not return inventory on uncheck, it requires audit event
        if (window.logEvent) window.logEvent("supp_uncheck", { key });
    }
    
    saveUIState();
    if(window.renderSupps) window.renderSupps();
};
