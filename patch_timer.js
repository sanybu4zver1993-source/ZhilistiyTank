window.startIsoTimer = (seconds, gear) => {
    stopIsoTimer();
    const display = document.getElementById("isoTimerDisplay");
    let time = seconds;
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    display.style.backgroundColor = "var(--danger)";
    display.innerText = `РАБОТА: ${time}с`;

    isoTimer = setInterval(() => {
        time--; display.innerText = `РАБОТА: ${time}с`;
        if (time <= 0) {
            stopIsoTimer(); display.style.backgroundColor = "var(--success)"; display.innerText = "ОТДЫХ!";
            if (navigator.vibrate) navigator.vibrate([500]); 
            if(window.logEvent) window.logEvent('workout', { gear: gear || 'iso', duration_s: seconds, rpe: 8 });
            if(window.calculateRecoveryScore) window.calculateRecoveryScore();
        }
    }, 1000);
};
