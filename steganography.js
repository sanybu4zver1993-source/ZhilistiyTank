// Steganography Backup Engine
window.exportStegoBackup = async () => {
    try {
        const password = prompt("Введи пароль для шифрования бэкапа:", "");
        if (!password) return showToast("Экспорт отменен");

        showToast("⏳ Собираю базу...");
        const payload = JSON.stringify({
            AppState: AppState,
            timestamp: new Date().toISOString()
        });

        // Simple XOR + Base64
        const xorString = (str, key) => {
            let res = '';
            for (let i = 0; i < str.length; i++) {
                res += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return btoa(res);
        };
        
        const encrypted = xorString(payload, password);
        
        // Compress using pako
        const compressed = pako.deflate(encrypted);
        const dataLength = compressed.length;
        
        // Hide in Canvas
        const canvas = document.createElement("canvas");
        // Minimum size based on data
        // Each pixel can store 3 bytes (R, G, B), we use alpha for opacity (255)
        const pixelsNeeded = Math.ceil((dataLength + 4) / 3); // +4 bytes for length prefix
        const size = Math.max(128, Math.ceil(Math.sqrt(pixelsNeeded)));
        
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        
        // Draw a base image or gradient so it looks like a real image
        const grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, "#2c3e50");
        grad.addColorStop(1, "#3498db");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        
        // We will encode data in the least significant bit (LSB) of RGB channels? 
        // No, let's just write raw data bytes into the RGB channels. It will look like noise but it's safe.
        // Wait, to make it look like a normal image, LSB steganography is better.
        // Let's use LSB.
        const imgData = ctx.getImageData(0, 0, size, size);
        const data = imgData.data;
        
        // Embed length in first 32 bits (4 bytes)
        let bitIndex = 0;
        const setBit = (val, bit) => {
            const byteIdx = Math.floor(bitIndex / 8);
            const bitInByte = 7 - (bitIndex % 8);
            
            // We use RGB channels (skip Alpha)
            let pixelIdx = Math.floor(bitIndex / 3) * 4;
            let channel = bitIndex % 3; // 0=R, 1=G, 2=B
            
            let p = pixelIdx + channel;
            
            // Clear LSB and set it to 'bit'
            data[p] = (data[p] & ~1) | bit;
            bitIndex++;
        };
        
        // Write length (32 bits)
        for (let i = 31; i >= 0; i--) {
            setBit(dataLength, (dataLength >> i) & 1);
        }
        
        // Write compressed data bytes
        for (let i = 0; i < dataLength; i++) {
            let b = compressed[i];
            for (let j = 7; j >= 0; j--) {
                setBit(b, (b >> j) & 1);
            }
        }
        
        ctx.putImageData(imgData, 0, 0);
        
        // Download
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `backup_photo_${new Date().getTime()}.png`;
        a.click();
        showToast("✅ Стегано-бэкап скачан!");
    } catch(e) {
        showToast("❌ Ошибка экспорта: " + e.message);
    }
};

window.importStegoBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const password = prompt("Введи пароль для расшифровки бэкапа:", "");
    if (!password) return showToast("Импорт отменен");

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                
                const imgData = ctx.getImageData(0, 0, img.width, img.height);
                const data = imgData.data;
                
                let bitIndex = 0;
                const getBit = () => {
                    let pixelIdx = Math.floor(bitIndex / 3) * 4;
                    let channel = bitIndex % 3;
                    let p = pixelIdx + channel;
                    let bit = data[p] & 1;
                    bitIndex++;
                    return bit;
                };
                
                // Read length (32 bits)
                let dataLength = 0;
                for (let i = 31; i >= 0; i--) {
                    dataLength = (dataLength << 1) | getBit();
                }
                
                if (dataLength > img.width * img.height * 3 / 8 || dataLength <= 0) {
                    throw new Error("Неверный формат или нет данных");
                }
                
                // Read compressed bytes
                const compressed = new Uint8Array(dataLength);
                for (let i = 0; i < dataLength; i++) {
                    let b = 0;
                    for (let j = 7; j >= 0; j--) {
                        b = (b << 1) | getBit();
                    }
                    compressed[i] = b;
                }
                
                // Decompress
                const encrypted = pako.inflate(compressed, { to: 'string' });
                
                // Decrypt
                const dexorString = (b64, key) => {
                    const str = atob(b64);
                    let res = '';
                    for (let i = 0; i < str.length; i++) {
                        res += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
                    }
                    return res;
                };
                
                const payloadStr = dexorString(encrypted, password);
                const payload = JSON.parse(payloadStr);
                
                if (payload && payload.AppState) {
                    Object.assign(AppState, payload.AppState);
                    saveUIState();
                    showToast("✅ Бэкап успешно восстановлен! Перезагрузи приложение.");
                    setTimeout(() => location.reload(), 1500);
                } else {
                    throw new Error("Неверный пароль или поврежден бэкап");
                }
            } catch(err) {
                showToast("❌ Ошибка импорта: " + err.message);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};
