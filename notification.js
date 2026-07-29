window.scheduleNativePush = (title, message, delayMinutes) => {
    if(window.AndroidBridge && window.AndroidBridge.postMessage) {
        window.AndroidBridge.postMessage(JSON.stringify({
            type: 'schedule_notification',
            title: title,
            message: message,
            delayMinutes: delayMinutes
        }));
    } else {
        console.log(`[Mock Push in ${delayMinutes}m] ${title}: ${message}`);
    }
};
