let currentCalc = "";

window.calcInput = (char) => {
    if (char === 'C') {
        currentCalc = "";
    } else {
        currentCalc += char;
    }
    document.getElementById("calcDisplay").innerText = currentCalc || "0";
};

window.calcEq = () => {
    if (!currentCalc) return;
    
    const realPin = localStorage.getItem("tank_real_pin");
    const fakePin = localStorage.getItem("tank_fake_pin");
    const wipePin = localStorage.getItem("tank_wipe_pin");
    
    // Check if it matches login strings or PINs
    if (currentCalc === realPin || currentCalc === "1993+1961") {
        activeDBName = "VeinyTankDB";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    } else if (currentCalc === fakePin || currentCalc === "2+2") {
        // FAKE DB - NO WIPE
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    } else if (currentCalc === wipePin) {
        // DURESS WIPE LOGIC
        indexedDB.deleteDatabase("VeinyTankDB");
        localStorage.removeItem("tank_real_pin");
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
        currentCalc = "";
        return;
    }
    
    // Evaluate math (safe eval)
    try {
        currentCalc = new Function('return ' + currentCalc)().toString();
        document.getElementById("calcDisplay").innerText = currentCalc;
    } catch(e) {
        document.getElementById("calcDisplay").innerText = "Err";
        currentCalc = "";
    }
};

window.changeSecurityMode = () => {
    const val = document.getElementById("securityMode").value;
    localStorage.setItem("securityMode", val);
    showToast("Режим безопасности изменен. Перезагрузите приложение.");
};

window.updateSecurityModeUI = () => {
    const mode = localStorage.getItem("securityMode") || "civilian";
    const modeSelect = document.getElementById("securityMode");
    if (modeSelect) modeSelect.value = mode;

    if (mode === "cyberpunk") {
        document.querySelectorAll(".cyberpunk-only").forEach(el => el.style.display = "block");
        document.getElementById("pinModeContainer").style.display = "none";
        document.getElementById("calcModeContainer").style.display = "flex";
    } else {
        document.querySelectorAll(".cyberpunk-only").forEach(el => el.style.display = "none");
        document.getElementById("pinModeContainer").style.display = "flex";
        document.getElementById("calcModeContainer").style.display = "none";
    }
};

window.saveDossier = () => {
    if (!AppState.dossier) AppState.dossier = {};
    AppState.dossier = {
        year: document.getElementById("dossierYear").value,
        height: document.getElementById("dossierHeight").value,
        weight: document.getElementById("dossierWeight").value,
        conditions: document.getElementById("dossierConditions").value,
        goal: document.getElementById("dossierGoal").value
    };
    saveUIState();
    showToast("Досье сохранено!");
};

window.loadDossierUI = () => {
    if (!AppState.dossier) return;
    if(document.getElementById("dossierYear")) document.getElementById("dossierYear").value = AppState.dossier.year || "";
    if(document.getElementById("dossierHeight")) document.getElementById("dossierHeight").value = AppState.dossier.height || "";
    if(document.getElementById("dossierWeight")) document.getElementById("dossierWeight").value = AppState.dossier.weight || "";
    if(document.getElementById("dossierConditions")) document.getElementById("dossierConditions").value = AppState.dossier.conditions || "";
    if(document.getElementById("dossierGoal")) document.getElementById("dossierGoal").value = AppState.dossier.goal || "maintenance";
};

// Event Sourcing Helper
window.logEvent = (type, payload) => {
    if (!AppState.events) AppState.events = [];
    AppState.events.push({
        id: "evt_" + Date.now() + "_" + Math.floor(Math.random()*1000),
        type: type,
        occurred_at: new Date().toISOString(),
        payload: payload
    });
    saveUIState();
};

window.calculateRecoveryScore = () => {
    let bb = 100;
    
    if (!AppState.sleepLogs) AppState.sleepLogs = [];
    if (!AppState.events) AppState.events = [];
    
    // 1. Get recent sleep (last 24h)
    const now = new Date();
    const recentSleep = AppState.sleepLogs.filter(s => (now - new Date(s.date)) < 24*60*60*1000);
    let totalSleepHrs = 0;
    recentSleep.forEach(s => totalSleepHrs += s.hrs);
    
    if (totalSleepHrs < 4 && recentSleep.length > 0) {
        bb = 20; // Critical
    } else if (totalSleepHrs < 6) {
        bb -= 30; // Sleep deprived
    } else if (totalSleepHrs >= 7 && totalSleepHrs <= 9) {
        // Optimal
    } else if (totalSleepHrs > 9) {
        bb -= 10; // Overslept slightly
    }
    
    // 2. Stress impact (from events last 24h)
    const recentStress = AppState.events.filter(e => e.type === 'stress' && (now - new Date(e.occurred_at)) < 24*60*60*1000);
    bb -= (recentStress.length * 15);
    
    // 3. Workouts impact (exhaustion)
    const recentWorkouts = AppState.events.filter(e => e.type === 'workout' && (now - new Date(e.occurred_at)) < 24*60*60*1000);
    bb -= (recentWorkouts.length * 10);
    
    // 4. Recovery activities (meditation, CNS reset)
    const recentRecovery = AppState.events.filter(e => e.type === 'cns_recovery' && (now - new Date(e.occurred_at)) < 24*60*60*1000);
    bb += (recentRecovery.length * 20);

    // Bounds
    if (bb < 0) bb = 0;
    if (bb > 100) bb = 100;
    
    AppState.bodyBattery = bb;
    if(window.updateBodyBatteryUI) window.updateBodyBatteryUI();
    saveUIState();
    return bb;
};

window.buildWeeklyFeaturePack = () => {
    const now = new Date();
    const events = AppState.events || [];
    let spanDays = 0;
    
    if (events.length > 0) {
        // Sort to get earliest
        const sorted = [...events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
        const earliest = new Date(sorted[0].occurred_at);
        spanDays = (now - earliest) / (1000 * 60 * 60 * 24);
    }
    
    if (spanDays < 14) {
        return JSON.stringify({ 
            warning: "Мало данных для поиска закономерностей (нужно минимум 14 дней). Аналитика трендов отключена.",
            dossier: AppState.dossier || {},
            current_recovery_score: AppState.bodyBattery || 0
        });
    }

    const last7Days = new Date(now.getTime() - 7*24*60*60*1000).toISOString();
    const recentEvents = events.filter(e => e.occurred_at >= last7Days);
    
    const featurePack = {
        dossier: AppState.dossier || {},
        current_recovery_score: AppState.bodyBattery || 0,
        events: recentEvents,
        summary: {
            total_water_ml: recentEvents.filter(e => e.type === 'water').reduce((sum, e) => sum + (e.payload.ml || 0), 0),
            total_sleep_logs: recentEvents.filter(e => e.type === 'sleep').length,
            total_workouts: recentEvents.filter(e => e.type === 'workout').length,
            total_stress_events: recentEvents.filter(e => e.type === 'stress').length
        }
    };
    
    return JSON.stringify(featurePack);
};
// Steganography Backup Engine
window.exportStegoBackup = async () => {
    try {
        const password = prompt("Введи пароль для шифрования бэкапа:", "");
        if (!password) return showToast("Экспорт отменен");

        showToast("⏳ Собираю базу...");
        const payload = JSON.stringify({
            AppState: AppState,
            timestamp: new Date().toISOString()
        });

        // Simple XOR + Base64
        const xorString = (str, key) => {
            let res = '';
            for (let i = 0; i < str.length; i++) {
                res += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return btoa(res);
        };
        
        const encrypted = xorString(payload, password);
        
        // Compress using pako
        const compressed = pako.deflate(encrypted);
        const dataLength = compressed.length;
        
        // Hide in Canvas
        const canvas = document.createElement("canvas");
        // Minimum size based on data
        // Each pixel can store 3 bytes (R, G, B), we use alpha for opacity (255)
        const pixelsNeeded = Math.ceil((dataLength + 4) / 3); // +4 bytes for length prefix
        const size = Math.max(128, Math.ceil(Math.sqrt(pixelsNeeded)));
        
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        
        // Draw a base image or gradient so it looks like a real image
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, "#2c3e50");
        grad.addColorStop(1, "#3498db");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        
        // We will encode data in the least significant bit (LSB) of RGB channels? 
        // No, let's just write raw data bytes into the RGB channels. It will look like noise but it's safe.
        // Wait, to make it look like a normal image, LSB steganography is better.
        // Let's use LSB.
        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;
        
        // Embed length in first 32 bits (4 bytes)
        let bitIndex = 0;
        const setBit = (val, bit) => {
            const byteIdx = Math.floor(bitIndex / 8);
            const bitInByte = 7 - (bitIndex % 8);
            
            // We use RGB channels (skip Alpha)
            let pixelIdx = Math.floor(bitIndex / 3) * 4;
            let channel = bitIndex % 3; // 0=R, 1=G, 2=B
            
            let p = pixelIdx + channel;
            
            // Clear LSB and set it to 'bit'
            data[p] = (data[p] & ~1) | bit;
            bitIndex++;
        };
        
        // Write length (32 bits)
        for (let i = 31; i >= 0; i--) {
            setBit(dataLength, (dataLength >> i) & 1);
        }
        
        // Write compressed data bytes
        for (let i = 0; i < dataLength; i++) {
            let b = compressed[i];
            for (let j = 7; j >= 0; j--) {
                setBit(b, (b >> j) & 1);
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        
        // Download
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `backup_photo_${new Date().getTime()}.png`;
        a.click();
        showToast("✅ Стегано-бэкап скачан!");
    } catch(e) {
        showToast("❌ Ошибка экспорта: " + e.message);
    }
};

window.importStegoBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const password = prompt("Введи пароль для расшифровки бэкапа:", "");
    if (!password) return showToast("Импорт отменен");

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                
                const imgData = ctx.getImageData(0, 0, img.width, img.height);
                const data = imgData.data;
                
                let bitIndex = 0;
                const getBit = () => {
                    let pixelIdx = Math.floor(bitIndex / 3) * 4;
                    let channel = bitIndex % 3;
                    let p = pixelIdx + channel;
                    let bit = data[p] & 1;
                    bitIndex++;
                    return bit;
                };
                
                // Read length (32 bits)
                let dataLength = 0;
                for (let i = 31; i >= 0; i--) {
                    dataLength = (dataLength << 1) | getBit();
                }
                
                if (dataLength > img.width * img.height * 3 / 8 || dataLength <= 0) {
                    throw new Error("Неверный формат или нет данных");
                }
                
                // Read compressed bytes
                const compressed = new Uint8Array(dataLength);
                for (let i = 0; i < dataLength; i++) {
                    let b = 0;
                    for (let j = 7; j >= 0; j--) {
                        b = (b << 1) | getBit();
                    }
                    compressed[i] = b;
                }
                
                // Decompress
                const encrypted = pako.inflate(compressed, { to: 'string' });
                
                // Decrypt
                const dexorString = (b64, key) => {
                    const str = atob(b64);
                    let res = '';
                    for (let i = 0; i < str.length; i++) {
                        res += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                    }
                    return res;
                };
                
                const payloadStr = dexorString(encrypted, password);
                const payload = JSON.parse(payloadStr);
                
                if (payload && payload.AppState) {
                    Object.assign(AppState, payload.AppState);
                    saveUIState();
                    showToast("✅ Бэкап успешно восстановлен! Перезагрузи приложение.");
                    setTimeout(() => location.reload(), 1500);
                } else {
                    throw new Error("Неверный пароль или поврежден бэкап");
                }
            } catch(err) {
                showToast("❌ Ошибка импорта: " + err.message);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};
