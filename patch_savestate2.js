const saveUIState = () => {
    if (!db) return;
    try {
        const tx = db.transaction("state", "readwrite");
        const store = tx.objectStore("state");
        store.put({ key: "food", value: AppState.food });
        store.put({ key: "water", value: AppState.water });
        store.put({ key: "supps", value: AppState.supps });
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
