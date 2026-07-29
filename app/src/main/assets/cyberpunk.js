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

const getPotIngredients = () => {
    return {
        'горох': { b: 20, f: 2, u: 53, k: 290 },
        'пшеничка': { b: 11, f: 1, u: 67, k: 320 },
        'перловка': { b: 9, f: 1, u: 73, k: 320 },
        'гречка': { b: 13, f: 3, u: 71, k: 343 },
        'пшенка': { b: 11.5, f: 3.3, u: 66.5, k: 348 },
        'овсянка': { b: 12, f: 6, u: 61, k: 350 },
        'курица': { b: 18, f: 10, u: 0, k: 170 },
        'печень': { b: 19, f: 6, u: 1, k: 140 },
        'овощи': { b: 2, f: 0, u: 6, k: 30 },
        'грибы': { b: 3, f: 0.5, u: 3, k: 27 },
        'молоко': { b: 3, f: 2.5, u: 4.7, k: 52 },
        'изюм': { b: 3, f: 0.5, u: 71, k: 299 },
        'банан': { b: 1.5, f: 0.1, u: 22, k: 89 },
        'орехи': { b: 15, f: 65, u: 7, k: 654 },
        'яблоко': { b: 0.4, f: 0.4, u: 11, k: 52 },
        ...(AppState.customPotIngredients || {})
    };
};

let currentPotType = '';
let currentPotRows = [];
let potRowCounter = 0;
let currentPotTotals = null;

window.openPotModal = (type) => {
    currentPotType = type;
    const container = document.getElementById("potCalculator");
    container.style.display = "block";
    
    currentPotRows = [];
    potRowCounter = 0;
    
    if (type === 'green') {
        addPotRow('гречка', '');
        addPotRow('курица', '');
        addPotRow('овощи', '');
    } else {
        addPotRow('овсянка', '');
        addPotRow('молоко', '');
        addPotRow('изюм', '');
        addPotRow('банан', '');
    }
    
    renderPotBuilder();
};

window.addPotRow = (defaultKey = '', defaultGrams = '') => {
    currentPotRows.push({ id: potRowCounter++, ingredientKey: defaultKey, grams: defaultGrams });
    renderPotBuilder();
};

window.removePotRow = (id) => {
    currentPotRows = currentPotRows.filter(r => r.id !== id);
    renderPotBuilder();
};

window.updatePotRow = (id, field, value) => {
    const row = currentPotRows.find(r => r.id === id);
    if (row) {
        row[field] = value;
    }
};

window.renderPotBuilder = () => {
    const container = document.getElementById("potCalculator");
    const ingredients = getPotIngredients();
    const sortedKeys = Object.keys(ingredients).sort();
    
    let html = `
        <h4 class="${currentPotType === 'green' ? 'text-success' : 'text-warning'} mb-2 text-center">
            ${currentPotType === 'green' ? '🟢 Зеленая (3л) Мясная' : '🌼 Белая (2л) Молочная'}
        </h4>
        <div id="potRowsContainer" class="flex-col gap-2 mb-2">
    `;
    
    currentPotRows.forEach(row => {
        let options = sortedKeys.map(k => `<option value="${k}" ${row.ingredientKey === k ? 'selected' : ''}>${k.charAt(0).toUpperCase() + k.slice(1)}</option>`).join('');
        html += `
            <div class="flex gap-2 align-center">
                <select class="input" style="flex: 2" onchange="updatePotRow(${row.id}, 'ingredientKey', this.value)">
                    <option value="" disabled ${!row.ingredientKey ? 'selected' : ''}>Выбери...</option>
                    ${options}
                </select>
                <input type="number" class="input" style="flex: 1" placeholder="Грамм" value="${row.grams}" oninput="updatePotRow(${row.id}, 'grams', this.value)">
                <button class="btn btn-danger text-sm" style="width:auto; padding: 0 10px;" onclick="removePotRow(${row.id})">✖</button>
            </div>
        `;
    });
    
    html += `
        </div>
        <div class="grid-2 gap-2 mt-2">
            <button class="btn btn-outline text-sm" onclick="addPotRow()">+ Ингредиент</button>
            <button class="btn btn-outline text-sm" onclick="openCustomIngredientModal()">⚙️ Свой Продукт</button>
        </div>
        <button class="btn btn-primary w-100 mt-2" onclick="calcPot()">🔥 Рассчитать Кастрюлю</button>
        <div id="potResult" class="mt-2 text-center" style="display:none; border: 1px dashed var(--primary); padding: 10px; border-radius: 8px;"></div>
    `;
    
    const oldResultObj = document.getElementById("potResult");
    const oldResult = oldResultObj ? oldResultObj.innerHTML : "";
    
    container.innerHTML = html;
    
    if (oldResult && document.getElementById("potResult")) {
        document.getElementById("potResult").innerHTML = oldResult;
        document.getElementById("potResult").style.display = currentPotTotals ? "block" : "none";
    }
};

window.openCustomIngredientModal = () => {
    const name = prompt("Название продукта:");
    if (!name) return;
    const k = parseFloat(prompt("Ккал на 100г:", "0"));
    const b = parseFloat(prompt("Белки на 100г:", "0"));
    const f = parseFloat(prompt("Жиры на 100г:", "0"));
    const u = parseFloat(prompt("Углеводы на 100г:", "0"));
    
    if (!isNaN(k) && !isNaN(b) && !isNaN(f) && !isNaN(u)) {
        if (!AppState.customPotIngredients) AppState.customPotIngredients = {};
        AppState.customPotIngredients[name.toLowerCase()] = { b, f, u, k };
        saveUIState();
        showToast("✅ Продукт добавлен!");
        renderPotBuilder();
    } else {
        showToast("❌ Ошибка ввода!");
    }
};

window.calcPot = () => {
    let b = 0, f = 0, u = 0, k = 0, weight = 0;
    const ingredients = getPotIngredients();
    
    currentPotRows.forEach(row => {
        if (row.ingredientKey && row.grams) {
            const g = parseFloat(row.grams);
            if (!isNaN(g) && g > 0) {
                const data = ingredients[row.ingredientKey];
                if (data) {
                    b += (data.b * g / 100);
                    f += (data.f * g / 100);
                    u += (data.u * g / 100);
                    k += (data.k * g / 100);
                    weight += g;
                }
            }
        }
    });

    if (weight === 0) {
        return showToast("Введи вес ингредиентов!");
    }

    const mainIng = currentPotRows[0] && currentPotRows[0].ingredientKey ? currentPotRows[0].ingredientKey : 'Кастрюля';
    const name = `${currentPotType === 'green' ? 'Мясная' : 'Молочная'} (${mainIng})`;

    currentPotTotals = { 
        name, 
        weight: Math.round(weight),
        b: Math.round(b), 
        f: Math.round(f), 
        u: Math.round(u), 
        k: Math.round(k) 
    };

    const resDiv = document.getElementById("potResult");
    resDiv.style.display = "block";
    resDiv.innerHTML = `
        <p class="text-success font-bold mb-1">ИТОГО В КАСТРЮЛЕ:</p>
        <p class="text-sm mb-2 font-bold">${currentPotTotals.weight} г | ${currentPotTotals.k} ккал<br>Б:${currentPotTotals.b} Ж:${currentPotTotals.f} У:${currentPotTotals.u}</p>
        <hr class="border-gray mt-2 mb-2">
        <p class="text-xs text-muted mb-2">Сколько грамм ты сейчас съел?</p>
        <div class="flex gap-2">
            <input type="number" id="eatenPotGrams" class="input" placeholder="Напр. 400" style="flex:1">
            <button class="btn btn-outline" style="width: auto;" onclick="eatPotGrams()">ОК</button>
        </div>
    `;
};

window.eatPotGrams = () => {
    if(!currentPotTotals) return;
    const eatenGrams = parseFloat(document.getElementById('eatenPotGrams').value);
    
    if(isNaN(eatenGrams) || eatenGrams <= 0) return showToast("Укажи сколько грамм съел!");
    
    const fraction = eatenGrams / currentPotTotals.weight;
    
    const b = Math.round(currentPotTotals.b * fraction);
    const f = Math.round(currentPotTotals.f * fraction);
    const u = Math.round(currentPotTotals.u * fraction);
    const k = Math.round(currentPotTotals.k * fraction);
    const label = `${currentPotTotals.name} [${eatenGrams}г]`;

    document.getElementById("foodName").value = label;
    document.getElementById("foodB").value = b;
    document.getElementById("foodF").value = f;
    document.getElementById("foodU").value = u;
    document.getElementById("foodKcal").value = k;
    
    showToast(`🍲 Порция ${eatenGrams}г загружена! Нажми 'Записать в итог'.`);
    document.getElementById("potCalculator").style.display = "none";
};
