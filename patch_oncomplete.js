        tx.oncomplete = () => {
            if (activeDBName === "VeinyTankDB_Fake") {
                const now = new Date();
                const yesterdayStr = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
                if (AppState.water === 0 && (!AppState.sleepLogs || AppState.sleepLogs.length === 0)) {
                    // Seed initial Fake DB
                    AppState.water = 1500;
                    AppState.bodyBattery = 85;
                    AppState.sleepLogs = [{ start: "23:00", end: "07:00", hrs: 8, date: yesterdayStr }];
                    AppState.food = { totalB: 120, totalF: 60, totalU: 200, totalKcal: 1820 };
                    AppState.events = [
                        { type: "water", payload: { ml: 500 }, occurred_at: yesterdayStr },
                        { type: "water", payload: { ml: 1000 }, occurred_at: now.toISOString() }
                    ];
                    AppState.lastResetDate = now.toISOString().slice(0, 10);
                } else if (AppState.events && AppState.events.length > 0) {
                    // Aging Fake DB: catch up to today
                    const sorted = [...AppState.events].sort((a,b) => new Date(b.occurred_at) - new Date(a.occurred_at));
                    const lastEventDate = new Date(sorted[0].occurred_at);
                    const diffDays = Math.floor((now - lastEventDate) / (1000 * 60 * 60 * 24));
                    
                    if (diffDays >= 1) {
                        for(let i = 1; i <= diffDays; i++) {
                            const d = new Date(lastEventDate.getTime() + i * 24 * 3600 * 1000).toISOString();
                            AppState.events.push({ type: "water", payload: { ml: 1200 }, occurred_at: d });
                            if(i % 2 === 0) AppState.events.push({ type: "sleep", payload: { hrs: 7.5 }, occurred_at: d });
                        }
                    }
                }
                saveUIState();
                updateFoodUI();
                syncWaterFromNative();
                if(window.calculateRecoveryScore) window.calculateRecoveryScore(); else updateBodyBatteryUI();
            }
        };
