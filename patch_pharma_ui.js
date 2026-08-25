const fs = require('fs');
let html = fs.readFileSync('app/src/main/assets/index.html', 'utf8');

const regex = /<div class="grid-2 gap-2 mt-2">[\s\S]*?applyFoodPreset\('Каша с бананом'[\s\S]*?<\/div>/g;
let matchCount = 0;
html = html.replace(regex, (match, offset) => {
    matchCount++;
    if (matchCount === 2) {
        // Replace second occurrence (the one in pharma)
        return `<div class="grid-4 gap-2 mt-2">
                            <button class="btn btn-outline text-sm" onclick="addCaffeine(50)">+50мг</button>
                            <button class="btn btn-outline text-sm" onclick="addCaffeine(100)">+100мг</button>
                            <button class="btn btn-outline text-sm" onclick="addCaffeine(150)">+150мг</button>
                            <button class="btn btn-outline text-sm" onclick="addCaffeine(200)">+200мг</button>
                        </div>`;
    }
    return match;
});

fs.writeFileSync('app/src/main/assets/index.html', html);
