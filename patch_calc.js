window.calcInput = (char) => {
    if (window.haptic) window.haptic(30);
    if (char === 'C') {
        currentCalc = "";
    } else {
        currentCalc += char;
    }
    document.getElementById("calcDisplay").innerText = currentCalc || "0";
};

window.enterPin = (num) => {
    if (window.haptic) window.haptic(30);
    if (!window.currentPin) window.currentPin = "";
    window.currentPin += num;
    // Simple mock display logic
    document.getElementById("loginMessage").innerText = window.currentPin;
};

window.clearPin = () => {
    if (window.haptic) window.haptic(30);
    window.currentPin = "";
    document.getElementById("loginMessage").innerText = "";
};

window.submitPin = () => {
    currentCalc = window.currentPin;
    calcEq();
};

