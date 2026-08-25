const fs = require('fs');

let code = fs.readFileSync('app/src/main/assets/cyberpunk.js', 'utf8');

const parserLogic = `
window.autoParseFood = () => {
    const text = document.getElementById("smartFoodInput").value.toLowerCase();
    if (!text) return;

    let totalB = 0, totalF = 0, totalU = 0, totalKcal = 0;
    const ingredients = getPotIngredients();
    
    // Regex matches: "150г каши", "каша 150", "2 яйца", "яйца 2шт"
    for (let key in ingredients) {
        if (text.includes(key)) {
            // attempt to find weight
            const regexStr = "(\\\\d+)\\\\s*(?:г|грамм|гр)?\\\\s*" + key + "|" + key + "\\\\s*(?:—|-)?\\\\s*(\\\\d+)\\\\s*(?:г|грамм|гр)?";
            const match = text.match(new RegExp(regexStr));
            let weight = 0;
            if (match) {
                weight = parseFloat(match[1] || match[2]);
            } else if (key === 'яйца' || key === 'яйцо') {
                const pMatch = text.match(new RegExp("(\\\\d+)\\\\s*(?:шт)?\\\\s*" + key + "|" + key + "\\\\s*(\\\\d+)"));
                if (pMatch) {
                    weight = parseFloat(pMatch[1] || pMatch[2]) * 55; // avg egg weight
                }
            } else {
                weight = 100; // default to 100g if no weight specified
            }
            
            if (weight > 0) {
                const data = ingredients[key];
                totalB += (data.b * weight / 100);
                totalF += (data.f * weight / 100);
                totalU += (data.u * weight / 100);
                totalKcal += (data.k * weight / 100);
            }
        }
    }
    
    document.getElementById("foodName").value = text.substring(0, 30);
    document.getElementById("foodB").value = Math.round(totalB);
    document.getElementById("foodF").value = Math.round(totalF);
    document.getElementById("foodU").value = Math.round(totalU);
    document.getElementById("foodKcal").value = Math.round(totalKcal);
};

window.startVoiceFood = () => {
    if (!('webkitSpeechRecognition' in window)) {
        showToast("Голосовой ввод не поддерживается");
        return;
    }
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById("smartFoodInput").value = transcript;
        autoParseFood();
    };
    recognition.onerror = function(event) {
        showToast("Ошибка микрофона: " + event.error);
    };
    recognition.start();
    showToast("Говори...");
};
`;

if (!code.includes('window.autoParseFood =')) {
    code += '\n' + parserLogic;
    fs.writeFileSync('app/src/main/assets/cyberpunk.js', code);
    console.log("Parser logic added.");
}
