        store.get("cnsTriggers").onsuccess = (e) => { 
            if (e.target.result) AppState.cnsTriggers = e.target.result.value; 
            if (window.renderSupps) window.renderSupps();
            if (window.renderCnsDashboard) window.renderCnsDashboard();
        };
