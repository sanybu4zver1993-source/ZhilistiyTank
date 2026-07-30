    } else if (currentCalc === wipePin) {
        if (window.haptic) window.haptic(300);
        // DURESS WIPE LOGIC
        indexedDB.deleteDatabase("VeinyTankDB");
        localStorage.removeItem("tank_real_pin");
        activeDBName = "VeinyTankDB_Fake";
