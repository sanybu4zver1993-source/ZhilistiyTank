"use strict";

// --- CNS Analytics Engine (Compartmental Body Battery + Spearman + FDR) ---
const CNSAnalytics = (() => {
    function median(arr) {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const mid = s.length >> 1;
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    function mad(arr) {
        if (!arr.length) return 0;
        const med = median(arr);
        return median(arr.map(x => Math.abs(x - med)));
    }

    function ranks(arr) {
        const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
        const r = new Array(arr.length);
        let i = 0;
        while (i < indexed.length) {
            let j = i;
            while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
            const avgRank = (i + j) / 2 + 1;
            for (let k = i; k <= j; k++) r[indexed[k].i] = avgRank;
            i = j + 1;
        }
        return r;
    }

    function pearson(x, y) {
        const n = x.length;
        let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
        const mx = sx / n, my = sy / n;
        for (let i = 0; i < n; i++) {
            const dx = x[i] - mx, dy = y[i] - my;
            sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
        }
        return (sxx === 0 || syy === 0) ? 0 : sxy / Math.sqrt(sxx * syy);
    }

    function spearman(x, y) {
        return pearson(ranks(x), ranks(y));
    }

    function hodgesLehmannShift(yTriggered, yControl) {
        const diffs = [];
        for (const yt of yTriggered) {
            for (const yc of yControl) diffs.push(yt - yc);
        }
        return median(diffs);
    }

    function makeRng(seed = 0x56544E4B) {
        let x = seed | 0;
        return () => {
            x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
            return (x >>> 0) / 4294967296;
        };
    }

    function buildDailyRecords() {
        const byDay = {};
        const ensure = (day) => {
            if (!byDay[day]) {
                byDay[day] = {
                    date: day,
                    lateCaffeineMg: 0,
                    sleepHours: null,
                    highStress: false,
                    heavyWorkout: false,
                    waterMl: 0,
                    pvtMedians: []
                };
            }
            return byDay[day];
        };

        (AppState.sleepLogs || []).forEach(s => {
            const rec = ensure(s.date);
            rec.sleepHours = (rec.sleepHours || 0) + (s.hrs || 0);
        });

        (AppState.events || []).forEach(e => {
            const day = e.day || (e.occurred_at || "").slice(0, 10);
            if (!day) return;
            const rec = ensure(day);
            if (e.type === "caffeine") {
                const hr = new Date(e.occurred_at).getHours();
                if (hr >= 17) rec.lateCaffeineMg += (e.payload?.mg || 0);
            } else if (e.type === "stress") {
                rec.highStress = true;
            } else if (e.type === "workout") {
                rec.heavyWorkout = true;
            } else if (e.type === "water") {
                rec.waterMl += (e.payload?.ml || 0);
            } else if (e.type === "pvt_series" && Number.isFinite(e.payload?.medianMs)) {
                rec.pvtMedians.push(e.payload.medianMs);
            }
        });

        const sortedDays = Object.keys(byDay).sort();
        const waterNorm = window.getWaterNorm ? window.getWaterNorm() : 3000;
        const paired = [];

        for (let i = 0; i < sortedDays.length - 1; i++) {
            const today = byDay[sortedDays[i]];
            const nextDay = byDay[sortedDays[i + 1]];
            if (nextDay.pvtMedians.length > 0 && today.sleepHours !== null) {
                paired.push({
                    date: sortedDays[i],
                    nextMorningPvtMedianMs: median(nextDay.pvtMedians),
                    lateCaffeineMg: today.lateCaffeineMg,
                    sleepHours: today.sleepHours,
                    highStress: today.highStress,
                    heavyWorkout: today.heavyWorkout,
                    waterDeficit: today.waterMl < waterNorm * 0.7
                });
            }
        }
        return paired;
    }

    function discoverTriggers() {
        const valid = buildDailyRecords();
        if (valid.length < 14) {
            return {
                status: "INSUFFICIENT_DATA",
                daysCollected: valid.length,
                daysRequired: 14,
                insights: []
            };
        }

        const candidates = [
            { id: "late_caffeine", label: "Кофеин > 60 мг после 17:00", extract: d => d.lateCaffeineMg > 60 ? 1 : 0, continuous: d => d.lateCaffeineMg },
            { id: "short_sleep", label: "Сон менее 6.5 часов", extract: d => d.sleepHours < 6.5 ? 1 : 0, continuous: d => -d.sleepHours },
            { id: "high_stress", label: "Стресс / Тревоги", extract: d => d.highStress ? 1 : 0, continuous: null },
            { id: "heavy_workout", label: "Тренировочная нагрузка", extract: d => d.heavyWorkout ? 1 : 0, continuous: null },
            { id: "dehydration", label: "Недобор воды (< 70% нормы)", extract: d => d.waterDeficit ? 1 : 0, continuous: null }
        ];

        const rng = makeRng();
        const rawResults = [];
        const yVec = valid.map(d => d.nextMorningPvtMedianMs);
        const N = valid.length;

        for (const c of candidates) {
            const yTrig = [], yCtrl = [];
            valid.forEach((d, idx) => (c.extract(d) ? yTrig : yCtrl).push(yVec[idx]));
            if (yTrig.length < 5 || yCtrl.length < 5) continue;

            const xVec = valid.map(d => c.continuous ? c.continuous(d) : c.extract(d));
            const rhoObs = spearman(xVec, yVec);
            const rhoShrunk = rhoObs * ((N - 2) / ((N - 2) + 10));
            const shiftMs = hodgesLehmannShift(yTrig, yCtrl);

            const permY = [...yVec];
            let extremeCount = 0;
            const M = 1000;
            for (let m = 0; m < M; m++) {
                for (let i = N - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    const tmp = permY[i]; permY[i] = permY[j]; permY[j] = tmp;
                }
                if (Math.abs(spearman(xVec, permY)) >= Math.abs(rhoObs)) extremeCount++;
            }
            const pValue = (extremeCount + 1) / (M + 1);

            rawResults.push({
                id: c.id,
                label: c.label,
                nTriggered: yTrig.length,
                rhoShrunk: +rhoShrunk.toFixed(2),
                shiftMs: Math.round(shiftMs),
                pValue
            });
        }

        rawResults.sort((a, b) => a.pValue - b.pValue);
        const mTotal = rawResults.length;
        let maxPassIdx = -1;
        for (let k = 0; k < mTotal; k++) {
            if (rawResults[k].pValue <= ((k + 1) / mTotal) * 0.10) maxPassIdx = k;
        }

        const verified = rawResults
            .slice(0, maxPassIdx + 1)
            .filter(r => Math.abs(r.shiftMs) >= 10 && Math.abs(r.rhoShrunk) >= 0.20);

        return { status: "OK", daysCollected: N, insights: verified };
    }

    return { median, mad, discoverTriggers };
})();

window.getActiveCaffeineMg = () => {
    let active = 0;
    const now = Date.now();
    (AppState.caffeineDoses || []).forEach(d => {
        const elapsedHours = (now - d.time) / (1000 * 60 * 60);
        if (elapsedHours >= 0 && elapsedHours < 36) {
            const remaining = d.amount * Math.pow(0.5, elapsedHours / 5);
            if (remaining > 3) active += remaining;
        }
    });
    return Math.round(active);
};

window.calculateRecoveryScore = () => {
    const now = Date.now();
    const cutoff24 = now - 24 * 60 * 60 * 1000;
    const today = window.todayKey();

    // Sleep recovery (saturating exponential + caffeine damper)
    const recentSleep = (AppState.sleepLogs || []).filter(s => s.ts ? s.ts >= cutoff24 : s.date === today);
    let bb = 65;
    if (recentSleep.length > 0) {
        let totalHrs = 0;
        let qSum = 0;
        recentSleep.forEach(s => {
            totalHrs += (s.hrs || 0);
            qSum += ((s.quality || 4) / 4);
        });
        const avgQ = Math.min(1.2, Math.max(0.5, qSum / recentSleep.length));
        const activeCaf = window.getActiveCaffeineMg();
        const cafDamper = 1 / (1 + activeCaf / 80);
        const startBase = 25;
        bb = 100 - (100 - startBase) * Math.exp(-0.28 * avgQ * cafDamper * totalHrs);
    }

    const recentEvents = (AppState.events || []).filter(e => new Date(e.occurred_at).getTime() >= cutoff24);
    const stressCount = recentEvents.filter(e => e.type === "stress").length;
    const workoutCount = recentEvents.filter(e => e.type === "workout").length;
    const recoveryCount = recentEvents.filter(e => e.type === "cns_recovery").length;

    bb -= stressCount * 12;
    bb -= workoutCount * 12;
    bb += recoveryCount * 15;

    // PVT Z-score calibration if baseline >= 3 series
    const pvtHist = AppState.pvtHistory || [];
    if (pvtHist.length >= 3) {
        const medians = pvtHist.map(p => p.medianMs);
        const latest = medians[medians.length - 1];
        const baseMed = CNSAnalytics.median(medians.slice(0, -1));
        const baseMad = CNSAnalytics.mad(medians.slice(0, -1));
        if (baseMad > 0) {
            const z = (latest - baseMed) / (1.4826 * baseMad);
            if (z > 1.5) bb -= Math.min(20, Math.round(6 * z));
        }
    }

    bb = Math.max(5, Math.min(100, Math.round(bb)));
    AppState.bodyBattery = bb;
    window.updateBodyBatteryUI();
    window.updateWorkoutUI();
    return bb;
};

window.updateBodyBatteryUI = () => {
    const val = AppState.bodyBattery ?? 85;
    const statusBar = document.getElementById("batteryStatus");
    if (statusBar) statusBar.innerText = `🔋 ЦНС: ${val}/100`;

    const textEl = document.getElementById("dashBatteryText");
    if (textEl) {
        textEl.innerText = `${val}/100`;
        textEl.className = val >= 70 ? "text-success" : (val >= 35 ? "text-warning" : "text-danger");
    }

    const fill = document.getElementById("dashBatteryFill");
    if (fill) {
        fill.style.width = `${val}%`;
        fill.style.backgroundColor = val >= 70 ? "var(--success)" : (val >= 35 ? "var(--warning)" : "var(--danger)");
    }

    const sosSug = document.getElementById("sosSuggestion");
    if (sosSug) {
        if (val <= 25) {
            sosSug.style.display = "block";
            sosSug.innerText = "⚠️ Критическое истощение ЦНС! Активирован режим DELOAD, рекомендуется 15-мин NSDR.";
        } else {
            sosSug.style.display = "none";
        }
    }
};

window.renderTriggerChips = () => {
    const box = document.getElementById("cnsTriggerChips");
    if (!box) return;
    const triggers = AppState.cnsTriggers || ["Дроны", "Тревога", "Новости", "Недосып", "Тяж. тренировка"];
    box.innerHTML = triggers.map(t =>
        `<button class="chip-btn" onclick="logStressTrigger('${escapeHtml(t)}')">⚡ ${escapeHtml(t)}</button>`
    ).join("");
};

window.logStressTrigger = (trigger) => {
    window.haptic(40);
    window.logEvent("stress", { trigger });
    window.calculateRecoveryScore();
    saveUIState();
    showToast(`⚡ Триггер "${trigger}" учтён (ЦНС: ${AppState.bodyBattery}/100)`);
};

// --- Sleep & Real CNS 14-day Canvas Chart ---
window.logSleep = () => {
    const hrs = parseFloat(document.getElementById("sleepHours").value);
    const quality = safeParseInt(document.getElementById("sleepQuality").value, 4);
    const note = (document.getElementById("sleepNote").value || "").trim();
    if (isNaN(hrs) || hrs <= 0 || hrs > 24) return showToast("Укажи реальные часы сна (0.5–24)!");

    const today = window.todayKey();
    const bb = window.calculateRecoveryScore();
    AppState.sleepLogs.push({ date: today, ts: Date.now(), hrs, quality, note, score: bb });
    AppState.dailyHistory[today] = Object.assign({}, AppState.dailyHistory[today] || {}, { bb });

    window.logEvent("sleep", { hrs, quality, note });
    window.calculateRecoveryScore();
    saveUIState();
    window.renderCnsDashboard();
    document.getElementById("sleepNote").value = "";
    showToast(`✅ Сон (${hrs}ч, кач. ${quality}/5) записан!`);
};

window.logCnsRecovery = () => {
    window.haptic(30);
    window.logEvent("cns_recovery", { method: "manual_nsdr_rest" });
    const bb = window.calculateRecoveryScore();
    saveUIState();
    window.renderCnsDashboard();
    showToast(`🧘 Восстановление ЦНС учтено! Ресурс: ${bb}/100`);
};

window.renderCnsDashboard = () => {
    const canvas = document.getElementById("cnsChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const cw = Math.max(280, canvas.parentElement.clientWidth - 16);
    const ch = 180;
    canvas.width = cw;
    canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);

    const days = 14;
    const dataPoints = [];
    const now = new Date();
    const today = window.todayKey();

    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        let val = null;
        if (ds === today) {
            val = AppState.bodyBattery;
        } else if (AppState.dailyHistory && AppState.dailyHistory[ds]?.bb !== undefined) {
            val = AppState.dailyHistory[ds].bb;
        } else {
            const sl = (AppState.sleepLogs || []).find(l => l.date === ds && Number.isFinite(l.score));
            if (sl) val = sl.score;
        }
        dataPoints.push({ date: ds, y: val });
    }

    const margin = 24;
    const graphW = cw - margin * 2;
    const graphH = ch - margin * 2;

    ctx.strokeStyle = "#30363d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
        const y = margin + (graphH / 4) * i;
        ctx.moveTo(margin, y);
        ctx.lineTo(cw - margin, y);
    }
    ctx.stroke();

    const validPts = dataPoints
        .map((pt, idx) => ({ ...pt, idx }))
        .filter(pt => pt.y !== null);

    if (validPts.length >= 2) {
        ctx.strokeStyle = "#03dac6";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        validPts.forEach((pt, k) => {
            const px = margin + (graphW / (days - 1)) * pt.idx;
            const py = margin + graphH - (pt.y / 100) * graphH;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.stroke();
    }

    ctx.fillStyle = "#bb86fc";
    validPts.forEach(pt => {
        const px = margin + (graphW / (days - 1)) * pt.idx;
        const py = margin + graphH - (pt.y / 100) * graphH;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = "#8b949e";
    ctx.font = "10px monospace";
    ctx.fillText("100", 2, margin + 4);
    ctx.fillText("50", 6, margin + graphH / 2 + 4);
    ctx.fillText("0", 10, ch - margin);
};

window.renderCnsInsights = () => {
    const box = document.getElementById("cnsInsightsList");
    if (!box) return;
    const res = CNSAnalytics.discoverTriggers();
    if (res.status === "INSUFFICIENT_DATA") {
        box.innerHTML = `<div class="text-muted">Собрано парных дней (сон + утренний PVT): <b>${res.daysCollected} / ${res.daysRequired}</b>. Продолжай замеры для честной статистики без галлюцинаций.</div>`;
        return;
    }
    if (res.insights.length === 0) {
        box.innerHTML = `<div class="text-success">✅ За ${res.daysCollected} дней статистически значимых просадок PVT по триггерам не выявлено (FDR q=0.10).</div>`;
        return;
    }
    box.innerHTML = res.insights.map(ins => `
        <div class="card bg-dark">
            <div class="font-bold text-warning">⚡ ${escapeHtml(ins.label)}</div>
            <div class="text-xs text-muted">Сдвиг PVT: ${ins.shiftMs > 0 ? "+" : ""}${ins.shiftMs} мс | ρ=${ins.rhoShrunk} | дней: ${ins.nTriggered}</div>
        </div>
    `).join("");
};

// --- Heatmap & Workouts (Auto-Deload + Isometric Timers) ---
window.renderHeatmap = () => {
    const grid = document.getElementById("heatmapGrid");
    if (!grid) return;
    grid.innerHTML = "";
    const days = AppState.workoutDays || [];
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const cell = document.createElement("div");
        cell.className = "heatmap-cell" + (days.includes(ds) ? " active" : "");
        cell.innerText = String(d.getDate());
        grid.appendChild(cell);
    }
};

window.updateWorkoutUI = () => {
    window.renderHeatmap();
    const bb = AppState.bodyBattery ?? 85;
    const wTitle = document.getElementById("workoutModeTitle");
    const block2 = document.getElementById("workoutBlock2");
    const block3 = document.getElementById("workoutBlock3");
    const iso30 = document.getElementById("iso30btn");
    const iso60 = document.getElementById("iso60btn");
    const isoDb = document.getElementById("isoDbbtn");
    if (!wTitle) return;

    if (bb <= 20) {
        wTitle.innerHTML = "<span class='text-danger'>Режим: DELOAD (ЦНС истощена)</span>";
        if (block2) block2.style.display = "none";
        if (iso30) {
            iso30.innerText = "Эспандер 15с (Deload)";
            iso30.onclick = () => window.startIsoTimer(15, "expander_deload");
        }
        if (iso60) iso60.style.display = "none";
        if (isoDb) isoDb.style.display = "none";
    } else {
        wTitle.innerHTML = "<span class='text-success'>Режим: НОРМА</span>";
        if (block2) block2.style.display = "block";
        if (block3) block3.style.display = "block";
        if (iso30) {
            iso30.innerText = "Эспандер 45с";
            iso30.onclick = () => window.startIsoTimer(45, "expander");
        }
        if (iso60) iso60.style.display = "block";
        if (isoDb) isoDb.style.display = "block";
    }
};

let isoTimerInterval = null;
let currentIsoSeconds = 0;

window.startIsoTimer = (seconds, type) => {
    window.haptic(30);
    clearInterval(isoTimerInterval);
    currentIsoSeconds = seconds;
    const display = document.getElementById("isoTimerDisplay");
    if (display) display.innerText = `00:${String(currentIsoSeconds).padStart(2, "0")}`;

    isoTimerInterval = setInterval(() => {
        currentIsoSeconds--;
        if (display) display.innerText = `00:${String(Math.max(0, currentIsoSeconds)).padStart(2, "0")}`;
        if (currentIsoSeconds <= 0) {
            clearInterval(isoTimerInterval);
            window.haptic([80, 60, 120]);
            window.logEvent("isometric_done", { type, expected: seconds });
            showToast("🔥 Изометрия завершена!");
        }
    }, 1000);
};

window.stopIsoTimer = () => {
    window.haptic(25);
    clearInterval(isoTimerInterval);
    const display = document.getElementById("isoTimerDisplay");
    if (display) display.innerText = "00:00";
};

window.addRep = (intensity = "normal") => {
    window.haptic(30);
    window.logEvent("isometric_rep", { intensity });
    showToast("✅ Подход записан!");
};

window.completeWorkout = () => {
    window.haptic(60);
    const today = window.todayKey();
    if (!AppState.workoutDays.includes(today)) {
        AppState.workoutDays.push(today);
    }
    window.logEvent("workout", { date: today });
    window.calculateRecoveryScore();
    window.renderHeatmap();
    saveUIState();
    showToast("🏋️ Тренировка закрыта и отмечена в календаре!");
};

// --- PVT Reaction Test (performance.now + pointerdown, 5-trial series) ---
let pvtState = "idle"; // idle | waiting | ready
let pvtTimeout = null;
let pvtStartPerf = 0;
let pvtTrials = [];

function bindPvtButton() {
    const btn = document.getElementById("pvtButton");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("pointerdown", () => {
        window.handlePvtPress();
    }, { passive: true });
}

window.handlePvtPress = () => {
    const btn = document.getElementById("pvtButton");
    const prog = document.getElementById("pvtProgress");
    const resEl = document.getElementById("hrvResult");

    if (pvtState === "idle") {
        pvtTrials = [];
        resEl.style.display = "none";
        startNextPvtTrial(btn, prog);
        return;
    }

    if (pvtState === "waiting") {
        clearTimeout(pvtTimeout);
        pvtState = "idle";
        window.haptic([60, 60]);
        btn.innerText = "ФАЛЬСТАРТ! Жми для повтора";
        btn.className = "btn btn-danger";
        prog.innerText = "Сброшено (фальстарт)";
        return;
    }

    if (pvtState === "ready") {
        const rt = Math.round(performance.now() - pvtStartPerf);
        pvtTrials.push(rt);
        window.haptic(25);

        if (pvtTrials.length < 5) {
            startNextPvtTrial(btn, prog);
        } else {
            pvtState = "idle";
            const medianMs = Math.round(CNSAnalytics.median(pvtTrials));
            const lapses = pvtTrials.filter(x => x > 500).length;
            AppState.pvtHistory.push({ date: window.todayKey(), ts: Date.now(), medianMs, lapses, trials: pvtTrials });
            window.logEvent("pvt_series", { medianMs, lapses, trials: pvtTrials });
            window.calculateRecoveryScore();
            window.updatePvtBaselineUI();
            saveUIState();

            btn.innerText = "⚡ Повторить серию (5 замеров)";
            btn.className = "btn btn-primary";
            prog.innerText = "Серия завершена (5 / 5)";

            resEl.style.display = "block";
            resEl.innerHTML = `
                <div class="font-bold text-primary">Медиана RT: ${medianMs} мс</div>
                <div class="text-xs text-muted mt-1">Замеры: ${pvtTrials.join(" / ")} мс</div>
                <div class="text-xs ${lapses > 0 ? "text-danger" : "text-success"} mt-1">
                    ${lapses > 0 ? `⚠️ Провалы внимания (>500 мс): ${lapses}` : "✅ Провалов нет, ЦНС в фокусе"}
                </div>
            `;
        }
    }
};

function startNextPvtTrial(btn, prog) {
    pvtState = "waiting";
    prog.innerText = `Замер ${pvtTrials.length + 1} / 5`;
    btn.innerText = "ЖДИ КРАСНОГО...";
    btn.className = "btn btn-outline";

    const delay = Math.floor(Math.random() * 3500) + 1500;
    pvtTimeout = setTimeout(() => {
        pvtState = "ready";
        pvtStartPerf = performance.now();
        btn.innerText = "ЖМИ!!!";
        btn.className = "btn btn-danger";
    }, delay);
}

window.updatePvtBaselineUI = () => {
    const el = document.getElementById("pvtBaselineInfo");
    if (!el) return;
    const hist = AppState.pvtHistory || [];
    if (hist.length < 3) {
        el.innerText = `Серий собрано: ${hist.length}/3 для расчёта личного baseline.`;
    } else {
        const med = Math.round(CNSAnalytics.median(hist.map(h => h.medianMs)));
        el.innerText = `Личный baseline (медиана по ${hist.length} сериям): ${med} мс`;
    }
};

// --- Caffeine & Supplements ---
window.addCaffeine = (mg) => {
    window.haptic(30);
    AppState.caffeineDoses.push({ amount: mg, time: Date.now() });
    // Keep only last 48h
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    AppState.caffeineDoses = AppState.caffeineDoses.filter(d => d.time >= cutoff);
    window.logEvent("caffeine", { mg });
    window.updateCaffeineUI();
    window.calculateRecoveryScore();
    saveUIState();
    showToast(`☕ +${mg} мг кофеина`);
};

window.updateCaffeineUI = () => {
    const total = window.getActiveCaffeineMg();
    const lvl = document.getElementById("caffeineLevel");
    const bar = document.getElementById("caffeineBar");
    const warn = document.getElementById("caffeineWarning");
    if (lvl) lvl.innerText = total;
    if (bar) bar.style.width = `${Math.min(100, (total / 400) * 100)}%`;
    if (warn) warn.style.display = total > 200 ? "block" : "none";
};

window.renderSupps = () => {
    const container = document.getElementById("suppsContainer");
    const quick = document.getElementById("quickSuppsList");
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;

    const buildRows = (prefix) => Object.keys(meta).map(key => {
        const isChecked = Boolean(AppState.supps[key]);
        const stock = AppState.suppsInventory[key] ?? 0;
        const lotInfo = meta[key].lot ? ` <span class="text-xs text-muted">(${escapeHtml(meta[key].lot)})</span>` : "";
        const stockHtml = stock < 10
            ? `<span class="text-danger font-bold text-xs"> (${stock} шт)</span>`
            : `<span class="text-muted text-xs"> (${stock} шт)</span>`;

        return `
            <div class="card bg-gray flex gap-2 align-center" style="padding:10px; opacity:${isChecked ? 0.55 : 1};">
                <input type="checkbox" id="${prefix}_${key}" class="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSupp('${key}', this.checked)">
                <label for="${prefix}_${key}" style="flex:1; cursor:pointer; font-size:13px;">${escapeHtml(meta[key].label)}${lotInfo}${stockHtml}</label>
            </div>
        `;
    }).join("");

    if (container) container.innerHTML = buildRows("supp");
    if (quick) quick.innerHTML = buildRows("qsupp");
};

window.toggleSupp = (key, checkedState) => {
    window.haptic(30);
    if (checkedState) {
        if ((AppState.suppsInventory[key] || 0) <= 0) {
            showToast("❌ Банка пуста! Пополни остатки в разделе Фарма.");
            window.renderSupps();
            return;
        }
        AppState.supps[key] = true;
        AppState.suppsInventory[key] -= 1;
        window.logEvent("supp_taken", { key, remaining: AppState.suppsInventory[key] });
        if (AppState.suppsInventory[key] < 10) {
            showToast(`⚠️ Осталось мало: ${AppState.suppsInventory[key]} шт`);
        }
    } else {
        AppState.supps[key] = false;
        window.logEvent("supp_uncheck", { key });
    }
    saveUIState();
    window.renderSupps();
};

window.openSuppsInventoryModal = () => {
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    const rows = Object.keys(meta).map(key => `
        <div class="card bg-dark mb-1" style="padding:8px;">
            <div class="text-xs font-bold mb-1">${escapeHtml(meta[key].label)}</div>
            <div class="grid-2 gap-1">
                <input type="number" id="inv_qty_${key}" value="${AppState.suppsInventory[key] ?? 0}" placeholder="Кол-во">
                <input type="text" id="inv_lot_${key}" value="${escapeHtml(meta[key].lot || "")}" placeholder="Срок / серия (опц.)">
            </div>
        </div>
    `).join("");

    window.openAppModal("⚙️ Остатки и сроки БАДов", `
        <div class="flex-col gap-1">${rows}</div>
        <button class="btn btn-success mt-2" onclick="saveSuppsInventoryModal()">💾 Сохранить банки</button>
    `);
};

window.saveSuppsInventoryModal = () => {
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    Object.keys(meta).forEach(key => {
        AppState.suppsInventory[key] = Math.max(0, safeParseInt(document.getElementById(`inv_qty_${key}`).value, 0));
        meta[key].lot = (document.getElementById(`inv_lot_${key}`).value || "").trim();
    });
    saveUIState();
    window.closeAppModal();
    window.renderSupps();
    showToast("✅ Остатки БАДов обновлены!");
};

// --- SOS Protocols ---
let breathInterval = null;
let nsdrInterval = null;

window.showSosCategory = (category) => {
    window.haptic(30);
    const container = document.getElementById("sosSubContainer");
    const title = document.getElementById("sosSubTitle");
    const buttons = document.getElementById("sosSubButtons");
    const breath = document.getElementById("sosBreathingBlock");

    container.style.display = "flex";
    breath.style.display = "none";
    buttons.innerHTML = "";

    if (category === "panic") {
        window.haptic([150, 80, 150]);
        title.innerText = "🚨 ПАНИКА / ТРЕВОГА";
        title.className = "text-center text-danger";
        breath.style.display = "block";
        window.logEvent("sos_trigger", { type: "panic" });
    } else if (category === "alcohol") {
        title.innerText = "🍺 АЛКОГОЛЬНЫЙ СРЫВ";
        title.className = "text-center text-warning";
        buttons.innerHTML = `
            <button class="btn btn-outline btn-sm" onclick="addWater(500); showToast('💧 +500мл воды учтено + выпей Гавискон')">💧 Выпить 500мл воды + Гавискон</button>
            <button class="btn btn-outline btn-sm" onclick="showToast('💊 Янтарная кислота 100мг + Магний 400мг')">💊 Янтарная кислота + Магний</button>
        `;
        window.logEvent("sos_trigger", { type: "alcohol" });
    } else if (category === "drugs") {
        title.innerText = "💊 ПАВ / ВОССТАНОВЛЕНИЕ";
        title.className = "text-center text-danger";
        buttons.innerHTML = `
            <button class="btn btn-outline btn-sm" onclick="showToast('🍊 Витамин C 300мг + Магний глицинат + вода')">Сбить нагрузку (Вит C + Магний)</button>
            <button class="btn btn-outline btn-sm" onclick="addWater(500)">💧 +500мл воды для детокса</button>
        `;
        window.logEvent("sos_trigger", { type: "drugs" });
    }
};

window.startSighAnimation = () => {
    window.haptic(30);
    const circle = document.getElementById("breathSighCircle");
    if (!circle) return;
    clearInterval(breathInterval);
    let step = 0;
    const tick = () => {
        if (step === 0) {
            circle.innerText = "ВДОХ 1";
            circle.style.transform = "scale(1.05)";
            circle.style.background = "var(--success)";
        } else if (step === 1) {
            circle.innerText = "ДОВДОХ";
            circle.style.transform = "scale(1.22)";
            circle.style.background = "var(--success)";
        } else {
            circle.innerText = "ВЫДОХ...";
            circle.style.transform = "scale(0.72)";
            circle.style.background = "var(--primary)";
        }
        step = (step + 1) % 3;
    };
    tick();
    breathInterval = setInterval(tick, 2000);
};

window.stopSighAnimation = () => {
    clearInterval(breathInterval);
    const circle = document.getElementById("breathSighCircle");
    if (circle) {
        circle.innerText = "ВЗДОХ";
        circle.style.transform = "scale(1)";
        circle.style.background = "var(--primary)";
    }
};

window.startNSDR = () => {
    window.haptic(30);
    const display = document.getElementById("nsdrDisplay");
    if (!display) return;
    display.style.display = "block";
    let timeLeft = 15 * 60;
    clearInterval(nsdrInterval);
    display.innerText = "15:00";
    nsdrInterval = setInterval(() => {
        timeLeft--;
        const m = Math.floor(timeLeft / 60);
        const s = timeLeft % 60;
        display.innerText = `${m}:${String(s).padStart(2, "0")}`;
        if (timeLeft <= 0) {
            clearInterval(nsdrInterval);
            window.haptic([100, 80, 100]);
            display.innerText = "ЗАВЕРШЕНО";
            window.logCnsRecovery();
        }
    }, 1000);
    window.logEvent("nsdr_started", {});
};

document.addEventListener("DOMContentLoaded", bindPvtButton);
