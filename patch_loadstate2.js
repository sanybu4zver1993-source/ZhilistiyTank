        store.get("activePots").onsuccess = (e) => { if (e.target.result) AppState.activePots = e.target.result.value; };
        store.get("customPotIngredients").onsuccess = (e) => { if (e.target.result) AppState.customPotIngredients = e.target.result.value; };
        store.get("potTare").onsuccess = (e) => { if (e.target.result) AppState.potTare = e.target.result.value; };
        store.get("potRecipes").onsuccess = (e) => { if (e.target.result) AppState.potRecipes = e.target.result.value; };
        store.get("cnsTriggers").onsuccess = (e) => { if (e.target.result) AppState.cnsTriggers = e.target.result.value; };
