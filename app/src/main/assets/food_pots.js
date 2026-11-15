"use strict";

// База продуктов (КБЖУ на 100г + штучный вес + алиасы)
window.FOOD_CATALOG_BASE = {
    "горох": { b: 20, f: 2, u: 53, k: 290, pieceGrams: 100, aliases: ["гороховый"] },
    "пшеничка": { b: 11, f: 1, u: 67, k: 320, pieceGrams: 100, aliases: ["пшеничная каша"] },
    "перловка": { b: 9, f: 1, u: 73, k: 320, pieceGrams: 100, aliases: ["перловая"] },
    "гречка": { b: 13, f: 3, u: 71, k: 343, pieceGrams: 100, aliases: ["гречневая", "гречка сухая"] },
    "гречка вареная": { b: 4, f: 1, u: 21, k: 110, pieceGrams: 200, aliases: ["вареная гречка", "гречка готовая"] },
    "рис вареный": { b: 2.5, f: 0.3, u: 28, k: 130, pieceGrams: 200, aliases: ["вареный рис", "рис"] },
    "пшенка": { b: 11.5, f: 3.3, u: 66.5, k: 348, pieceGrams: 100, aliases: ["пшено", "пшенная"] },
    "овсянка": { b: 12, f: 6, u: 61, k: 350, pieceGrams: 100, aliases: ["овсяная каша", "каша", "геркулес"] },
    "манка": { b: 10.3, f: 1, u: 73.3, k: 333, pieceGrams: 100, aliases: ["манная"] },
    "чечевица": { b: 24, f: 1.5, u: 46, k: 310, pieceGrams: 100, aliases: [] },
    "курица": { b: 21, f: 6, u: 0, k: 140, pieceGrams: 150, aliases: ["куриная грудка", "филе куриное", "курятина"] },
    "свинина (мякоть)": { b: 16, f: 20, u: 0, k: 244, pieceGrams: 150, aliases: ["свинина"] },
    "свиной язык": { b: 16, f: 16, u: 0, k: 208, pieceGrams: 150, aliases: ["язык"] },
    "печень": { b: 19, f: 6, u: 1, k: 140, pieceGrams: 150, aliases: ["жареная печень", "куриная печень", "свиная печень"] },
    "яйцо": { b: 13, f: 11, u: 1, k: 155, pieceGrams: 55, alwaysPieces: true, aliases: ["яйца", "яйцо куриное"] },
    "творог": { b: 16, f: 5, u: 3, k: 121, pieceGrams: 200, aliases: [] },
    "молоко": { b: 3, f: 2.5, u: 4.7, k: 52, pieceGrams: 250, aliases: [] },
    "сыр": { b: 25, f: 28, u: 0, k: 350, pieceGrams: 30, aliases: [] },
    "батон": { b: 8, f: 3, u: 51, k: 265, pieceGrams: 30, aliases: [] },
    "хлеб": { b: 7, f: 1.5, u: 40, k: 210, pieceGrams: 35, aliases: [] },
    "колбаса": { b: 12, f: 22, u: 1, k: 250, pieceGrams: 40, aliases: [] },
    "овощи": { b: 2, f: 0, u: 6, k: 30, pieceGrams: 150, aliases: ["салат", "огурец", "помидор"] },
    "грибы": { b: 3, f: 0.5, u: 3, k: 27, pieceGrams: 100, aliases: ["шампиньоны"] },
    "изюм": { b: 3, f: 0.5, u: 71, k: 299, pieceGrams: 30, aliases: [] },
    "банан": { b: 1.5, f: 0.1, u: 22, k: 89, pieceGrams: 120, alwaysPieces: true, aliases: [] },
    "яблоко": { b: 0.4, f: 0.4, u: 11, k: 52, pieceGrams: 180, alwaysPieces: true, aliases: [] },
    "орехи": { b: 15, f: 65, u: 7, k: 654, pieceGrams: 30, aliases: ["грецкий орех", "арахис"] },
    "мёд": { b: 0.8, f: 0, u: 81, k: 329, pieceGrams: 20, aliases: ["мед"] },
    "медовая смесь (суперфуд)": { b: 8, f: 15, u: 55, k: 395, pieceGrams: 30, aliases: ["медовая смесь", "суперфуд"] },
    "трутневое молочко": { b: 10, f: 2, u: 5, k: 78, pieceGrams: 10, aliases: ["гомогенат"] },
    "масло": { b: 0.5, f: 82, u: 0.8, k: 748, pieceGrams: 10, aliases: ["сливочное масло", "масло растительное"] }
};

window.getPotIngredients = () => {
    const out = {};
    for (const key in window.FOOD_CATALOG_BASE) {
        out[key] = window.FOOD_CATALOG_BASE[key];
    }
    const custom = AppState.customPotIngredients || {};
    for (const key in custom) {
        out[key] = custom[key];
    }
    return out;
};

// --- Offline Morphological Food Parser ---
const OfflineFoodParser = (() => {
    const UNIT_TO_GRAMS = {
        "г": 1, "гр": 1, "грамм": 1, "грамма": 1, "граммов": 1,
        "кг": 1000, "кило": 1000, "мл": 1, "л": 1000, "литр": 1000,
        "стл": 18, "чл": 5, "скуп": 30, "черпак": 30,
        "порц": null, "шт": null
    };

    const NUM_WORDS = {
        "один": 1, "одна": 1, "одно": 1, "два": 2, "две": 2, "пару": 2, "пара": 2,
        "три": 3, "четыре": 4, "пять": 5, "пол": 0.5, "половина": 0.5, "полтора": 1.5
    };

    const RU_SUFFIX_RE = /(иями|ями|ами|его|ого|ему|ому|ыми|ими|ей|ой|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|ов|ев|ам|ям|ах|ях|ом|ем|ью|ия|ья|ье|а|я|о|е|ы|и|у|ю|ь)$/;

    const STEM_OVERRIDES = {
        "яйца": "яйц", "яиц": "яйц", "яйцо": "яйц",
        "яблоко": "яблок", "яблоки": "яблок", "яблок": "яблок",
        "молоко": "молок", "молока": "молок",
        "масло": "масл", "масла": "масл",
        "мед": "мед", "меда": "мед",
        "печень": "печен", "печени": "печен",
        "каша": "каш", "каши": "каш", "кашу": "каш",
        "филе": "филе"
    };

    const STOP_WORDS = new Set(["с", "со", "из", "в", "на", "по", "без", "для", "от"]);

    function stemWord(word) {
        const w = word.toLowerCase().replace(/ё/g, "е").trim();
        if (STEM_OVERRIDES[w]) return STEM_OVERRIDES[w];
        if (w.length <= 3) return w;
        const stripped = w.replace(RU_SUFFIX_RE, "");
        return stripped.length >= 3 ? stripped : w.slice(0, 3);
    }

    function tokenizeStems(text) {
        return text
            .toLowerCase()
            .replace(/ё/g, "е")
            .replace(/[^a-zа-я0-9\s-]/g, " ")
            .split(/\s+/)
            .filter(t => t.length > 0 && !STOP_WORDS.has(t))
            .map(stemWord);
    }

    function buildCatalogIndex() {
        const catalog = [];
        const base = window.getPotIngredients();
        for (const name in base) {
            const d = base[name];
            catalog.push({
                name,
                b100: d.b, f100: d.f, u100: d.u, k100: d.k,
                pieceGrams: d.pieceGrams || 100,
                alwaysPieces: Boolean(d.alwaysPieces),
                aliases: d.aliases || []
            });
        }
        ["green", "white"].forEach(t => {
            const pot = AppState.activePots && AppState.activePots[t];
            if (pot) {
                catalog.push({
                    name: pot.name,
                    b100: pot.b100, f100: pot.f100, u100: pot.u100, k100: pot.k100,
                    pieceGrams: 300,
                    alwaysPieces: false,
                    aliases: [t === "green" ? "зеленая кастрюля" : "белая кастрюля"]
                });
            }
        });

        return catalog.map(item => ({
            item,
            stemSets: [item.name, ...item.aliases].map(n => tokenizeStems(n))
        }));
    }

    function parseSegment(rawSeg, indexedCatalog) {
        let s = rawSeg.toLowerCase().replace(/ё/g, "е").trim();
        if (!s) return null;

        s = s.replace(/ст\.?\s*лож\w*|ст\.?\s*л\.?/g, " стл ")
            .replace(/ч\.?\s*лож\w*|ч\.?\s*л\.?/g, " чл ");

        let qty = null;
        let unit = null;

        const numUnitRe = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(кг|кило|гр|грамм\w*|г|мл|литр\w*|л|стл|чл|скуп\w*|черпак\w*|порц\w*|шт\w*)?(?=\s|$)/i;
        const match = s.match(numUnitRe);

        if (match) {
            qty = parseFloat(match[1].replace(",", "."));
            if (match[2]) {
                const uRaw = match[2];
                unit = Object.keys(UNIT_TO_GRAMS).find(k => uRaw === k || (k.length >= 2 && uRaw.startsWith(k))) || "шт";
            }
            s = s.replace(match[0], " ");
        } else {
            for (const [word, val] of Object.entries(NUM_WORDS)) {
                const wRe = new RegExp(`(?:^|\\s)${word}(?=\\s|$)`);
                if (wRe.test(s)) { qty = val; s = s.replace(wRe, " "); break; }
            }
        }

        const queryStems = tokenizeStems(s);
        if (queryStems.length === 0) return null;
        const querySet = new Set(queryStems);

        let bestMatch = null;
        let bestScore = 0;

        for (const entry of indexedCatalog) {
            for (const targetStems of entry.stemSets) {
                if (targetStems.length === 0) continue;
                let matchedCount = 0;
                for (const ts of targetStems) {
                    if (querySet.has(ts)) matchedCount++;
                }
                if (matchedCount === 0) continue;

                const targetCoverage = matchedCount / targetStems.length;
                const queryCoverage = matchedCount / querySet.size;
                const score = (targetCoverage * 0.65) + (queryCoverage * 0.35) + (matchedCount * 0.08);

                if (targetCoverage >= 0.5 && score > bestScore) {
                    bestScore = score;
                    bestMatch = entry.item;
                }
            }
        }

        if (!bestMatch) return null;

        let grams;
        const defaultPieceG = bestMatch.pieceGrams || 100;

        if (qty === null) {
            grams = defaultPieceG;
        } else if (!unit || UNIT_TO_GRAMS[unit] === null) {
            if (!unit && qty > 15 && !bestMatch.alwaysPieces) {
                grams = qty;
            } else {
                grams = qty * defaultPieceG;
            }
        } else {
            grams = qty * UNIT_TO_GRAMS[unit];
        }

        const factor = grams / 100;
        return {
            b: bestMatch.b100 * factor,
            f: bestMatch.f100 * factor,
            u: bestMatch.u100 * factor,
            k: bestMatch.k100 * factor
        };
    }

    function parseMealText(input) {
        const indexed = buildCatalogIndex();
        const segments = input.split(/[,;\n+]+|\s+(?:и|плюс|да)\s+/i);
        let totalB = 0, totalF = 0, totalU = 0, totalK = 0, count = 0;
        for (const seg of segments) {
            const res = parseSegment(seg, indexed);
            if (res) {
                totalB += res.b;
                totalF += res.f;
                totalU += res.u;
                totalK += res.k;
                count++;
            }
        }
        return { totalB, totalF, totalU, totalK, count };
    }

    return { parseMealText };
})();

window.autoParseFood = () => {
    const text = (document.getElementById("smartFoodInput").value || "").trim();
    if (!text) return;
    const parsed = OfflineFoodParser.parseMealText(text);
    if (parsed.count > 0) {
        document.getElementById("foodName").value = text.substring(0, 40);
        document.getElementById("foodB").value = Math.round(parsed.totalB);
        document.getElementById("foodF").value = Math.round(parsed.totalF);
        document.getElementById("foodU").value = Math.round(parsed.totalU);
        document.getElementById("foodKcal").value = Math.round(parsed.totalK);
    }
};

// --- Optional Native Speech Recognizer (Zero RECORD_AUDIO manifest permission) ---
window.initVoiceFoodButton = () => {
    const btn = document.getElementById("btnVoiceFood");
    if (!btn) return;
    let supported = false;
    if (window.AndroidBridge && window.AndroidBridge.canUseVoiceInput) {
        try {
            supported = Boolean(window.AndroidBridge.canUseVoiceInput());
        } catch (_) {
            supported = false;
        }
    } else {
        supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    }
    btn.style.display = supported ? "inline-flex" : "none";
};

window.startVoiceFood = () => {
    if (!window.assertVaultUnlocked()) return;
    if (window.AndroidBridge && window.AndroidBridge.startVoiceFoodAsync) {
        window.AndroidBridge.startVoiceFoodAsync("onVoiceFoodResult");
        return;
    }
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
        return showToast("Голосовой ввод недоступен на этом устройстве (используй микрофон клавиатуры)");
    }
    const recognition = new SpeechRec();
    recognition.lang = "ru-RU";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        document.getElementById("smartFoodInput").value = transcript;
        window.autoParseFood();
    };
    recognition.onerror = (event) => showToast("Ошибка голоса: " + event.error);
    recognition.start();
    showToast("🎤 Говори...");
};

window.onVoiceFoodResult = (resStr) => {
    try {
        const res = JSON.parse(resStr);
        if (res.ok && res.text) {
            document.getElementById("smartFoodInput").value = res.text;
            window.autoParseFood();
            showToast("🎤 Распознано");
        }
    } catch (_) {}
};

// --- Native Compressed Food Photo Picker & Camera Capture (1024px RGB_565 JPEG 80%) ---
function ensureVisionKeyReadyOrWarn() {
    if (window.syncApiKeysFromInputs) window.syncApiKeysFromInputs(false);
    const keys = AppState.apiKeys || {};
    if (!keys.visionKey && !keys.trainerKey) {
        showToast("🔑 Сначала вставь Gemini API ключ в ⚙️ Настройки!");
        return false;
    }
    return true;
}

window.takeFoodCameraPhoto = () => {
    if (!window.assertVaultUnlocked()) return;
    if (!ensureVisionKeyReadyOrWarn()) return;
    if (window.AndroidBridge && window.AndroidBridge.takeFoodPhotoAsync) {
        const statusEl = document.getElementById("photoStatusBox") || document.getElementById("foodImageStatus");
        if (statusEl) statusEl.innerHTML = "<span class='text-muted'>📸 Открываю камеру...</span>";
        window.AndroidBridge.takeFoodPhotoAsync("onFoodPhotoPicked");
    } else {
        const inp = document.getElementById("foodVisionInput");
        if (inp) inp.click();
    }
};

window.pickFoodPhoto = () => {
    if (!window.assertVaultUnlocked()) return;
    if (!ensureVisionKeyReadyOrWarn()) return;
    if (window.AndroidBridge && window.AndroidBridge.pickAndCompressFoodPhotoAsync) {
        const statusEl = document.getElementById("photoStatusBox") || document.getElementById("foodImageStatus");
        if (statusEl) statusEl.innerHTML = "<span class='text-muted'>🖼 Выбор и сжатие фото...</span>";
        window.AndroidBridge.pickAndCompressFoodPhotoAsync("onFoodPhotoPicked");
    } else {
        const inp = document.getElementById("foodVisionInput");
        if (inp) inp.click();
    }
};

window.onFoodPhotoPicked = (resStr) => {
    const statusBox = document.getElementById("photoStatusBox");
    const nutritionStatus = document.getElementById("foodImageStatus");
    const setStat = (html) => {
        if (statusBox) statusBox.innerHTML = html;
        if (nutritionStatus) nutritionStatus.innerHTML = html;
    };

    try {
        const res = JSON.parse(resStr);
        if (res.cancelled) {
            setStat("");
            return;
        }
        if (!res.ok || !res.base64) {
            setStat(`<span class="text-danger">❌ ${escapeHtml(res.error || "Ошибка фото")}</span>`);
            return;
        }
        if (window.analyzeFoodImageBase64) {
            window.analyzeFoodImageBase64(res.base64, res.mimeType || "image/jpeg");
        }
    } catch (_) {
        setStat(`<span class="text-danger">❌ Ошибка обработки фото</span>`);
    }
};

window.analyzeFoodImageFallback = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ensureVisionKeyReadyOrWarn()) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = String(e.target.result || "");
        const base64data = dataUrl.split(",")[1];
        if (base64data && window.analyzeFoodImageBase64) {
            window.analyzeFoodImageBase64(base64data, file.type || "image/jpeg");
        }
    };
    reader.readAsDataURL(file);
};

// --- Pot Builder (Мега-Варка) with Event Delegation ---
let currentPotType = "";
let currentPotRows = [];
let potRowCounter = 0;

function bindPotEvents() {
    const container = document.getElementById("potCalculator");
    if (!container || container.dataset.delegated) return;
    container.dataset.delegated = "1";

    container.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;
        const action = btn.dataset.action;
        const type = btn.dataset.potType || currentPotType;

        if (action === "eat-pot") window.eatActivePotGrams(type);
        else if (action === "new-pot") window.startNewPot(type);
        else if (action === "load-recipe") window.loadPotRecipe(type);
        else if (action === "save-recipe") window.savePotRecipe(type);
        else if (action === "remove-row") window.removePotRow(safeParseInt(btn.dataset.rowId, -1));
        else if (action === "add-row") window.addPotRow();
        else if (action === "open-custom-ing") window.openCustomIngredientModal();
        else if (action === "apply-tare") window.applyTareToGross();
        else if (action === "calc-pot") window.calcPot();
    });

    container.addEventListener("change", (e) => {
        const sel = e.target.closest("[data-row-field='ingredientKey']");
        if (sel) {
            window.updatePotRow(safeParseInt(sel.dataset.rowId, -1), "ingredientKey", sel.value);
            return;
        }
        const tareInp = e.target.closest("#potTareWeight");
        if (tareInp) {
            window.updatePotTare(currentPotType, tareInp.value);
        }
    });

    container.addEventListener("input", (e) => {
        const gInp = e.target.closest("[data-row-field='grams']");
        if (gInp) {
            window.updatePotRow(safeParseInt(gInp.dataset.rowId, -1), "grams", gInp.value);
        }
    });
}

window.openPotModal = (type) => {
    bindPotEvents();
    currentPotType = type;
    const container = document.getElementById("potCalculator");
    container.style.display = "block";
    if (AppState.activePots && AppState.activePots[type]) {
        window.renderActivePot(type);
    } else {
        window.startNewPot(type);
    }
};

window.renderActivePot = (type) => {
    bindPotEvents();
    const container = document.getElementById("potCalculator");
    const pot = AppState.activePots[type];
    if (!pot) return window.startNewPot(type);

    container.innerHTML = `
        <h4 class="${type === "green" ? "text-success" : "text-warning"} mb-1 text-center">
            ${type === "green" ? "🟢 Зеленая (3л)" : "🌼 Белая (2л)"} — Активная!
        </h4>
        <div class="card" style="border-color:${type === "green" ? "#2ecc71" : "#f1c40f"};">
            <p class="font-bold mb-1">${escapeHtml(pot.name)}</p>
            <p class="text-sm mb-1">Осталось: <span class="text-primary font-bold">${pot.remainingWeight}</span> г (из ${pot.totalWeight} г)</p>
            <p class="text-xs text-muted mb-2">На 100г: ${Math.round(pot.k100)} ккал | Б:${pot.b100.toFixed(1)} Ж:${pot.f100.toFixed(1)} У:${pot.u100.toFixed(1)}</p>
            <hr class="border-gray">
            <p class="text-xs mb-1 font-bold">Сколько грамм ты сейчас съел?</p>
            <div class="flex gap-2">
                <input type="number" id="eatenPotGramsActive" placeholder="Напр. 300" style="flex:1">
                <button class="btn btn-primary btn-sm" style="width:auto;" data-action="eat-pot" data-pot-type="${escapeHtml(type)}">Съесть</button>
            </div>
            <button class="btn btn-outline btn-sm mt-2 text-danger" data-action="new-pot" data-pot-type="${escapeHtml(type)}">🗑 Сбросить и сварить новую</button>
        </div>
    `;
};

window.startNewPot = (type) => {
    bindPotEvents();
    currentPotType = type;
    currentPotRows = [];
    potRowCounter = 0;
    if (type === "green") {
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "гречка", grams: "" });
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "курица", grams: "" });
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "овощи", grams: "" });
    } else {
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "овсянка", grams: "" });
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "молоко", grams: "" });
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "изюм", grams: "" });
        currentPotRows.push({ id: potRowCounter++, ingredientKey: "банан", grams: "" });
    }
    window.renderPotBuilder();
};

window.addPotRow = (defaultKey = "", defaultGrams = "") => {
    currentPotRows.push({ id: potRowCounter++, ingredientKey: defaultKey, grams: defaultGrams });
    window.renderPotBuilder();
};

window.removePotRow = (id) => {
    currentPotRows = currentPotRows.filter(r => r.id !== id);
    window.renderPotBuilder();
};

window.updatePotRow = (id, field, value) => {
    const row = currentPotRows.find(r => r.id === id);
    if (row) row[field] = value;
};

window.renderPotBuilder = () => {
    bindPotEvents();
    const container = document.getElementById("potCalculator");
    const ingredients = window.getPotIngredients();
    const sortedKeys = Object.keys(ingredients).sort();

    let html = `
        <div class="flex justify-between align-center mb-2">
            <h4 class="${currentPotType === "green" ? "text-success" : "text-warning"}">
                ${currentPotType === "green" ? "🟢 Зеленая (3л)" : "🌼 Белая (2л)"}
            </h4>
            <div class="flex gap-1">
                <button class="btn btn-outline btn-sm" style="width:auto;" data-action="load-recipe" data-pot-type="${escapeHtml(currentPotType)}">📥 Загр.</button>
                <button class="btn btn-outline btn-sm" style="width:auto;" data-action="save-recipe" data-pot-type="${escapeHtml(currentPotType)}">💾 Сохр.</button>
            </div>
        </div>
        <div class="flex-col gap-2 mb-2">
    `;

    currentPotRows.forEach(row => {
        const options = sortedKeys.map(k =>
            `<option value="${escapeHtml(k)}" ${row.ingredientKey === k ? "selected" : ""}>${escapeHtml(k.charAt(0).toUpperCase() + k.slice(1))}</option>`
        ).join("");
        html += `
            <div class="flex gap-1 align-center">
                <select style="flex:2" data-row-id="${row.id}" data-row-field="ingredientKey">
                    <option value="" disabled ${!row.ingredientKey ? "selected" : ""}>Выбери...</option>
                    ${options}
                </select>
                <input type="number" style="flex:1" placeholder="г (сырой)" value="${escapeHtml(row.grams)}" data-row-id="${row.id}" data-row-field="grams">
                <button class="btn btn-danger btn-sm" style="width:auto;" data-action="remove-row" data-row-id="${row.id}">✖</button>
            </div>
        `;
    });

    html += `
        </div>
        <div class="grid-2 gap-2 mb-2">
            <button class="btn btn-outline btn-sm" data-action="add-row">+ Ингредиент</button>
            <button class="btn btn-outline btn-sm" data-action="open-custom-ing">⚙️ Свой продукт</button>
        </div>
        <div class="card mb-2" style="border-style:dashed; padding:10px;">
            <p class="text-xs font-bold text-center mb-1">⚖️ Взвешивание готовой кастрюли</p>
            <div class="grid-2 gap-2 mb-2">
                <div class="input-group">
                    <label>Пустая тара (г)</label>
                    <input type="number" id="potTareWeight" value="${(AppState.potTare && AppState.potTare[currentPotType]) || 0}">
                </div>
                <div class="input-group">
                    <label>Вес с едой (г)</label>
                    <div class="flex gap-1">
                        <input type="number" id="potGrossWeight" placeholder="2500" style="flex:1">
                        <button class="btn btn-outline btn-sm" style="width:auto;" data-action="apply-tare">- Тара</button>
                    </div>
                </div>
            </div>
            <div class="input-group">
                <label class="text-primary">ЧИСТЫЙ вес готовой еды (г)</label>
                <input type="number" id="potNetWeight" placeholder="Если пусто — возьмётся сырой вес">
            </div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="calc-pot">🔥 Сварить кастрюлю</button>
    `;
    container.innerHTML = html;
};

window.updatePotTare = (type, val) => {
    if (!window.assertVaultUnlocked()) return;
    const v = safeParseInt(val, 0);
    if (v >= 0) {
        AppState.potTare[type] = v;
        saveUIState();
    }
};

window.applyTareToGross = () => {
    const gross = parseFloat(document.getElementById("potGrossWeight").value);
    const tare = AppState.potTare[currentPotType] || 0;
    if (!isNaN(gross) && gross > tare) {
        document.getElementById("potNetWeight").value = Math.round(gross - tare);
        showToast("Тара вычтена!");
    } else {
        showToast("Вес с едой должен быть больше тары!");
    }
};

window.savePotRecipe = (type) => {
    if (!window.assertVaultUnlocked()) return;
    const validRows = currentPotRows.filter(r => r.ingredientKey && r.grams);
    if (validRows.length === 0) return showToast("Нет ингредиентов для сохранения!");
    AppState.potRecipes[type] = validRows.map(r => ({ k: r.ingredientKey, g: r.grams }));
    saveUIState();
    showToast("💾 Рецепт сохранён!");
};

window.loadPotRecipe = (type) => {
    const rec = AppState.potRecipes && AppState.potRecipes[type];
    if (!rec || rec.length === 0) return showToast("Нет сохранённого рецепта!");
    currentPotRows = [];
    potRowCounter = 0;
    rec.forEach(r => currentPotRows.push({ id: potRowCounter++, ingredientKey: r.k, grams: r.g }));
    window.renderPotBuilder();
    showToast("📥 Рецепт загружен!");
};

window.openCustomIngredientModal = () => {
    if (!window.assertVaultUnlocked()) return;
    window.openAppModal("⚙️ Новый продукт в базу", `
        <div class="flex-col gap-2">
            <input type="text" id="custIngName" placeholder="Название (напр: Индейка)">
            <div class="grid-2 gap-2">
                <input type="number" id="custIngK" placeholder="Ккал / 100г">
                <input type="number" id="custIngB" placeholder="Белки / 100г">
            </div>
            <div class="grid-2 gap-2">
                <input type="number" id="custIngF" placeholder="Жиры / 100г">
                <input type="number" id="custIngU" placeholder="Углеводы / 100г">
            </div>
            <button class="btn btn-success mt-1" onclick="saveCustomIngredientFromModal()">Сохранить продукт</button>
        </div>
    `);
};

window.saveCustomIngredientFromModal = () => {
    if (!window.assertVaultUnlocked()) return;
    const name = (document.getElementById("custIngName").value || "").trim().toLowerCase();
    const k = parseFloat(document.getElementById("custIngK").value);
    const b = parseFloat(document.getElementById("custIngB").value);
    const f = parseFloat(document.getElementById("custIngF").value);
    const u = parseFloat(document.getElementById("custIngU").value);
    if (!name || isNaN(k) || isNaN(b) || isNaN(f) || isNaN(u)) {
        return showToast("❌ Заполни все поля корректно");
    }
    AppState.customPotIngredients[name] = { b, f, u, k, pieceGrams: 100, aliases: [] };
    saveUIState();
    window.closeAppModal();
    window.renderPotBuilder();
    showToast(`✅ Добавлен продукт: ${name}`);
};

window.calcPot = () => {
    if (!window.assertVaultUnlocked()) return;
    let b = 0, f = 0, u = 0, k = 0, rawWeight = 0;
    const ingredients = window.getPotIngredients();

    currentPotRows.forEach(row => {
        const g = parseFloat(row.grams);
        if (row.ingredientKey && !isNaN(g) && g > 0 && ingredients[row.ingredientKey]) {
            const data = ingredients[row.ingredientKey];
            b += (data.b * g / 100);
            f += (data.f * g / 100);
            u += (data.u * g / 100);
            k += (data.k * g / 100);
            rawWeight += g;
        }
    });

    if (rawWeight === 0) return showToast("Введи сырой вес ингредиентов!");

    let finalWeight = rawWeight;
    const netVal = parseFloat(document.getElementById("potNetWeight").value);
    if (!isNaN(netVal) && netVal > 0) finalWeight = netVal;
    if (!Number.isFinite(finalWeight) || finalWeight < 10) {
        return showToast("Вес готовой кастрюли должен быть не менее 10 г!");
    }

    const mainIng = currentPotRows[0]?.ingredientKey || "Кастрюля";
    const name = `${currentPotType === "green" ? "Мясная" : "Молочная"} (${mainIng.charAt(0).toUpperCase() + mainIng.slice(1)})`;

    const potData = {
        batchId: "BATCH_" + Date.now().toString(36).toUpperCase(),
        name,
        totalWeight: Math.round(finalWeight),
        remainingWeight: Math.round(finalWeight),
        k100: (k / finalWeight) * 100,
        b100: (b / finalWeight) * 100,
        f100: (f / finalWeight) * 100,
        u100: (u / finalWeight) * 100
    };

    AppState.activePots[currentPotType] = potData;
    window.logEvent("pot_batch_created", potData);
    saveUIState();
    showToast(`✅ Кастрюля сварена (${potData.totalWeight} г)!`);
    window.renderActivePot(currentPotType);
};

window.eatActivePotGrams = (type) => {
    if (!window.assertVaultUnlocked()) return;
    const pot = AppState.activePots[type];
    if (!pot) return;
    const eaten = parseFloat(document.getElementById("eatenPotGramsActive").value);
    if (isNaN(eaten) || eaten <= 0) return showToast("Укажи сколько съел!");
    if (eaten > pot.remainingWeight) return showToast(`В кастрюле осталось только ${pot.remainingWeight} г!`);

    const k = Math.round((pot.k100 * eaten) / 100);
    const b = Math.round((pot.b100 * eaten) / 100);
    const f = Math.round((pot.f100 * eaten) / 100);
    const u = Math.round((pot.u100 * eaten) / 100);
    const label = `${pot.name} [${eaten}г]`;

    AppState.food.totalB += b;
    AppState.food.totalF += f;
    AppState.food.totalU += u;
    AppState.food.totalKcal += k;
    AppState.todayFoodItems.push({ name: label, b, f, u, k, time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) });

    pot.remainingWeight = Math.round(pot.remainingWeight - eaten);
    window.logEvent("food", { name: label, B: b, F: f, U: u, Kcal: k, type: "batch_portion_eaten", remaining: pot.remainingWeight });

    if (pot.remainingWeight <= 0) {
        AppState.activePots[type] = null;
        document.getElementById("potCalculator").style.display = "none";
        showToast(`✅ Съедено ${eaten}г! Кастрюля доедена.`);
    } else {
        window.renderActivePot(type);
        showToast(`✅ +${k} ккал. Осталось в кастрюле: ${pot.remainingWeight}г`);
    }
    window.updateFoodUI();
    saveUIState();
};

document.addEventListener("DOMContentLoaded", () => {
    bindPotEvents();
    window.initVoiceFoodButton();
});
