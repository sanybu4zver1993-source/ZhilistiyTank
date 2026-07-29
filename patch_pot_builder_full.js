window.renderPotBuilder = () => {
    const container = document.getElementById("potCalculator");
    const ingredients = getPotIngredients();
    const sortedKeys = Object.keys(ingredients).sort();
    
    // Ensure tare is initialized
    if (!AppState.potTare) AppState.potTare = { green: 0, white: 0 };
    if (!AppState.potRecipes) AppState.potRecipes = { green: null, white: null };
    
    let html = `
        <h4 class="${currentPotType === 'green' ? 'text-success' : 'text-warning'} mb-2 text-center flex align-center justify-center gap-2">
            ${currentPotType === 'green' ? '🟢 Зеленая (3л)' : '🌼 Белая (2л)'} — Новая Варка
            <button class="btn btn-outline text-xs" style="padding: 2px 5px;" onclick="loadPotRecipe('${currentPotType}')">📥 Загрузить</button>
            <button class="btn btn-outline text-xs" style="padding: 2px 5px;" onclick="savePotRecipe('${currentPotType}')">💾 Сохр</button>
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
                <input type="number" class="input" style="flex: 1" placeholder="Сырой вес (г)" value="${row.grams}" oninput="updatePotRow(${row.id}, 'grams', this.value)">
                <button class="btn btn-danger text-sm" style="width:auto; padding: 0 10px;" onclick="removePotRow(${row.id})">✖</button>
            </div>
        `;
    });
    
    html += `
        </div>
        <div class="grid-2 gap-2 mt-2 mb-2">
            <button class="btn btn-outline text-sm" onclick="addPotRow()">+ Ингредиент</button>
            <button class="btn btn-outline text-sm" onclick="openCustomIngredientModal()">⚙️ Свой Продукт</button>
        </div>
        
        <div class="card" style="background: #2a2a2a; border: 1px dashed gray; padding: 10px;">
            <p class="text-sm font-bold text-center mb-1">⚖️ Взвешивание готовой кастрюли</p>
            <div class="grid-2 gap-2 mb-2">
                <div class="input-group">
                    <label class="text-xs">Вес пустой тары (г)</label>
                    <input type="number" id="potTareWeight" class="input" value="${AppState.potTare[currentPotType] || 0}" oninput="updatePotTare('${currentPotType}', this.value)">
                </div>
                <div class="input-group">
                    <label class="text-xs">Вес с едой (г)</label>
                    <div class="flex gap-1">
                        <input type="number" id="potGrossWeight" class="input" placeholder="Напр. 2500" style="flex: 1">
                        <button class="btn btn-outline" style="width: auto; padding: 0 10px;" onclick="applyTareToGross()">- Тара</button>
                    </div>
                </div>
            </div>
            <div class="input-group">
                <label class="text-xs text-primary">Итоговый ЧИСТЫЙ вес готовой еды (г)</label>
                <input type="number" id="potNetWeight" class="input" placeholder="Вес без тары">
            </div>
        </div>
        
        <button class="btn btn-primary w-100 mt-2" onclick="calcPot()">🔥 Сварить Кастрюлю (Сохранить)</button>
    `;
    
    container.innerHTML = html;
};

window.updatePotTare = (type, val) => {
    const v = parseInt(val);
    if (!isNaN(v) && v >= 0) {
        if (!AppState.potTare) AppState.potTare = { green: 0, white: 0 };
        AppState.potTare[type] = v;
        saveUIState();
    }
};

window.applyTareToGross = () => {
    const gross = parseFloat(document.getElementById("potGrossWeight").value);
    const tare = AppState.potTare[currentPotType] || 0;
    if (!isNaN(gross) && gross > 0) {
        const net = gross - tare;
        if (net > 0) {
            document.getElementById("potNetWeight").value = net;
            showToast("Тара вычтена!");
        } else {
            showToast("Вес с едой должен быть больше тары!");
        }
    } else {
        showToast("Укажи вес кастрюли с едой!");
    }
};

window.savePotRecipe = (type) => {
    if (!AppState.potRecipes) AppState.potRecipes = { green: null, white: null };
    const validRows = currentPotRows.filter(r => r.ingredientKey && r.grams);
    if (validRows.length === 0) return showToast("Нет ингредиентов для сохранения!");
    
    AppState.potRecipes[type] = validRows.map(r => ({ k: r.ingredientKey, g: r.grams }));
    saveUIState();
    showToast("💾 Рецепт сохранен!");
};

window.loadPotRecipe = (type) => {
    if (!AppState.potRecipes || !AppState.potRecipes[type] || AppState.potRecipes[type].length === 0) {
        return showToast("Нет сохраненного рецепта!");
    }
    
    currentPotRows = [];
    potRowCounter = 0;
    AppState.potRecipes[type].forEach(r => {
        addPotRow(r.k, r.g);
    });
    showToast("📥 Рецепт загружен!");
};

