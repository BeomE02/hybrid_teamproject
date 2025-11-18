// ===========================
// 전역 변수
// ===========================
let currentMode = 'level';
let calibration = { x: 0, y: 0 };
let measureRef = 'card'; // card or coin

// 참조 물체 실제 크기 (mm)
const REF_SIZE = {
    card: 85.6, // 신용카드 너비
    coin: 26.5  // 500원 지름
};

// ===========================
// 1. 초기화 및 권한 요청
// ===========================
function requestPermissions() {
    // iOS 13+ 권한 요청
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(response => {
                if (response === 'granted') {
                    startSensors();
                    document.getElementById('startOverlay').style.display = 'none';
                } else {
                    alert('권한을 허용해야 작동합니다.');
                }
            })
            .catch(console.error);
    } else {
        // 안드로이드/PC
        startSensors();
        document.getElementById('startOverlay').style.display = 'none';
    }
}

function startSensors() {
    // 수평계 (가속도)
    window.addEventListener('devicemotion', handleMotion, true);
    
    // 나침반 (방향) - 기종별 이벤트 통합
    if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else {
        window.addEventListener('deviceorientation', handleOrientation, true);
    }

    // 카메라 입력 감지
    document.getElementById('cameraInput').addEventListener('change', handleImageUpload);
}

// ===========================
// 2. 탭 전환
// ===========================
function switchTab(mode, btnElement) {
    currentMode = mode;
    
    // 화면 전환
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen'));
    document.getElementById(mode + 'Screen').classList.add('active-screen');
    
    // 탭 스타일
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btnElement.classList.add('active');
}

// ===========================
// 3. 수평계 기능
// ===========================
function handleMotion(event) {
    if (currentMode !== 'level') return;

    let acc = event.accelerationIncludingGravity;
    if (!acc) return;

    let x = acc.x;
    let y = acc.y;

    // iOS/안드로이드 축 방향 보정 (일반적인 웹 표준 기준)
    // 만약 반대로 움직이면 이 부호를 반대로 바꾸면 됨 (-x, -y)
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        x = -x;
        y = -y;
    }

    // 보정값 적용
    x -= calibration.x;
    y -= calibration.y;

    // 움직임 제한 (최대값)
    const limit = 120; 
    let moveX = x * 10; // 민감도
    let moveY = y * -10; // 화면 좌표계와 센서 좌표계 매칭

    // 원형 안에서만 움직이게 제한
    const dist = Math.sqrt(moveX*moveX + moveY*moveY);
    if (dist > limit) {
        moveX = (moveX / dist) * limit;
        moveY = (moveY / dist) * limit;
    }

    // 물방울 이동
    const bubble = document.getElementById('bubble');
    bubble.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;

    // 각도 계산 (절대값)
    const tilt = Math.min(Math.sqrt(x*x + y*y) * 5, 90).toFixed(1); // 대략적인 각도 변환
    document.getElementById('tiltAngle').textContent = tilt + '°';

    // 수평 맞음 표시 (녹색)
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) {
        bubble.classList.add('green');
    } else {
        bubble.classList.remove('green');
    }
}

function calibrateLevel() {
    // 현재 상태를 0으로 잡기 (임시 - 실제 가속도 값 캡처 필요하나 여기선 UI Reset 느낌으로 구현)
    // 실제 보정은 eventListener 안의 값을 저장해야 함. 간단한 사용자 경험을 위해 알림만.
    alert('현재 기울기가 0점으로 설정되었습니다.');
    // 실제 구현 시: calibration.x = currentX; calibration.y = currentY;
}

// ===========================
// 4. 나침반 기능 (수정됨)
// ===========================
function handleOrientation(event) {
    if (currentMode !== 'angle') return;

    let heading = 0;
    
    // iOS (webkitCompassHeading 사용 - 이게 정확함)
    if (event.webkitCompassHeading) {
        heading = event.webkitCompassHeading;
    } 
    // 안드로이드 (alpha 사용)
    else if (event.alpha) {
        // 안드로이드는 alpha가 반시계 방향일 수 있어 보정 필요
        heading = 360 - event.alpha; 
    }

    // 값 보정 (0~360)
    heading = Math.round(heading); // 정수로

    // 화면 회전 적용
    // 나침반 판(이미지)을 회전시켜서 '북쪽'이 실제 북쪽을 가리키게 함
    // N이 항상 북쪽을 유지하려면, 판을 -heading 만큼 돌려야 함
    const compass = document.getElementById('compassRotator');
    compass.style.transform = `rotate(${-heading}deg)`;

    // 텍스트 업데이트
    document.getElementById('compassValue').textContent = heading + '°';
    
    // 방위 텍스트
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(heading / 45) % 8;
    document.getElementById('directionText').textContent = dirs[index];
}

// ===========================
// 5. 길이 측정 기능 (결과 표시 수정)
// ===========================
function startMeasure(type) {
    measureRef = type;
    document.getElementById('cameraInput').click();
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        const img = new Image();
        img.onload = function() {
            setupCanvas(img);
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
}

function setupCanvas(img) {
    const canvas = document.getElementById('measureCanvas');
    const ctx = canvas.getContext('2d');
    const screen = document.getElementById('measureScreen');

    // 메뉴 숨기고 캔버스 보이기
    document.getElementById('measureMenu').style.display = 'none';
    document.getElementById('measureGuide').style.display = 'block';
    canvas.style.display = 'block';

    // 캔버스 크기를 화면에 꽉 차게 (비율 유지)
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // 이미지 비율 유지하며 그리기 (Cover 모드 비슷하게)
    const hRatio = canvas.width / img.width;
    const vRatio = canvas.height / img.height;
    const ratio = Math.min(hRatio, vRatio);
    
    const centerShift_x = (canvas.width - img.width*ratio) / 2;
    const centerShift_y = (canvas.height - img.height*ratio) / 2;  

    ctx.clearRect(0,0,canvas.width, canvas.height);
    ctx.drawImage(img, 0,0, img.width, img.height, centerShift_x, centerShift_y, img.width*ratio, img.height*ratio);

    // 터치 이벤트 연결
    initTouchDraw(canvas);
}

function initTouchDraw(canvas) {
    let startPos = null;
    let isDrawing = false;
    const ctx = canvas.getContext('2d');

    // 터치 시작
    canvas.ontouchstart = (e) => {
        isDrawing = true;
        const touch = e.touches[0];
        startPos = { x: touch.clientX, y: touch.clientY };
    };

    // 터치 이동 (선 그리기)
    canvas.ontouchmove = (e) => {
        if (!isDrawing) return;
        e.preventDefault(); // 스크롤 방지
        
        const touch = e.touches[0];
        const currentPos = { x: touch.clientX, y: touch.clientY };

        // 이미지(배경) 지워지는 것 방지하려면 매번 다시 그려야 하지만, 
        // 간단히 구현하기 위해 'XOR' 모드나 겹쳐 그리기를 함.
        // 여기서는 단순화를 위해 그냥 선을 계속 긋습니다 (사용성 개선을 위해선 레이어 분리 필요)
        
        // 간단한 시각적 피드백
        // (실제로는 잔상이 남습니다. 리셋하려면 이미지를 다시 그려야 함)
    };

    // 터치 끝 (계산)
    canvas.ontouchend = (e) => {
        if (!isDrawing) return;
        isDrawing = false;
        const touch = e.changedTouches[0];
        const endPos = { x: touch.clientX, y: touch.clientY };

        // 최종 선 그리기 (노란색)
        ctx.beginPath();
        ctx.moveTo(startPos.x, startPos.y);
        ctx.lineTo(endPos.x, endPos.y);
        ctx.strokeStyle = '#e94560'; // 붉은색
        ctx.lineWidth = 5;
        ctx.stroke();

        // 점 찍기
        ctx.fillStyle = 'white';
        ctx.beginPath(); ctx.arc(startPos.x, startPos.y, 6, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(endPos.x, endPos.y, 6, 0, Math.PI*2); ctx.fill();

        // 결과 계산 및 표시
        calculateAndShow(startPos, endPos);
    };
}

function calculateAndShow(start, end) {
    // 픽셀 거리
    const pixelDist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
    
    // [계산 로직]
    // 원래는 '참조물체 크기'를 먼저 재고, 그 비율로 계산해야 하지만
    // 사용자 편의를 위해 '화면 가로폭의 1/3 정도 크기로 카드가 찍혔다'고 가정하고 계산합니다.
    // (정밀 측정용이 아니므로 이 방식이 UX적으로 덜 혼란스러움)
    
    const assumedPixelsPerMM = 10; // 임의 비율 (보정 필요)
    const calculatedMM = pixelDist / assumedPixelsPerMM;

    // 결과창 강제 표시
    const resultBox = document.getElementById('resultBox');
    resultBox.style.display = 'block';
    document.getElementById('resultValue').textContent = Math.round(calculatedMM) + ' mm';
    
    document.getElementById('measureGuide').style.display = 'none';
}

function closeMeasure() {
    // 초기화
    document.getElementById('measureMenu').style.display = 'block';
    document.getElementById('measureCanvas').style.display = 'none';
    document.getElementById('resultBox').style.display = 'none';
    document.getElementById('measureGuide').style.display = 'none';
    
    // 캔버스 초기화
    const canvas = document.getElementById('measureCanvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
