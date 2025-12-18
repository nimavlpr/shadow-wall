let video;
let bodySegmentation;
let bodyPose;
let segmentation;
let poses = [];
let options = {
    maskType: "background",
};

// --- تصاویر ---
let hornImg, haloImg, wallImg;
let greenImg, blueImg;

// --- تنظیمات ماشین زمان ---
let historyBuffer = [];
const MAX_BUFFER = 150;
let playbackIndex = 0;
let isLagging = false;
let lagTimer = 0;
let lagCooldown = 0;

// --- تنظیمات فیزیک ---
let userX = 0, userY = 0;
let velocityX = 0, velocityY = 0;
let shadowOffsetX = 0, shadowOffsetY = 0;
let shadowVx = 0, shadowVy = 0;

function preload() {
    bodySegmentation = ml5.bodySegmentation("SelfieSegmentation", options);
    bodyPose = ml5.bodyPose();

    // تصاویر
    hornImg = loadImage('assets/horn.png');
    haloImg = loadImage('assets/halo.png');
    wallImg = loadImage('assets/wall2.jpg');
    greenImg = loadImage('assets/alien.png');
    blueImg = loadImage('assets/crown.png');
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    video = createCapture(VIDEO);

    // *** تغییر ۱: افزایش کیفیت برای کاهش پیکسلی شدن ***
    // قبلا 320, 240 بود. الان کیفیت رو کمی بهتر کردیم.
    video.size(480, 360);

    video.hide();
    bodySegmentation.detectStart(video, gotSegmentation);
    bodyPose.detectStart(video, gotPoses);
    imageMode(CORNER);
}

function draw() {
    noTint();
    imageMode(CORNER);

    // ریست کردن فیلترها برای پس‌زمینه (که دیوار تار نشه)
    drawingContext.filter = 'none';

    if (wallImg) image(wallImg, 0, 0, width, height);
    else background(200);

    if (segmentation) {
        calculateHeavyPhysics();

        let img = video.get();
        img.mask(segmentation.mask);

        // --- تشخیص رنگ ---
        let accessoryType = "none";
        if (poses.length > 0) {
            let pose = poses[0];
            if(pose.keypoints[5].confidence > 0.1 && pose.keypoints[6].confidence > 0.1) {
                let chestX = constrain((pose.keypoints[5].x + pose.keypoints[6].x)/2, 0, video.width);
                let chestY = constrain((pose.keypoints[5].y + pose.keypoints[6].y)/2, 0, video.height);
                let c = video.get(chestX, chestY);
                let r = c[0], g = c[1], b = c[2];

                if (r > g + 30 && r > b + 30) accessoryType = "horn";
                else if (g > r + 30 && g > b + 30) accessoryType = "alien";
                else if (b > r + 30 && b > g + 30) accessoryType = "crown";
                else if (r > 180 && g > 180 && b > 180) accessoryType = "halo";
            }
        }

        historyBuffer.push({
            image: img,
            poses: JSON.parse(JSON.stringify(poses)),
            accessory: accessoryType,
            offsetX: shadowOffsetX,
            offsetY: shadowOffsetY
        });

        if (historyBuffer.length > MAX_BUFFER) {
            historyBuffer.shift();
            playbackIndex = max(0, playbackIndex - 1);
        }

        manageTimeLogic();

        if (historyBuffer.length > 0) {

            if (isLagging) {
                // ===========================
                // حالت لگ (Lag Mode)
                // ===========================
                let liveIndex = historyBuffer.length - 1;
                let frozenIndex = floor(playbackIndex);

                // 1. رسم ارواح (Ghost Tether)
                noTint();
                for(let i = 1; i <= 6; i++) {
                    let percent = i / 7.0;
                    let tetherIndex = floor(lerp(frozenIndex, liveIndex, percent));

                    if (tetherIndex < historyBuffer.length) {
                        let data = historyBuffer[tetherIndex];
                        tint(0, 30);
                        imageMode(CORNER);

                        // *** تغییر ۲: اعمال بلور روی ارواح ***
                        drawingContext.filter = 'blur(4px)';
                        image(data.image, 0, 0, width, height);
                    }
                }

                // 2. رسم سایه اصلی فریز شده
                let data = historyBuffer[frozenIndex];
                tint(0, 255);
                imageMode(CORNER);
                let jitterX = random(-10, 10);
                let drawX = data.offsetX + jitterX;
                let drawY = data.offsetY;

                // *** تغییر ۳: اعمال بلور قوی روی سایه اصلی ***
                // این باعث میشه لبه‌های تیز از بین برن و مثل سایه واقعی بشه
                drawingContext.filter = 'blur(8px)';
                image(data.image, drawX, drawY, width, height);

                // خاموش کردن بلور برای اکسسوری (که شارپ باشه)
                drawingContext.filter = 'none';
                drawAccessory(data, drawX, drawY, width, height);

            } else {
                // ===========================
                // حالت عادی (Normal Mode)
                // ===========================
                for (let i = 5; i >= 0; i--) {
                    let trailIndex = floor(playbackIndex - (i * 2));
                    if (trailIndex >= 0 && trailIndex < historyBuffer.length) {
                        let data = historyBuffer[trailIndex];
                        let opacity = (i === 0) ? 255 : 40;

                        tint(0, opacity);
                        imageMode(CORNER);

                        let extraH = 0, extraW = 0;
                        if (i === 0 && abs(velocityX) < 0.5) {
                            let wave = sin(frameCount * 0.04);
                            extraH = map(wave, -1, 1, 0, 8);
                            extraW = map(wave, -1, 1, 0, 2);
                        }
                        let drawX = (i === 0) ? data.offsetX - extraW/2 : 0;
                        let drawY = (i === 0) ? data.offsetY - extraH : 0;

                        // *** تغییر ۴: اعمال بلور در حالت عادی ***
                        // لایه اصلی (i==0) بلور کمتر، دنباله‌ها بلور بیشتر
                        let blurAmount = (i === 0) ? 8 : 12;
                        drawingContext.filter = `blur(${blurAmount}px)`;

                        image(data.image, drawX, drawY, width + extraW, height + extraH);

                        // خاموش کردن بلور برای اکسسوری
                        if (i === 0) {
                            drawingContext.filter = 'none';
                            drawAccessory(data, drawX, drawY, width + extraW, height + extraH);
                        }
                    }
                }
            }
        }
    }
    // در پایان کار فیلتر را خاموش میکنیم برای فریم بعد
    drawingContext.filter = 'none';
}

function drawAccessory(data, drawX, drawY, currentW, currentH) {
    if (data.poses.length > 0) {
        let pose = data.poses[0];
        if (pose.keypoints[3].confidence > 0.1 && pose.keypoints[4].confidence > 0.1) {
            let scaleX = currentW / video.width;
            let scaleY = currentH / video.height;
            let headX = ((pose.keypoints[3].x + pose.keypoints[4].x) / 2) * scaleX + drawX;
            let headY = ((pose.keypoints[3].y + pose.keypoints[4].y) / 2) * scaleY + drawY;
            let earDist = dist(pose.keypoints[3].x, pose.keypoints[3].y, pose.keypoints[4].x, pose.keypoints[4].y) * scaleX;
            let assetSize = earDist;

            noTint();
            imageMode(CENTER);

            if (data.accessory === "horn" && hornImg) image(hornImg, headX, headY - assetSize*0.5, assetSize, assetSize);
            else if (data.accessory === "halo" && haloImg) image(haloImg, headX, headY - assetSize*0.8, assetSize, assetSize);
            else if (data.accessory === "alien" && greenImg) image(greenImg, headX, headY - assetSize*0.5, assetSize, assetSize);
            else if (data.accessory === "crown" && blueImg) image(blueImg, headX, headY - assetSize*0.5, assetSize, assetSize);
        }
    }
}

function calculateHeavyPhysics() {
    if (poses.length > 0) {
        let pose = poses[0];
        let nose = pose.keypoints[0];
        let currentVx = (nose.x - userX);
        let currentVy = (nose.y - userY);
        let accelerationX = currentVx - velocityX;
        velocityX = lerp(velocityX, currentVx, 0.2);
        velocityY = lerp(velocityY, currentVy, 0.2);
        userX = nose.x; userY = nose.y;

        let tension = 0.2;
        let impulseMultiplier = 8.0;

        let forceX = -shadowOffsetX * tension;
        let forceY = -shadowOffsetY * tension;

        if (abs(accelerationX) > 1.0) forceX += -accelerationX * impulseMultiplier;
        shadowVx += forceX; shadowVy += forceY;
        let friction = 0.6;
        shadowVx *= friction; shadowVy *= friction;
        shadowOffsetX += shadowVx; shadowOffsetY += shadowVy;
    } else {
        shadowOffsetX = lerp(shadowOffsetX, 0, 0.2);
        shadowOffsetY = lerp(shadowOffsetY, 0, 0.2);
    }
}

function manageTimeLogic() {
    let targetIndex = historyBuffer.length - 1;
    if (historyBuffer.length < 10) { playbackIndex = targetIndex; return; }

    // 1. مدیریت زمان استراحت (Cooldown)
    if (lagCooldown > 0) {
        lagCooldown--; // کم کردن تایمر استراحت
    }

    // 2. شرط شروع لگ:
    // - الان لگ نباشه (!isLagging)
    // - زمان استراحت تمام شده باشه (lagCooldown <= 0)
    // - شانس تصادفی هم بیاره (که دقیقا سر ثانیه نباشه و طبیعی باشه)
    if (!isLagging && lagCooldown <= 0 && random(100) < 1) {
        isLagging = true;
        lagTimer = 50; // مدت زمانِ گیر کردن (حدود ۱ ثانیه)

        // تنظیم زمان استراحت برای دفعه بعدی:
        // بین 600 تا 900 فریم صبر کن (حدود ۱۰ تا ۱۵ ثانیه)
        lagCooldown = random(400, 700);
    }

    if (isLagging) {
        lagTimer--;
        if (lagTimer <= 0) isLagging = false;
    } else {
        playbackIndex = lerp(playbackIndex, targetIndex, 0.15);
        if (abs(playbackIndex - targetIndex) < 0.5) playbackIndex = targetIndex;
    }
}

function gotSegmentation(result) { segmentation = result; }
function gotPoses(results) { poses = results; }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }