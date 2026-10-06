// Fruit face filter: covers the eyes and mouth with fruit/vegetable images.
// Landmarks come from MediaPipe Face Landmarker (478 points, including iris centres).
// Shared by fruitface.html (filter only) and fruitinference.html (filter feeding the
// inference pipeline). Both render the filtered webcam frame into an offscreen graphics
// buffer with renderFruitFrame(); keys are handled by fruitKeyPressed().
// Keys: r = random fruit on each landmark (50% chance of none), h = hide/show fruit,
// d = debug landmarks.

const MEDIAPIPE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// MediaPipe landmark indices. "left"/"right" here mean the left/right side of the IMAGE
// (so leftEye is the subject's right eye).
const LM = {
  leftEyeCenter: 468, // iris centre
  leftEyeCorners: [33, 133],
  rightEyeCenter: 473,
  rightEyeCorners: [362, 263],
  mouthCenter: [13, 14], // inner upper lip, inner lower lip
  mouthCorners: [61, 291],
};

// ----------------- FRUIT IMAGES -----------------
// PNGs with transparent backgrounds in public/fruit/. `scale` is relative to the feature's
// width (eye corner to corner, or mouth corner to corner), so 2.0 = twice as wide as the eye.
const FRUIT = {
  orange: { file: "fruit/orange.png", scale: 3.0 },
  kiwi: { file: "fruit/kiwi.png", scale: 3.0 },
  tomato: { file: "fruit/tomato.png", scale: 3.0 },
  cucumber: { file: "fruit/cucumber.png", scale: 3.0 },
  avocadoL: { file: "fruit/avocadoL.png", scale: 3.3 },
  avocadoR: { file: "fruit/avocadoR.png", scale: 3.3 },
  banana: { file: "fruit/banana.png", scale: 2.7 },
  watermelon: { file: "fruit/watermelon.png", scale: 2.7 },
};

// Which fruit each landmark can randomly get. The avocado halves are a left/right pair;
// the mouth only gets the long shapes.
const POOLS = {
  leftEye: ["orange", "kiwi", "tomato", "cucumber", "avocadoL"],
  rightEye: ["orange", "kiwi", "tomato", "cucumber", "avocadoR"],
  mouth: ["banana", "watermelon"],
};
const EMPTY_CHANCE = 0.5; // chance that a landmark gets no fruit when randomising

// ----------------- STATE -----------------
let faceLandmarker;
let lastVideoTime = -1;
let features = null; // smoothed eye/mouth positions, or null when no face
let arrangement = {}; // landmark name -> fruit name (missing = no fruit)
let fruitHidden = false;
let fruitDebug = false;
const SMOOTHING = 0.5; // 0 = no smoothing, closer to 1 = steadier but laggier

// ----------------- SETUP -----------------
// Call from preload() or setup(). Images drawn before they finish loading are skipped.
function loadFruitImages() {
  for (const key in FRUIT) {
    FRUIT[key].img = loadImage(FRUIT[key].file);
  }
}

// Offscreen 640x480 buffer the filtered frame is rendered into. pixelDensity 1 keeps its
// pixels array the same size as a plain 640x480 image on retina screens.
function createFruitFrame() {
  const g = createGraphics(640, 480);
  g.pixelDensity(1);
  g.angleMode(RADIANS);
  return g;
}

async function initFaceLandmarker() {
  // MediaPipe ships as an ES module, so load it with a dynamic import
  const { FaceLandmarker, FilesetResolver } = await import(
    MEDIAPIPE_URL + "/vision_bundle.mjs"
  );
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_URL + "/wasm");
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  try {
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (err) {
    console.log("GPU delegate unavailable, falling back to CPU:", err);
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

// ----------------- PER FRAME -----------------
// Draw the webcam frame plus fruit into `g` (from createFruitFrame)
function renderFruitFrame(g, video) {
  g.image(video, 0, 0, g.width, g.height);
  detectFace(video.elt, g.width, g.height);
  if (!features) return;

  if (!fruitHidden) {
    drawFeature(g, arrangement.leftEye, features.leftEye, features.leftEyeWidth);
    drawFeature(g, arrangement.rightEye, features.rightEye, features.rightEyeWidth);
    drawFeature(g, arrangement.mouth, features.mouth, features.mouthWidth);
  }

  if (fruitDebug) {
    g.noStroke();
    g.fill(0, 255, 0);
    for (const p of [features.leftEye, features.rightEye, features.mouth]) {
      g.circle(p.x, p.y, 6);
    }
  }
}

// Returns true if the key was one of the filter's keys
function fruitKeyPressed(k) {
  if (k == "r") {
    randomizeArrangement();
    fruitHidden = false;
  } else if (k == "h") {
    fruitHidden = !fruitHidden;
  } else if (k == "d") {
    fruitDebug = !fruitDebug;
  } else {
    return false;
  }
  return true;
}

// Pick a fruit for each landmark, leaving each one empty EMPTY_CHANCE of the time
function randomizeArrangement() {
  arrangement = {};
  for (const landmark in POOLS) {
    if (random() >= EMPTY_CHANCE) {
      arrangement[landmark] = random(POOLS[landmark]);
    }
  }
  console.log("arrangement:", arrangement);
}

// e.g. "leftEye: kiwi, rightEye: -, mouth: banana"
function describeArrangement() {
  if (fruitHidden) return "fruit hidden";
  return ["leftEye", "rightEye", "mouth"]
    .map((k) => `${k}: ${arrangement[k] || "-"}`)
    .join(", ");
}

function fruitStatusText() {
  const face = !faceLandmarker ? "loading model..." : features ? "face found" : "no face";
  return `${describeArrangement()} | ${face}`;
}

// ----------------- FACE DETECTION -----------------
function detectFace(videoEl, w, h) {
  if (!faceLandmarker || videoEl.readyState < 2) return;
  if (videoEl.currentTime === lastVideoTime) return; // no new frame yet
  lastVideoTime = videoEl.currentTime;

  const result = faceLandmarker.detectForVideo(videoEl, performance.now());
  if (result.faceLandmarks.length === 0) {
    features = null;
  } else {
    features = smoothFeatures(features, measureFeatures(result.faceLandmarks[0], w, h));
  }
}

// Convert normalised landmarks into frame-space centres, widths, and head tilt
function measureFeatures(landmarks, w, h) {
  const pt = (i) => createVector(landmarks[i].x * w, landmarks[i].y * h);
  const mid = ([a, b]) => p5.Vector.lerp(pt(a), pt(b), 0.5);
  const span = ([a, b]) => p5.Vector.dist(pt(a), pt(b));

  const leftEye = pt(LM.leftEyeCenter);
  const rightEye = pt(LM.rightEyeCenter);
  return {
    leftEye,
    rightEye,
    mouth: mid(LM.mouthCenter),
    leftEyeWidth: span(LM.leftEyeCorners),
    rightEyeWidth: span(LM.rightEyeCorners),
    mouthWidth: span(LM.mouthCorners),
    // radians regardless of the sketch's angleMode (the inference page uses DEGREES)
    angle: Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x),
  };
}

function smoothFeatures(prev, next) {
  if (!prev) return next;
  const out = {};
  for (const k in next) {
    out[k] =
      next[k] instanceof p5.Vector
        ? p5.Vector.lerp(next[k], prev[k], SMOOTHING)
        : lerp(next[k], prev[k], SMOOTHING);
  }
  return out;
}

// ----------------- DRAWING -----------------
// Draw a fruit image centred on a feature, sized to the feature and rotated with the head
function drawFeature(g, fruitName, center, featureWidth) {
  if (!fruitName) return;
  const fruit = FRUIT[fruitName];
  const img = fruit.img;
  if (!img || !img.width) return; // still loading
  const w = featureWidth * fruit.scale;
  const h = w * (img.height / img.width);
  g.push();
  g.translate(center.x, center.y);
  g.rotate(features.angle);
  g.imageMode(CENTER);
  g.image(img, 0, 0, w, h);
  g.pop();
}
