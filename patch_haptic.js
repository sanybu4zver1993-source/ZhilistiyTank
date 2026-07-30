window.haptic = (pattern) => {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
};
