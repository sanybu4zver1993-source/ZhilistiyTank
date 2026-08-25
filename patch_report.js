const fs = require('fs');

let code = fs.readFileSync('app/src/main/assets/app.js', 'utf8');

const reportFunc = `
window.exportMedicalReportTxt = () => {
    if (window.haptic) window.haptic(30);
    
    let report = "\\uFEFF"; // UTF-8 BOM
    report += "=== МЕДИЧНИЙ ЗВІТ / ПАЦІЄНТ ===\\n\\n";
    report += "Дата генерації: " + new Date().toLocaleString("uk-UA") + "\\n";
    report += "Група крові: " + (document.getElementById("dossierBlood") ? document.getElementById("dossierBlood").value : "") + "\\n";
    report += "Хронічні стани: " + (document.getElementById("dossierConditions") ? document.getElementById("dossierConditions").value : "") + "\\n";
    report += "Алергії: " + (document.getElementById("dossierAllergies") ? document.getElementById("dossierAllergies").value : "") + "\\n\\n";
    
    report += "--- ПОТОЧНИЙ СТАН (ЦНС / BODY BATTERY) ---\\n";
    report += "Оцінка ресурсу: " + AppState.bodyBattery + " / 100\\n";
    
    report += "\\n--- БАДИ ТА ПРЕПАРАТИ (РЕГУЛЯРНИЙ ПРИЙОМ) ---\\n";
    for(let k in AppState.supps) {
        if(AppState.supps[k]) {
            report += "- " + SUPP_NAMES[k] + "\\n";
        }
    }
    
    report += "\\n--- ОСТАННІ ПОДІЇ ТА ТРИГЕРИ ---\\n";
    const recent = AppState.logs.slice(-10).reverse();
    recent.forEach(log => {
        report += "[" + new Date(log.ts).toLocaleString("uk-UA") + "] " + log.type + " | " + JSON.stringify(log.payload || {}) + "\\n";
    });

    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "medical_report_" + new Date().toISOString().slice(0,10) + ".txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Звіт збережено (UTF-8)");
};
`;

if (!code.includes('window.exportMedicalReportTxt')) {
    code += '\n' + reportFunc;
    fs.writeFileSync('app/src/main/assets/app.js', code);
    
    let html = fs.readFileSync('app/src/main/assets/index.html', 'utf8');
    html = html.replace('<h2>🗃 Личное Досье</h2>', '<h2>🗃 Личное Досье</h2>\n<button class="btn btn-outline mb-2" style="border-color: #9b59b6; color: #9b59b6;" onclick="exportMedicalReportTxt()">📄 Вивантажити мед. звіт (.txt)</button>');
    fs.writeFileSync('app/src/main/assets/index.html', html);
    console.log("Report func added");
}
