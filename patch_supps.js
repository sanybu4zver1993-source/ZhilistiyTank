        chk.onchange = (e) => {
            AppState.supps[key] = e.target.checked;
            if(e.target.checked && window.logEvent) {
                window.logEvent("supplement", { name: suppLabels[key], id: key });
            }
            saveUIState();
            if(e.target.checked) {
                if(key === 'mag') {
                    showToast("Магний: Лучше за 1-2ч до сна.");
                    if(window.scheduleNativePush) window.scheduleNativePush("Сон", "Пора спать, магний уже действует!", 120);
                }
                if(key === 'succinic') showToast("Янтарная кислота: Строго после еды.");
                if(key === 'gaviscon') showToast("Гавискон: Строго перед сном.");
                if(key !== 'mag' && window.scheduleNativePush) window.scheduleNativePush("Витамины", "Не забудь про вечернюю порцию!", 240);
            }
            if(window.checkSuppConflicts) window.checkSuppConflicts();
        };
