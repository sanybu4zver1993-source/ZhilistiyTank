const AppState = {
    food: { totalB: 0, totalF: 0, totalU: 0, totalKcal: 0 },
    water: 0,
    supps: { gaviscon: false, mag: false, succinic: false, omega: false, multi: false, d3: false, b2: false, c300: false },
    caffeineDoses: [],
    workoutDays: [], // Array of timestamp strings "YYYY-MM-DD"
    sleepLogs: [],
    bodyBattery: 85,
    logs: [],
    lastResetDate: new Date().toISOString().slice(0,10),
    apiKeys: { gemini: "", geminiModel: "gemini-3.1-flash", groq: "", groqModel: "llama-3.1-70b-versatile", customUrl: "", customKey: "", customModel: "" },
    cnsTriggers: ["Дроны", "Новости", "Недосып", "Еда"],
    stressTriggers: ["Без стресса", "Был стресс"],
    activePots: { green: null, white: null },
    customPotIngredients: {},
    potTare: { green: 0, white: 0 },
    potRecipes: { green: null, white: null }
};
