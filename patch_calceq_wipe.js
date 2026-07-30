    } else if (currentCalc === wipePin) {
        if (window.haptic) window.haptic(300);
        
        // CRYPTO-SHREDDING (Instant wipe of decryption keys via overwrite)
        if (window.crypto && window.crypto.getRandomValues) {
            for (let i = 0; i < 5; i++) {
                localStorage.setItem("tank_real_pin", crypto.getRandomValues(new Uint8Array(32)).toString());
            }
        }
        localStorage.removeItem("tank_real_pin");
        
        // Delete IndexedDB (asynchronous, but keys are already shredded)
        indexedDB.deleteDatabase("VeinyTankDB");
        
        activeDBName = "VeinyTankDB_Fake";
