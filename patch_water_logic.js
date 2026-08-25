const fs = require('fs');
let code = fs.readFileSync('app/src/main/assets/app.js', 'utf8');

if (!code.includes('window.addCustomWater')) {
    code = code.replace('window.addWater = (ml) => {', 
`window.addCustomWater = () => {
    const input = document.getElementById("customWaterInput");
    const ml = parseInt(input.value);
    if (!isNaN(ml) && ml > 0) {
        addWater(ml);
        input.value = '';
    }
};

window.addWater = (ml) => {`);
}

// update 2000 to 3000 in water calculation
code = code.replace(/\(AppState\.water \/ 2000\) \* 100/g, '(AppState.water / 3000) * 100');
// wait, the previous grep showed `3000` is already in app.js on line 201. Let's make sure.
code = code.replace(/\(AppState\.water \/ [0-9]+\) \* 100/g, '(AppState.water / 3000) * 100');

fs.writeFileSync('app/src/main/assets/app.js', code);
