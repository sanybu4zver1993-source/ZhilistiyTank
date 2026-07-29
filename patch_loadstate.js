        tx.oncomplete = () => {
            if (activeDBName === "VeinyTankDB_Fake" && AppState.water === 0 && (!AppState.sleepLogs || AppState.sleepLogs.length === 0)) {
                // Populate Fake DB with realistic noise
                AppState.water = 1500;
                AppState.bodyBattery = 85;
                const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
                AppState.sleepLogs = [{
                    start: "23:00",
                    end: "07:00",
                    hrs: 8,
                    date: yesterday
                }];
                AppState.food = { totalB: 120, totalF: 60, totalU: 200, totalKcal: 1820 };
                AppState.events = [
                    { type: "water", payload: { ml: 500 }, occurred_at: yesterday },
                    { type: "water", payload: { ml: 1000 }, occurred_at: new Date().toISOString() }
                ];
                saveUIState();
                updateFoodUI();
                syncWaterFromNative();
                if(window.calculateRecoveryScore) window.calculateRecoveryScore(); else updateBodyBatteryUI();
            }
        };
