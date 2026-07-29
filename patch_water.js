window.addWater = (ml) => {
    if(window.logEvent) window.logEvent("water", { ml: ml });
    if(window.AndroidBridge) { window.AndroidBridge.addWater(ml); syncWaterFromNative(); } 
    else { AppState.water += ml; saveUIState(); updateWaterUI(); }
    if(window.scheduleNativePush) window.scheduleNativePush("Вода", "Пора выпить еще стакан воды!", 60);
};
