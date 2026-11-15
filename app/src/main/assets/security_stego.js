"use strict";

// --- Safe Recursive-Descent Math Evaluator (No eval / No new Function) ---
function evaluateSafeMath(expr) {
    const tokens = expr.replace(/\s+/g, "").match(/\d+(\.\d+)?|[+\-*/()]/g);
    if (!tokens || tokens.join("") !== expr.replace(/\s+/g, "")) {
        throw new Error("Invalid expression");
    }
    let pos = 0;

    function parseExpr() {
        let left = parseTerm();
        while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
            const op = tokens[pos++];
            const right = parseTerm();
            left = op === "+" ? left + right : left - right;
        }
        return left;
    }

    function parseTerm() {
        let left = parseFactor();
        while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/")) {
            const op = tokens[pos++];
            const right = parseFactor();
            if (op === "/" && right === 0) throw new Error("Div0");
            left = op === "*" ? left * right : left / right;
        }
        return left;
    }

    function parseFactor() {
        const tok = tokens[pos];
        if (tok === "-") { pos++; return -parseFactor(); }
        if (tok === "+") { pos++; return parseFactor(); }
        if (tok === "(") {
            pos++;
            const val = parseExpr();
            if (tokens[pos++] !== ")") throw new Error("Paren");
            return val;
        }
        pos++;
        const num = parseFloat(tok);
        if (isNaN(num)) throw new Error("NaN");
        return num;
    }

    const res = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(res)) throw new Error("Syntax");
    return Math.round(res * 1e8) / 1e8;
}

// --- Stealth Calculator & Dual-PIN Crypto-Vault Gate ---
let currentCalc = "";
let eqHoldTimer = null;
let eqLongPressTriggered = false;

window.initStealthGate = () => {
    const setupBox = document.getElementById("vaultSetupContainer");
    const calcBox = document.getElementById("calcModeContainer");

    const hasNativeVault = Boolean(window.AndroidBridge && window.AndroidBridge.isVaultInitialized);
    let initialized = false;
    if (hasNativeVault) {
        initialized = window.AndroidBridge.isVaultInitialized();
    } else {
        initialized = Boolean(localStorage.getItem("vt_browser_vault_init"));
    }

    if (!initialized) {
        setupBox.style.display = "flex";
        calcBox.style.display = "none";
    } else {
        setupBox.style.display = "none";
        calcBox.style.display = "flex";
    }

    const eqBtn = document.getElementById("calcEqBtn");
    if (eqBtn && !eqBtn.dataset.holdBound) {
        eqBtn.dataset.holdBound = "1";
        const startHold = () => {
            eqLongPressTriggered = false;
            eqHoldTimer = setTimeout(() => {
                eqLongPressTriggered = true;
                window.haptic([80, 60, 120]);
                document.getElementById("loginOverlay").style.display = "none";
                window.showModule("sos");
                if (window.showSosCategory) window.showSosCategory("panic");
            }, 800);
        };
        const cancelHold = () => clearTimeout(eqHoldTimer);
        eqBtn.addEventListener("pointerdown", startHold, { passive: true });
        eqBtn.addEventListener("pointerup", cancelHold, { passive: true });
        eqBtn.addEventListener("pointercancel", cancelHold, { passive: true });
        eqBtn.addEventListener("pointerleave", cancelHold, { passive: true });
    }
};

window.completeVaultSetup = () => {
    const realPin = (document.getElementById("setupRealPin").value || "").trim();
    const decoyPin = (document.getElementById("setupDecoyPin").value || "").trim();
    const panicPin = (document.getElementById("setupPanicPin").value || "").trim();

    if (!realPin || !decoyPin) return showToast("Укажи оба PIN (Реальный и Фейковый)");
    if (realPin === decoyPin) return showToast("Реальный и Фейковый PIN должны отличаться!");
    if (panicPin && (panicPin === realPin || panicPin === decoyPin)) {
        return showToast("Panic PIN не должен совпадать с рабочими PIN!");
    }

    const btn = document.getElementById("btnInitVault");
    btn.disabled = true;
    btn.innerText = "⏳ Создание AES-256 сейфа...";

    window._pendingSetupPins = { realPin };
    const initialJson = JSON.stringify(AppState);

    if (window.AndroidBridge && window.AndroidBridge.setupVaultAsync) {
        window.AndroidBridge.setupVaultAsync(realPin, decoyPin, panicPin, initialJson, "onVaultSetupDone");
    } else {
        localStorage.setItem("vt_browser_vault_init", "1");
        localStorage.setItem("vt_browser_pin_real", realPin);
        localStorage.setItem("vt_browser_pin_decoy", decoyPin);
        if (panicPin) localStorage.setItem("vt_browser_pin_panic", panicPin);
        sessionStorage.setItem("vt_fallback_slot_0", initialJson);
        window.onVaultSetupDone(JSON.stringify({ ok: true }));
    }
};

window.onVaultSetupDone = (resStr) => {
    const btn = document.getElementById("btnInitVault");
    if (btn) { btn.disabled = false; btn.innerText = "Создать и войти"; }
    try {
        const res = JSON.parse(resStr);
        if (!res.ok) return showToast("❌ Ошибка инициализации сейфа");

        VaultSession.unlocked = true;
        VaultSession.slot = 0;
        VaultSession.pin = window._pendingSetupPins?.realPin || "";
        window._pendingSetupPins = null;

        document.getElementById("vaultSetupContainer").style.display = "none";
        document.getElementById("calcModeContainer").style.display = "flex";
        document.getElementById("loginOverlay").style.display = "none";
        window.hydrateAllUI();
        showToast("🔐 Крипто-сейф создан!");
    } catch (_) {
        showToast("❌ Ошибка ответа Vault");
    }
};

window.calcInput = (char) => {
    window.haptic(20);
    if (char === "C") {
        currentCalc = "";
    } else {
        currentCalc += char;
    }
    document.getElementById("calcDisplay").innerText = currentCalc || "0";
};

window.calcEq = () => {
    if (eqLongPressTriggered) {
        eqLongPressTriggered = false;
        return;
    }
    if (!currentCalc) return;
    const candidate = currentCalc;

    if (window.AndroidBridge && window.AndroidBridge.unlockVaultAsync) {
        window._pendingAttemptPin = candidate;
        document.getElementById("calcDisplay").innerText = "...";
        window.AndroidBridge.unlockVaultAsync(candidate, "onVaultUnlockResult");
    } else {
        // Browser fallback
        const real = localStorage.getItem("vt_browser_pin_real");
        const decoy = localStorage.getItem("vt_browser_pin_decoy");
        const panic = localStorage.getItem("vt_browser_pin_panic");
        if (candidate === panic) {
            localStorage.clear();
            sessionStorage.clear();
            window.onVaultUnlockResult(JSON.stringify({ status: "WIPED", slot: 1, stateJson: "{}" }));
        } else if (candidate === real) {
            const raw = sessionStorage.getItem("vt_fallback_slot_0") || "{}";
            window.onVaultUnlockResult(JSON.stringify({ status: "OK", slot: 0, stateJson: raw }));
        } else if (candidate === decoy) {
            const raw = sessionStorage.getItem("vt_fallback_slot_1") || "{}";
            window.onVaultUnlockResult(JSON.stringify({ status: "OK", slot: 1, stateJson: raw }));
        } else {
            window.onVaultUnlockResult(JSON.stringify({ status: "DENIED" }));
        }
    }
};

window.onVaultUnlockResult = (resStr) => {
    try {
        const res = JSON.parse(resStr);
        if (res.status === "OK" || res.status === "WIPED") {
            VaultSession.unlocked = true;
            VaultSession.slot = res.slot || 0;
            VaultSession.pin = window._pendingAttemptPin || "";
            window._pendingAttemptPin = null;

            const parsedState = res.stateJson ? JSON.parse(res.stateJson) : {};
            window.AppState = window.mergeStateWithDefaults(parsedState);

            currentCalc = "";
            document.getElementById("calcDisplay").innerText = "0";
            document.getElementById("loginOverlay").style.display = "none";
            window.hydrateAllUI();

            if (res.status === "WIPED") {
                showToast("🧹 Крипто-шреддинг выполнен");
            }
            return;
        }
    } catch (_) {}

    // Not a PIN — evaluate safely as math expression
    window._pendingAttemptPin = null;
    try {
        currentCalc = String(evaluateSafeMath(currentCalc));
        document.getElementById("calcDisplay").innerText = currentCalc;
    } catch (_) {
        document.getElementById("calcDisplay").innerText = "Err";
        currentCalc = "";
    }
};

window.changeVaultPinsUI = () => {
    const oldPin = (document.getElementById("oldRealPin").value || "").trim();
    const newReal = (document.getElementById("newRealPin").value || "").trim();
    const newDecoy = (document.getElementById("newDecoyPin").value || "").trim();
    const newPanic = (document.getElementById("newPanicPin").value || "").trim();

    if (VaultSession.slot !== 0) return showToast("Смена PIN доступна только в основном профиле");
    if (oldPin !== VaultSession.pin) return showToast("❌ Текущий Реальный PIN неверный");
    if (!newReal || !newDecoy || newReal === newDecoy) return showToast("❌ Заполни разные Real и Decoy PIN");

    window._pendingSetupPins = { realPin: newReal };
    if (window.AndroidBridge && window.AndroidBridge.setupVaultAsync) {
        window.AndroidBridge.setupVaultAsync(newReal, newDecoy, newPanic, JSON.stringify(AppState), "onPinsUpdated");
    } else {
        localStorage.setItem("vt_browser_pin_real", newReal);
        localStorage.setItem("vt_browser_pin_decoy", newDecoy);
        if (newPanic) localStorage.setItem("vt_browser_pin_panic", newPanic);
        window.onPinsUpdated(JSON.stringify({ ok: true }));
    }
};

window.onPinsUpdated = (resStr) => {
    try {
        const res = JSON.parse(resStr);
        if (res.ok && window._pendingSetupPins) {
            VaultSession.pin = window._pendingSetupPins.realPin;
            window._pendingSetupPins = null;
            ["oldRealPin", "newRealPin", "newDecoyPin", "newPanicPin"].forEach(id => {
                document.getElementById(id).value = "";
            });
            showToast("✅ Vault перешифрован под новые PIN!");
        }
    } catch (_) {
        showToast("❌ Ошибка перешифровки");
    }
};

// --- Native WebCrypto + CompressionStream Stego & .tank Backup ---
const StegoVault = (() => {
    const MAGIC = new Uint8Array([0x56, 0x54, 0x4E, 0x4B]); // VTNK
    const PBKDF2_ITER = 150000;

    async function deriveKey(password, salt, usage) {
        const keyMat = await crypto.subtle.importKey(
            "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
        );
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" },
            keyMat,
            { name: "AES-GCM", length: 256 },
            false,
            [usage]
        );
    }

    async function streamTransform(uint8Data, transformStream) {
        const writer = transformStream.writable.getWriter();
        writer.write(uint8Data);
        writer.close();
        const chunks = [];
        const reader = transformStream.readable.getReader();
        let total = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.byteLength;
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
        return out;
    }

    async function encryptPayloadBytes(stateObj, password) {
        const rawUtf8 = new TextEncoder().encode(JSON.stringify(stateObj));
        const compressed = await streamTransform(rawUtf8, new CompressionStream("deflate-raw"));
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(password, salt, "encrypt");
        const ciphertext = new Uint8Array(
            await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed)
        );
        const payloadLen = salt.length + iv.length + ciphertext.length;
        const packet = new Uint8Array(8 + payloadLen);
        packet.set(MAGIC, 0);
        new DataView(packet.buffer).setUint32(4, payloadLen, false);
        packet.set(salt, 8);
        packet.set(iv, 24);
        packet.set(ciphertext, 36);
        return packet;
    }

    async function decryptPayloadBytes(packet, password) {
        if (packet.length < 40) throw new Error("Файл слишком мал");
        for (let i = 0; i < 4; i++) {
            if (packet[i] !== MAGIC[i]) throw new Error("Неверная сигнатура VTNK");
        }
        const payloadLen = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(4, false);
        if (payloadLen <= 28 || payloadLen + 8 > packet.length) throw new Error("Повреждён заголовок");
        const salt = packet.slice(8, 24);
        const iv = packet.slice(24, 36);
        const ciphertext = packet.slice(36, 8 + payloadLen);
        const key = await deriveKey(password, salt, "decrypt");
        let compressed;
        try {
            compressed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
        } catch {
            throw new Error("Неверный пароль или файл повреждён");
        }
        const rawUtf8 = await streamTransform(compressed, new DecompressionStream("deflate-raw"));
        return JSON.parse(new TextDecoder().decode(rawUtf8));
    }

    async function encodeToPngBytes(stateObj, password) {
        const packet = await encryptPayloadBytes(stateObj, password);
        const totalBits = packet.length * 8;
        const minPixels = Math.ceil(totalBits / 3) + 1024;
        const side = Math.max(512, Math.ceil(Math.sqrt(minPixels)));

        const canvas = document.createElement("canvas");
        canvas.width = side;
        canvas.height = side;
        const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
        const imgData = ctx.createImageData(side, side);
        const px = imgData.data;

        const noiseBuf = new Uint8Array(side * 4);
        for (let y = 0; y < side; y++) {
            crypto.getRandomValues(noiseBuf);
            for (let x = 0; x < side; x++) {
                const idx = (y * side + x) * 4;
                px[idx] = Math.min(248, Math.max(8, Math.floor((x / side) * 90 + 20) + (noiseBuf[x * 4] & 7)));
                px[idx + 1] = Math.min(248, Math.max(8, Math.floor((y / side) * 110 + 30) + (noiseBuf[x * 4 + 1] & 7)));
                px[idx + 2] = Math.min(248, Math.max(8, Math.floor(((x + y) / (2 * side)) * 130 + 40) + (noiseBuf[x * 4 + 2] & 7)));
                px[idx + 3] = 255; // Strict Alpha=255
            }
        }

        let bitIdx = 0;
        for (let i = 0; i < px.length && bitIdx < totalBits; i += 4) {
            for (let ch = 0; ch < 3 && bitIdx < totalBits; ch++) {
                const bytePos = bitIdx >> 3;
                const bitShift = 7 - (bitIdx & 7);
                const bit = (packet[bytePos] >> bitShift) & 1;
                px[i + ch] = (px[i + ch] & 0xFE) | bit;
                bitIdx++;
            }
        }

        ctx.putImageData(imgData, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        return new Uint8Array(await blob.arrayBuffer());
    }

    async function decodeFromPngBlob(pngBlob, password) {
        const bitmap = await createImageBitmap(pngBlob, {
            colorSpaceConversion: "none",
            premultiplyAlpha: "none"
        });
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        function readBytes(startBit, byteCount) {
            const out = new Uint8Array(byteCount);
            let bitIdx = startBit;
            for (let b = 0; b < byteCount; b++) {
                let val = 0;
                for (let bit = 0; bit < 8; bit++) {
                    const pixelIdx = Math.floor(bitIdx / 3) * 4;
                    const channel = bitIdx % 3;
                    if (pixelIdx + channel >= px.length) throw new Error("Неожиданный конец PNG");
                    val = (val << 1) | (px[pixelIdx + channel] & 1);
                    bitIdx++;
                }
                out[b] = val;
            }
            return out;
        }

        const header = readBytes(0, 8);
        for (let i = 0; i < 4; i++) {
            if (header[i] !== MAGIC[i]) throw new Error("Бэкап не найден (вероятно, PNG был сжат мессенджером)");
        }
        const payloadLen = new DataView(header.buffer).getUint32(4, false);
        if (payloadLen <= 28 || payloadLen > 50 * 1024 * 1024) throw new Error("Повреждённый заголовок PNG");
        const payload = readBytes(64, payloadLen);
        const packet = new Uint8Array(8 + payloadLen);
        packet.set(header, 0);
        packet.set(payload, 8);
        return decryptPayloadBytes(packet, password);
    }

    return { encryptPayloadBytes, decryptPayloadBytes, encodeToPngBytes, decodeFromPngBlob };
})();

window.exportStegoBackup = async () => {
    const pass = (document.getElementById("steganoPassInput").value || "").trim();
    if (pass.length < 4) return showToast("Введи пароль (от 4 символов) в поле выше!");
    try {
        showToast("⏳ Упаковка PNG (AES-256-GCM)...");
        const pngBytes = await StegoVault.encodeToPngBytes({ AppState, ts: new Date().toISOString() }, pass);
        window.saveFileToDownloads(`tank_stego_${window.todayKey()}.png`, "image/png", pngBytes, false);
    } catch (e) {
        showToast("❌ Ошибка стего-экспорта: " + e.message);
    }
};

window.importStegoBackup = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const pass = (document.getElementById("steganoPassInput").value || "").trim();
    if (pass.length < 4) return showToast("Сначала введи пароль расшифровки в поле выше!");
    try {
        showToast("⏳ Расшифровка PNG...");
        const payload = await StegoVault.decodeFromPngBlob(file, pass);
        if (!payload || !payload.AppState) throw new Error("Пустой снимок");
        window.AppState = window.mergeStateWithDefaults(payload.AppState);
        window.flushVaultNow();
        window.hydrateAllUI();
        showToast("✅ База успешно восстановлена из PNG!");
    } catch (e) {
        showToast("❌ " + e.message);
    }
};

window.exportEncryptedJSON = async () => {
    const pass = (document.getElementById("tankBackupPassInput").value || "").trim();
    if (pass.length < 4) return showToast("Введи пароль для .tank (от 4 символов)!");
    try {
        const bytes = await StegoVault.encryptPayloadBytes({ AppState, ts: new Date().toISOString() }, pass);
        window.saveFileToDownloads(`VeinyTank_${window.todayKey()}.tank`, "application/octet-stream", bytes, false);
    } catch (e) {
        showToast("❌ Ошибка экспорта .tank: " + e.message);
    }
};

window.importEncryptedJSON = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const pass = (document.getElementById("tankBackupPassInput").value || "").trim();
    if (pass.length < 4) return showToast("Сначала введи пароль от .tank в поле выше!");
    try {
        const buf = new Uint8Array(await file.arrayBuffer());
        const payload = await StegoVault.decryptPayloadBytes(buf, pass);
        if (!payload || !payload.AppState) throw new Error("Неверный формат .tank");
        window.AppState = window.mergeStateWithDefaults(payload.AppState);
        window.flushVaultNow();
        window.hydrateAllUI();
        showToast("✅ База восстановлена из .tank!");
    } catch (e) {
        showToast("❌ " + e.message);
    }
};

// --- QR Code Generator ---
window.generateSummaryQR = () => {
    const box = document.getElementById("qrOutput");
    if (!box) return;
    if (typeof QRCode === "undefined") return showToast("QRCode модуль не загружен");

    let text = (document.getElementById("qrInputText").value || "").trim();
    if (!text) {
        const d = AppState.dossier || {};
        text = `VeinyTank|BB:${AppState.bodyBattery}|Blood:${d.blood || "-"}|Allergy:${d.allergies || "none"}|Cond:${(d.conditions || "-").slice(0, 60)}`;
    }
    box.innerHTML = "";
    box.style.display = "flex";
    new QRCode(box, { text, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
};
