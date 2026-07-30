
let pvtTimeout = null;
let pvtStartTime = 0;
let pvtActive = false;

window.startPVT = () => {
    const btn = document.getElementById("pvtButton");
    const result = document.getElementById("hrvResult");
    if (pvtActive) {
        clearTimeout(pvtTimeout);
        btn.innerText = "ФАЛЬСТАРТ!";
        btn.className = "btn btn-danger";
        pvtActive = false;
        if (window.haptic) window.haptic([50, 50]);
        setTimeout(() => {
            btn.innerText = "⚡ PVT Тест (Реакция)";
            btn.className = "btn btn-primary";
        }, 1500);
        return;
    }
    
    if (pvtStartTime > 0) {
        const rt = Date.now() - pvtStartTime;
        pvtStartTime = 0;
        btn.innerText = "⚡ PVT Тест (Реакция)";
        btn.className = "btn btn-primary";
        
        let msg = `Медиана (RT): ${rt} мс`;
        if (rt > 500) {
            msg += "<br><span class='text-danger'>⚠️ Пропуск/задержка (>500ms)</span>";
        } else {
            msg += "<br><span class='text-success'>ЦНС в норме</span>";
        }
        
        result.style.display = "block";
        result.innerHTML = msg;
        if (window.haptic) window.haptic(30);
        if (window.logEvent) window.logEvent("pvt_result", { rt, delayed: rt > 500 });
        return;
    }

    result.style.display = "none";
    btn.innerText = "ЖДИ КРАСНОГО...";
    btn.className = "btn btn-outline";
    pvtActive = true;
    
    const delay = Math.floor(Math.random() * 8000) + 2000;
    pvtTimeout = setTimeout(() => {
        pvtActive = false;
        pvtStartTime = Date.now();
        btn.innerText = "ЖМИ!!!";
        btn.className = "btn btn-danger";
        if (window.haptic) window.haptic(100);
    }, delay);
};

window.sendNativeAlarm = (type, message, delayMs) => {
    if (window.AndroidBridge && window.AndroidBridge.postMessage) {
        window.AndroidBridge.postMessage(JSON.stringify({
            action: 'set_alarm',
            type: type,
            message: message,
            delayMs: delayMs
        }));
    }
};

window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        if (window.navigator && window.navigator.locks && window.saveUIState) {
            navigator.locks.request('db_flush', { mode: 'exclusive' }, async lock => {
                window.saveUIState();
            });
        } else if (window.saveUIState) {
            window.saveUIState();
        }
    }
});

window.addEventListener('pagehide', () => {
    if (window.saveUIState) window.saveUIState();
});

