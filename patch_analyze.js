// Override Vision API call
window.analyzeFoodImage = async (event) => {
    const file = event.target.files[0];
    if(!file) return;

    if(!AppState.apiKeys || !AppState.apiKeys.gemini) return showToast("Укажи Gemini API Key в Настройках!");
    showToast("⏳ Анализирую (Ground Truth Verification)...");
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64data = e.target.result.split(',')[1];
        const prompt = `Ты эксперт-диетолог. Проанализируй это фото еды. Ответь СТРОГО в формате JSON: {"name": "название блюда", "kcal": число, "b": число, "f": число, "u": число}. Рассчитай калории и БЖУ максимально точно.`;
        
        const payload = {
            contents: [{
                parts: [
                    {text: prompt},
                    {inline_data: { mime_type: file.type, data: base64data }}
                ]
            }]
        };

        try {
            const res = await window.AIRouter.callAI('gemini_vision', payload, { temperature: 0.0, retries: 1 });
            let txt = res.text.replace(/```json/g, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(txt);
            
            // Ground Truth Verification
            let warning = "";
            const truth = {
                "гречка": { kcal: 343, b: 13, f: 3, u: 71 },
                "яйцо": { kcal: 155, b: 13, f: 11, u: 1 },
                "курица": { kcal: 165, b: 31, f: 3, u: 0 }
            };
            
            const n = parsed.name.toLowerCase();
            for (let k in truth) {
                if (n.includes(k)) {
                    const diff = Math.abs(parsed.kcal - truth[k].kcal) / truth[k].kcal;
                    if (diff > 0.3) {
                        warning = " ⚠️ Отклонение калорий от эталона >30%!";
                    }
                    break;
                }
            }
            
            if (res.confidence < 0.7) {
                warning += " ⚠️ Низкая уверенность ИИ.";
            }

            document.getElementById("foodName").value = parsed.name || "Еда с фото";
            document.getElementById("foodKcal").value = parsed.kcal || 0;
            document.getElementById("foodB").value = parsed.b || 0;
            document.getElementById("foodF").value = parsed.f || 0;
            document.getElementById("foodU").value = parsed.u || 0;
            
            showToast(`Распознано!${warning ? `\n${warning}` : ''}`);
        } catch(err) {
            showToast("❌ Ошибка: " + err.message);
        }
    };
    reader.readAsDataURL(file);
};
