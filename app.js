// ===========================
// 전역 변수
// ===========================
let currentMode = 'level';
let levelDisplayMode = 'surface';

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

let myLat = 0, myLng = 0;
let targetLat = null, targetLng = null;
let watchId = null;
let map = null;
let mapMarker = null;

// SOS
let flashStream = null;
let isFlashOn = false;
let isSirenOn = false;
let isSOSOn = false;
let sirenOsc = null;
let sirenGain = null;
let sosInterval = null;

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
    const camInput = document.getElementById('cameraInput');
    if(camInput) camInput.addEventListener('change', handleImageUpload);
}

function startGPS() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude, speed } = pos.coords;
                myLat = latitude; myLng = longitude;
                updateGPSUI();
                updateSpeedometer(speed);
                updateMapMarker(latitude, longitude);
            },
            (err) => console.log("GPS Error"),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 1000 }
        );
    }
}

// ===========================
// SOS & 사이렌 (아이콘 적용)
// ===========================
async function toggleFlashlight() {
    if(isSOSOn) toggleSOS(); 
    isFlashOn = !isFlashOn;
    updateFlashState(isFlashOn);
    const btn = document.getElementById('btnFlash');
    if(isFlashOn) btn.classList.add('active');
    else btn.classList.remove('active');
}

async function updateFlashState(on) {
    try {
        if (on) {
            if (!flashStream) {
                flashStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            }
            const track = flashStream.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            if (capabilities.torch) await track.applyConstraints({ advanced: [{ torch: true }] });
        } else {
            if (flashStream) {
                const track = flashStream.getVideoTracks()[0];
                await track.applyConstraints({ advanced: [{ torch: false }] });
                track.stop(); flashStream = null;
            }
        }
    } catch (e) { console.log("Flash Error:", e); }
    const overlay = document.getElementById('screenFlashOverlay');
    if (on) overlay.classList.add('active'); else overlay.classList.remove('active');
}

function toggleSiren() {
    isSirenOn = !isSirenOn;
    const btn = document.getElementById('btnSiren');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    if (isSirenOn) {
        btn.classList.add('active');
        // [수정] 아이콘 포함 텍스트 변경
        btn.innerHTML = '<span class="material-symbols-rounded">volume_off</span> 사이렌 끄기';
        startSirenSound();
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span class="material-symbols-rounded">volume_up</span> 사이렌';
        stopSirenSound();
    }
}

function startSirenSound() {
    if (sirenOsc) stopSirenSound();
    sirenOsc = audioCtx.createOscillator();
    sirenGain = audioCtx.createGain();
    sirenOsc.type = 'sawtooth';
    sirenOsc.connect(sirenGain); sirenGain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    sirenOsc.frequency.setValueAtTime(600, now);
    sirenOsc.frequency.linearRampToValueAtTime(1200, now + 0.5);
    sirenOsc.frequency.linearRampToValueAtTime(600, now + 1.0);
    const lfo = audioCtx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 1.0;
    const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 600;
    lfo.connect(lfoGain); lfoGain.connect(sirenOsc.frequency);
    sirenOsc.start(); lfo.start(); sirenOsc.lfo = lfo; 
}
function stopSirenSound() {
    if (sirenOsc) { try { sirenOsc.stop(); if(sirenOsc.lfo) sirenOsc.lfo.stop(); } catch(e) {} sirenOsc = null; }
}

function toggleSOS() {
    if(isFlashOn) toggleFlashlight();
    if(isSirenOn) toggleSiren();
    isSOSOn = !isSOSOn;
    const btn = document.getElementById('btnSOS');
    if (isSOSOn) {
        btn.classList.add('active');
        btn.innerHTML = '<span class="material-symbols-rounded">stop_circle</span> SOS 정지';
        let toggle = false;
        sosInterval = setInterval(() => { toggle = !toggle; updateFlashState(toggle); }, 300);
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span class="material-symbols-rounded">sos</span> 구조신호<br><span style="font-size:14px; font-weight:normal;">(자동 깜빡임)</span>';
        clearInterval(sosInterval); updateFlashState(false);
    }
}

// ===========================
// 유틸
// ===========================
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
// 2. 속도계 & 지도
// ===========================
function initMap() {
    if (map) return; 
    map = L.map('map').setView([37.5665, 126.9780], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM' }).addTo(map);
    const icon = L.divIcon({
        className: 'custom-map-marker',
        html: '<div style="width:15px;height:15px;background:#e94560;border:2px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>',
        iconSize: [20, 20]
    });
    mapMarker = L.marker([37.5665, 126.9780], {icon: icon}).addTo(map);
}
function updateSpeedometer(speedMPS) {
    let kmh = 0; if (speedMPS !== null && speedMPS > 0) kmh = (speedMPS * 3.6).toFixed(0); 
    document.getElementById('speedValue').textContent = kmh;
    document.getElementById('coordInfo').textContent = `${myLat.toFixed(5)}, ${myLng.toFixed(5)}`;
}
function updateMapMarker(lat, lng) {
    if (!map || !mapMarker) return;
    mapMarker.setLatLng([lat, lng]); map.setView([lat, lng], map.getZoom()); 
}

// ===========================
// 3. 수평계 (아이콘 적용)
// ===========================
function toggleTiltAlarm() {
    isTiltAlarmOn = !isTiltAlarmOn;
    const btn = document.getElementById('tiltAlarmBtn');
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (isTiltAlarmOn) {
        // [수정] 아이콘 포함 텍스트 변경
        btn.innerHTML = '<span class="material-symbols-rounded">notifications_active</span> 알림 켜짐';
        btn.classList.add('on');
        if(navigator.vibrate) navigator.vibrate([200]); playBeep();
    } else {
        btn.innerHTML = '<span class="material-symbols-rounded">notifications_off</span> 알림 꺼짐';
        btn.classList.remove('on');
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
    const textUI = document.getElementById('levelModeText');
    
    if (mode === 'surface') {
        document.getElementById('btnModeSurface').classList.add('active');
        surfaceUI.classList.add('active'); barUI.classList.remove('active');
        textUI.textContent = "평면 모드 (전체 수평)";
    } else {
        surfaceUI.classList.remove('active'); barUI.classList.add('active');
        if (mode === 'bar_h') {
            document.getElementById('btnModeBarH').classList.add('active');
            barWrap.classList.remove('vertical-mode'); textUI.textContent = "가로 모드 (X축)";
        } else {
            document.getElementById('btnModeBarV').classList.add('active');
            barWrap.classList.add('vertical-mode'); textUI.textContent = "세로 모드 (Y축)";
        }
    }
}

function handleMotion(event) {
    if (currentMode !== 'level') return;
    let acc = event.accelerationIncludingGravity; if (!acc) return;
    let x = acc.x; let y = acc.y;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) { x = -x; y = -y; }
    rawSensor.x = x; rawSensor.y = y; x -= calibration.x; y -= calibration.y;

    let isLevel = false; let displayAngle = 0;

    if (levelDisplayMode === 'surface') {
        const limit = 100; let moveX = x * 10; let moveY = y * -10;
        if(Math.abs(x) < 0.5 && Math.abs(y) < 0.5) { moveX = 0; moveY = 0; document.getElementById('bubble').classList.add('green'); isLevel = true; } 
        else { document.getElementById('bubble').classList.remove('green'); isLevel = false; const dist = Math.sqrt(moveX*moveX + moveY*moveY); if (dist > limit) { moveX = (moveX/dist)*limit; moveY = (moveY/dist)*limit; } }
        const bubble = document.getElementById('bubble');
        bubble.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
        displayAngle = Math.sqrt(x*x+y*y)*5;
    } else {
        const barBubble = document.getElementById('barBubble');
        let tilt = (levelDisplayMode === 'bar_h') ? x * 5 : y * -5;
        let barMove = tilt * 5; 
        if (Math.abs(tilt) < 1.0) { barMove = 0; barBubble.classList.add('green'); isLevel = true; } 
        else { barBubble.classList.remove('green'); isLevel = false; if (barMove > 120) barMove = 120; if (barMove < -120) barMove = -120; }
        barBubble.style.left = `calc(50% + ${barMove}px)`;
        displayAngle = Math.abs(tilt);
    }

    document.getElementById('tiltAngle').textContent = Math.min(displayAngle, 90).toFixed(1) + '°';
    if(isLevel && isTiltAlarmOn) document.body.style.backgroundColor = '#1a1a2e';
    if (isTiltAlarmOn && !isLevel) {
        const now = Date.now();
        if (now - lastAlertTime > 400) { if(navigator.vibrate) navigator.vibrate([100]); playBeep(); document.body.style.backgroundColor = '#4a1a1a'; setTimeout(() => { if(isTiltAlarmOn) document.body.style.backgroundColor = '#1a1a2e'; }, 100); lastAlertTime = now; }
    }
}
function calibrateLevel() { calibration.x = rawSensor.x; calibration.y = rawSensor.y; alert('0점 설정 완료'); }

// ===========================
// 4. 나침반
// ===========================
function saveCurrentLocation() {
    if (myLat === 0 && myLng === 0) { alert("GPS 신호를 기다리는 중입니다..."); return; }
    targetLat = myLat; targetLng = myLng;
    document.getElementById('btnSaveLoc').style.display = 'none';
    document.getElementById('gpsInfo').style.display = 'block';
    document.getElementById('targetArrow').style.display = 'block';
    document.getElementById('compassArea').classList.add('shrink');
    alert("현재 위치 저장됨"); updateGPSUI();
}
function clearLocation() {
    targetLat = null; targetLng = null;
    document.getElementById('btnSaveLoc').style.display = 'flex';
    document.getElementById('gpsInfo').style.display = 'none';
    document.getElementById('targetArrow').style.display = 'none';
    document.getElementById('compassArea').classList.remove('shrink');
}
function updateGPSUI() {
    if (targetLat === null) return;
    const R = 6371e3; const φ1 = myLat * Math.PI/180; const φ2 = targetLat * Math.PI/180;
    const Δφ = (targetLat - myLat) * Math.PI/180; const Δλ = (targetLng - myLng) * Math.PI/180;
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
    const dial = document.getElementById('compassDial'); if(dial.querySelector('.tick')) return; 
    const directions = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let i = 0; i < 360; i += 2) {
        if (i % 10 === 0) {
            const tick = document.createElement('div'); tick.className = 'tick major'; tick.style.transform = `rotate(${i}deg)`; dial.appendChild(tick);
            if (i % 90 === 0) {
                const label = document.createElement('div'); label.className = `tick-label ${i===0 ? 'north' : ''}`; label.textContent = directions[i]; label.style.transform = `translateX(-50%) rotate(${-i}deg)`; const c = document.createElement('div'); c.style.position='absolute'; c.style.width='100%'; c.style.height='100%'; c.style.transform=`rotate(${i}deg)`; c.appendChild(label); dial.appendChild(c);
            } else if (i % 30 === 0) {
                const label = document.createElement('div'); label.className = 'tick-label'; label.style.fontSize = '12px'; label.style.top = '10px'; label.textContent = i; const c = document.createElement('div'); c.style.position='absolute'; c.style.width='100%'; c.style.height='100%'; c.style.transform=`rotate(${i}deg)`; c.appendChild(label); dial.appendChild(c);
            }
        } else { const tick = document.createElement('div'); tick.className = 'tick'; tick.style.transform = `rotate(${i}deg)`; dial.appendChild(tick); }
    }
}
function handleOrientation(event) {
    if (currentMode !== 'angle') return;
    let h = event.webkitCompassHeading || (event.alpha ? 360 - event.alpha : 0); h = Math.round(h);
    document.getElementById('compassContainer').style.transform = `rotate(${-h}deg)`;
    document.getElementById('compassValue').textContent = h + '°';
    const dirs = ['N','NE','E','SE','S','SW','W','NW']; document.getElementById('directionText').textContent = dirs[Math.round(h/45)%8];
}

// ===========================
// 5. 탭 전환
// ===========================
function switchTab(mode, btn) {
    currentMode = mode;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    
    if (mode === 'level') document.getElementById('levelScreen').classList.add('active-screen');
    if (mode === 'measure') document.getElementById('measureScreen').classList.add('active-screen');
    if (mode === 'angle') { document.getElementById('angleScreen').classList.add('active-screen'); drawCompassTicks(); }
    if (mode === 'gps') { document.getElementById('gpsScreen').classList.add('active-screen'); initMap(); setTimeout(() => { map.invalidateSize(); }, 200); }
    if (mode === 'sos') document.getElementById('sosScreen').classList.add('active-screen');

    if(btn) btn.classList.add('active');
}

function startMeasure(type) { measureRefType = type; document.getElementById('cameraInput').click(); }
function handleImageUpload(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = function(evt) { const img = new Image(); img.onload = function() { setupCanvas(img); }; img.src = evt.target.result; }; reader.readAsDataURL(file); }
function setupCanvas(img) { const canvas = document.getElementById('measureCanvas'); const ctx = canvas.getContext('2d'); document.getElementById('measureMenu').style.display = 'none'; document.getElementById('stepBar').style.display = 'block'; canvas.style.display = 'block'; canvas.width = window.innerWidth; canvas.height = window.innerHeight; const hRatio = canvas.width / img.width; const vRatio = canvas.height / img.height; const ratio = Math.min(hRatio, vRatio); const cx = (canvas.width - img.width*ratio) / 2; const cy = (canvas.height - img.height*ratio) / 2; window.bgImage = { img, cx, cy, w: img.width*ratio, h: img.height*ratio }; redrawCanvas(); measureState = 1; refLine = null; targetLine = null; updateStepUI(); initTouchDraw(canvas); }
function updateStepUI() { const text = document.getElementById('stepText'); const btn = document.getElementById('stepActionBtn'); if (measureState === 1) { text.innerHTML = `<b>1단계</b>: <span style='color:#4CAF50'>${measureRefType === 'card' ? '신용카드 긴 면' : '500원 동전 지름'}</span>에 선을 맞추세요`; text.style.color = '#fff'; btn.textContent = "기준 등록"; btn.style.display = 'block'; } else if (measureState === 2) { text.innerHTML = `<b>2단계</b>: <span style='color:#e94560'>측정할 물체</span>에 선을 그으세요`; btn.style.display = 'none'; } }
function redrawCanvas() { const canvas = document.getElementById('measureCanvas'); const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,canvas.width, canvas.height); if(window.bgImage) { const {img, cx, cy, w, h} = window.bgImage; ctx.drawImage(img, 0, 0, img.width, img.height, cx, cy, w, h); } if (refLine) drawLine(ctx, refLine.start, refLine.end, '#4CAF50', '1단계: 기준'); if (targetLine) drawLine(ctx, targetLine.start, targetLine.end, '#e94560', '2단계: 대상'); }
function drawLine(ctx, start, end, color, label) { ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = 'white'; ctx.beginPath(); ctx.arc(start.x, start.y, 5, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(end.x, end.y, 5, 0, Math.PI*2); ctx.fill(); if(label) { ctx.fillStyle = color; ctx.font = "bold 14px sans-serif"; ctx.fillText(label, start.x, start.y - 10); } }
function initTouchDraw(canvas) { let startPos = null; let isDrawing = false; canvas.ontouchstart = (e) => { if(measureState > 2) return; isDrawing = true; const t = e.touches[0]; startPos = { x: t.clientX, y: t.clientY }; }; canvas.ontouchmove = (e) => { if (!isDrawing) return; e.preventDefault(); const t = e.touches[0]; const currentPos = { x: t.clientX, y: t.clientY }; if (measureState === 1) refLine = { start: startPos, end: currentPos }; else if (measureState === 2) targetLine = { start: startPos, end: currentPos }; redrawCanvas(); }; canvas.ontouchend = (e) => { if (!isDrawing) return; isDrawing = false; if (measureState === 2) calculateFinalResult(); }; }
function confirmReference() { if (!refLine) { alert("선을 그어주세요."); return; } const distPx = Math.sqrt(Math.pow(refLine.end.x - refLine.start.x, 2) + Math.pow(refLine.end.y - refLine.start.y, 2)); if (distPx < 10) { alert("너무 짧습니다."); return; } const realSize = measureRefType === 'card' ? REF_SIZE.card : REF_SIZE.coin; pixelsPerMM = distPx / realSize; measureState = 2; updateStepUI(); }
function calculateFinalResult() { if (!targetLine || !pixelsPerMM) return; const distPx = Math.sqrt(Math.pow(targetLine.end.x - targetLine.start.x, 2) + Math.pow(targetLine.end.y - targetLine.start.y, 2)); const realMM = distPx / pixelsPerMM; measureState = 3; document.getElementById('stepBar').style.display = 'none'; document.getElementById('finalResult').style.display = 'block'; document.getElementById('resultValue').textContent = realMM.toFixed(1) + ' mm'; }
function resetMeasure() { document.getElementById('measureMenu').style.display = 'block'; document.getElementById('measureCanvas').style.display = 'none'; document.getElementById('stepBar').style.display = 'none'; document.getElementById('finalResult').style.display = 'none'; measureState = 0; refLine = null; targetLine = null; }
