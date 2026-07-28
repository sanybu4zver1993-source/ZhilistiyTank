"use strict";

const safeParseInt = (val, fallback = 0) => {
    const res = parseInt(val, 10);
    return isNaN(res) ? fallback : res;
};

// --- State Core ---
const AppState = {
    food: { totalB: 0, totalF: 0, totalU: 0 },
    logs: [] 
};

// --- Module Navigation ---
window.showModule = (id) => {
    document.querySelectorAll('.module').forEach(el => el.classList.remove('active'));
    document.getElementById(`module-${id}`).classList.add('active');
};

// ==========================================
// 1. УМНЫЙ ВВОД КБЖУ (Smart NLP Parser)
// ==========================================
// Локальная база (Граммовки на 100г продукта)
const foodDB = {
    "гречк": { b: 12, f: 3, u: 68 }, 
    "яйц": { b: 13, f: 11, u: 1, unit: 50 }, // 1 шт = ~50г
    "колбас": { b: 12, f: 20, u: 2 },
    "пшенк": { b: 11, f: 3, u: 73 },
    "печен": { b: 19, f: 4, u: 0 },
    "куриц": { b: 23, f: 2, u: 0 },
    "банан": { b: 1.5, f: 0.1, u: 22, unit: 120 }
};

window.parseFoodString = () => {
    const text = document.getElementById("smartFoodInput").value.toLowerCase();
    let outB = 0, outF = 0, outU = 0;
    let parsedItems = [];

    // Ищем паттерны: "150г гречки", "2 шт яйца", "100 грамм колбасы"
    const regex = /(\d+)\s*(г|грамм|шт)?\s*([а-я]+)/g;
    let match;
    let foundSomething = false;

    while ((match = regex.exec(text)) !== null) {
        let amount = parseInt(match[1]);
        let unit = match[2] || "г"; 
        let name = match[3];

        // Поиск ключа в базе
        let dbKey = Object.keys(foodDB).find(k => name.includes(k));
        if (dbKey) {
            foundSomething = true;
            let item = foodDB[dbKey];
            // Конвертация штук в граммы, если указано
            let weight = (unit === "шт" && item.unit) ? amount * item.unit : amount;
            
            let b = (item.b * weight / 100);
            let f = (item.f * weight / 100);
            let u = (item.u * weight / 100);
            
            outB += b; outF += f; outU += u;
            parsedItems.push(`${name} (${weight}г)`);
        }
    }

    const resDiv = document.getElementById("smartParseResult");
    resDiv.style.display = "block";

    if (foundSomething) {
        resDiv.innerHTML = `<span class="text-success">Распознано:</span> ${parsedItems.join(", ")}<br>
                            <b>Б:</b> ${outB.toFixed(1)} <b>Ж:</b> ${outF.toFixed(1)} <b>У:</b> ${outU.toFixed(1)}`;
        window.tempSmartData = { b: outB, f: outF, u: outU, text };
        document.getElementById("btnSaveSmartFood").style.display = "block";
    } else {
        resDiv.innerHTML = "<span class="text-danger">Не удалось распознать продукты.</span><br>Попробуй формат: '150г гречки, 2 шт яйца'";
        document.getElementById("btnSaveSmartFood").style.display = "none";
    }
};

window.commitSmartFood = () => {
    if(!window.tempSmartData) return;
    AppState.food.totalB += window.tempSmartData.b;
    AppState.food.totalF += window.tempSmartData.f;
    AppState.food.totalU += window.tempSmartData.u;
    
    updateFoodUI();
    AppState.logs.push({type: "food", data: window.tempSmartData.text, time: Date.now()});
    
    document.getElementById("smartFoodInput").value = "";
    document.getElementById("smartParseResult").style.display = "none";
    document.getElementById("btnSaveSmartFood").style.display = "none";
    window.tempSmartData = null;
};

window.applyTemplate = (name) => {
    let str = "";
    if(name === 'Завтрак Танка') str = "2 шт яйца, 150г пшенки";
    if(name === 'Ужин Танка') str = "200г печень, 100г гречки";
    document.getElementById("smartFoodInput").value = str;
    window.parseFoodString();
};

window.resetBJU = () => { AppState.food = { totalB: 0, totalF: 0, totalU: 0 }; updateFoodUI(); };

function updateFoodUI() {
    document.getElementById("totalB").innerText = Math.round(AppState.food.totalB);
    document.getElementById("totalF").innerText = Math.round(AppState.food.totalF);
    document.getElementById("totalU").innerText = Math.round(AppState.food.totalU);
}

// ==========================================
// 2. ИНТЕРАКТИВНЫЙ WORKOUT ENGINE (Iso-Timer)
// ==========================================
let isoTimer;
window.startIsoTimer = (seconds) => {
    stopIsoTimer();
    const display = document.getElementById("isoTimerDisplay");
    let time = seconds;
    
    // Вбрация на старт
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    
    display.style.backgroundColor = "var(--danger)";
    display.innerText = `УДЕРЖАНИЕ: ${time}с`;

    isoTimer = setInterval(() => {
        time--;
        display.innerText = `УДЕРЖАНИЕ: ${time}с`;
        if (time <= 0) {
            stopIsoTimer();
            display.style.backgroundColor = "var(--success)";
            display.innerText = "ОТДЫХ!";
            if (navigator.vibrate) navigator.vibrate([500]); // Длинная вибрация на отпускание
        }
    }, 1000);
};

window.stopIsoTimer = () => {
    if (isoTimer) clearInterval(isoTimer);
    document.getElementById("isoTimerDisplay").innerText = "ОСТАНОВЛЕНО";
    document.getElementById("isoTimerDisplay").style.backgroundColor = "var(--nav-bg)";
};

let currentReps = 0;
window.addRep = () => {
    currentReps++;
    if(currentReps > 3) currentReps = 0;
    document.getElementById("repCounter").innerText = `${currentReps} / 3`;
    if(navigator.vibrate) navigator.vibrate(50);
};

// ==========================================
// 3. SOS: АНИМАЦИЯ ФИЗИОЛОГИЧЕСКОГО ВЗДОХА
// ==========================================
let sighInterval;
window.startSighAnimation = () => {
    stopSighAnimation();
    const circle = document.getElementById("breathSighCircle");
    
    const cycle = () => {
        // Вдох 1
        circle.className = "breathing-animator anim-inhale-1";
        circle.innerText = "ВДОХ";
        if(navigator.vibrate) navigator.vibrate(100);
        
        setTimeout(() => {
            // Вдох 2 (добор)
            circle.className = "breathing-animator anim-inhale-2";
            circle.innerText = "ДОБОР!";
            if(navigator.vibrate) navigator.vibrate(150);
            
            setTimeout(() => {
                // Выдох
                circle.className = "breathing-animator anim-exhale";
                circle.innerText = "ВЫДОХ";
                
                setTimeout(cycle, 4000); // Повтор через 4 секунды выдоха
            }, 1000); // Добор длится 1 сек
        }, 1500); // 1й вдох длится 1.5 сек
    };
    cycle();
};

window.stopSighAnimation = () => {
    if (sighInterval) clearTimeout(sighInterval);
    // Это просто сбросит все таймауты грубо, но для PoC сойдет.
    // Лучше очищать таймауты по id, но перепишем в след. итерации если надо.
    let id = window.setTimeout(function() {}, 0);
    while (id--) window.clearTimeout(id); 
    
    const circle = document.getElementById("breathSighCircle");
    circle.className = "breathing-animator";
    circle.innerText = "ВЗДОХ";
};

let nsdrTimer;
window.startNSDR = () => {
    if(nsdrTimer) clearInterval(nsdrTimer);
    let time = 15 * 60; // 15 min
    const display = document.getElementById("nsdrDisplay");
    display.style.display = "block";
    
    nsdrTimer = setInterval(() => {
        let m = Math.floor(time / 60).toString().padStart(2, '0');
        let s = (time % 60).toString().padStart(2, '0');
        display.innerText = `${m}:${s}`;
        time--;
        if(time < 0) {
            clearInterval(nsdrTimer);
            display.innerText = "СЕАНС ЗАВЕРШЕН";
            if(navigator.vibrate) navigator.vibrate([1000, 500, 1000]);
        }
    }, 1000);
};

// ==========================================
// 4. МЕТЕО БЕЗ GPS (Open-Meteo API)
// ==========================================
window.fetchWeather = async () => {
    const city = document.getElementById("cityInput").value || "Чернигов";
    const res = document.getElementById("weatherResult");
    res.style.display = "block";
    res.innerText = "Запрашиваю API...";

    try {
        // Получаем координаты города (GeoCoding API)
        const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru`);
        const geoData = await geoResp.json();
        
        if(!geoData.results || geoData.results.length === 0) {
            res.innerText = `❌ Город ${city} не найден.`;
            return;
        }
        
        const lat = geoData.results[0].latitude;
        const lon = geoData.results[0].longitude;

        // Получаем погоду (Weather API)
        const wResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=surface_pressure`);
        const wData = await wResp.json();
        
        const temp = wData.current_weather.temperature;
        const wind = wData.current_weather.windspeed;
        const pressurehPa = wData.hourly.surface_pressure[0]; 
        const pressureMmHg = Math.round(pressurehPa * 0.75006); // hPa -> мм рт. ст.

        res.innerHTML = `📍 ${city}:<br>🌡 Температура: ${temp}°C<br>💨 Ветер: ${wind} км/ч<br>⚖️ Давление: ${pressureMmHg} мм рт.ст.`;
        document.getElementById("weatherStatus").innerText = `🌤 ${city}: ${temp}°C`;
        
    } catch(e) {
        res.innerText = "⚠️ Ошибка сети. Проверьте интернет.";
    }
};

// ==========================================
// 5. ЭКСПОРТ В .TXT (UTF-8 BOM, Укр)
// ==========================================
window.exportToTxt = () => {
    let txt = "ЗВІТ ДЛЯ ЛІКАРЯ (МЕДИЧНА ВИПИСКА)\n=================================\n\n";
    txt += `Дата формування: ${new Date().toLocaleString("uk-UA")}\n\n`;
    
    txt += "📊 ЗЖИВАННЯ БЖУ (ОСТАННІ ДАНІ):\n";
    txt += `- Білки: ${Math.round(AppState.food.totalB)} г\n`;
    txt += `- Жири: ${Math.round(AppState.food.totalF)} г\n`;
    txt += `- Вуглеводи: ${Math.round(AppState.food.totalU)} г\n\n`;
    
    txt += "📝 ЛОГ ПОДІЙ:\n";
    if(AppState.logs.length === 0) txt += "Немає записів.\n";
    
    AppState.logs.forEach(log => {
        txt += `[${new Date(log.time).toLocaleTimeString("uk-UA")}] ТИП: ${log.type} | Дані: ${log.data}\n`;
    });

    // Добавляем BOM (Byte Order Mark) чтобы блокноты Windows 100% читали UTF-8
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `Медичний_Звіт_Танк_${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};
