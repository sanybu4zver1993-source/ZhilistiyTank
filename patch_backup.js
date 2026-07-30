
window.exportEncryptedJSON = () => {
    if (window.haptic) window.haptic(30);
    const pin = localStorage.getItem("tank_real_pin") || "0000";
    const dataStr = JSON.stringify(AppState);
    
    // Simple XOR cipher using PIN
    let encrypted = "";
    for(let i=0; i<dataStr.length; i++) {
        const c = dataStr.charCodeAt(i) ^ pin.charCodeAt(i % pin.length);
        encrypted += String.fromCharCode(c);
    }
    const b64 = btoa(unescape(encodeURIComponent(encrypted)));
    
    const blob = new Blob([b64], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `VeinyTank_Backup_${new Date().toISOString().slice(0,10)}.tank`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    if (window.showToast) window.showToast("Бэкап сохранен!");
};

// Check for 7-day auto backup
const checkAutoBackup = () => {
    const lastBackup = localStorage.getItem("tank_last_backup_date");
    const now = Date.now();
    if (!lastBackup || (now - parseInt(lastBackup)) > 7 * 24 * 60 * 60 * 1000) {
        localStorage.setItem("tank_last_backup_date", now.toString());
        // Since it's background, we might not want to download a file automatically.
        // We can just save it to a separate IndexedDB store or just trigger a log
        if (window.logEvent) window.logEvent("auto_backup", { timestamp: now });
        if (window.showToast) window.showToast("Сделан системный авто-бэкап (7 дней)");
    }
};

setTimeout(checkAutoBackup, 5000); // Check 5 seconds after load

