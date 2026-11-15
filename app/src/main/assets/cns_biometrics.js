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

    // Strict paired filter: requires real sleep log + next-morning real PVT (no imputation)
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
            const curDayStr = sortedDays[i];
            const nextDayStr = sortedDays[i + 1];
            const curMs = Date.parse(curDayStr + "T00:00:00Z");
            const nextMs = Date.parse(nextDayStr + "T00:00:00Z");
            if (Math.round((nextMs - curMs) / 86400000) !== 1) continue;

            const today = byDay[curDayStr];
            const nextDay = byDay[nextDayStr];
            if (nextDay.pvtMedians.length > 0 && today.sleepHours !== null) {
                paired.push({
                    date: curDayStr,
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

    let cachedTriggersKey = null;
    let cachedTriggersRes = null;

    function discoverTriggers() {
        const valid = buildDailyRecords();
        const fp = valid.length + ":" + (valid[valid.length - 1]?.date || "") + ":" + (AppState.events?.length || 0);
        if (cachedTriggersKey === fp && cachedTriggersRes) {
            return cachedTriggersRes;
        }
        if (valid.length < 14) {
            cachedTriggersKey = fp;
            cachedTriggersRes = {
                status: "INSUFFICIENT_DATA",
                daysCollected: valid.length,
                daysRequired: 14,
                insights: []
            };
            return cachedTriggersRes;
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
            const M = 400;
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

        cachedTriggersKey = fp;
        cachedTriggersRes = { status: "OK", daysCollected: N, insights: verified };
        return cachedTriggersRes;
    }

    return { median, mad, buildDailyRecords, discoverTriggers };
})();

// --- Offline WebAudio 432Hz Gentle Chime (Zero MP3 assets) ---
let tankAudioCtx = null;

function unlockAudioCtx() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!tankAudioCtx) tankAudioCtx = new AudioCtx();
        if (tankAudioCtx.state === "suspended") tankAudioCtx.resume();
        return tankAudioCtx;
    } catch (_) {
        return null;
    }
}

window.suspendAudioCtx = () => {
    try {
        if (tankAudioCtx && tankAudioCtx.state === "running") {
            tankAudioCtx.suspend();
        }
    } catch (_) {}
};

function playGentleChime432() {
    try {
        const ctx = unlockAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(432, now);
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 1.55);
    } catch (_) {}
}

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

    // PVT Z-score calibration: apply ONLY if today has a PVT measurement, else neutral Z = 0
    const pvtHist = AppState.pvtHistory || [];
    const hasTodayPvt = pvtHist.some(p => p.date === today);
    if (pvtHist.length >= 3 && hasTodayPvt) {
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
    window.updatePvtBaselineUI();
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

// --- Event-Delegated Stress Trigger Chips ---
function bindTriggerChipsDelegation() {
    const box = document.getElementById("cnsTriggerChips");
    if (!box || box.dataset.delegated) return;
    box.dataset.delegated = "1";
    box.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-trigger]");
        if (!btn) return;
        window.logStressTrigger(btn.dataset.trigger);
    });
}

window.renderTriggerChips = () => {
    bindTriggerChipsDelegation();
    const box = document.getElementById("cnsTriggerChips");
    if (!box) return;
    const triggers = AppState.cnsTriggers || ["Дроны", "Тревога", "Новости", "Недосып", "Тяж. тренировка"];
    box.innerHTML = triggers.map(t =>
        `<button class="chip-btn" data-trigger="${escapeHtml(t)}">⚡ ${escapeHtml(t)}</button>`
    ).join("");
};

window.logStressTrigger = (trigger) => {
    if (!window.assertVaultUnlocked()) return;
    window.haptic(40);
    window.logEvent("stress", { trigger });
    window.calculateRecoveryScore();
    saveUIState();
    showToast(`⚡ Триггер "${trigger}" учтён (ЦНС: ${AppState.bodyBattery}/100)`);
};

// --- Sleep & Real CNS 14-day Canvas Chart ---
window.logSleep = () => {
    if (!window.assertVaultUnlocked()) return;
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
    if (!window.assertVaultUnlocked()) return;
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

// --- Heatmap & Workouts (Auto-Deload + Drift-Free Isometric Timers) ---
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
let isoEndAt = 0;

window.startIsoTimer = (seconds, type) => {
    window.haptic(30);
    unlockAudioCtx();
    clearInterval(isoTimerInterval);
    isoEndAt = Date.now() + seconds * 1000;
    const display = document.getElementById("isoTimerDisplay");
    if (display) display.innerText = `00:${String(seconds).padStart(2, "0")}`;

    isoTimerInterval = setInterval(() => {
        const remSec = Math.max(0, Math.ceil((isoEndAt - Date.now()) / 1000));
        if (display) display.innerText = `00:${String(remSec).padStart(2, "0")}`;
        if (remSec <= 0) {
            clearInterval(isoTimerInterval);
            isoTimerInterval = null;
            window.haptic([80, 60, 120]);
            playGentleChime432();
            if (VaultSession.unlocked) window.logEvent("isometric_done", { type, expected: seconds });
            showToast("🔥 Изометрия завершена!");
        }
    }, 250);
};

window.stopIsoTimer = () => {
    window.haptic(25);
    clearInterval(isoTimerInterval);
    isoTimerInterval = null;
    const display = document.getElementById("isoTimerDisplay");
    if (display) display.innerText = "00:00";
};

window.addRep = (intensity = "normal") => {
    if (!window.assertVaultUnlocked()) return;
    window.haptic(30);
    window.logEvent("isometric_rep", { intensity });
    showToast("✅ Подход записан!");
};

window.completeWorkout = () => {
    if (!window.assertVaultUnlocked()) return;
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

// --- PVT Reaction Test (rAF Vblank Calibration + event.timeStamp + pointerdown) ---
let pvtState = "idle"; // idle | waiting | arming | ready
let pvtTimeout = null;
let pvtStartPerf = 0;
let pvtTrials = [];

function bindPvtButton() {
    const btn = document.getElementById("pvtButton");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("pointerdown", (e) => {
        window.handlePvtPress(e);
    }, { passive: true });
}

window.handlePvtPress = (event) => {
    if (!window.assertVaultUnlocked()) return;
    const btn = document.getElementById("pvtButton");
    const prog = document.getElementById("pvtProgress");
    const resEl = document.getElementById("hrvResult");

    if (pvtState === "idle") {
        pvtTrials = [];
        resEl.style.display = "none";
        startNextPvtTrial(btn, prog);
        return;
    }

    if (pvtState === "arming") return;

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
        const nowPerf = performance.now();
        const rawTs = event && typeof event.timeStamp === "number" ? event.timeStamp : 0;
        const pressPerf = (rawTs > 0 && Math.abs(nowPerf - rawTs) < 500) ? rawTs : nowPerf;
        const rt = Math.max(1, Math.round(pressPerf - pvtStartPerf));
        if (rt < 100) {
            pvtState = "idle";
            window.haptic([60, 60]);
            btn.innerText = "ФАЛЬСТАРТ (<100 мс)! Жми для повтора";
            btn.className = "btn btn-danger";
            prog.innerText = "Сброшено (упреждение < 100 мс)";
            return;
        }
        pvtTrials.push(rt);
        window.haptic(25);

        if (pvtTrials.length < 5) {
            startNextPvtTrial(btn, prog);
        } else {
            pvtState = "idle";
            const medianMs = Math.round(CNSAnalytics.median(pvtTrials));
            const madMs = Math.round(CNSAnalytics.mad(pvtTrials));
            const lapses = pvtTrials.filter(x => x > 500).length;
            AppState.pvtHistory.push({ date: window.todayKey(), ts: Date.now(), medianMs, madMs, lapses, trials: pvtTrials });
            window.logEvent("pvt_series", { medianMs, madMs, lapses, trials: pvtTrials });
            window.calculateRecoveryScore();
            window.updatePvtBaselineUI();
            saveUIState();

            btn.innerText = "⚡ Повторить серию (5 замеров)";
            btn.className = "btn btn-primary";
            prog.innerText = "Серия завершена (5 / 5)";

            resEl.style.display = "block";
            resEl.innerHTML = `
                <div class="font-bold text-primary">Медиана RT: ${medianMs} мс (MAD: ${madMs} мс)</div>
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
        pvtState = "arming";
        btn.innerText = "ЖМИ!!!";
        btn.className = "btn btn-danger";
        requestAnimationFrame((frameTimestamp) => {
            if (pvtState !== "arming") return;
            pvtStartPerf = (typeof frameTimestamp === "number" && frameTimestamp > 0) ? frameTimestamp : performance.now();
            pvtState = "ready";
        });
    }, delay);
}

window.updatePvtBaselineUI = () => {
    const el = document.getElementById("pvtBaselineInfo");
    if (!el) return;
    const hist = AppState.pvtHistory || [];
    const today = window.todayKey();
    const hasTodayPvt = hist.some(h => h.date === today);

    if (hist.length < 3) {
        el.innerText = `Серий собрано: ${hist.length}/3 для расчёта личного baseline.`;
    } else {
        const med = Math.round(CNSAnalytics.median(hist.map(h => h.medianMs)));
        el.innerText = hasTodayPvt
            ? `Личный baseline (медиана по ${hist.length} сериям): ${med} мс`
            : `Baseline: ${med} мс (${hist.length} сер.) · Сегодня PVT не пройден (точность ЦНС снижена, Z=0)`;
    }
};

// --- Caffeine & Supplements (suppMeta + Archive + Event Delegation) ---
window.addCaffeine = (mg) => {
    if (!window.assertVaultUnlocked()) return;
    window.haptic(30);
    AppState.caffeineDoses.push({ amount: mg, time: Date.now() });
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

function bindSuppsContainerDelegation(el) {
    if (!el || el.dataset.delegated) return;
    el.dataset.delegated = "1";
    el.addEventListener("change", (e) => {
        const cb = e.target.closest("input[data-supp-id]");
        if (!cb) return;
        window.toggleSupp(cb.dataset.suppId, cb.checked);
    });
}

window.renderSupps = () => {
    const container = document.getElementById("suppsContainer");
    const quick = document.getElementById("quickSuppsList");
    bindSuppsContainerDelegation(container);
    bindSuppsContainerDelegation(quick);

    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    const showArchived = Boolean(document.getElementById("showArchivedSuppsToggle")?.checked);

    const buildRows = (prefix, includeArchived) => Object.keys(meta)
        .filter(key => includeArchived || !meta[key].archived)
        .map(key => {
            const item = meta[key];
            const isChecked = Boolean(AppState.supps[key]);
            const stock = AppState.suppsInventory[key] ?? 0;
            const lotInfo = item.lot ? ` <span class="text-xs text-muted">(${escapeHtml(item.lot)})</span>` : "";
            const archBadge = item.archived ? ` <span class="badge-pill">архив</span>` : "";
            const stockHtml = stock < 10
                ? `<span class="text-danger font-bold text-xs"> (${stock} шт)</span>`
                : `<span class="text-muted text-xs"> (${stock} шт)</span>`;
            const archClass = item.archived ? " supp-archived" : "";

            return `
                <div class="card bg-gray flex gap-2 align-center${archClass}" style="padding:10px; opacity:${isChecked ? 0.55 : (item.archived ? 0.5 : 1)};">
                    <input type="checkbox" id="${prefix}_${escapeHtml(key)}" class="checkbox" data-supp-id="${escapeHtml(key)}" ${isChecked ? "checked" : ""}>
                    <label for="${prefix}_${escapeHtml(key)}" style="flex:1; cursor:pointer; font-size:13px;">${escapeHtml(item.label)}${lotInfo}${stockHtml}${archBadge}</label>
                </div>
            `;
        }).join("") || "<p class='text-xs text-muted'>Нет активных добавок. Нажми ➕ БАД или включи архив.</p>";

    if (container) container.innerHTML = buildRows("supp", showArchived);
    if (quick) quick.innerHTML = buildRows("qsupp", false);
};

window.toggleSupp = (key, checkedState) => {
    if (!window.assertVaultUnlocked()) {
        window.renderSupps();
        return;
    }
    window.haptic(30);
    if (checkedState) {
        if ((AppState.suppsInventory[key] || 0) <= 0) {
            showToast("❌ Банка пуста! Пополни остатки или скрой в ⚙️ Банки.");
            window.renderSupps();
            return;
        }
        AppState.supps[key] = true;
        AppState.suppsInventory[key] -= 1;
        const label = AppState.suppMeta?.[key]?.label || key;
        window.logEvent("supp_taken", { key, label, remaining: AppState.suppsInventory[key] });
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

window.openAddSupplementModal = () => {
    if (!window.assertVaultUnlocked()) return;
    window.openAppModal("➕ Новая добавка в стек", `
        <div class="flex-col gap-2">
            <div class="input-group">
                <label>Название и дозировка</label>
                <input type="text" id="newSuppName" placeholder="Напр: Цинк пиколинат 25mg">
            </div>
            <div class="grid-2 gap-2">
                <div class="input-group">
                    <label>Количество (шт)</label>
                    <input type="number" id="newSuppStock" value="30">
                </div>
                <div class="input-group">
                    <label>Серия / Срок (опц.)</label>
                    <input type="text" id="newSuppLot" placeholder="до 10.2027">
                </div>
            </div>
            <button class="btn btn-success mt-1" onclick="saveNewSupplementFromModal()">✅ Добавить в стек</button>
        </div>
    `);
};

window.saveNewSupplementFromModal = () => {
    if (!window.assertVaultUnlocked()) return;
    const rawName = (document.getElementById("newSuppName").value || "").trim();
    const stock = Math.max(0, safeParseInt(document.getElementById("newSuppStock").value, 30));
    const lot = (document.getElementById("newSuppLot").value || "").trim();
    if (!rawName) return showToast("Укажи название добавки!");

    const id = "supp_" + Date.now().toString(36);
    const label = /^[^\w\sа-яА-ЯёЁ]/.test(rawName) ? rawName : `💊 ${rawName}`;
    AppState.suppMeta[id] = { id, label, lot, archived: false };
    AppState.supps[id] = false;
    AppState.suppsInventory[id] = stock;
    window.logEvent("supp_added", { id, label, stock });
    saveUIState();
    window.closeAppModal();
    window.renderSupps();
    showToast(`✅ Добавлено: ${rawName}`);
};

window.toggleArchiveSupplementInModal = (key) => {
    if (!window.assertVaultUnlocked()) return;
    const item = AppState.suppMeta?.[key];
    if (!item) return;
    item.archived = !item.archived;
    if (item.archived) AppState.supps[key] = false;
    saveUIState();
    window.renderSupps();
    window.openSuppsInventoryModal();
};

window.openSuppsInventoryModal = () => {
    if (!window.assertVaultUnlocked()) return;
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    const rows = Object.keys(meta).map(key => {
        const item = meta[key];
        const archText = item.archived ? "♻️ Вернуть" : "📦 В архив";
        return `
            <div class="card bg-dark mb-1" style="padding:8px;">
                <div class="flex justify-between align-center mb-1 gap-1">
                    <span class="text-xs font-bold">${escapeHtml(item.label)}</span>
                    <button type="button" class="btn btn-outline btn-sm" style="width:auto; min-height:30px; padding:2px 8px;" data-action="toggle-archive-supp" data-supp-id="${escapeHtml(key)}">${archText}</button>
                </div>
                <div class="grid-2 gap-1">
                    <input type="number" data-inv-qty="${escapeHtml(key)}" value="${AppState.suppsInventory[key] ?? 0}" placeholder="Кол-во">
                    <input type="text" data-inv-lot="${escapeHtml(key)}" value="${escapeHtml(item.lot || "")}" placeholder="Срок / серия">
                </div>
            </div>
        `;
    }).join("");

    window.openAppModal("⚙️ Остатки, сроки и архив БАДов", `
        <div id="suppInventoryModalList" class="flex-col gap-1">${rows}</div>
        <button class="btn btn-success mt-2" onclick="saveSuppsInventoryModal()">💾 Сохранить банки</button>
    `);

    const listEl = document.getElementById("suppInventoryModalList");
    if (listEl) {
        listEl.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-action='toggle-archive-supp']");
            if (btn) window.toggleArchiveSupplementInModal(btn.dataset.suppId);
        });
    }
};

window.saveSuppsInventoryModal = () => {
    if (!window.assertVaultUnlocked()) return;
    const meta = AppState.suppMeta || window.DEFAULT_SUPP_META;
    const modalBody = document.getElementById("appModalBody");
    if (modalBody) {
        modalBody.querySelectorAll("input[data-inv-qty]").forEach(inp => {
            const k = inp.dataset.invQty;
            AppState.suppsInventory[k] = Math.max(0, safeParseInt(inp.value, 0));
        });
        modalBody.querySelectorAll("input[data-inv-lot]").forEach(inp => {
            const k = inp.dataset.invLot;
            if (meta[k]) meta[k].lot = (inp.value || "").trim();
        });
    }
    saveUIState();
    window.closeAppModal();
    window.renderSupps();
    showToast("✅ Остатки БАДов обновлены!");
};

// --- SOS Protocols (Safe in Lockscreen Mode + Drift-Free NSDR + 432Hz Chime) ---
let breathInterval = null;
let nsdrInterval = null;
let nsdrEndAt = 0;

window.stopAllSosTimers = () => {
    clearInterval(breathInterval);
    breathInterval = null;
    clearInterval(nsdrInterval);
    nsdrInterval = null;
    clearInterval(isoTimerInterval);
    isoTimerInterval = null;

    const circle = document.getElementById("breathSighCircle");
    if (circle) {
        circle.innerText = "ВЗДОХ";
        circle.style.transform = "scale(1)";
        circle.style.background = "var(--primary)";
    }
    const nsdr = document.getElementById("nsdrDisplay");
    if (nsdr) {
        nsdr.style.display = "none";
        nsdr.innerText = "15:00";
    }
    const iso = document.getElementById("isoTimerDisplay");
    if (iso) iso.innerText = "00:00";
};

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
        if (VaultSession.unlocked) window.logEvent("sos_trigger", { type: "panic" });
    } else if (category === "alcohol") {
        title.innerText = "🍺 АЛКОГОЛЬНЫЙ СРЫВ";
        title.className = "text-center text-warning";
        buttons.innerHTML = `
            <p class="text-xs text-muted text-center">Протокол: 500 мл чистой воды + Гавискон + Янтарная кислота 100 мг + Магний глицинат 400 мг.</p>
            <button class="btn btn-outline btn-sm auth-only-control" onclick="addWater(500); showToast('💧 +500мл воды учтено + выпей Гавискон')">💧 Записать +500мл воды в трекер</button>
            <button class="btn btn-outline btn-sm" onclick="showToast('💊 Янтарная кислота 100мг + Магний 400мг')">💊 Напоминание по фарме</button>
        `;
        if (VaultSession.unlocked) window.logEvent("sos_trigger", { type: "alcohol" });
    } else if (category === "drugs") {
        title.innerText = "💊 ПАВ / ВОССТАНОВЛЕНИЕ";
        title.className = "text-center text-danger";
        buttons.innerHTML = `
            <p class="text-xs text-muted text-center">Протокол: Витамин C 300 мг + Магний глицинат 400 мг + вода маленькими глотками + тишина.</p>
            <button class="btn btn-outline btn-sm" onclick="showToast('🍊 Витамин C 300мг + Магний глицинат + вода')">Сбить нагрузку (памятка)</button>
            <button class="btn btn-outline btn-sm auth-only-control" onclick="addWater(500)">💧 Записать +500мл воды для детокса</button>
        `;
        if (VaultSession.unlocked) window.logEvent("sos_trigger", { type: "drugs" });
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
    breathInterval = null;
    const circle = document.getElementById("breathSighCircle");
    if (circle) {
        circle.innerText = "ВЗДОХ";
        circle.style.transform = "scale(1)";
        circle.style.background = "var(--primary)";
    }
};

window.startNSDR = () => {
    window.haptic(30);
    unlockAudioCtx();
    const display = document.getElementById("nsdrDisplay");
    if (!display) return;
    display.style.display = "block";
    nsdrEndAt = Date.now() + 15 * 60 * 1000;
    clearInterval(nsdrInterval);
    display.innerText = "15:00";

    nsdrInterval = setInterval(() => {
        const timeLeft = Math.max(0, Math.ceil((nsdrEndAt - Date.now()) / 1000));
        const m = Math.floor(timeLeft / 60);
        const s = timeLeft % 60;
        display.innerText = `${m}:${String(s).padStart(2, "0")}`;
        if (timeLeft <= 0) {
            clearInterval(nsdrInterval);
            nsdrInterval = null;
            window.haptic([100, 80, 100]);
            playGentleChime432();
            display.innerText = "ЗАВЕРШЕНО";
            if (VaultSession.unlocked) window.logCnsRecovery();
        }
    }, 250);

    if (VaultSession.unlocked) window.logEvent("nsdr_started", {});
};

document.addEventListener("DOMContentLoaded", bindPvtButton);
