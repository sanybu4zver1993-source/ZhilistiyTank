
window.generate14DayDigest = () => {
    if (window.haptic) window.haptic(30);
    const inputEl = document.getElementById("chatInput");
    if (inputEl) {
        inputEl.value = "Проанализируй мои последние 14 дней. Дай мне жесткий разбор моего состояния, дисциплины по БАДам, ЦНС и тренировкам. Что просело, а где я красавчик?";
        window.sendChatMessage();
    }
};

