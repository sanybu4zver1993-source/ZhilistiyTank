window.openPotModal = (type) => {
    currentPotType = type;
    const container = document.getElementById("potCalculator");
    container.style.display = "block";
    
    if (AppState.activePots && AppState.activePots[type]) {
        renderActivePot(type);
    } else {
        startNewPot(type);
    }
};

window.renderActivePot = (type) => {
    const container = document.getElementById("potCalculator");
    const pot = AppState.activePots[type];
    
    let html = `
        <h4 class="${type === 'green' ? 'text-success' : 'text-warning'} mb-2 text-center">
            ${type === 'green' ? '🟢 Зеленая (3л)' : '🌼 Белая (2л)'} — Активная!
        </h4>
        <div class="card" style="background: #222; border: 1px solid ${type === 'green' ? '#2ecc71' : '#f1c40f'};">
            <p class="font-bold mb-1">${pot.name}</p>
            <p class="text-sm mb-1">Осталось: <span class="text-primary font-bold" style="font-size: 1.1rem">${pot.remainingWeight}</span> г (из ${pot.totalWeight} г)</p>
            <p class="text-xs text-muted mb-2">На 100г: ${Math.round(pot.k100)} ккал | Б:${pot.b100.toFixed(1)} Ж:${pot.f100.toFixed(1)} У:${pot.u100.toFixed(1)}</p>
            
            <hr class="border-gray mt-2 mb-2">
            <p class="text-xs mb-2 font-bold">Сколько грамм ты сейчас съел?</p>
            <div class="flex gap-2">
                <input type="number" id="eatenPotGramsActive" class="input" placeholder="Напр. 300" style="flex:1">
                <button class="btn btn-primary" style="width: auto;" onclick="eatActivePotGrams('${type}')">Съесть</button>
            </div>
            
            <button class="btn btn-outline btn-danger mt-2 w-100 text-sm" onclick="startNewPot('${type}')">🗑 Сбросить и сварить новую</button>
        </div>
    `;
    container.innerHTML = html;
};

window.startNewPot = (type) => {
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
            ${currentPotType === 'green' ? '🟢 Зеленая (3л) Мясная' : '🌼 Белая (2л) Молочная'} — Новая Варка
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
        <button class="btn btn-primary w-100 mt-2" onclick="calcPot()">🔥 Сварить Кастрюлю (Сохранить)</button>
    `;
    
    container.innerHTML = html;
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
    const name = `${currentPotType === 'green' ? 'Мясная' : 'Молочная'} (${mainIng.charAt(0).toUpperCase() + mainIng.slice(1)})`;

    // Calculate per 100g
    const k100 = (k / weight) * 100;
    const b100 = (b / weight) * 100;
    const f100 = (f / weight) * 100;
    const u100 = (u / weight) * 100;

    const potData = {
        name,
        totalWeight: Math.round(weight),
        remainingWeight: Math.round(weight),
        k100, b100, f100, u100
    };

    if (!AppState.activePots) AppState.activePots = { green: null, white: null };
    AppState.activePots[currentPotType] = potData;
    saveUIState();
    
    showToast("✅ Кастрюля сварена и сохранена!");
    renderActivePot(currentPotType);
};

window.eatActivePotGrams = (type) => {
    const pot = AppState.activePots[type];
    if (!pot) return;
    
    const input = document.getElementById('eatenPotGramsActive');
    const eaten = parseFloat(input.value);
    
    if (isNaN(eaten) || eaten <= 0) return showToast("Укажи сколько съел!");
    if (eaten > pot.remainingWeight) return showToast(`В кастрюле осталось только ${pot.remainingWeight} г!`);
    
    // Calculate macros for eaten portion
    const k = Math.round((pot.k100 * eaten) / 100);
    const b = Math.round((pot.b100 * eaten) / 100);
    const f = Math.round((pot.f100 * eaten) / 100);
    const u = Math.round((pot.u100 * eaten) / 100);
    
    const label = `${pot.name} [${eaten}г]`;

    document.getElementById("foodName").value = label;
    document.getElementById("foodB").value = b;
    document.getElementById("foodF").value = f;
    document.getElementById("foodU").value = u;
    document.getElementById("foodKcal").value = k;
    
    // Deduct from remaining
    pot.remainingWeight -= eaten;
    if (pot.remainingWeight <= 0) {
        AppState.activePots[type] = null;
        showToast("🍲 Кастрюля пуста! Порция загружена.");
        document.getElementById("potCalculator").style.display = "none";
    } else {
        showToast(`🍲 Порция ${eaten}г загружена! Осталось ${pot.remainingWeight} г.`);
        renderActivePot(type);
    }
    
    saveUIState();
};
