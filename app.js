// ===========================
// 전역 변수
// ===========================
let currentMode = 'level';
let levelDisplayMode = 'surface'; // 'surface'(원형) or 'bar'(막대)

let calibration = { x: 0, y: 0 };
let rawSensor = { x: 0, y: 0 };
let measureState = 0; 
let measureRefType = 'card'; 
let pixelsPerMM = 0; 
let refLine = null; 
let targetLine = null;
let isTiltAlarmOn = false;
let lastAlertTime = 0;
let audioCtx = null;

const REF_SIZE = { card: 85.60, coin: 26.50 };

// ===========================
// 1. 초기화
// ===========================
function requestPermissions() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        alert("⚠️ 보안 연결(HTTPS)이 필요합니다.");
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(res => {
                if (res === 'granted') { startSensors(); hideOverlay(); }
                else { alert('권한이 거부되었습니다.'); hideOverlay(); }
            })
            .catch(e => { alert("오류: " + e); startSensors(); hideOverlay(); });
    } else { startSensors(); hideOverlay(); }
}

function hideOverlay() { 
    document.getElementById('startOverlay').style.display = 'none'; 
    drawCompassTicks(); 
}

function startSensors() {
    window.addEventListener('devicemotion', handleMotion, true);
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    else window.addEventListener('deviceorientation', handleOrientation, true);
    document.getElementById('cameraInput').addEventListener('change', handleImageUpload);
}

function playBeep() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode); gainNode.connect(audioCtx.destination);
    osc.type = 'sine'; osc.frequency.value = 600; gainNode.gain.value = 0.1; 
    osc.start(); setTimeout(() => { osc.stop(); }, 100);
}

// ===========================
// 2. 수평계 기능 (수동 모드 + 회전)
// ===========================
function toggleTiltAlarm() {
    isTiltAlarmOn = !isTiltAlarmOn;
    const btn = document.getElementById('tiltAlarmBtn');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (isTiltAlarmOn) {
        btn.textContent = "⚠️ 알림 켜짐"; btn.classList.add('on');
        if(navigator.vibrate) navigator.vibrate([200]); playBeep();
    } else {
        btn.textContent = "🔕 알림 꺼짐"; btn.classList.remove('on');
        document.body.style.backgroundColor = '#1a1a2e';
    }
}

// [신규] 모드 변경 함수
function setLevelMode(mode) {
    levelDisplayMode = mode;
    
    // 탭 스타일 변경
    document.getElementById('btnModeSurface').classList.remove('active');
    document.getElementById('btnModeBar').classList.remove('active');
    
    if (mode === 'surface') {
        document.getElementById('btnModeSurface').classList.add('active');
        document.getElementById('surfaceLevel').classList.add('active');
        document.getElementById('barLevelContainer').classList.remove('active');
        document.getElementById('levelModeText').textContent = "평면 모드 (X/Y축)";
    } else {
        document.getElementById('btnModeBar').classList.add('active');
        document.getElementById('surfaceLevel').classList.remove('active');
        document.getElementById('barLevelContainer').classList.add('active');
        document.getElementById('levelModeText').textContent = "막대형 모드";
    }
}

function handleMotion(event) {
    if (currentMode !== 'level') return;
    
    let acc = event.accelerationIncludingGravity;
    if (!acc) return;

    let x = acc.x; let y = acc.y;

    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) { x = -x; y = -y; }

    rawSensor.x = x; rawSensor.y = y;
    x -= calibration.x; y -= calibration.y;

    let isLevel = false;
    let displayAngle = 0;

    if (levelDisplayMode === 'surface') {
        // 1. 원형 (평면)
        const limit = 100;
        let moveX = x * 10; let moveY = y * -10;
        const dist = Math.sqrt(moveX*moveX + moveY*moveY);
        if (dist > limit) { moveX = (moveX/dist)*limit; moveY = (moveY/dist)*limit; }

        const bubble = document.getElementById('bubble');
        bubble.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;

        if(Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
            bubble.classList.add('green'); isLevel = true;
        } else {
            bubble.classList.remove('green'); isLevel = false;
        }
        displayAngle = Math.sqrt(x*x+y*y)*5;

    } else {
        // 2. 막대형 (수직/수평)
        const barWrap = document.getElementById('barLevel');
        const barBubble = document.getElementById('barBubble');
        
        // X축(가로)과 Y축(세로) 중 더 기울어진 쪽을 기준으로 표시
        let tilt = 0;
        let isVertical = false;

        if (Math.abs(x) > Math.abs(y)) {
            // X축 기울기가 더 큼 -> 가로 모드
            tilt = x * 5; 
            barWrap.classList.remove('vertical'); // 가로 배치
        } else {
            // Y축 기울기가 더 큼 -> 세로 모드 (90도 회전)
            tilt = y * 5; 
            barWrap.classList.add('vertical'); // 세로 배치
            isVertical = true;
        }
        
        // 물방울 이동
        let barMove = tilt * 5; 
        if (barMove > 120) barMove = 120;
        if (barMove < -120) barMove = -120;
        
        // 세로 모드일 때 방향 보정 (물방울 움직임 자연스럽게)
        if (isVertical) barMove = -barMove;

        barBubble.style.left = `calc(50% + ${barMove}px)`;

        // 수평 판정 (1도 이내)
        if (Math.abs(tilt) < 1.0) {
            barBubble.classList.add('green'); isLevel = true;
        } else {
            barBubble.classList.remove('green'); isLevel = false;
        }
        displayAngle = Math.abs(tilt);
    }

    document.getElementById('tiltAngle').textContent = Math.min(displayAngle, 90).toFixed(1) + '°';
    if(isLevel && isTiltAlarmOn) document.body.style.backgroundColor = '#1a1a2e';

    // 경고 알림
    if (isTiltAlarmOn && !isLevel) {
        const now = Date.now();
        if (now - lastAlertTime > 400) {
            if(navigator.vibrate) navigator.vibrate([100]);
            playBeep();
            document.body.style.backgroundColor = '#4a1a1a'; 
            setTimeout(() => { if(isTiltAlarmOn) document.body.style.backgroundColor = '#1a1a2e'; }, 100);
            lastAlertTime = now;
        }
    }
}

function calibrateLevel() {
    calibration.x = rawSensor.x;
    calibration.y = rawSensor.y;
    alert('현재 상태를 0점으로 설정했습니다.');
}

// ===========================
// 3. 나침반 기능 (유지)
// ===========================
function drawCompassTicks() {
    const dial = document.getElementById('compassDial');
    if(dial.children.length > 0) return;
    const directions = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let i = 0; i < 360; i += 2) {
        if (i % 10 === 0) {
            const tick = document.createElement('div');
            tick.className = 'tick major';
            tick.style.transform = `rotate(${i}deg)`;
            dial.appendChild(tick);
            if (i % 90 === 0) {
                const label = document.createElement('div');
                label.className = `tick-label ${i===0 ? 'north' : ''}`;
                label.textContent = directions[i];
                label.style.transform = `translateX(-50%) rotate(${-i}deg)`; 
                const tickContainer = document.createElement('div');
                tickContainer.style.position = 'absolute';
                tickContainer.style.width = '100%'; tickContainer.style.height = '100%';
                tickContainer.style.transform = `rotate(${i}deg)`; tickContainer.appendChild(label);
                dial.appendChild(tickContainer);
            } else if (i % 30 === 0) {
                const label = document.createElement('div');
                label.className = 'tick-label'; label.style.fontSize = '12px'; label.style.top = '10px';
                label.textContent = i;
                const tickContainer = document.createElement('div');
                tickContainer.style.position = 'absolute';
                tickContainer.style.width = '100%'; tickContainer.style.height = '100%';
                tickContainer.style.transform = `rotate(${i}deg)`; tickContainer.appendChild(label);
                dial.appendChild(tickContainer);
            }
        } else {
            const tick = document.createElement('div');
            tick.className = 'tick';
            tick.style.transform = `rotate(${i}deg)`;
            dial.appendChild(tick);
        }
    }
}
function handleOrientation(event) {
    if (currentMode !== 'angle') return;
    let h = event.webkitCompassHeading || (event.alpha ? 360 - event.alpha : 0);
    h = Math.round(h);
    const dial = document.getElementById('compassContainer');
    dial.style.transform = `rotate(${-h}deg)`;
    document.getElementById('compassValue').textContent = h + '°';
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    document.getElementById('directionText').textContent = dirs[Math.round(h/45)%8];
}

// ===========================
// 4. 탭 전환 (유지)
// ===========================
function switchTab(mode, btn) {
    currentMode = mode;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.getElementById(mode + 'Screen').classList.add('active-screen');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if(btn) btn.classList.add('active');
    if(mode === 'angle') drawCompassTicks();
}

// ===========================
// 5. 길이 측정 (유지)
// ===========================
function startMeasure(type) { measureRefType = type; document.getElementById('cameraInput').click(); }
function handleImageUpload(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = function(evt) { const img = new Image(); img.onload = function() { setupCanvas(img); }; img.src = evt.target.result; }; reader.readAsDataURL(file); }
function setupCanvas(img) {
    const canvas = document.getElementById('measureCanvas'); const ctx = canvas.getContext('2d');
    document.getElementById('measureMenu').style.display = 'none'; document.getElementById('stepBar').style.display = 'block';
    canvas.style.display = 'block'; canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    const hRatio = canvas.width / img.width; const vRatio = canvas.height / img.height; const ratio = Math.min(hRatio, vRatio);
    const cx = (canvas.width - img.width*ratio) / 2; const cy = (canvas.height - img.height*ratio) / 2;
    window.bgImage = { img, cx, cy, w: img.width*ratio, h: img.height*ratio };
    redrawCanvas(); measureState = 1; refLine = null; targetLine = null; updateStepUI(); initTouchDraw(canvas);
}
function updateStepUI() {
    const text = document.getElementById('stepText'); const btn = document.getElementById('stepActionBtn');
    if (measureState === 1) { text.innerHTML = `<b>1단계</b>: <span style='color:#4CAF50'>${measureRefType === 'card' ? '신용카드 긴 면' : '500원 동전 지름'}</span>에 선을 맞추세요`; text.style.color = '#fff'; btn.textContent = "기준 등록"; btn.style.display = 'block'; } 
    else if (measureState === 2) { text.innerHTML = `<b>2단계</b>: <span style='color:#e94560'>측정할 물체</span>에 선을 그으세요`; btn.style.display = 'none'; }
}
function redrawCanvas() {
    const canvas = document.getElementById('measureCanvas'); const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width, canvas.height);
    if(window.bgImage) { const {img, cx, cy, w, h} = window.bgImage; ctx.drawImage(img, 0, 0, img.width, img.height, cx, cy, w, h); }
    if (refLine) drawLine(ctx, refLine.start, refLine.end, '#4CAF50', '1단계: 기준');
    if (targetLine) drawLine(ctx, targetLine.start, targetLine.end, '#e94560', '2단계: 대상');
}
function drawLine(ctx, start, end, color, label) {
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(start.x, start.y, 5, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(end.x, end.y, 5, 0, Math.PI*2); ctx.fill();
    if(label) { ctx.fillStyle = color; ctx.font = "bold 14px sans-serif"; ctx.fillText(label, start.x, start.y - 10); }
}
function initTouchDraw(canvas) {
    let startPos = null; let isDrawing = false;
    canvas.ontouchstart = (e) => { if(measureState > 2) return; isDrawing = true; const t = e.touches[0]; startPos = { x: t.clientX, y: t.clientY }; };
    canvas.ontouchmove = (e) => { if (!isDrawing) return; e.preventDefault(); const t = e.touches[0]; const currentPos = { x: t.clientX, y: t.clientY }; if (measureState === 1) refLine = { start: startPos, end: currentPos }; else if (measureState === 2) targetLine = { start: startPos, end: currentPos }; redrawCanvas(); };
    canvas.ontouchend = (e) => { if (!isDrawing) return; isDrawing = false; if (measureState === 2) calculateFinalResult(); };
}
function confirmReference() {
    if (!refLine) { alert("선을 그어주세요."); return; }
    const distPx = Math.sqrt(Math.pow(refLine.end.x - refLine.start.x, 2) + Math.pow(refLine.end.y - refLine.start.y, 2));
    if (distPx < 10) { alert("너무 짧습니다."); return; }
    const realSize = measureRefType === 'card' ? REF_SIZE.card : REF_SIZE.coin;
    pixelsPerMM = distPx / realSize; measureState = 2; updateStepUI();
}
function calculateFinalResult() {
    if (!targetLine || !pixelsPerMM) return;
    const distPx = Math.sqrt(Math.pow(targetLine.end.x - targetLine.start.x, 2) + Math.pow(targetLine.end.y - targetLine.start.y, 2));
    const realMM = distPx / pixelsPerMM;
    measureState = 3; document.getElementById('stepBar').style.display = 'none'; document.getElementById('finalResult').style.display = 'block'; document.getElementById('resultValue').textContent = realMM.toFixed(1) + ' mm';
}
function resetMeasure() {
    document.getElementById('measureMenu').style.display = 'block'; document.getElementById('measureCanvas').style.display = 'none'; document.getElementById('stepBar').style.display = 'none'; document.getElementById('finalResult').style.display = 'none';
    measureState = 0; refLine = null; targetLine = null;
}
