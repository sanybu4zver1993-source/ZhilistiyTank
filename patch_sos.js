
window.showSosCategory = (category) => {
    if (window.haptic) window.haptic(30);
    const container = document.getElementById("sosSubContainer");
    const title = document.getElementById("sosSubTitle");
    const buttons = document.getElementById("sosSubButtons");
    const breath = document.getElementById("sosBreathingBlock");
    
    container.style.display = "flex";
    breath.style.display = "none";
    buttons.innerHTML = "";
    
    if (category === 'panic') {
        if (window.haptic) window.haptic(300); // long vibration for panic
        title.innerText = "🚨 ПАНИКА / ТРЕВОГА";
        title.className = "text-center text-danger";
        breath.style.display = "block";
        if(window.logEvent) window.logEvent("sos_trigger", { type: "panic" });
    } else if (category === 'alcohol') {
        title.innerText = "🍺 АЛКОГОЛЬНЫЙ СРЫВ";
        title.className = "text-center text-warning";
        buttons.innerHTML = `
            <button class="btn btn-outline" onclick="showToast('Пей 500мл воды с Гависконом')">💧 Вода + Гавискон</button>
            <button class="btn btn-outline" onclick="showToast('Янтарная кислота - 2 таб')">💊 Янтарная кислота</button>
        `;
        if(window.logEvent) window.logEvent("sos_trigger", { type: "alcohol" });
    } else if (category === 'drugs') {
        title.innerText = "💊 ПАВ / ОТХОДА";
        title.className = "text-center text-danger";
        buttons.innerHTML = `
            <button class="btn btn-outline" onclick="showToast('Витамин C 300мг + Магний')">Сбить толер (Вит С + Магний)</button>
            <button class="btn btn-primary" onclick="startNSDR()">Запустить NSDR</button>
        `;
        if(window.logEvent) window.logEvent("sos_trigger", { type: "drugs" });
    }
};

let breathInterval = null;
window.startSighAnimation = () => {
    if (window.haptic) window.haptic(30);
    const circle = document.getElementById("breathSighCircle");
    if(!circle) return;
    circle.innerText = "ВЗДОХ";
    circle.style.transform = "scale(1.2)";
    circle.style.background = "var(--primary)";
    
    clearInterval(breathInterval);
    let step = 0;
    breathInterval = setInterval(() => {
        step = (step + 1) % 3;
        if(step === 0 || step === 1) {
            circle.innerText = "ВЗДОХ";
            circle.style.transform = "scale(1.2)";
            circle.style.background = "var(--primary)";
        } else {
            circle.innerText = "ВЫДОХ";
            circle.style.transform = "scale(0.8)";
            circle.style.background = "var(--success)";
        }
    }, 2000);
};

window.stopSighAnimation = () => {
    if (window.haptic) window.haptic(30);
    clearInterval(breathInterval);
    const circle = document.getElementById("breathSighCircle");
    if(circle) {
        circle.innerText = "ВЗДОХ";
        circle.style.transform = "scale(1)";
        circle.style.background = "var(--primary)";
    }
};

let nsdrInterval = null;
window.startNSDR = () => {
    if (window.haptic) window.haptic(30);
    const display = document.getElementById("nsdrDisplay");
    if(!display) return;
    display.style.display = "block";
    let timeLeft = 15 * 60;
    
    clearInterval(nsdrInterval);
    nsdrInterval = setInterval(() => {
        timeLeft--;
        const m = Math.floor(timeLeft / 60);
        const s = timeLeft % 60;
        display.innerText = `${m}:${s.toString().padStart(2, '0')}`;
        if(timeLeft <= 0) {
            clearInterval(nsdrInterval);
            if (window.haptic) window.haptic([50, 50, 50]);
            display.innerText = "ЗАВЕРШЕНО";
        }
    }, 1000);
    
    if (window.logEvent) window.logEvent("nsdr_started", {});
};

