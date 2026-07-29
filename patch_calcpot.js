window.calcPot = () => {
    let b = 0, f = 0, u = 0, k = 0, rawWeight = 0;
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
                    rawWeight += g;
                }
            }
        }
    });

    if (rawWeight === 0) {
        return showToast("Введи вес ингредиентов!");
    }
    
    let finalWeight = rawWeight;
    const netInput = document.getElementById("potNetWeight");
    if (netInput && netInput.value) {
        const parsedNet = parseFloat(netInput.value);
        if (!isNaN(parsedNet) && parsedNet > 0) {
            finalWeight = parsedNet;
        }
    }

    const mainIng = currentPotRows[0] && currentPotRows[0].ingredientKey ? currentPotRows[0].ingredientKey : 'Кастрюля';
    const name = `${currentPotType === 'green' ? 'Мясная' : 'Молочная'} (${mainIng.charAt(0).toUpperCase() + mainIng.slice(1)})`;

    // Calculate per 100g based on final cooked weight
    const k100 = (k / finalWeight) * 100;
    const b100 = (b / finalWeight) * 100;
    const f100 = (f / finalWeight) * 100;
    const u100 = (u / finalWeight) * 100;

    const potData = {
        name,
        totalWeight: Math.round(finalWeight),
        remainingWeight: Math.round(finalWeight),
        k100, b100, f100, u100
    };

    if (!AppState.activePots) AppState.activePots = { green: null, white: null };
    AppState.activePots[currentPotType] = potData;
    saveUIState();
    
    showToast(`✅ Кастрюля сварена! Вес: ${Math.round(finalWeight)}г`);
    renderActivePot(currentPotType);
};
