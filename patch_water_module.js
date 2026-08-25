const fs = require('fs');
let html = fs.readFileSync('app/src/main/assets/index.html', 'utf8');

const waterHtml = `                <!-- ВОДА -->
                <div id="module-water" class="module">
                    <h2>💧 Трекер Воды</h2>
                    <div class="card flex-col gap-2 text-center">
                        <p class="text-muted text-sm mb-2">Норма: 3000 мл</p>
                        <div class="battery-bar mt-2 mb-2" style="height: 30px;">
                            <div class="battery-fill bg-water" id="waterBar" style="width: 0%; background: #3498db;"></div>
                        </div>
                        <p class="font-bold text-xl mb-4"><span id="waterLevel">0</span> / 3000 мл</p>
                        
                        <div class="grid-4 gap-2 mb-4">
                            <button class="btn btn-outline" style="border-color: #3498db; color: #3498db;" onclick="addWater(100)">+100</button>
                            <button class="btn btn-outline" style="border-color: #3498db; color: #3498db;" onclick="addWater(250)">+250</button>
                            <button class="btn btn-outline" style="border-color: #3498db; color: #3498db;" onclick="addWater(500)">+500</button>
                            <button class="btn btn-outline" style="border-color: #3498db; color: #3498db;" onclick="addWater(1000)">+1Л</button>
                        </div>
                        <div class="flex gap-2">
                            <input type="number" id="customWaterInput" class="input" placeholder="Произвольный объем (мл)" style="flex: 1;">
                            <button class="btn btn-primary" style="width: auto; padding: 0 15px;" onclick="addCustomWater()">Добавить</button>
                        </div>
                    </div>
                </div>
`;

if (!html.includes('id="module-water"')) {
    html = html.replace('<div id="module-sleep"', waterHtml + '\n<div id="module-sleep"');
    fs.writeFileSync('app/src/main/assets/index.html', html);
    console.log("Added module-water");
} else {
    console.log("module-water already exists");
}
