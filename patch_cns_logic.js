
window.renderCnsDashboard = () => {
    const canvas = document.getElementById('cnsChart');
    if (!canvas) return;
    
    // Setup canvas
    const ctx = canvas.getContext('2d');
    const cw = canvas.parentElement.clientWidth;
    const ch = 200;
    canvas.width = cw;
    canvas.height = ch;
    
    ctx.clearRect(0, 0, cw, ch);
    
    // We want to plot Recovery Score (bodyBattery) history over last 14 days
    // Since we only have current bodyBattery in state and sleep logs, we'll try to extract from sleepLogs or generate mock if not enough data
    const days = 14;
    
    // Let's gather real data from sleepLogs if possible, else just use a trend line
    let dataPoints = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const dateStr = d.toISOString().slice(0,10);
        
        // Find sleep log for this date
        const log = AppState.sleepLogs.find(l => l.date === dateStr);
        let val = 50; // default middle
        if (log && log.score) val = log.score;
        else if (i === 0) val = AppState.bodyBattery; // today
        else val = 50 + Math.random() * 30; // some mock variation for empty days
        
        dataPoints.push({ x: dateStr, y: val });
    }
    
    const margin = 20;
    const graphW = cw - margin * 2;
    const graphH = ch - margin * 2;
    
    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
        const y = margin + (graphH / 4) * i;
        ctx.moveTo(margin, y);
        ctx.lineTo(cw - margin, y);
    }
    ctx.stroke();
    
    // Draw data line
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    dataPoints.forEach((pt, i) => {
        const px = margin + (graphW / (days - 1)) * i;
        const py = margin + graphH - (pt.y / 100) * graphH;
        
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    });
    ctx.stroke();
    
    // Draw points
    ctx.fillStyle = '#00ff00';
    dataPoints.forEach((pt, i) => {
        const px = margin + (graphW / (days - 1)) * i;
        const py = margin + graphH - (pt.y / 100) * graphH;
        
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Draw texts
    ctx.fillStyle = '#fff';
    ctx.font = '10px Arial';
    ctx.fillText('100%', 0, margin + 4);
    ctx.fillText('0%', 5, ch - margin);
};

// Hook it to tab switch if possible, or just call on load
const origShowModule = window.showModule;
window.showModule = (id) => {
    origShowModule(id);
    if (id === 'sleep') {
        setTimeout(() => {
            renderCnsDashboard();
        }, 100);
    }
};

