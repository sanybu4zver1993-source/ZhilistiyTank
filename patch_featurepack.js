window.buildWeeklyFeaturePack = () => {
    const now = new Date();
    const events = AppState.events || [];
    let spanDays = 0;
    
    if (events.length > 0) {
        // Sort to get earliest
        const sorted = [...events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
        const earliest = new Date(sorted[0].occurred_at);
        spanDays = (now - earliest) / (1000 * 60 * 60 * 24);
    }
    
    if (spanDays < 14) {
        return JSON.stringify({ 
            warning: "Мало данных для поиска закономерностей (нужно минимум 14 дней). Аналитика трендов отключена.",
            dossier: AppState.dossier || {},
            current_recovery_score: AppState.bodyBattery || 0
        });
    }

    const last7Days = new Date(now.getTime() - 7*24*60*60*1000).toISOString();
    const recentEvents = events.filter(e => e.occurred_at >= last7Days);
    
    const featurePack = {
        dossier: AppState.dossier || {},
        current_recovery_score: AppState.bodyBattery || 0,
        events: recentEvents,
        summary: {
            total_water_ml: recentEvents.filter(e => e.type === 'water').reduce((sum, e) => sum + (e.payload.ml || 0), 0),
            total_sleep_logs: recentEvents.filter(e => e.type === 'sleep').length,
            total_workouts: recentEvents.filter(e => e.type === 'workout').length,
            total_stress_events: recentEvents.filter(e => e.type === 'stress').length
        }
    };
    
    return JSON.stringify(featurePack);
};
