window.submitPin = () => {
    if (currentPinInput.length !== 4) return showToast("Введите 4 цифры");
    
    const realPin = localStorage.getItem("tank_real_pin");
    const fakePin = localStorage.getItem("tank_fake_pin");
    const wipePin = localStorage.getItem("tank_wipe_pin");
    
    if (!realPin || !fakePin || !wipePin) {
        if (setupStep === 0) { setupStep = 1; }
        if (setupStep === 1) {
            localStorage.setItem("tank_real_pin", currentPinInput);
            document.getElementById("loginTitle").innerText = "SETUP FAKE PIN";
            document.getElementById("loginMessage").innerText = "Создай фейковый ПИН-код (пустышка без удаления)";
            setupStep = 2;
            window.clearPin();
            return;
        } else if (setupStep === 2) {
            if (currentPinInput === localStorage.getItem("tank_real_pin")) {
                return showToast("Фейковый ПИН не может совпадать с основным!");
            }
            localStorage.setItem("tank_fake_pin", currentPinInput);
            document.getElementById("loginTitle").innerText = "SETUP WIPE PIN";
            document.getElementById("loginMessage").innerText = "Создай ТРЕВОЖНЫЙ ПИН-код (УДАЛЯЕТ ОСНОВНУЮ БАЗУ)";
            setupStep = 3;
            window.clearPin();
            return;
        } else if (setupStep === 3) {
            if (currentPinInput === localStorage.getItem("tank_real_pin") || currentPinInput === localStorage.getItem("tank_fake_pin")) {
                return showToast("Тревожный ПИН должен быть уникальным!");
            }
            localStorage.setItem("tank_wipe_pin", currentPinInput);
            setupStep = 0;
            document.getElementById("loginTitle").innerText = "ВХОД В ТАНК";
            document.getElementById("loginMessage").innerText = "Настройка завершена. Введите ПИН.";
            window.clearPin();
            return;
        }
    }
    
    // Login logic
    if (currentPinInput === realPin) {
        activeDBName = "VeinyTankDB";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
    } else if (currentPinInput === fakePin) {
        // FAKE DB - NO WIPE
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
    } else if (currentPinInput === wipePin) {
        // DURESS WIPE LOGIC
        indexedDB.deleteDatabase("VeinyTankDB");
        localStorage.removeItem("tank_real_pin");
        activeDBName = "VeinyTankDB_Fake";
        document.getElementById("loginOverlay").style.display = "none";
        initDB().catch(console.error);
    } else {
        showToast("Неверный ПИН-код");
        document.getElementById("pinDots").classList.add("shake");
        setTimeout(() => document.getElementById("pinDots").classList.remove("shake"), 500);
        window.clearPin();
    }
};
