    const potData = {
        batchId: 'BATCH_' + Date.now().toString(36).toUpperCase(),
        name,
        totalWeight: Math.round(finalWeight),
        remainingWeight: Math.round(finalWeight),
        k100, b100, f100, u100
    };
    
    if (window.logEvent) window.logEvent("pot_batch_created", potData);
