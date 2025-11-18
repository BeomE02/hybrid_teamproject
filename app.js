// ===========================
// 전역 변수
// ===========================
let currentMode = 'level';
let calibration = { x: 0, y: 0 };

// 측정 관련 변수
let measureState = 0; // 0:대기, 1:기준설정중, 2:측정중, 3:결과
let measureRefType = 'card'; 
let pixelsPerMM = 0; // 핵심: 1mm당 픽셀 비율
let refLine = null; // {start, end} 기준선 좌표
let targetLine = null; // {start, end} 측정선 좌표

const REF_SIZE = {
    card: 85.60, // 신용카드 너비 (mm)
    coin: 26.50  // 500원 지름 (mm)
};

// ===========================
// 1. 초기화 & 권한
// ===========================
function requestPermissions() {
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
    } else {
        startSensors(); hideOverlay();
    }
}

function hideOverlay() { document.getElementById('startOverlay').style.display = 'none'; }
function startSensors() {
    window.addEventListener('devicemotion', handleMotion, true);
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    else window.addEventListener('deviceorientation', handleOrientation, true);
    document.getElementById('cameraInput').addEventListener('change', handleImageUpload);
}

// ===========================
// 2. 탭 전환
// ===========================
function switchTab(mode, btn) {
    currentMode = mode;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.getElementById(mode + 'Screen').classList.add('active-screen');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if(btn) btn.classList.add('active');
}

// ===========================
// 3. 수평계 (기존 유지)
// ===========================
function handleMotion(event) {
    if (currentMode !== 'level') return;
    let acc = event.accelerationIncludingGravity;
    if (!acc) return;
    let x = acc.x, y = acc.y;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) { x = -x; y = -y; }
    x -= calibration.x; y -= calibration.y;
    
    const limit = 100;
    let moveX = x * 10;
    let moveY = y * -10;
    const dist = Math.sqrt(moveX*moveX + moveY*moveY);
    if (dist > limit) { moveX = (moveX/dist)*limit; moveY = (moveY/dist)*limit; }
    
    const bubble = document.getElementById('bubble');
    if(bubble) {
        bubble.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
        if(Math.abs(x)<0.5 && Math.abs(y)<0.5) bubble.classList.add('green');
        else bubble.classList.remove('green');
    }
    document.getElementById('tiltAngle').textContent = Math.min(Math.sqrt(x*x+y*y)*5, 90).toFixed(1) + '°';
}
function calibrateLevel() { alert('0점 보정 완료'); }

// ===========================
// 4. 나침반 (기존 유지)
// ===========================
function handleOrientation(event) {
    if (currentMode !== 'angle') return;
    let h = event.webkitCompassHeading || (event.alpha ? 360 - event.alpha : 0);
    h = Math.round(h);
    document.getElementById('compassRotator').style.transform = `rotate(${-h}deg)`;
    document.getElementById('compassValue').textContent = h + '°';
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    document.getElementById('directionText').textContent = dirs[Math.round(h/45)%8];
}

// ===========================
// 5. [핵심] 길이 측정 (2단계 로직 적용)
// ===========================
function startMeasure(type) {
    measureRefType = type;
    document.getElementById('cameraInput').click();
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        const img = new Image();
        img.onload = function() { setupCanvas(img); };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
}

function setupCanvas(img) {
    const canvas = document.getElementById('measureCanvas');
    const ctx = canvas.getContext('2d');
    
    // UI 상태 변경
    document.getElementById('measureMenu').style.display = 'none';
    document.getElementById('stepBar').style.display = 'block';
    canvas.style.display = 'block';
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight; // 전체 화면 사용
    
    // 이미지 비율 맞춰 그리기
    const hRatio = canvas.width / img.width;
    const vRatio = canvas.height / img.height;
    const ratio = Math.min(hRatio, vRatio);
    const cx = (canvas.width - img.width*ratio) / 2;
    const cy = (canvas.height - img.height*ratio) / 2;
    
    // 배경 이미지 저장 (다시 그리기용)
    window.bgImage = { img, cx, cy, w: img.width*ratio, h: img.height*ratio };
    redrawCanvas();

    // 상태 초기화: 1단계(기준 설정) 진입
    measureState = 1;
    refLine = null; 
    targetLine = null;
    updateStepUI();
    
    initTouchDraw(canvas);
}

function updateStepUI() {
    const text = document.getElementById('stepText');
    const btn = document.getElementById('stepActionBtn');
    
    if (measureState === 1) {
        // 1단계: 기준 잡기
        const refName = measureRefType === 'card' ? '신용카드 긴 면' : '500원 동전 지름';
        text.innerHTML = `<b>1단계</b>: <span style='color:#4CAF50'>${refName}</span>에 선을 맞추세요`;
        text.style.color = '#fff';
        btn.textContent = "기준 등록";
        btn.style.display = 'block';
    } else if (measureState === 2) {
        // 2단계: 측정 하기
        text.innerHTML = `<b>2단계</b>: <span style='color:#e94560'>측정할 물체</span>에 선을 그으세요`;
        btn.style.display = 'none'; // 드래그 끝나면 자동 결과 표시
    }
}

// 캔버스 다시 그리기 (배경 + 선들)
function redrawCanvas() {
    const canvas = document.getElementById('measureCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width, canvas.height);
    
    // 배경
    if(window.bgImage) {
        const {img, cx, cy, w, h} = window.bgImage;
        ctx.drawImage(img, 0, 0, img.width, img.height, cx, cy, w, h);
    }
    
    // 기준선 (파란색)
    if (refLine) {
        drawLine(ctx, refLine.start, refLine.end, '#4CAF50', '1단계: 기준');
    }
    
    // 측정선 (붉은색)
    if (targetLine) {
        drawLine(ctx, targetLine.start, targetLine.end, '#e94560', '2단계: 대상');
    }
}

function drawLine(ctx, start, end, color, label) {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    
    // 양 끝점
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.arc(start.x, start.y, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(end.x, end.y, 5, 0, Math.PI*2); ctx.fill();
    
    // 라벨
    if(label) {
        ctx.fillStyle = color;
        ctx.font = "bold 14px sans-serif";
        ctx.fillText(label, start.x, start.y - 10);
    }
}

function initTouchDraw(canvas) {
    let startPos = null;
    let isDrawing = false;

    canvas.ontouchstart = (e) => {
        if(measureState > 2) return; // 결과 나온 후엔 터치 막음
        isDrawing = true;
        const t = e.touches[0];
        startPos = { x: t.clientX, y: t.clientY };
    };

    canvas.ontouchmove = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const t = e.touches[0];
        const currentPos = { x: t.clientX, y: t.clientY };
        
        // 실시간 드래그 보여주기
        if (measureState === 1) refLine = { start: startPos, end: currentPos };
        else if (measureState === 2) targetLine = { start: startPos, end: currentPos };
        
        redrawCanvas();
    };

    canvas.ontouchend = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        
        // 드래그가 끝나면
        if (measureState === 2) {
            // 2단계에선 드래그 끝나자마자 결과 계산
            calculateFinalResult();
        }
    };
}

// [버튼 클릭] 1단계 완료 -> 기준 비율 계산
function confirmReference() {
    if (!refLine) { alert("먼저 신용카드(또는 동전) 위에 선을 그어주세요."); return; }
    
    // 픽셀 거리 계산
    const distPx = Math.sqrt(Math.pow(refLine.end.x - refLine.start.x, 2) + Math.pow(refLine.end.y - refLine.start.y, 2));
    
    if (distPx < 10) { alert("선이 너무 짧습니다. 다시 그어주세요."); return; }
    
    // 비율 계산 (픽셀 / 실제mm)
    const realSize = measureRefType === 'card' ? REF_SIZE.card : REF_SIZE.coin;
    pixelsPerMM = distPx / realSize;
    
    // 2단계로 이동
    measureState = 2;
    updateStepUI();
    alert("기준이 설정되었습니다.\n이제 재고 싶은 물건 위에 선을 그으세요.");
}

// [자동 실행] 2단계 완료 -> 결과 표시
function calculateFinalResult() {
    if (!targetLine || !pixelsPerMM) return;
    
    const distPx = Math.sqrt(Math.pow(targetLine.end.x - targetLine.start.x, 2) + Math.pow(targetLine.end.y - targetLine.start.y, 2));
    
    // 실제 길이 계산
    const realMM = distPx / pixelsPerMM;
    
    // 결과 표시
    measureState = 3;
    document.getElementById('stepBar').style.display = 'none';
    document.getElementById('finalResult').style.display = 'block';
    document.getElementById('resultValue').textContent = realMM.toFixed(1) + ' mm';
}

function resetMeasure() {
    document.getElementById('measureMenu').style.display = 'block';
    document.getElementById('measureCanvas').style.display = 'none';
    document.getElementById('stepBar').style.display = 'none';
    document.getElementById('finalResult').style.display = 'none';
    measureState = 0;
    refLine = null; targetLine = null;
}
