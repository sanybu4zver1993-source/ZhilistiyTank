
let isoTimerInterval = null;
let currentIsoSeconds = 0;

window.startIsoTimer = (seconds, type) => {
    if (window.haptic) window.haptic(30);
    clearInterval(isoTimerInterval);
    currentIsoSeconds = seconds;
    const display = document.getElementById("isoTimerDisplay");
    
    isoTimerInterval = setInterval(() => {
        currentIsoSeconds--;
        if(display) display.innerText = `00:${currentIsoSeconds.toString().padStart(2, '0')}`;
        
        if(currentIsoSeconds <= 0) {
            clearInterval(isoTimerInterval);
            if (window.haptic) window.haptic([50, 50, 50]);
            if (window.showToast) window.showToast("Таймер завершен!");
            if (window.logEvent) window.logEvent("isometric_done", { type, expected: seconds });
        }
    }, 1000);
};

window.stopIsoTimer = () => {
    if (window.haptic) window.haptic(30);
    clearInterval(isoTimerInterval);
    if(document.getElementById("isoTimerDisplay")) {
        document.getElementById("isoTimerDisplay").innerText = "00:00";
    }
};

window.addRep = () => {
    if (window.haptic) window.haptic(30);
    if (window.logEvent) window.logEvent("isometric_rep", {});
    if (window.showToast) window.showToast("Подход записан!");
};

