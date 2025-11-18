// ===========================
// 전역 변수
// ===========================
let currentMode = 'level';
let levelDisplayMode = 'surface'; // 'surface', 'bar_h', 'bar_v'

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

// [신규] GPS 관련 변수
let myLat = 0, myLng = 0;
let targetLat = null, targetLng = null;
let watchId = null;

const REF_SIZE = { card: 85.60, coin: 26.50 };

// ===========================
// 1. 초기화
// ===========================
function requestPermissions() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(res => {
                if (res === 'granted') { startAppSystem(); }
                else { alert('권한이 거부되었습니다.'); hideOverlay(); }
            })
            .catch(e => { alert("오류: " + e); startAppSystem(); });
    } else { 
        startAppSystem(); 
    }
}

function startAppSystem() {
    startSensors();
    startGPS();
    hideOverlay();
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

function startGPS() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                myLat = pos.coords.latitude;
                myLng = pos.coords.longitude;
                updateGPSUI();
            },
            (err) => console.log("GPS Error"),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
    }
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
// 2. 수평계 기능 (중앙 스냅 보정 적용)
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

function setLevelMode(mode) {
    levelDisplayMode = mode;
    document.getElementById('btnModeSurface').classList.remove('active');
    document.getElementById('btnModeBarH').classList.remove('active');
    document.getElementById('btnModeBarV').classList.remove('active');
    
    const surfaceUI = document.getElementById('surfaceLevel');
    const barUI = document.getElementById('barLevelContainer');
    const barWrap = document.getElementById('barLevel');
    
    if (mode === 'surface') {
        document.getElementById('btnModeSurface').classList.add('active');
        surfaceUI.classList.add('active');
        barUI.classList.remove('active');
        document.getElementById('levelModeText').textContent = "평면 모드 (전체 수평)";
    } else if (mode === 'bar_h') {
        document.getElementById('btnModeBarH').classList.add('active');
        surfaceUI.classList.remove('active');
        barUI.classList.add('active');
        barWrap.classList.remove('vertical-mode');
        document.getElementById('levelModeText').textContent = "가로 모드 (X축)";
    } else if (mode === 'bar_v') {
        document.getElementById('btnModeBarV').classList.add('active');
        surfaceUI.classList.remove('active');
        barUI.classList.add('active');
        barWrap.classList.add('vertical-mode');
        document.getElementById('levelModeText').textContent = "세로 모드 (Y축)";
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

    // [수정됨] 원형 수평계 로직
    if (levelDisplayMode === 'surface') {
        const limit = 100; // 최대 이동 거리
        let moveX = x * 10; 
        let moveY = y * -10;

        // 수평 판정 (0.5도 이내)
        if(Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
            // [핵심 수정] 수평이면 강제로 중앙(0,0)으로 고정! (스냅 기능)
            moveX = 0;
            moveY = 0;
            document.getElementById('bubble').classList.add('green'); 
            isLevel = true;
        } else {
            document.getElementById('bubble').classList.remove('green'); 
            isLevel = false;
            
            // 원형 범위 제한
            const dist = Math.sqrt(moveX*moveX + moveY*moveY);
            if (dist > limit) { moveX = (moveX/dist)*limit; moveY = (moveY/dist)*limit; }
        }

        const bubble = document.getElementById('bubble');
        bubble.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
        displayAngle = Math.sqrt(x*x+y*y)*5;

    } else {
        // [수정됨] 막대형 수평계 로직
        const barBubble = document.getElementById('barBubble');
        let tilt = (levelDisplayMode === 'bar_h') ? x * 5 : y * -5;
        
        let barMove = tilt * 5; 
        
        // 수평 판정 (1.0도 이내)
        if (Math.abs(tilt) < 1.0) {
            // [핵심 수정] 수평이면 강제로 중앙(0px)으로 고정!
            barMove = 0;
            barBubble.classList.add('green'); 
            isLevel = true;
        } else {
            barBubble.classList.remove('green'); 
            isLevel = false;
            // 범위 제한
            if (barMove > 120) barMove = 120; 
            if (barMove < -120) barMove = -120;
        }

        barBubble.style.left = `calc(50% + ${barMove}px)`;
        displayAngle = Math.abs(tilt);
    }

    document.getElementById('tiltAngle').textContent = Math.min(displayAngle, 90).toFixed(1) + '°';
    
    // 알림 상태 복구
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
// 3. 나침반 + GPS 기능 (유지)
// ===========================
function saveCurrentLocation() {
    if (myLat === 0 && myLng === 0) { alert("GPS 신호를 기다리는 중입니다..."); return; }
    targetLat = myLat; targetLng = myLng;
    document.getElementById('btnSaveLoc').style.display = 'none';
    document.getElementById('gpsInfo').style.display = 'block';
    document.getElementById('targetArrow').style.display = 'block';
    alert("현재 위치가 타겟으로 저장되었습니다.");
    updateGPSUI();
}

function clearLocation() {
    targetLat = null; targetLng = null;
    document.getElementById('btnSaveLoc').style.display = 'flex';
    document.getElementById('gpsInfo').style.display = 'none';
    document.getElementById('targetArrow').style.display = 'none';
}

function updateGPSUI() {
    if (targetLat === null) return;
    const R = 6371e3;
    const φ1 = myLat * Math.PI/180;
    const φ2 = targetLat * Math.PI/180;
    const Δφ = (targetLat - myLat) * Math.PI/180;
    const Δλ = (targetLng - myLng) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const dist = R * c;
    document.getElementById('gpsDist').textContent = Math.round(dist) + " m";
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    const bearing = (θ * 180 / Math.PI + 360) % 360;
    document.getElementById('targetArrow').style.transform = `rotate(${bearing}deg)`;
}

function drawCompassTicks() {
    const dial = document.getElementById('compassDial');
    if(dial.querySelector('.tick')) return;
    const directions = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let i = 0; i < 360; i += 2) {
        if (i % 10 === 0) {
            const tick = document.createElement('div'); tick.className = 'tick major';
            tick.style.transform = `rotate(${i}deg)`; dial.appendChild(tick);
            if (i % 90 === 0) {
                const label = document.createElement('div'); label.className = `tick-label ${i===0 ? 'north' : ''}`;
                label.textContent = directions[i]; label.style.transform = `translateX(-50%) rotate(${-i}deg)`; 
                const c = document.createElement('div'); c.style.position='absolute'; c.style.width='100%'; c.style.height='100%';
                c.style.transform=`rotate(${i}deg)`; c.appendChild(label); dial.appendChild(c);
            } else if (i % 30 === 0) {
                const label = document.createElement('div'); label.className = 'tick-label'; label.style.fontSize = '12px'; label.style.top = '10px';
                label.textContent = i;
                const c = document.createElement('div'); c.style.position='absolute'; c.style.width='100%'; c.style.height='100%';
                c.style.transform=`rotate(${i}deg)`; c.appendChild(label); dial.appendChild(c);
            }
        } else {
            const tick = document.createElement('div'); tick.className = 'tick';
            tick.style.transform = `rotate(${i}deg)`; dial.appendChild(tick);
        }
    }
}
function handleOrientation(event) {
    if (currentMode !== 'angle') return;
    let h = event.webkitCompassHeading || (event.alpha ? 360 - event.alpha : 0);
    h = Math.round(h);
    document.getElementById('compassContainer').style.transform = `rotate(${-h}deg)`;
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
