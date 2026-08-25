const fs = require('fs');
let code = fs.readFileSync('app/src/main/assets/cyberpunk.js', 'utf8');

const additionalFoods = `
        'яйцо': { b: 13, f: 11, u: 1, k: 155 },
        'яйца': { b: 13, f: 11, u: 1, k: 155 },
        'творог': { b: 16, f: 5, u: 3, k: 121 },
        'батон': { b: 8, f: 3, u: 51, k: 265 },
        'хлеб': { b: 7, f: 1.5, u: 40, k: 210 },
        'колбаса': { b: 12, f: 22, u: 1, k: 250 },
`;
code = code.replace(/'овощи': \{ b: 2, f: 0, u: 6, k: 30 \},/, "'овощи': { b: 2, f: 0, u: 6, k: 30 }," + additionalFoods);
fs.writeFileSync('app/src/main/assets/cyberpunk.js', code);
