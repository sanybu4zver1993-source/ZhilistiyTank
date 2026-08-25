const fs = require('fs');

let html = fs.readFileSync('app/src/main/assets/index.html', 'utf8');

const securityScript = `
    <script>
        // FAIL-CLOSED & ANTI-FORENSICS
        if (!location.hostname.includes('localhost') && !location.hostname.includes('127.0.0.1')) {
            window.console.log = function(){};
            window.console.warn = function(){};
            window.console.info = function(){};
            window.console.error = function(){};
        }
        
        // RAM Scrubbing & Visibility Lock
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Clear UI to prevent snapshot leaks in Recents
                if (document.getElementById('loginOverlay') && document.getElementById('loginOverlay').style.display === 'none') {
                    // Temporarily hide sensitive data by throwing up the calculator
                    document.getElementById('loginOverlay').style.display = 'flex';
                    document.getElementById('pinModeContainer').style.display = 'none';
                    document.getElementById('calcModeContainer').style.display = 'flex';
                }
            }
        });
        
        // Disable global uncaught exceptions leaking info
        window.addEventListener('error', function (e) {
            e.preventDefault(); // Stop default logging
            // Fail-closed approach: If fatal error, force lock
            if (e.message.toLowerCase().includes('crypto') || e.message.toLowerCase().includes('db')) {
                 location.reload();
            }
        });
    </script>
`;

if (!html.includes('window.console.log = function(){}')) {
    html = html.replace('</head>', securityScript + '</head>');
    fs.writeFileSync('app/src/main/assets/index.html', html);
    console.log("Security script added.");
}
