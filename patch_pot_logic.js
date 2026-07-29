
const potIngredients = {
    'горох': { b: 20, f: 2, u: 53, k: 290 },
    'пшеничка': { b: 11, f: 1, u: 67, k: 320 },
    'перловка': { b: 9, f: 1, u: 73, k: 320 },
    'гречка': { b: 13, f: 3, u: 71, k: 343 },
    'курица': { b: 18, f: 10, u: 0, k: 170 },
    'печень': { b: 19, f: 6, u: 1, k: 140 },
    'овощи': { b: 2, f: 0, u: 6, k: 30 },
    'овсянка': { b: 12, f: 6, u: 61, k: 350 },
    'молоко': { b: 3, f: 2.5, u: 4.7, k: 52 },
    'изюм': { b: 3, f: 0.5, u: 71, k: 299 },
    'банан': { b: 1.5, f: 0.1, u: 22, k: 89 },
    'орехи': { b: 15, f: 65, u: 7, k: 654 },
    'яблоко': { b: 0.4, f: 0.4, u: 11, k: 52 }
};

let currentPotTotals = null;

window.openPotModal = (type) => {
    const container = document.getElementById("potCalculator");
    container.style.display = "block";
    let html = "";
    if (type === 'green') {
        html = `
            <h4 class="text-success mb-2 text-center">🟢 Зеленая (3л) Мясная</h4>
            <div class="grid-2 gap-2 mb-2">
                <div>
                    <label class="text-sm">Крупа</label>
                    <select id="potBase" class="input" style="width:100%">
                        <option value="горох">Горох</option>
                        <option value="пшеничка">Пшеничка</option>
                        <option value="перловка">Перловка</option>
                        <option value="гречка">Гречка</option>
                    </select>
                </div>
                <div><label class="text-sm">Грамм (сухой)</label><input type="number" id="potBaseG" class="input" placeholder="Напр. 500" style="width:100%"></div>
            </div>
            <div class="grid-2 gap-2 mb-2">
                <div>
                    <label class="text-sm">Мясо</label>
                    <select id="potMeat" class="input" style="width:100%">
                        <option value="курица">Куриный набор</option>
                        <option value="печень">Печень</option>
                    </select>
                </div>
                <div><label class="text-sm">Грамм (сырого)</label><input type="number" id="potMeatG" class="input" placeholder="Напр. 400" style="width:100%"></div>
            </div>
            <div class="grid-2 gap-2 mb-2">
                <div>
                    <label class="text-sm">Овощи (лук, морковь)</label>
                    <input type="text" class="input" value="Микс" disabled style="width:100%; opacity:0.6;">
                </div>
                <div><label class="text-sm">Грамм</label><input type="number" id="potVegG" class="input" placeholder="Напр. 150" style="width:100%"></div>
            </div>
            <button class="btn btn-primary w-100 mt-2" onclick="calcPot('green')">🔥 Рассчитать Кастрюлю</button>
        `;
    } else {
        html = `
            <h4 class="text-warning mb-2 text-center">🌼 Белая (2л) Молочная</h4>
            <div class="grid-2 gap-2 mb-2">
                <div><label class="text-sm">Овсянка (г)</label><input type="number" id="potOatG" class="input" placeholder="200" style="width:100%"></div>
                <div><label class="text-sm">Молоко (мл)</label><input type="number" id="potMilkMl" class="input" value="700" style="width:100%"></div>
                <div><label class="text-sm">Изюм (г)</label><input type="number" id="potRaisinG" class="input" placeholder="50" style="width:100%"></div>
                <div><label class="text-sm">Банан (г)</label><input type="number" id="potBananaG" class="input" placeholder="240" style="width:100%"></div>
                <div><label class="text-sm">Орехи (г)</label><input type="number" id="potNutG" class="input" placeholder="0" style="width:100%"></div>
                <div><label class="text-sm">Яблоки (г)</label><input type="number" id="potAppleG" class="input" placeholder="0" style="width:100%"></div>
            </div>
            <button class="btn btn-primary w-100 mt-2" onclick="calcPot('white')">🔥 Рассчитать Кастрюлю</button>
        `;
    }
    
    html += `<div id="potResult" class="mt-2 text-center" style="display:none; border: 1px dashed var(--primary); padding: 10px; border-radius: 8px;"></div>`;
    container.innerHTML = html;
};

window.calcPot = (type) => {
    let b = 0, f = 0, u = 0, k = 0;
    let name = "";
    
    const addIngredient = (id, key) => {
        const el = document.getElementById(id);
        if(el && el.value) {
            const g = parseFloat(el.value);
            const data = potIngredients[key];
            b += (data.b * g / 100);
            f += (data.f * g / 100);
            u += (data.u * g / 100);
            k += (data.k * g / 100);
        }
    };

    if (type === 'green') {
        const baseKey = document.getElementById("potBase").value;
        const meatKey = document.getElementById("potMeat").value;
        addIngredient("potBaseG", baseKey);
        addIngredient("potMeatG", meatKey);
        addIngredient("potVegG", "овощи");
        name = `Мясная 3л (${baseKey}+${meatKey})`;
    } else {
        addIngredient("potOatG", "овсянка");
        addIngredient("potMilkMl", "молоко");
        addIngredient("potRaisinG", "изюм");
        addIngredient("potBananaG", "банан");
        addIngredient("potNutG", "орехи");
        addIngredient("potAppleG", "яблоко");
        name = `Молочная 2л (Овсянка)`;
    }

    currentPotTotals = { name, b: Math.round(b), f: Math.round(f), u: Math.round(u), k: Math.round(k) };

    const resDiv = document.getElementById("potResult");
    resDiv.style.display = "block";
    resDiv.innerHTML = `
        <p class="text-success font-bold mb-1">ИТОГО В КАСТРЮЛЕ:</p>
        <p class="text-sm mb-2 font-bold">${currentPotTotals.k} ккал (Б:${currentPotTotals.b} Ж:${currentPotTotals.f} У:${currentPotTotals.u})</p>
        <p class="text-xs text-muted mb-2">Какую часть кастрюли ты сейчас съел?</p>
        <div class="grid-4 gap-1">
            <button class="btn btn-outline text-xs" style="padding:5px;" onclick="eatPotPortion(0.25)">1/4</button>
            <button class="btn btn-outline text-xs" style="padding:5px;" onclick="eatPotPortion(0.33)">1/3</button>
            <button class="btn btn-outline text-xs" style="padding:5px;" onclick="eatPotPortion(0.5)">1/2</button>
            <button class="btn btn-outline text-xs" style="padding:5px;" onclick="eatPotPortion(1.0)">Всё</button>
        </div>
        <p class="text-xs text-muted mt-2">Или укажи свою порцию от всей кастрюли (%):</p>
        <div class="flex gap-2">
            <input type="number" id="customPotPct" class="input" placeholder="Напр. 15" style="flex:1">
            <button class="btn btn-outline" style="width: auto;" onclick="eatPotPortion(parseFloat(document.getElementById('customPotPct').value)/100)">ОК</button>
        </div>
    `;
};

window.eatPotPortion = (fraction) => {
    if(!currentPotTotals || isNaN(fraction) || fraction <= 0) return showToast("Укажи нормальную порцию!");
    
    const b = Math.round(currentPotTotals.b * fraction);
    const f = Math.round(currentPotTotals.f * fraction);
    const u = Math.round(currentPotTotals.u * fraction);
    const k = Math.round(currentPotTotals.k * fraction);
    const label = `${currentPotTotals.name} [${Math.round(fraction*100)}%]`;

    document.getElementById("foodName").value = label;
    document.getElementById("foodB").value = b;
    document.getElementById("foodF").value = f;
    document.getElementById("foodU").value = u;
    document.getElementById("foodKcal").value = k;
    
    showToast("🍲 Порция загружена! Нажми 'Записать в итог'.");
    document.getElementById("potCalculator").style.display = "none";
};
