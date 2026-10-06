// Standalone fruit face filter page (for capturing with OBS). The filter itself lives in
// fruitFilter.js, shared with the combined fruitinference.html page.
// Keys: r = random fruit on each landmark (50% chance of none), h = hide/show fruit,
// d = debug landmarks.

let video;
let frame; // filtered webcam frame
const statusEl = document.getElementById("status");

function preload() {
  loadFruitImages();
}

function setup() {
  createCanvas(640, 480);
  frame = createFruitFrame();
  // use the real webcam (never the OBS Virtual Camera this page feeds), whatever Chrome's
  // default is: the NexiGo if it's plugged in, otherwise any other non-OBS camera
  findCameraId([
    (label) => /NexiGo/i.test(label),
    (label) => !/OBS/i.test(label),
  ]).then((deviceId) => {
    video = createCapture(cameraConstraints(deviceId));
    video.size(640, 480);
    video.hide();
  });
  randomizeArrangement();
  initFaceLandmarker();
}

function draw() {
  background(0);
  updateStatus();
  if (!video) return; // camera is still being chosen
  renderFruitFrame(frame, video);
  image(frame, 0, 0, width, height);
}

function keyPressed() {
  fruitKeyPressed(key);
}

function updateStatus() {
  const text = `${fruitStatusText()} | keys: r randomise, h hide/show, d debug`;
  if (statusEl.textContent !== text) statusEl.textContent = text;
}
