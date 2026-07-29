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
