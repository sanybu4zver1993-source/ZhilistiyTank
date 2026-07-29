
window.renderSupps = () => {
    const container = document.getElementById("suppsContainer");
    if (!container) return;
    
    let html = '';
    const activeSupps = ['omega', 'd3', 'b2', 'c300', 'multi']; // The ones user requested explicitly, plus others if needed. We'll show all from suppLabels for now.
    
    Object.keys(suppLabels).forEach(key => {
        const isChecked = AppState.supps[key];
        const stock = AppState.suppsInventory[key] || 0;
        const warning = stock < 10 ? `<span class="text-danger font-bold text-xs"> (Остаток: ${stock} шт)</span>` : `<span class="text-muted text-xs"> (${stock} шт)</span>`;
        
        html += `
            <div class="card bg-gray flex gap-2 align-center" style="padding: 10px; opacity: ${isChecked ? 0.5 : 1}">
                <input type="checkbox" id="supp_${key}" class="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleSupp('${key}')" style="width: 24px; height: 24px;">
                <label for="supp_${key}" style="flex: 1; margin: 0; cursor: pointer;">${suppLabels[key]} ${warning}</label>
            </div>
        `;
    });
    
    container.innerHTML = html;
};

window.toggleSupp = (key) => {
    const checkbox = document.getElementById(`supp_${key}`);
    const isChecked = checkbox.checked;
    
    AppState.supps[key] = isChecked;
    
    if (isChecked) {
        // Deduct from inventory
        if (AppState.suppsInventory[key] > 0) {
            AppState.suppsInventory[key] -= 1;
        }
        
        if (AppState.suppsInventory[key] < 10) {
            showToast(`⚠️ Заканчивается ${suppLabels[key]}! Осталось ${AppState.suppsInventory[key]} шт.`);
        }
        
        if (window.logEvent) {
            window.logEvent("supps", { name: suppLabels[key], action: "taken" });
        }
    } else {
        // If unchecked, add back to inventory
        AppState.suppsInventory[key] = (AppState.suppsInventory[key] || 0) + 1;
    }
    
    saveUIState();
    renderSupps();
};

window.openSuppsInventoryModal = () => {
    const html = `
        <h3 class="mb-2">📦 Настройка банок</h3>
        <p class="text-sm text-muted mb-2">Введи текущий остаток капсул/таблеток</p>
        <div class="flex-col gap-2" style="max-height: 300px; overflow-y: auto;">
            ${Object.keys(suppLabels).map(key => `
                <div class="input-group">
                    <label class="text-xs">${suppLabels[key]}</label>
                    <input type="number" id="inv_${key}" class="input" value="${AppState.suppsInventory[key] || 0}">
                </div>
            `).join('')}
        </div>
        <button class="btn btn-primary w-100 mt-2" onclick="saveSuppsInventory()">💾 Сохранить остатки</button>
    `;
    
    // We don't have a generic modal function, but there is one. We can just reuse potCalculator or another way to show settings.
    // Wait, let's create a generic modal if it doesn't exist, or just use prompts. 
    // Actually, prompt is annoying for 8 items. Let's create a quick modal overlay in DOM.
    
    let modal = document.getElementById("suppsModal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "suppsModal";
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;";
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="card" style="width: 100%; max-width: 400px; background: #111; border: 1px solid var(--primary);">
            ${html}
            <button class="btn btn-outline btn-danger mt-2 w-100" onclick="document.getElementById('suppsModal').style.display='none'">Отмена</button>
        </div>
    `;
    modal.style.display = 'flex';
};

window.saveSuppsInventory = () => {
    Object.keys(suppLabels).forEach(key => {
        const el = document.getElementById(`inv_${key}`);
        if (el) {
            const val = parseInt(el.value);
            if (!isNaN(val) && val >= 0) {
                AppState.suppsInventory[key] = val;
            }
        }
    });
    saveUIState();
    renderSupps();
    document.getElementById('suppsModal').style.display = 'none';
    showToast("✅ Остатки обновлены!");
};

// Add to load event
const originalInitPharma = window.loadState; // We need to trigger renderSupps on load. We can just run it when switching to module.
