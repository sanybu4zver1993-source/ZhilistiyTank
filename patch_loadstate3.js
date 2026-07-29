        store.get("potTare").onsuccess = (e) => { if (e.target.result) AppState.potTare = e.target.result.value; };
        store.get("potRecipes").onsuccess = (e) => { if (e.target.result) AppState.potRecipes = e.target.result.value; };
        store.get("suppsInventory").onsuccess = (e) => { if (e.target.result) AppState.suppsInventory = e.target.result.value; };
        store.get("cnsTriggers").onsuccess = (e) => { if (e.target.result) AppState.cnsTriggers = e.target.result.value; };
