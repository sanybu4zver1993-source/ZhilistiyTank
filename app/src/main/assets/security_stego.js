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

// --- Stealth Calculator, Single-PIN Onboarding & RAM-only Vault Gate ---
let currentCalc = "";
let eqHoldTimer = null;
let eqLongPressTriggered = false;
let isUnlockingVault = false;
let versionTapCount = 0;
let versionTapTimer = null;

window.openLockscreenSOS = () => {
    if (VaultSession.unlocked) {
        document.body.classList.remove("lockscreen-sos-mode");
        document.getElementById("loginOverlay").style.display = "none";
        window.showModule("sos");
        if (window.showSosCategory) window.showSosCategory("panic");
        return;
    }
    document.body.classList.add("lockscreen-sos-mode");
    document.getElementById("loginOverlay").style.display = "none";
    document.querySelectorAll(".module").forEach(el => el.classList.remove("active"));
    const sosMod = document.getElementById("module-sos");
    if (sosMod) sosMod.classList.add("active");
    if (window.showSosCategory) window.showSosCategory("panic");
};

window.exitLockscreenSOS = () => {
    if (window.stopAllSosTimers) window.stopAllSosTimers();
    document.body.classList.remove("lockscreen-sos-mode");
    const sosMod = document.getElementById("module-sos");
    if (sosMod) sosMod.classList.remove("active");
    const sosSub = document.getElementById("sosSubContainer");
    if (sosSub) sosSub.style.display = "none";
    document.getElementById("loginOverlay").style.display = "flex";
};

window.initStealthGate = () => {
    const setupBox = document.getElementById("vaultSetupContainer");
    const calcBox = document.getElementById("calcModeContainer");

    const hasNativeVault = Boolean(window.AndroidBridge && window.AndroidBridge.isVaultInitialized);
    const initialized = hasNativeVault
        ? window.AndroidBridge.isVaultInitialized()
        : Boolean(localStorage.getItem("vt_browser_vault_init"));

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
                window.openLockscreenSOS();
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
    if (realPin.length < 4) return showToast("Задай PIN от 4 символов (цифры или формула)!");

    const btn = document.getElementById("btnInitVault");
    btn.disabled = true;
    btn.innerText = "⏳ Создание AES-256 сейфа...";

    const initialJson = JSON.stringify(AppState);

    if (window.AndroidBridge && window.AndroidBridge.setupVaultSinglePinAsync) {
        window.AndroidBridge.setupVaultSinglePinAsync(realPin, initialJson, "onVaultSetupDone");
    } else {
        localStorage.setItem("vt_browser_vault_init", "1");
        localStorage.setItem("vt_browser_pin_real", realPin);
        sessionStorage.setItem("vt_fallback_slot_0", initialJson);
        window.onVaultSetupDone(JSON.stringify({ ok: true }));
    }
};

window.onVaultSetupDone = (resStr) => {
    const btn = document.getElementById("btnInitVault");
    if (btn) { btn.disabled = false; btn.innerText = "Создать и войти"; }
    const setupInput = document.getElementById("setupRealPin");
    if (setupInput) setupInput.value = "";

    try {
        const res = JSON.parse(resStr);
        if (!res.ok) return showToast("❌ Ошибка инициализации сейфа");

        VaultSession.unlocked = true;
        VaultSession.slot = 0;

        document.getElementById("vaultSetupContainer").style.display = "none";
        document.getElementById("calcModeContainer").style.display = "flex";
        document.getElementById("loginOverlay").style.display = "none";
        window.showModule("dashboard");
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
    if (!currentCalc || isUnlockingVault) return;
    const candidate = currentCalc;

    // Fast path (0.1ms): short inputs (< 4 chars) cannot be a PIN -> evaluate math immediately in JS
    if (candidate.length < 4) {
        try {
            currentCalc = String(evaluateSafeMath(candidate));
            document.getElementById("calcDisplay").innerText = currentCalc;
        } catch (_) {
            document.getElementById("calcDisplay").innerText = "Err";
            currentCalc = "";
        }
        return;
    }

    if (window.AndroidBridge && window.AndroidBridge.unlockVaultAsync) {
        isUnlockingVault = true;
        document.getElementById("calcDisplay").innerText = "...";
        window.AndroidBridge.unlockVaultAsync(candidate, "onVaultUnlockResult");
    } else {
        const real = localStorage.getItem("vt_browser_pin_real");
        const decoy = localStorage.getItem("vt_browser_pin_decoy");
        const panic = localStorage.getItem("vt_browser_pin_panic");
        if (panic && candidate === panic) {
            localStorage.clear();
            sessionStorage.clear();
            window.onVaultUnlockResult(JSON.stringify({ status: "WIPED", slot: 1, stateJson: "{}" }));
        } else if (real && candidate === real) {
            const raw = sessionStorage.getItem("vt_fallback_slot_0") || "{}";
            window.onVaultUnlockResult(JSON.stringify({ status: "OK", slot: 0, stateJson: raw }));
        } else if (decoy && candidate === decoy) {
            const raw = sessionStorage.getItem("vt_fallback_slot_1") || "{}";
            window.onVaultUnlockResult(JSON.stringify({ status: "OK", slot: 1, stateJson: raw }));
        } else {
            window.onVaultUnlockResult(JSON.stringify({ status: "DENIED" }));
        }
    }
};

window.onVaultUnlockResult = (resStr) => {
    isUnlockingVault = false;
    try {
        const res = JSON.parse(resStr);
        if (res.status === "OK" || res.status === "WIPED") {
            VaultSession.unlocked = true;
            VaultSession.slot = res.slot || 0;

            const parsedState = res.stateJson ? JSON.parse(res.stateJson) : {};
            window.AppState = window.mergeStateWithDefaults(parsedState);

            currentCalc = "";
            document.getElementById("calcDisplay").innerText = "0";
            document.body.classList.remove("lockscreen-sos-mode");
            document.getElementById("loginOverlay").style.display = "none";
            window.showModule("dashboard");
            window.hydrateAllUI();

            if (res.status === "WIPED") {
                showToast("🧹 Крипто-шреддинг выполнен");
            }
            return;
        }
    } catch (_) {}

    // Not a valid PIN — evaluate safely as math expression
    try {
        currentCalc = String(evaluateSafeMath(currentCalc));
        document.getElementById("calcDisplay").innerText = currentCalc;
    } catch (_) {
        document.getElementById("calcDisplay").innerText = "Err";
        currentCalc = "";
    }
};

// --- Slot-Neutral PIN Change (Works identically in Slot 0 & Slot 1 for Plausible Deniability) ---
window.changeCurrentSlotPinUI = () => {
    if (!window.assertVaultUnlocked()) return;
    const oldPin = (document.getElementById("oldCurrentPin").value || "").trim();
    const newPin = (document.getElementById("newCurrentPin").value || "").trim();

    if (!oldPin) return showToast("Введи текущий PIN-код");
    if (newPin.length < 4) return showToast("Новый PIN должен быть от 4 символов!");

    if (window.AndroidBridge && window.AndroidBridge.changeCurrentSlotPinAsync) {
        window.AndroidBridge.changeCurrentSlotPinAsync(oldPin, newPin, "onCurrentPinChanged");
    } else {
        const key = VaultSession.slot === 1 ? "vt_browser_pin_decoy" : "vt_browser_pin_real";
        if (oldPin !== localStorage.getItem(key)) {
            return window.onCurrentPinChanged(JSON.stringify({ status: "WRONG_PIN" }));
        }
        localStorage.setItem(key, newPin);
        window.onCurrentPinChanged(JSON.stringify({ status: "OK" }));
    }
};

window.onCurrentPinChanged = (resStr) => {
    try {
        const res = JSON.parse(resStr);
        if (res.status === "OK") {
            document.getElementById("oldCurrentPin").value = "";
            document.getElementById("newCurrentPin").value = "";
            showToast("✅ PIN-код доступа обновлён!");
        } else if (res.status === "WRONG_PIN") {
            showToast("❌ Текущий PIN введён неверно");
        } else if (res.status === "INVALID_NEW_PIN") {
            showToast("❌ Новый PIN слишком короткий");
        } else if (res.status === "LOCKED") {
            window.lockToStealth();
        } else {
            showToast("❌ Ошибка смены PIN");
        }
    } catch (_) {
        showToast("❌ Ошибка ответа Vault");
    }
};

// --- Hidden 5-Tap Security Config (Strictly Slot 0; innocent toast in Slot 1) ---
window.handleVersionTap = () => {
    versionTapCount++;
    clearTimeout(versionTapTimer);
    versionTapTimer = setTimeout(() => { versionTapCount = 0; }, 3000);

    if (versionTapCount < 5) return;
    versionTapCount = 0;

    if (!VaultSession.unlocked || VaultSession.slot !== 0) {
        showToast("Сборка актуальна: v4.2-release");
        return;
    }

    window.openAppModal("🛡 Дополнительные коды (Слот 0)", `
        <div class="flex-col gap-2">
            <p class="text-xs text-muted">Опционально задай второй (фейковый) профиль и PIN экстренного крипто-шреддинга. Пустые поля отключают соответствующий код (Слот 1 заполняется неотличимым шумом).</p>
            <div class="input-group">
                <label>Подтверди текущий основной PIN</label>
                <input type="password" id="hiddenRealPinConfirm" placeholder="Твой основной PIN">
            </div>
            <div class="input-group">
                <label>Дополнительный PIN (Слот 1, опц.)</label>
                <input type="text" id="hiddenDecoyPin" placeholder="Пусто = отключён (от 4 симв.)">
            </div>
            <div class="input-group">
                <label>Экстренный Wipe PIN (шреддинг, опц.)</label>
                <input type="text" id="hiddenPanicPin" placeholder="Пусто = отключён (от 4 симв.)">
            </div>
            <button class="btn btn-primary mt-1" onclick="saveHiddenCodesFromModal()">🔐 Применить конфигурацию</button>
        </div>
    `);
};

window.saveHiddenCodesFromModal = () => {
    if (!window.assertVaultUnlocked() || VaultSession.slot !== 0) return;
    const realPin = (document.getElementById("hiddenRealPinConfirm").value || "").trim();
    const decoyPin = (document.getElementById("hiddenDecoyPin").value || "").trim();
    const panicPin = (document.getElementById("hiddenPanicPin").value || "").trim();

    if (!realPin) return showToast("Введи основной PIN для подтверждения!");
    if (decoyPin && (decoyPin.length < 4 || decoyPin === realPin)) {
        return showToast("Дополнительный PIN должен быть от 4 симв. и отличаться от основного!");
    }
    if (panicPin && (panicPin.length < 4 || panicPin === realPin || panicPin === decoyPin)) {
        return showToast("Wipe PIN должен быть от 4 симв. и не совпадать с рабочими!");
    }

    if (window.AndroidBridge && window.AndroidBridge.configureHiddenCodesAsync) {
        window.AndroidBridge.configureHiddenCodesAsync(realPin, decoyPin, panicPin, "onHiddenCodesSaved");
    } else {
        if (realPin !== localStorage.getItem("vt_browser_pin_real")) {
            return window.onHiddenCodesSaved(JSON.stringify({ status: "WRONG_REAL_PIN" }));
        }
        if (decoyPin) localStorage.setItem("vt_browser_pin_decoy", decoyPin);
        else localStorage.removeItem("vt_browser_pin_decoy");
        if (panicPin) localStorage.setItem("vt_browser_pin_panic", panicPin);
        else localStorage.removeItem("vt_browser_pin_panic");
        window.onHiddenCodesSaved(JSON.stringify({ status: "OK" }));
    }
};

window.onHiddenCodesSaved = (resStr) => {
    try {
        const res = JSON.parse(resStr);
        if (res.status === "OK") {
            window.closeAppModal();
            showToast("✅ Коды безопасности обновлены!");
        } else if (res.status === "WRONG_REAL_PIN") {
            showToast("❌ Основной PIN указан неверно");
        } else if (res.status === "INVALID_DECOY") {
            showToast("❌ Некорректный дополнительный PIN");
        } else if (res.status === "INVALID_PANIC") {
            showToast("❌ Некорректный Wipe PIN");
        } else {
            showToast("❌ Доступ запрещён");
        }
    } catch (_) {
        showToast("❌ Ошибка ответа Vault");
    }
};

// --- Native WebCrypto + CompressionStream Stego & .tank Backup ---
const StegoVault = (() => {
    const MAGIC = new Uint8Array([0x56, 0x54, 0x4E, 0x4B]); // VTNK
    const PBKDF2_ITER = 150000;
    const MAX_PNG_COMPRESSED_BYTES = 512 * 1024;

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

    async function encryptPayloadBytes(stateObj, password, enforcePngCap = false) {
        const rawUtf8 = new TextEncoder().encode(JSON.stringify(stateObj));
        const compressed = await streamTransform(rawUtf8, new CompressionStream("deflate-raw"));
        if (enforcePngCap && compressed.byteLength > MAX_PNG_COMPRESSED_BYTES) {
            throw new Error(`Сжатый слепок (${Math.round(compressed.byteLength / 1024)} КБ) превышает лимит PNG (512 КБ) — используй экспорт .tank`);
        }
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
        const packet = await encryptPayloadBytes(stateObj, password, true);
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
                px[idx + 3] = 255;
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
    if (!window.assertVaultUnlocked()) return;
    const pass = (document.getElementById("steganoPassInput").value || "").trim();
    if (pass.length < 4) return showToast("Введи пароль (от 4 символов) в поле выше!");
    try {
        showToast("⏳ Упаковка PNG (AES-256-GCM)...");
        const pngBytes = await StegoVault.encodeToPngBytes({ AppState, ts: new Date().toISOString() }, pass);
        window.saveFileToDownloads(`tank_stego_${window.todayKey()}.png`, "image/png", pngBytes, false);
    } catch (e) {
        showToast("❌ " + e.message);
    }
};

window.importStegoBackup = async (event) => {
    if (!window.assertVaultUnlocked()) return;
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
    if (!window.assertVaultUnlocked()) return;
    const pass = (document.getElementById("tankBackupPassInput").value || "").trim();
    if (pass.length < 4) return showToast("Введи пароль для .tank (от 4 символов)!");
    try {
        const bytes = await StegoVault.encryptPayloadBytes({ AppState, ts: new Date().toISOString() }, pass, false);
        window.saveFileToDownloads(`VeinyTank_${window.todayKey()}.tank`, "application/octet-stream", bytes, false);
    } catch (e) {
        showToast("❌ Ошибка экспорта .tank: " + e.message);
    }
};

window.importEncryptedJSON = async (event) => {
    if (!window.assertVaultUnlocked()) return;
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

// --- Safe UTF-8 Byte-Checked QR Generator with Privacy Toggle ---
function truncateUtf8Safe(str, maxBytes) {
    const encoder = new TextEncoder();
    if (encoder.encode(str).length <= maxBytes) return { text: str, truncated: false };
    let out = "";
    for (const ch of str) {
        if (encoder.encode(out + ch).length > maxBytes - 4) break;
        out += ch;
    }
    return { text: out + "…", truncated: true };
}

window.generateSummaryQR = () => {
    const box = document.getElementById("qrOutput");
    if (!box) return;
    if (typeof QRCode === "undefined") return showToast("QRCode модуль не загружен");

    let text = (document.getElementById("qrInputText").value || "").trim();
    if (!text) {
        const d = AppState.dossier || {};
        const includeCond = Boolean(document.getElementById("qrIncludeConditions")?.checked);
        text = `VeinyTank|BB:${AppState.bodyBattery}|Blood:${d.blood || "-"}|Allergy:${d.allergies || "none"}`;
        if (includeCond && d.conditions) {
            text += `|Cond:${d.conditions}`;
        }
    }

    const encodedLen = new TextEncoder().encode(text).length;
    const correctLevel = encodedLen > 700 ? QRCode.CorrectLevel.L : QRCode.CorrectLevel.M;
    const checked = truncateUtf8Safe(text, 1800);

    box.innerHTML = "";
    box.style.display = "flex";
    try {
        new QRCode(box, { text: checked.text, width: 220, height: 220, correctLevel });
        if (checked.truncated) {
            showToast("⚠️ Текст сокращён для надёжного чтения QR-сканером");
        }
    } catch (e) {
        box.style.display = "none";
        showToast("❌ Данные не помещаются в QR-код");
    }
};
