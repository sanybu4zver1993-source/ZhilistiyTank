        store.get("apiKeys").onsuccess = (e) => { if (e.target.result) AppState.apiKeys = e.target.result.value; if(window.loadApiKeysUI) window.loadApiKeysUI(); };
        store.get("activePots").onsuccess = (e) => { if (e.target.result) AppState.activePots = e.target.result.value; };
        store.get("customPotIngredients").onsuccess = (e) => { if (e.target.result) AppState.customPotIngredients = e.target.result.value; };
        store.get("cnsTriggers").onsuccess = (e) => { if (e.target.result) AppState.cnsTriggers = e.target.result.value; };
        store.get("stressTriggers").onsuccess = (e) => { if (e.target.result) AppState.stressTriggers = e.target.result.value; };
        store.get("dossier").onsuccess = (e) => { if (e.target.result) AppState.dossier = e.target.result.value; };
        store.get("events").onsuccess = (e) => { if (e.target.result) AppState.events = e.target.result.value; if(window.renderEvents) window.renderEvents(); };
