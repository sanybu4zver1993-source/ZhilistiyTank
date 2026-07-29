function updateWorkoutUI() {
    const bb = AppState.bodyBattery || 100;
    const wTitle = document.getElementById("workoutModeTitle");
    const block2 = document.getElementById("workoutBlock2");
    const block3 = document.getElementById("workoutBlock3");
    
    if (bb <= 20) { // Red zone threshold for Deload
        wTitle.innerHTML = "<span class='text-danger'>Режим: DELOAD (ЦНС истощена)</span>";
        block2.style.display = "none";
        block3.style.display = "none";
        document.getElementById("iso30btn").innerText = "Эспандер 15с (Deload)";
        document.getElementById("iso30btn").onclick = () => startIsoTimer(15, 'expander');
        document.getElementById("iso60btn").style.display = "none";
        if(document.getElementById("isoDbbtn")) document.getElementById("isoDbbtn").style.display = "none";
    } else {
        wTitle.innerHTML = "<span class='text-success'>Режим: НОРМА</span>";
        block2.style.display = "block";
        block3.style.display = "block";
        document.getElementById("iso30btn").innerText = "Эспандер 45с";
        document.getElementById("iso30btn").onclick = () => startIsoTimer(45, 'expander');
        document.getElementById("iso60btn").style.display = "inline-block";
        if(document.getElementById("isoDbbtn")) document.getElementById("isoDbbtn").style.display = "inline-block";
    }
}
