(function(){
  "use strict";

  const form = document.querySelector("[data-fi-form]");
  if (!form) return;

  const imageKeys = ["front_neutral", "front_smile", "side_profile"];
  const images = {};
  const imageQuality = {};
  const state = {
    step: 0,
    activeKey: null,
    stream: null,
    loop: null,
    countdown: null,
    countdownValue: 0,
    loadingTimer: null,
    loadingProgress: 0,
    lastReport: null,
    faceDetector: null,
    faceDetectorReady: false,
    faceLandmarker: null,
    faceLandmarkerReady: false,
    faceLandmarkerLoading: null,
    detecting: false,
    lastTestId: "",
    ownerAccessSig: "",
    clientTestCode: "",
    processedImages: {},
    gates: {},
    loadingStoryTimer: null,
    loadingStoryIndex: 0,
    loadingGameScore: 0,
    loadingGameGoal: 6,
    greenStreak: {},
    memoryFlip: [],
    memoryMatched: null,
    wakeLock: null,
    loadingStartedAt: 0
  };

  const $ = (selector, base = document) => base.querySelector(selector);
  const $$ = (selector, base = document) => Array.from(base.querySelectorAll(selector));

  function setStep(index){
    stopCamera();
    state.step = Math.max(1, Math.min(3, index));
    $$("[data-step]").forEach(step => step.classList.toggle("is-active", Number(step.dataset.step) === state.step));
    $$("[data-step-indicator]").forEach(item => item.classList.toggle("is-active", Number(item.dataset.stepIndicator) === state.step));
    const prev = $("[data-prev]");
    const next = $("[data-next]");
    if (prev) prev.disabled = state.step === 1 || state.step === 3;
    if (next) {
      next.hidden = state.step === 3;
      next.textContent = state.step === 2 ? "Steckbrief erstellen" : "Weiter";
      next.disabled = !canContinue();
    }
  }

  function value(name){
    const field = form.elements[name];
    return field ? String(field.value || "").trim() : "";
  }

  function checked(name){
    return form.querySelector(`[name="${name}"]:checked`);
  }

  function initClientTestCode(){
    const stored = window.sessionStorage ? window.sessionStorage.getItem("faceinsight_client_test_code") : "";
    state.clientTestCode = stored || `FI-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (window.sessionStorage && !stored) window.sessionStorage.setItem("faceinsight_client_test_code", state.clientTestCode);
    const hidden = form.elements.client_test_code;
    const visible = $("[data-client-test-code]");
    if (hidden) hidden.value = state.clientTestCode;
    if (visible) visible.textContent = state.clientTestCode;
  }

  const COOKIE_PREFS_KEY = "fi_cookie_prefs_v3";

  function readCookiePrefs(){
    try {
      const s = window.localStorage.getItem(COOKIE_PREFS_KEY);
      if (!s) return null;
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }

  function migrateLegacyCookieConsent(){
    try {
      if (window.localStorage.getItem("fi_cookie_ok") !== "1") return;
      if (!readCookiePrefs()) {
        window.localStorage.setItem(COOKIE_PREFS_KEY, JSON.stringify({
          v: 2,
          essential: true,
          comfort: true,
          legacy: true,
          at: new Date().toISOString()
        }));
      }
      window.localStorage.removeItem("fi_cookie_ok");
    } catch (_) {}
  }

  function cookieConsentDismissed(){
    const p = readCookiePrefs();
    if (p && p.v === 2 && p.essential === true) return true;
    try {
      return window.sessionStorage.getItem("fi_cookie_sess_ok") === "1";
    } catch (_) {
      return false;
    }
  }

  function persistCookieConsent(comfort){
    const payload = {
      v: 2,
      essential: true,
      comfort: Boolean(comfort),
      at: new Date().toISOString()
    };
    let stored = false;
    try {
      window.localStorage.setItem(COOKIE_PREFS_KEY, JSON.stringify(payload));
      stored = true;
    } catch (_) {}
    if (!stored) {
      try {
        window.sessionStorage.setItem("fi_cookie_sess_ok", "1");
        window.sessionStorage.setItem("fi_cookie_sess_comfort", comfort ? "1" : "0");
      } catch (_) {}
    }
    return Boolean(stored);
  }

  function canContinue(){
    if (state.step === 1) return Boolean(images.front_neutral) && Boolean(images.front_smile);
    if (state.step === 2) {
      const age = Number(value("age"));
      return value("first_name").length > 0 && age >= 13 && age <= 100 && value("makeup_status").length > 0;
    }
    return true;
  }

  function updateNav(){
    const next = $("[data-next]");
    if (next && state.step !== 3) next.disabled = !canContinue();
  }

  function setCameraStatus(text){
    const node = $("[data-camera-status]");
    if (node) node.textContent = text;
  }

  function getFaceDetector(){
    if (state.faceDetectorReady) return state.faceDetector;
    state.faceDetectorReady = true;
    try {
      if ("FaceDetector" in window) {
        state.faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 });
      }
    } catch (_) {
      state.faceDetector = null;
    }
    return state.faceDetector;
  }

  function getFaceLandmarker(){
    if (state.faceLandmarkerReady) return Promise.resolve(state.faceLandmarker);
    if (state.faceLandmarkerLoading) return state.faceLandmarkerLoading;
    state.faceLandmarkerLoading = (async () => {
      try {
        const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
        const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
        state.faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numFaces: 2,
          outputFaceBlendshapes: true
        });
      } catch (_) {
        state.faceLandmarker = null;
      }
      state.faceLandmarkerReady = true;
      return state.faceLandmarker;
    })();
    return state.faceLandmarkerLoading;
  }

  function warmupFaceLandmarker(){
    getFaceLandmarker().then(detector => {
      if (detector && state.activeKey) setCameraStatus("Kamera aktiv. Live-Gesichtspruefung ist bereit. Gruen bedeutet: Aufnahme ist freigegeben.");
    }).catch(() => {});
  }

  async function startCamera(key, reuseStream = false){
    const video = $(`[data-video="${key}"]`);
    const card = $(`[data-photo-card="${key}"]`);
    if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setFrameState(key, "red", "Kamera nicht verfuegbar. Bitte Upload verwenden.");
      return;
    }

    try {
      if (reuseStream && state.stream) {
        clearLiveTarget(true);
        state.activeKey = key;
      } else {
        stopCamera();
        state.activeKey = key;
        state.stream = await openCameraStream();
      }
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.muted = true;
      video.autoplay = true;
      video.srcObject = state.stream;
      await waitForVideo(video);
      await video.play();
      if (card) {
        card.classList.add("is-live");
        card.classList.remove("has-image");
      }
      state.gates[key] = gateResult(false, "starting", "Kamera startet.");
      updateCaptureControls(key, false);
      warmupFaceLandmarker();
      const detector = getFaceDetector();
      const detectorCopy = detector ? "Fallback-Gesichtserkennung aktiv." : "MediaPipe wird geladen.";
      setFrameState(key, "yellow", key === "front_smile" ? "Bitte natuerlich laecheln. Ausloeser wird erst bei gueltigem Gesicht aktiv." : "Bitte frontal und neutral schauen. Ausloeser wird erst bei gueltigem Gesicht aktiv.");
      setCameraStatus(`Kamera aktiv. ${detectorCopy} Keine Aufnahme ohne gueltiges Gesicht und passenden Ausdruck.`);
      state.loop = window.setInterval(() => {
        if (!state.detecting) evaluateLiveFrame(key);
      }, 320);
    } catch (error) {
      const message = cameraErrorMessage(error);
      setFrameState(key, "red", message);
      stopCamera();
    }
  }

  async function openCameraStream(){
    const profiles = [
      { video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 1600 } }, audio: false },
      { video: { facingMode: "user" }, audio: false },
      { video: true, audio: false }
    ];
    let lastError = null;
    for (const profile of profiles) {
      try {
        return await navigator.mediaDevices.getUserMedia(profile);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("camera_open_failed");
  }

  function cameraErrorMessage(error){
    if (!error || !error.name) return "Kamera konnte nicht gestartet werden.";
    if (error.name === "NotAllowedError") return "Kamerazugriff blockiert. Bitte Berechtigung aktivieren oder Upload verwenden.";
    if (error.name === "NotFoundError") return "Keine Kamera gefunden. Bitte Upload verwenden.";
    if (error.name === "NotReadableError") return "Kamera ist bereits durch eine andere App belegt. Bitte Kamera-App schliessen und erneut versuchen.";
    if (error.name === "OverconstrainedError") return "Kamera-Profil nicht verfuegbar. Wir nutzen ein Fallback-Profil, bitte erneut starten.";
    if (error.name === "SecurityError") return "Kamera nur in sicherem Kontext verfuegbar (HTTPS).";
    return "Kamera konnte nicht gestartet werden.";
  }

  function waitForVideo(video){
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2 && video.videoWidth) return resolve();
      const timer = window.setTimeout(() => reject(new Error("Video timeout")), 7000);
      const done = () => {
        window.clearTimeout(timer);
        video.removeEventListener("loadedmetadata", done);
        resolve();
      };
      video.addEventListener("loadedmetadata", done);
    });
  }

  async function evaluateLiveFrame(key){
    const video = $(`[data-video="${key}"]`);
    if (!video || !video.videoWidth) return;
    state.detecting = true;
    try {
      const quality = sampleVideoQuality(video);
      const face = await detectFace(video);
      const verdict = liveVerdict(key, quality, face, video.videoWidth, video.videoHeight);

      if (verdict.color !== "green") {
        state.greenStreak[key] = 0;
        cancelCountdown(key);
      } else {
        state.greenStreak[key] = (state.greenStreak[key] || 0) + 1;
        if (!state.countdown && state.activeKey === key && state.greenStreak[key] >= 5) {
          state.greenStreak[key] = 0;
          startCountdown(key);
        }
      }
      state.gates[key] = verdict.gate || gateResult(false, "not_ready", verdict.message);
      updateCaptureControls(key, verdict.color === "green");
      let msg = verdict.message;
      if (verdict.color === "green") {
        msg = state.countdown ? "Automatische Aufnahme …" : "Halten … automatischer Ausloeser gleich.";
      }
      setFrameState(key, verdict.color, msg);
    } finally {
      state.detecting = false;
    }
  }

  async function detectFace(video){
    const landmarker = await getFaceLandmarker();
    if (landmarker) {
      try {
        const result = landmarker.detectForVideo(video, performance.now());
        return faceFromLandmarker(result, video.videoWidth, video.videoHeight);
      } catch (_) {}
    }
    const detector = getFaceDetector();
    if (!detector) return { supported: false, count: 0, box: null };
    try {
      const faces = await detector.detect(video);
      const first = faces && faces[0] ? faces[0].boundingBox : null;
      return { supported: true, count: faces.length, box: first };
    } catch (_) {
      return { supported: false, count: 0, box: null };
    }
  }

  function faceFromLandmarker(result, width, height){
    const landmarks = result && Array.isArray(result.faceLandmarks) ? result.faceLandmarks : [];
    const first = landmarks[0] || [];
    const box = first.length ? landmarksToBox(first, width, height) : null;
    const blend = result && result.faceBlendshapes && result.faceBlendshapes[0] ? result.faceBlendshapes[0].categories || [] : [];
    const score = name => {
      const item = blend.find(category => category.categoryName === name);
      return item ? Number(item.score || 0) : 0;
    };
    const smileScore = Math.max(score("mouthSmileLeft"), score("mouthSmileRight"), (score("mouthSmileLeft") + score("mouthSmileRight")) / 2);
    const jawOpen = score("jawOpen");
    const eyeBlink = (score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2;
    return {
      supported: true,
      source: "mediapipe",
      count: landmarks.length,
      box,
      smileScore,
      jawOpen,
      eyesOpenScore: Math.max(0, Math.min(1, 1 - eyeBlink)),
      frontalScore: estimateFrontalScore(first)
    };
  }

  function landmarksToBox(points, width, height){
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    points.forEach(point => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    });
    return { x: minX * width, y: minY * height, width: (maxX - minX) * width, height: (maxY - minY) * height, nx: minX, ny: minY, nw: maxX - minX, nh: maxY - minY };
  }

  function estimateFrontalScore(points){
    if (!points || points.length < 264) return 0.72;
    const leftEye = midpoint(points[33], points[133]);
    const rightEye = midpoint(points[362], points[263]);
    const nose = points[1] || points[4];
    if (!leftEye || !rightEye || !nose) return 0.72;
    const eyeCenter = midpoint(leftEye, rightEye);
    const eyeDistance = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
    const offset = Math.abs(nose.x - eyeCenter.x) / eyeDistance;
    return Math.max(0, Math.min(1, 1 - offset * 1.8));
  }

  function midpoint(a, b){
    if (!a || !b) return null;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function liveVerdict(key, quality, face, width, height){
    let rejection = "";
    if (!face.supported) {
      return { color: "red", message: "Live-Gesichtserkennung nicht verfuegbar. Bitte Browser aktualisieren oder Foto hochladen.", gate: gateResult(false, "face_detection_unavailable", "Live-Gesichtserkennung nicht verfuegbar.") };
    }
    if (face.count < 1) return { color: "red", message: "Noch kein Gesicht erkannt. Gesicht in den Umriss bringen.", gate: gateResult(false, "no_face", "Kein Gesicht erkannt.") };
    if (face.count > 1) return { color: "red", message: "Bitte nur eine Person im Bild.", gate: gateResult(false, "multiple_faces", "Mehr als ein Gesicht erkannt.") };
    if (face.supported) {
      const box = face.box;
      if (box) {
        const cx = (box.x + box.width / 2) / width;
        const cy = (box.y + box.height / 2) / height;
        const size = box.height / height;
        if (box.nx !== undefined && (box.nx < .015 || box.ny < .015 || box.nx + box.nw > .985 || box.ny + box.nh > .985)) {
          return { color: "yellow", message: "Gesicht ist angeschnitten. Bitte vollstaendig in den Rahmen.", gate: gateResult(false, "face_cut_off", "Gesicht angeschnitten.", face) };
        }
        if (cx < .34 || cx > .66 || cy < .24 || cy > .62) return { color: "yellow", message: "Gesicht mittiger und auf Augenhoehe halten.", gate: gateResult(false, "not_centered", "Gesicht nicht mittig.", face) };
        if (size < .30) return { color: "yellow", message: "Etwas naeher an die Kamera.", gate: gateResult(false, "too_far", "Gesicht zu klein.", face) };
        if (size > .74) return { color: "yellow", message: "Etwas weiter weg, Gesicht vollstaendig im Rahmen.", gate: gateResult(false, "too_close", "Gesicht zu gross.", face) };
      }
      if (face.eyesOpenScore !== undefined && face.eyesOpenScore < .45) return { color: "yellow", message: "Bitte Augen offen halten.", gate: gateResult(false, "eyes_not_open", "Augen nicht sicher offen.", face) };
      if (face.frontalScore !== undefined && face.frontalScore < .58 && key !== "side_profile") return { color: "yellow", message: "Bitte Kopf frontaler zur Kamera ausrichten.", gate: gateResult(false, "not_frontal", "Kopf nicht frontal genug.", face) };
    }

    if (quality.brightness < 55 || quality.brightness > 218 || quality.sharpness < 5) {
      return { color: "red", message: "Licht oder Schaerfe passt noch nicht. Handy ruhig und gerade halten.", gate: gateResult(false, "quality_low", "Licht oder Schaerfe passt nicht.", face) };
    }
    if (quality.brightness < 78 || quality.brightness > 198 || quality.sharpness < 8 || quality.contrast < 18) {
      return { color: "yellow", message: "Fast gut. Besseres Frontlicht oder etwas ruhiger halten.", gate: gateResult(false, "quality_borderline", "Bildqualitaet fast bereit.", face) };
    }
    const smileScore = typeof face.smileScore === "number" ? face.smileScore : Math.max(0, Math.min(1, quality.smileHint / 28));
    if (typeof face.smileScore === "number") quality.smileHint = Number((face.smileScore * 28).toFixed(1));
    if (key === "front_neutral" && (quality.smileHint > 10 || smileScore > .35)) {
      rejection = "neutral_smile";
      return { color: "yellow", message: "Bitte neutral in die Kamera schauen. Fuer dieses Bild kein Laecheln.", gate: gateResult(false, rejection, "Neutralbild zeigt Laecheln.", face, quality) };
    }
    if (key === "front_smile" && (quality.smileHint < 9 || smileScore < .60)) {
      rejection = "smile_missing";
      return { color: "yellow", message: "Bitte natuerlich laecheln. Das Laecheln muss klar erkennbar sein.", gate: gateResult(false, rejection, "Laecheln nicht klar genug.", face, quality) };
    }
    return { color: "green", message: "Gueltig. Jetzt ausloesen.", gate: gateResult(true, null, "Aufnahme freigegeben.", face, quality) };
  }

  function gateResult(accepted, reason, message, face = {}, quality = {}){
    return {
      accepted: Boolean(accepted),
      face_detected: Boolean(face.supported && face.count === 1),
      face_count: face.supported ? Number(face.count || 0) : 0,
      in_frame: !reason || !["face_cut_off", "not_centered", "too_far", "too_close"].includes(reason),
      frontal_score: typeof face.frontalScore === "number" ? Number(face.frontalScore.toFixed(3)) : 0,
      eyes_open_score: typeof face.eyesOpenScore === "number" ? Number(face.eyesOpenScore.toFixed(3)) : 0,
      smile_score: typeof face.smileScore === "number" ? Number(face.smileScore.toFixed(3)) : Math.max(0, Math.min(1, Number(quality.smileHint || 0) / 28)),
      quality_score: qualityScore(quality),
      rejection_reason: reason || null,
      message
    };
  }

  function qualityScore(quality){
    const brightness = Number(quality.brightness || 0);
    const sharpness = Number(quality.sharpness || 0);
    const contrast = Number(quality.contrast || 0);
    const light = Math.max(0, Math.min(1, 1 - Math.abs(brightness - 140) / 140));
    const crisp = Math.max(0, Math.min(1, sharpness / 14));
    const contrastScore = Math.max(0, Math.min(1, contrast / 34));
    return Number(((light + crisp + contrastScore) / 3).toFixed(3));
  }

  function sampleVideoQuality(video){
    const canvas = document.createElement("canvas");
    canvas.width = 112;
    canvas.height = 140;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return measureQuality(ctx, canvas.width, canvas.height);
  }

  function startCountdown(key){
    if (state.countdown) return;
    state.countdownValue = 3;
    showCountdown(key, state.countdownValue);
    state.countdown = window.setInterval(() => {
      state.countdownValue -= 1;
      if (state.countdownValue <= 0) {
        clearCountdownTimer();
        hideCountdown(key);
        capture(key, true);
      } else {
        showCountdown(key, state.countdownValue);
      }
    }, 1000);
  }

  function cancelCountdown(key){
    clearCountdownTimer();
    hideCountdown(key);
  }

  function clearCountdownTimer(){
    if (state.countdown) window.clearInterval(state.countdown);
    state.countdown = null;
    state.countdownValue = 0;
  }

  function showCountdown(key, count){
    const node = $(`[data-countdown="${key}"]`);
    if (node) {
      node.textContent = String(count);
      node.hidden = false;
    }
  }

  function hideCountdown(key){
    const node = $(`[data-countdown="${key}"]`);
    if (node) node.hidden = true;
  }

  function stopCamera(){
    clearLiveTarget(false);
  }

  function clearLiveTarget(keepStream){
    if (state.loop) window.clearInterval(state.loop);
    state.loop = null;
    clearCountdownTimer();
    if (state.activeKey) hideCountdown(state.activeKey);
    if (!keepStream && state.stream) {
      state.stream.getTracks().forEach(track => track.stop());
      state.stream = null;
    }
    if (state.activeKey) {
      const video = $(`[data-video="${state.activeKey}"]`);
      const card = $(`[data-photo-card="${state.activeKey}"]`);
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      if (card) card.classList.remove("is-live");
    }
    state.activeKey = null;
    state.detecting = false;
  }

  function capture(key, automatic){
    const video = $(`[data-video="${key}"]`);
    if (!video || !video.videoWidth) {
      setFrameState(key, "red", "Kein Kamerabild verfuegbar.");
      return;
    }
    const gate = state.gates[key];
    if (!gate || !gate.accepted) {
      setFrameState(key, "yellow", gate && gate.message ? gate.message : "Bitte warten, bis der Rahmen gruen ist.");
      updateCaptureControls(key, false);
      return;
    }
    const canvas = $(`[data-canvas="${key}"]`) || document.createElement("canvas");
    const data = drawNormalized(video, canvas, true);
    data.quality.source = automatic ? "auto_countdown" : "manual";
    data.quality.gate = gate;
    data.quality.smileHint = Math.max(Number(data.quality.smileHint || 0), Number(gate.smile_score || 0) * 28);
    stopCamera();
    saveImage(key, data.url, data.quality);
  }

  async function handleUpload(input){
    const key = input.dataset.upload;
    const file = input.files && input.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const img = await loadImage(await fileToDataUrl(file));
      const canvas = $(`[data-canvas="${key}"]`) || document.createElement("canvas");
      const data = drawNormalized(img, canvas, false);
      data.quality.source = "upload";
      data.quality.gate = {
        accepted: true,
        face_detected: false,
        face_count: 0,
        in_frame: true,
        frontal_score: 0,
        smile_score: Math.max(0, Math.min(1, Number(data.quality.smileHint || 0) / 28)),
        quality_score: qualityScore(data.quality),
        rejection_reason: "upload_not_live_verified",
        message: "Upload wird serverseitig erneut geprueft."
      };
      saveImage(key, data.url, data.quality);
    } catch (_) {
      setFrameState(key, "red", "Bild konnte nicht gelesen werden.");
    }
  }

  function drawNormalized(source, canvas, mirror){
    const width = 960;
    const height = 1200;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#f7fafc";
    ctx.fillRect(0, 0, width, height);
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    const rect = containRect(sw, sh, width, height);
    ctx.save();
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, sw, sh, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
    return { url: canvas.toDataURL("image/jpeg", 0.9), quality: measureQuality(ctx, width, height) };
  }

  function containRect(sw, sh, width, height){
    const pad = 26;
    const maxW = width - pad * 2;
    const maxH = height - pad * 2;
    const sourceRatio = sw / sh;
    let outW = maxW;
    let outH = outW / sourceRatio;
    if (outH > maxH) {
      outH = maxH;
      outW = outH * sourceRatio;
    }
    return { x: (width - outW) / 2, y: (height - outH) / 2, width: outW, height: outH };
  }

  function measureQuality(ctx, width, height){
    const sample = document.createElement("canvas");
    sample.width = 112;
    sample.height = 140;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(ctx.canvas || ctx, 0, 0, sample.width, sample.height);
    const data = sctx.getImageData(0, 0, sample.width, sample.height).data;
    let brightness = 0;
    let contrast = 0;
    let sharpness = 0;
    let smileHint = 0;
    let mouthSamples = 0;
    let count = 0;
    for (let y = 1; y < sample.height - 1; y += 2) {
      for (let x = 1; x < sample.width - 1; x += 2) {
        const i = (y * sample.width + x) * 4;
        const l = luminance(data, i);
        const lx = luminance(data, (y * sample.width + x + 1) * 4);
        const ly = luminance(data, ((y + 1) * sample.width + x) * 4);
        brightness += l;
        contrast += Math.abs(l - 128);
        sharpness += Math.abs(l - lx) + Math.abs(l - ly);
        if (y > sample.height * .54 && y < sample.height * .78 && x > sample.width * .23 && x < sample.width * .77) {
          smileHint += Math.abs(l - 132) + (l > 165 ? 10 : 0);
          mouthSamples++;
        }
        count++;
      }
    }
    brightness = Math.round(brightness / Math.max(1, count));
    contrast = Math.round(contrast / Math.max(1, count));
    sharpness = Number((sharpness / Math.max(1, count)).toFixed(1));
    smileHint = Number((smileHint / Math.max(1, mouthSamples) / 3).toFixed(1));
    const issues = [];
    if (brightness < 70) issues.push("etwas dunkel");
    if (brightness > 205) issues.push("sehr hell");
    if (sharpness < 8) issues.push("moeglich unscharf");
    if (contrast < 20) issues.push("wenig Kontrast");
    return { brightness, contrast, sharpness, smileHint, issues };
  }

  function luminance(data, index){
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }

  function saveImage(key, url, quality){
    images[key] = url;
    imageQuality[key] = quality;
    const preview = $(`[data-preview="${key}"]`);
    const card = $(`[data-photo-card="${key}"]`);
    if (preview) preview.src = url;
    if (card) {
      card.classList.add("has-image");
      card.classList.remove("is-live");
    }
    const message = quality.issues && quality.issues.length ? `Gespeichert. Hinweis: ${quality.issues.join(", ")}.` : "Foto gespeichert. Qualitaet wirkt gut.";
    setFrameState(key, quality.issues && quality.issues.length ? "yellow" : "green", message);
    updateNav();

    if (key === "front_neutral" && !images.front_smile) {
      setCameraStatus("Neutralfoto gespeichert. Jetzt startet automatisch die Laecheln-Kamera.");
      window.setTimeout(() => {
        startCamera("front_smile", true)
          .catch(() => startCamera("front_smile"))
          .catch(() => {
            setFrameState("front_smile", "yellow", "Laecheln-Kamera konnte nicht automatisch starten. Bitte auf Kamera tippen oder Upload nutzen.");
          });
      }, 420);
    }

    if (key === "front_smile") {
      setCameraStatus("Perfekt. Beide Fotos sind bereit. Weiter mit Schritt 3.");
    }
  }

  function setFrameState(key, color, message){
    const card = $(`[data-photo-card="${key}"]`);
    const quality = $(`[data-quality="${key}"]`);
    const live = $(`[data-live-state="${key}"]`);
    if (card) {
      card.classList.remove("is-red", "is-yellow", "is-green");
      card.classList.add(`is-${color}`);
    }
    if (quality) quality.textContent = message || "";
    if (live) live.textContent = message || "";
  }

  function updateCaptureControls(key, enabled){
    $$(`[data-capture="${key}"]`).forEach(button => {
      button.disabled = !enabled;
      button.setAttribute("aria-disabled", enabled ? "false" : "true");
    });
  }

  function fileToDataUrl(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function payload(){
    const selectedMode = value("report_mode");
    const effectiveMode = selectedMode === "free" ? "free" : "premium";
    return {
      mode: effectiveMode,
      pair_base_test_id: "",
      client_test_code: state.clientTestCode || value("client_test_code"),
      consent: {
        privacy_accepted: true,
        similarity_accepted: true,
        rights_confirmed: true,
        storage_mode: "delete_immediately"
      },
      user: {
        first_name: value("first_name"),
        age: Number(value("age")),
        self_described_gender: value("self_described_gender"),
        makeup_status: value("makeup_status")
      },
      images,
      processed_images: state.processedImages,
      image_quality: imageQuality,
      source: { app: "faceinsight-standalone", version: "1.3.0" }
    };
  }

  async function callStage(stage, data, timeoutMs = 120000){
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`api/analyze.php?stage=${encodeURIComponent(stage)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, stage }),
      signal: controller.signal
    });
    window.clearTimeout(timer);
    const json = await response.json();
    if (!response.ok || !json || json.success !== true) {
      throw new Error((json && (json.message || (json.errors || []).join(", "))) || `${stage} fehlgeschlagen`);
    }
    if (!json.stage && json.report) {
      return {
        success: true,
        stage: "legacy_report",
        data: { render_payload: { direct_profile_fields: {
          mode: json.mode || "fallback",
          test_id: json.test_id || "",
          expires_at: json.expires_at || "",
          owner_access_sig: json.owner_access_sig || "",
          report: json.report,
          pair_report: json.pair_report || null
        } } },
        warnings: json.message ? [json.message] : []
      };
    }
    return json;
  }

  function applyProcessedImages(processed, basePayload){
    const slotMap = { neutral: "front_neutral", smile: "front_smile", side_profile: "side_profile" };
    const items = processed && processed.data && Array.isArray(processed.data.processed_images)
      ? processed.data.processed_images
      : [];
    state.processedImages = state.processedImages || {};
    basePayload.processed_images = basePayload.processed_images || {};
    items.forEach(item => {
      const key = slotMap[item.slot] || item.slot;
      const image = typeof item.output_data_url === "string" ? item.output_data_url : "";
      if (image && /^data:image\//.test(image)) {
        state.processedImages[key] = image;
        basePayload.processed_images[key] = image;
      }
    });
  }

  async function acquireWakeLock(){
    try {
      if (!("wakeLock" in navigator) || state.wakeLock) return;
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
    } catch (_) {}
  }

  function releaseWakeLock(){
    if (!state.wakeLock) return;
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }

  function shuffleDeck(arr){
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function resetLoadingGame(){
    state.loadingGameScore = 0;
    state.memoryFlip = [];
    state.memoryMatched = new Set();
    const score = $("[data-loading-game-score]");
    if (score) score.textContent = `0 / ${state.loadingGameGoal} Paare`;
    buildMemoryGrid();
  }

  function buildMemoryGrid(){
    const grid = $("[data-memory-grid]");
    if (!grid) return;
    const symbols = ["🎬", "🎨", "🎯", "🌟", "🎭", "🏔️"];
    const deck = shuffleDeck(symbols.flatMap((sym, pairId) => [{ sym, pairId }, { sym, pairId }]));
    grid.innerHTML = "";
    deck.forEach((card, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "fi-memory-card";
      b.setAttribute("data-memory-idx", String(idx));
      b.setAttribute("data-pair", String(card.pairId));
      b.setAttribute("data-symbol", card.sym);
      b.setAttribute("aria-label", "Karte aufdecken");
      b.dataset.revealed = "0";
      b.textContent = "";
      grid.appendChild(b);
    });
  }

  function updateLoadingGameScore(){
    const score = $("[data-loading-game-score]");
    if (score) score.textContent = `${state.loadingGameScore} / ${state.loadingGameGoal} Paare`;
    if (state.loadingGameScore >= state.loadingGameGoal) {
      const copyNode = $("[data-loading-copy]");
      if (copyNode) copyNode.textContent = "Alle Paare gefunden. KI finalisiert den Report.";
    }
  }

  function wireMemoryGame(){
    const game = $("[data-loading-game]");
    if (!game || game.dataset.memoryBound === "1") return;
    game.dataset.memoryBound = "1";
    game.addEventListener("click", e => {
      const btn = e.target.closest(".fi-memory-card");
      if (!btn || btn.disabled) return;
      if (btn.dataset.revealed === "1") return;
      const pair = Number(btn.getAttribute("data-pair") || -1);
      if (state.memoryMatched && state.memoryMatched.has(pair)) return;
      if (state.memoryFlip.length >= 2) return;
      btn.dataset.revealed = "1";
      btn.textContent = btn.getAttribute("data-symbol") || "";
      state.memoryFlip.push(btn);
      if (state.memoryFlip.length < 2) return;
      const a = state.memoryFlip[0];
      const b = state.memoryFlip[1];
      const pa = a.getAttribute("data-pair");
      const pb = b.getAttribute("data-pair");
      if (pa === pb) {
        state.memoryMatched.add(Number(pa));
        state.loadingGameScore += 1;
        updateLoadingGameScore();
        state.memoryFlip = [];
        return;
      }
      window.setTimeout(() => {
        a.textContent = "";
        b.textContent = "";
        a.dataset.revealed = "0";
        b.dataset.revealed = "0";
        state.memoryFlip = [];
      }, 620);
    });
  }

  function startLoading(){
    const loading = $("[data-loading]");
    const report = $("[data-report]");
    const error = $("[data-report-error]");
    if (report) report.hidden = true;
    if (error) error.hidden = true;
    if (loading) loading.hidden = false;
    state.loadingStartedAt = Date.now();
    state.loadingProgress = 0;
    state.loadingStoryIndex = 0;
    resetLoadingGame();
    acquireWakeLock();
    setLoading(8, "Bilder werden vorbereitet.");
    window.clearInterval(state.loadingTimer);
    window.clearInterval(state.loadingStoryTimer);
    state.loadingTimer = window.setInterval(() => {
      const cap = state.loadingProgress < 45 ? 45 : state.loadingProgress < 78 ? 78 : 98;
      if (state.loadingProgress < cap) setLoading(state.loadingProgress + 2);
    }, 280);
    const story = [
      "KI prüft gerade die Fotoqualität.",
      "KI bearbeitet deine Bilder für den Premium-Look.",
      "KI analysiert Mimik, Kontur und sichtbare Merkmale.",
      "KI erstellt den Steckbrief und setzt das Layout.",
      "KI gleicht Merkmale mit der Report-Maske ab.",
      "KI finalisiert deinen Premium-Steckbrief.",
      "KI speichert den Report auf dem Server."
    ];
    state.loadingStoryTimer = window.setInterval(() => {
      const copyNode = $("[data-loading-copy]");
      if (!copyNode) return;
      if (state.loadingStoryIndex < story.length) {
        copyNode.textContent = story[state.loadingStoryIndex];
      } else {
        const waitSec = Math.max(1, Math.floor((Date.now() - state.loadingStartedAt) / 1000));
        copyNode.textContent = `KI arbeitet weiter im Hintergrund ... seit ${waitSec}s.`;
      }
      state.loadingStoryIndex += 1;
    }, 1700);
  }

  function setLoading(value, copy){
    state.loadingProgress = Math.max(state.loadingProgress, Math.min(100, Math.round(value)));
    const bar = $("[data-loading-bar]");
    const percent = $("[data-loading-percent]");
    const copyNode = $("[data-loading-copy]");
    if (bar) bar.style.width = `${state.loadingProgress}%`;
    if (percent) percent.textContent = `${state.loadingProgress}%`;
    if (copyNode && copy) copyNode.textContent = copy;
  }

  function finishLoading(){
    window.clearInterval(state.loadingTimer);
    window.clearInterval(state.loadingStoryTimer);
    releaseWakeLock();
    setLoading(100, "Steckbrief fertig.");
    window.setTimeout(() => {
      const loading = $("[data-loading]");
      const report = $("[data-report]");
      if (loading) loading.hidden = true;
      if (report) report.hidden = false;
    }, 180);
  }

  function ownerSigStorageKey(tid){
    return `fi_owner_sig_${tid}`;
  }

  function directReportUrl(testId){
    const tid = testId || state.lastTestId || state.clientTestCode;
    const sig = state.ownerAccessSig || (window.sessionStorage ? window.sessionStorage.getItem(ownerSigStorageKey(tid)) : "") || "";
    let url = `steckbrief-direkt.html?mode=owner&tid=${encodeURIComponent(tid)}`;
    if (sig) url += `&sig=${encodeURIComponent(sig)}`;
    return url;
  }

  async function createReport(){
    setStep(3);
    startLoading();
    let data = null;
    const errorBox = $("[data-report-error]");
    if (errorBox) {
      errorBox.hidden = true;
      errorBox.textContent = "";
    }
    try {
      const basePayload = payload();
      setLoading(24, "Precheck laeuft.");
      const precheck = await callStage("precheck", basePayload);
      if (precheck.stage === "legacy_report") {
        data = precheck;
        setLoading(86, "Steckbrief wird zusammengestellt.");
        throw { legacyReady: true };
      }
      data = precheck;
      const preData = precheck.data || {};
      if (!(preData.global && preData.global.can_continue)) {
        const guidance = [];
        const slotToFrame = slot => slot === "neutral" ? "front_neutral" : slot === "smile" ? "front_smile" : slot;
        (preData.images || []).forEach(item => {
          if (item.slot && Array.isArray(item.guidance) && item.guidance.length) {
            setFrameState(slotToFrame(item.slot), "yellow", item.guidance[0]);
            guidance.push(`${item.slot}: ${item.guidance[0]}`);
          }
        });
        throw new Error(guidance.join(" | ") || "Precheck nicht bestanden. Bitte Bilder neu aufnehmen.");
      }
      setLoading(46, "Bilder werden hochwertig vorbereitet.");
      try {
        const processed = await callStage("process", basePayload, 70000);
        applyProcessedImages(processed, basePayload);
      } catch (_) {
        setLoading(56, "Bildbearbeitung dauert zu lange. Wir nutzen Originalbilder und machen weiter.");
      }
      setLoading(66, "Gesichtsanalyse wird geprüft.");
      const analyzed = await callStage("analyze", basePayload);
      if (!(analyzed && analyzed.data && analyzed.data.can_generate_report)) {
        const reasons = analyzed && analyzed.data && Array.isArray(analyzed.data.blocking_reasons)
          ? analyzed.data.blocking_reasons
          : [];
        const message = reasons.length
          ? `Analyse blockiert: ${reasons.join(", ")}`
          : "Analyse blockiert. Bitte Fotos neu aufnehmen.";
        throw new Error(message);
      }
      basePayload.analysis_result = analyzed.data || {};
      setLoading(78, "Steckbrief wird erstellt.");
      data = await callStage("report", basePayload);
    } catch (error) {
      if (error && error.legacyReady) {
        // Partial live deployments can briefly have new JS talking to the old API.
      } else if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = error && error.message ? error.message : "Analyse-API nicht erreichbar oder fehlerhaft.";
      }
      data = data || null;
    }

    if (data && data.retry) {
      window.clearInterval(state.loadingTimer);
      window.clearInterval(state.loadingStoryTimer);
      releaseWakeLock();
      setStep(1);
      const message = data.message || "Die KI konnte die Bilder nicht sicher pruefen. Bitte neu aufnehmen.";
      setCameraStatus(message);
      if (errorBox) {
        errorBox.hidden = false;
        errorBox.textContent = message;
      }
      if (Array.isArray(data.errors)) {
        data.errors.forEach(error => {
          if (String(error).includes("smile")) setFrameState("front_smile", "yellow", message);
          if (String(error).includes("neutral") || String(error).includes("face")) setFrameState("front_neutral", "yellow", message);
        });
      }
      return;
    }

    if (!data || !data.success) {
      if (errorBox && !errorBox.textContent) {
        errorBox.hidden = false;
        errorBox.textContent = (data && data.message) ? data.message : "Analyse-API nicht erreichbar oder fehlerhaft.";
      }
      const fallback = fallbackReport();
      state.lastReport = fallback;
      renderReport(fallback);
      finishLoading();
      return;
    }

    const stageReport = data && data.data && data.data.render_payload ? data.data.render_payload : {};
    const directPayload = stageReport.direct_profile_fields || {};
    const report = directPayload.report || (data && data.success && data.report ? data.report : fallbackReport());
    if (directPayload.test_id || (data && data.test_id)) {
      state.lastTestId = directPayload.test_id || data.test_id;
      report.test_id = state.lastTestId;
    }
    state.ownerAccessSig = directPayload.owner_access_sig || (data && data.owner_access_sig) || "";
    if (state.lastTestId && state.ownerAccessSig && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(ownerSigStorageKey(state.lastTestId), state.ownerAccessSig);
      } catch (_) {}
    }
    if (directPayload.expires_at) report.expires_at = directPayload.expires_at;
    if (data && data.warnings && data.warnings.length) report.system_note = data.warnings.join(" | ");
    state.lastReport = report;
    if (new URLSearchParams(window.location.search).get("inline") !== "1") {
      window.location.href = directReportUrl(report.test_id || state.lastTestId);
      return;
    }
    setLoading(92, "Steckbrief-Maske wird gesetzt.");
    renderReport(report);
    finishLoading();
  }

  function fallbackReport(){
    const age = Number(value("age")) || 35;
    return {
      report_header: {
        first_name: value("first_name") || "FaceInsight",
        actual_age: age,
        visual_age_estimate: "KI-Schätzung nicht sicher",
        age_alignment_note: "Kein optisches Alter aus der Eingabe abgeleitet; bitte Analyse mit klaren Fotos erneut starten.",
        overall_type: "klar, präsent, modern"
      },
      impact: "Auf andere wirkt das Gesicht klar, aufmerksam und freundlich. Das natürliche Lächeln macht den Eindruck wärmer, offener und zugänglicher, während die frontale Haltung Ruhe und Verlässlichkeit vermittelt.",
      scores: [
        metric("Attraktivität", 8.2, "harmonischer Gesamteindruck"),
        metric("Vertrauenswirkung", 8.4, "ruhige, klare Wirkung"),
        metric("Präsenz", 8.6, "Blick und Kopfhaltung prägen den Eindruck"),
        metric("Harmonie", 8.0, "stimmige Proportionen"),
        metric("Markanz", 7.8, "gut erinnerbare Linien"),
        metric("Symmetrie", 8.1, "Frontansicht wirkt ausgeglichen"),
        metric("Ausdruck", 8.3, "Lächeln verbessert Nahbarkeit"),
        metric("Hautbild-Klarheit", 7.9, "sichtbare Textur berücksichtigt"),
        metric("Zahnlinien-Symmetrie", 7.8, "nur bei sichtbarem Lächeln")
      ],
      observations: [
        observation("Gesichtsform", "Harmonisch-ovale Grundwirkung mit klaren Konturen."),
        observation("Stirn & Haaransatz", "Ausgewogene Stirnpartie, ruhige Linienführung."),
        observation("Augenpartie", "Wacher, direkter Blick mit präsentem Ausdruck."),
        observation("Nase", "Proportioniert und stimmig zur Gesichtsmitte."),
        observation("Falten & Linien", "Sichtbare Linien werden realistisch berücksichtigt und nicht weichgezeichnet."),
        observation("Hautqualität", "Hautbild wirkt im Foto gleichmäßig; Licht und Schärfe beeinflussen die Bewertung."),
        observation("Erkannter Hauttyp", "Optisch eher normal bis leicht trocken; keine medizinische Hautdiagnose."),
        observation("Haare", "Haarlinie, Dichte und Kontur werden altersklassengerecht eingeordnet."),
        observation("Bart", "Bartstruktur wird nur bewertet, wenn sie sichtbar ist, und nicht in die Geschlechtsformulierung übernommen."),
        observation("Ohren", "Ohren-Proportion und seitliche Sichtbarkeit werden vorsichtig eingeschätzt."),
        observation("Zähne", "Zahnhelligkeit, sichtbare Frontlinie und Lücken werden nur bei ausreichender Sichtbarkeit benannt."),
        observation("Lippen", "Neutral kontrolliert, lächelnd deutlich wärmer."),
        observation("Kieferlinie", "Definierte Kontur mit guter Stabilitaet."),
        observation("Symmetrie", "Frontale Wirkung erscheint insgesamt ausgeglichen."),
        observation("Gesamtwirkung", "Klar, seriös und freundlich bei sichtbarem Lächeln.")
      ],
      archetype: { label: "Der präsente Beobachter", icon: "star", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Edouard_Manet_-_The_Muse.jpg?width=180", description: "Ruhige Aufmerksamkeit, kontrollierte Ausstrahlung und klare Wirkungslinien." },
      reference: {
        disclaimer: "Modellbasierte visuelle Ähnlichkeit, keine Identifikation.",
        items: [
          { label: "Ernest Hemingway", era: "20. Jahrhundert", status: "historisch", percent: 64, note: "Ähnliche Wirkung in Blickruhe, Markanz und kontrollierter Präsenz.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Ernest_Hemingway_1923_passport_photo.jpg?width=180" },
          { label: "Humphrey Bogart", era: "klassisches Hollywood", status: "historisch", percent: 58, note: "Vergleichbare ruhige Ausstrahlung und kantige Gesamterscheinung.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Humphrey_Bogart_1940.jpg?width=180" }
        ]
      },
      critical: "Ein hochwertiger, klar strukturierter Premium-Look mit starker visueller Fuehrung und sympathischer Praesenz.",
      tips: [
        "Weiches Licht von vorne lässt Hautbild und Augenpartie hochwertiger wirken.",
        "Kamera auf Augenhöhe halten, damit Proportionen nicht verzerrt werden.",
        "Ein leichtes, echtes Lächeln steigert Sympathie ohne Präsenzverlust."
      ],
      visual_asset: { premium_portrait_image: "" },
      share_profile: "Klar, präsent und modern mit warmer Lächelwirkung.",
      legal_note: "Hinweis: visuelle Einschätzung anhand von Fotos. Ähnlichkeitswerte sind Unterhaltung, keine Identifikation, keine Verwandtschaftsaussage und keine medizinische Analyse."
    };
  }

  function metric(label, value, note){ return { label, value, note }; }
  function observation(area, finding){ return { area, finding }; }

  function renderReport(report){
    const head = report.report_header || {};
    const scoreItems = report.scores || [];
    const averageScore = scoreItems.length
      ? Math.round(scoreItems.reduce((sum, item) => sum + scoreValue(item), 0) / scoreItems.length)
      : 87;
    const visualAge = formatVisualAge(head.visual_age_estimate, head.actual_age || value("age"));
    text("[data-report-name]", head.first_name || value("first_name") || "FaceInsight");
    text("[data-report-age-short]", head.actual_age || value("age") || "-");
    text("[data-report-visual-age]", visualAge);
    text("[data-report-date]", new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }));
    text("[data-report-overall-score]", averageScore);
    text("[data-report-type]", head.overall_type || "-");
    text("[data-report-impact]", report.impact || "");
    text("[data-report-critical]", report.critical || "");
    text("[data-report-legal]", report.legal_note || "Visuelle Einschaetzung anhand von Fotos, keine Diagnose.");

    const processed = state.processedImages || {};
    const portrait = $("[data-report-blueprint]");
    if (portrait) portrait.src = (report.visual_asset && report.visual_asset.premium_portrait_image) || processed.front_smile || processed.front_neutral || images.front_smile || images.front_neutral || "";
    const miniNeutral = $("[data-mini-neutral]");
    const miniSmile = $("[data-mini-smile]");
    if (miniNeutral) miniNeutral.src = processed.front_neutral || images.front_neutral || (report.visual_asset && report.visual_asset.premium_portrait_image) || "";
    if (miniSmile) miniSmile.src = processed.front_smile || images.front_smile || (report.visual_asset && report.visual_asset.premium_portrait_image) || "";

    renderObservations(report.observations || []);
    renderScores(scoreItems);
    renderArchetype(report.archetype || {});
    renderReference(report.reference || {});
    renderTips(report.tips || []);
    renderTags(report);
    text("[data-report-test-id]", report.test_id || state.lastTestId || state.clientTestCode || "-");
  }

  function formatVisualAge(estimate, actualAge){
    if (estimate) {
      const clean = String(estimate).replace(/\s+/g, " ").trim();
      if (/nicht sicher|unsicher|unbekannt|keine/i.test(clean)) return clean;
      return /jahr/i.test(clean) ? clean : `${clean} Jahre`;
    }
    return "KI-Schätzung nicht sicher";
  }

  function renderScores(items){
    const target = $("[data-report-scores]");
    if (!target) return;
    const fallback = [
      metric("Symmetrie", 92, "ausgewogen"),
      metric("Attraktivitaet", 85, "praesent"),
      metric("Ausdrucksstaerke", 88, "stark"),
      metric("Vertrauenswirkung", 84, "ruhig"),
      metric("Praesenz", 88, "direkt"),
      metric("Harmonie", 90, "stimmig"),
      metric("Charisma", 87, "markant")
    ];
    const rows = (items && items.length ? items : fallback).slice(0, 9);
    target.innerHTML = rows.map(item => {
      const ten = scoreTen(item);
      const quarter = Math.round(ten * 4) / 4;
      const fill = Math.max(0, Math.min(100, (quarter / 10) * 100));
      return `<article class="fi-profile-metric"><div><strong>${escapeHtml(item.label)}</strong></div><div class="fi-star-score"><span class="fi-stars" style="--fill:${fill.toFixed(2)}%"><i></i></span><b>${ten.toFixed(1)} / 10</b></div></article>`;
    }).join("");
  }

  function scoreValue(item){
    const raw = Number(item && item.value) || Number(item && item.score) || 1;
    return Math.max(1, Math.min(100, Math.round(raw <= 10 ? raw * 10 : raw)));
  }

  function scoreTen(item){
    const raw = Number(item && item.value) || Number(item && item.score) || 1;
    const value = raw <= 10 ? raw : raw / 10;
    return Math.max(1, Math.min(10, value));
  }

  function renderObservations(items){
    const target = $("[data-report-observations]");
    if (!target) return;
    const rows = items && items.length ? items : [
      observation("Gesichtsform", "Harmonische Grundwirkung mit klaren Proportionen."),
      observation("Stirn & Haaransatz", "Ausgewogene Stirnpartie mit ruhiger Linienführung."),
      observation("Augenpartie", "Klarer Blick mit präsenter Wirkung."),
      observation("Nase", "Proportioniert und stimmig zur Gesichtsmitte."),
      observation("Falten & Linien", "Sichtbare Linien werden realistisch berücksichtigt."),
      observation("Hautqualität", "Hautbild wirkt gleichmäßig; Licht und Schärfe beeinflussen die Bewertung."),
      observation("Haare", "Haarlinie und Dichte wirken altersentsprechend stimmig."),
      observation("Bart", "Bartstruktur unterstützt die Untergesichtsform klar und harmonisch."),
      observation("Ohren", "Ohren sind proportional zur Gesichtsbreite ausgerichtet."),
      observation("Zähne", "Im Lächeln zeigt sich eine ruhige Frontausrichtung."),
      observation("Erkannter Hauttyp", "Optisch eher normal bis leicht trocken; keine medizinische Diagnose."),
      observation("Lippen", "Neutral kontrolliert, lächelnd deutlich wärmer.")
    ];
    const icons = ["face", "hair", "eye", "nose", "lips", "jaw", "scale", "spark", "hair", "jaw", "face", "spark"];
    target.innerHTML = rows.slice(0,10).map((item, index) => {
      return `<article class="fi-feature-item"><i data-icon="${escapeHtml(iconGlyph(icons[index]))}"></i><div><strong>${escapeHtml(item.area)}</strong><p>${escapeHtml(item.finding)}</p></div></article>`;
    }).join("");
  }

  function iconGlyph(name){
    const map = { face: "●", hair: "✦", eye: "◉", nose: "▲", lips: "◆", jaw: "⬢", scale: "◌", spark: "✶" };
    return map[name] || "*";
  }

  function renderArchetype(item){
    const target = $("[data-report-archetype]");
    if (!target) return;
    const label = item.label || "Der praesente Beobachter";
    const copy = item.description || "Klarer Auftritt, ruhige Mimik und eine moderne, vertrauensvolle Wirkung.";
    const image = item.image_url || "assets/img/archetype-modern.jpg";
    target.innerHTML = [
      '<article class="fi-archetype-hero">',
      `<img alt="${escapeHtml(label)}" src="${escapeHtml(image)}" onerror="this.onerror=null;this.src='assets/img/archetype-modern.jpg';">`,
      '<div>',
      `<strong>${escapeHtml(label)}</strong>`,
      `<small>Wirkungsprofil</small>`,
      `<p>${escapeHtml(copy)}</p>`,
      '</div>',
      '</article>'
    ].join("");
  }

  function archetypeGlyph(icon){
    const map = { observer: "O", star: "*", strategist: "^", harmonizer: "+", classic: "I", creator: "~", leader: "A" };
    return map[icon || "observer"] || "*";
  }

  function renderReference(item){
    const target = $("[data-report-reference]");
    if (!target) return;
    const list = Array.isArray(item && item.items) ? item.items : [
      item && item.label ? item : null,
      { label: "Humphrey Bogart", era: "klassisches Hollywood", status: "historisch", percent: 58, note: "Vergleichbare ruhige Ausstrahlung und kantige Gesamterscheinung.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Humphrey_Bogart_1940.jpg?width=180" }
    ].filter(Boolean);
    const rows = (list.length ? list : [
      { label: "Ernest Hemingway", era: "20. Jahrhundert", status: "historisch", percent: 64, note: "Ähnliche Wirkung in Blickruhe, Markanz und kontrollierter Präsenz.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Ernest_Hemingway_1923_passport_photo.jpg?width=180" },
      { label: "Humphrey Bogart", era: "klassisches Hollywood", status: "historisch", percent: 58, note: "Vergleichbare ruhige Ausstrahlung und kantige Gesamterscheinung.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Humphrey_Bogart_1940.jpg?width=180" }
    ]).slice(0, 2);
    target.innerHTML = rows.map(entry => {
      const label = entry.label || "Stilreferenz";
      const note = entry.note || "Visuelle Wirkungslinie ohne identifizierenden Abgleich.";
      const meta = [entry.status, entry.era].filter(Boolean).join(" · ");
      const percent = Math.max(1, Math.min(99, Number(entry.percent) || 76));
      const wikiByName = {
        "Ernest Hemingway": "https://commons.wikimedia.org/wiki/Special:FilePath/Ernest_Hemingway_1923_passport_photo.jpg?width=180",
        "Humphrey Bogart": "https://commons.wikimedia.org/wiki/Special:FilePath/Humphrey_Bogart_1940.jpg?width=180",
        "Grace Kelly": "https://commons.wikimedia.org/wiki/Special:FilePath/Grace_Kelly_1955.jpg?width=180",
        "Audrey Hepburn": "https://commons.wikimedia.org/wiki/Special:FilePath/Audrey_Hepburn_1959.jpg?width=180"
      };
      const imageUrl = entry.image_url || wikiByName[label] || "";
      const image = imageUrl ? `<img alt="${escapeHtml(label)}" src="${escapeHtml(imageUrl)}">` : '<span class="fi-reference-fallback"></span>';
      return `<article class="fi-sim-person">${image}<div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(meta || "visuelle Referenz")}</small><b>${percent}% Ähnlichkeit</b><small>${escapeHtml(note)}</small></div></article>`;
    }).join("");
  }

  function renderTips(items){
    const target = $("[data-report-tips]");
    if (!target) return;
    target.innerHTML = items.slice(0,3).map(item => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function renderTags(report){
    const target = $("[data-report-tags]");
    if (!target) return;
    const tipTags = Array.isArray(report.tips) ? report.tips.filter(Boolean) : [];
    const scores = Array.isArray(report.scores) ? report.scores : [];
    const labels = scores.slice(0, 3).map(item => item.label).filter(Boolean);
    const tags = tipTags.length ? tipTags : (labels.length ? labels : ["Entschlossen", "Charismatisch", "Selbstbewusst"]);
    target.innerHTML = tags.slice(0, 3).map(tag => `<span>${escapeHtml(tag)}</span>`).join("");
  }

  function text(selector, content){
    $$(selector).forEach(node => { node.textContent = content || ""; });
  }

  function escapeHtml(value){
    return String(value || "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[char]));
  }

  function shareText(){
    if (!state.lastReport) return "Ich habe meinen FaceInsight Premium-Steckbrief erstellt.";
    const head = state.lastReport.report_header || {};
    return `FaceInsight Premium-Steckbrief${head.first_name ? ` von ${head.first_name}` : ""}\n${state.lastReport.share_profile || state.lastReport.impact || ""}`;
  }

  function demoPortrait(){
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 560">',
      '<defs>',
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#10375e"/><stop offset="1" stop-color="#061528"/></linearGradient>',
      '<linearGradient id="hair" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f0cc85"/><stop offset=".55" stop-color="#b97932"/><stop offset="1" stop-color="#5a2f18"/></linearGradient>',
      '<linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7d1ad"/><stop offset="1" stop-color="#c88662"/></linearGradient>',
      '</defs>',
      '<rect width="420" height="560" fill="url(#bg)"/>',
      '<circle cx="210" cy="142" r="122" fill="url(#hair)" opacity=".96"/>',
      '<path d="M83 545c12-128 77-190 127-190s115 62 127 190z" fill="#ece8df"/>',
      '<path d="M108 245c-10-94 32-166 102-166s112 72 102 166c-8 82-49 132-102 132s-94-50-102-132z" fill="url(#skin)"/>',
      '<path d="M96 189c25-91 92-136 154-101 38 22 67 67 72 126-58-42-132-54-226-25z" fill="url(#hair)"/>',
      '<path d="M108 206c-19 70-13 137 26 203-64-43-87-137-55-218z" fill="url(#hair)" opacity=".94"/>',
      '<path d="M307 200c24 83 6 161-42 211 23-68 28-135 8-202z" fill="url(#hair)" opacity=".94"/>',
      '<circle cx="169" cy="238" r="8" fill="#172338"/><circle cx="248" cy="238" r="8" fill="#172338"/>',
      '<path d="M148 218c19-13 42-11 55 0" fill="none" stroke="#503422" stroke-width="8" stroke-linecap="round"/>',
      '<path d="M227 218c18-12 41-11 54 1" fill="none" stroke="#503422" stroke-width="8" stroke-linecap="round"/>',
      '<path d="M206 244c-5 34-15 54-28 66 17 8 38 9 58 0-14-13-23-33-30-66z" fill="#d99578" opacity=".62"/>',
      '<path d="M168 320c28 30 59 30 87 0" fill="none" stroke="#8b3e33" stroke-width="10" stroke-linecap="round"/>',
      '<path d="M172 315c24 12 53 12 78 0" fill="none" stroke="#fff4e6" stroke-width="7" stroke-linecap="round"/>',
      '<path d="M109 544c4-66 46-112 101-112s96 46 101 112z" fill="#f4efe5"/>',
      '</svg>'
    ].join("");
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function demoReport(){
    images.front_smile = demoPortrait();
    const report = {
      test_id: state.clientTestCode,
      report_header: {
        first_name: "Sven",
        actual_age: 29,
        visual_age_estimate: "27-31",
        overall_type: "klar, präsent, modern"
      },
      impact: "Auf andere wirkt das Gesicht klar, aufmerksam und freundlich. Das natürliche Lächeln macht den Eindruck wärmer, offener und zugänglicher, während die frontale Haltung Ruhe und Verlässlichkeit vermittelt.",
      scores: [
        metric("Attraktivität", 8.2, "harmonische Gesamtwirkung"),
        metric("Vertrauenswirkung", 8.4, "ruhige, klare Ausstrahlung"),
        metric("Präsenz", 8.6, "direkter Blick und klare Linien"),
        metric("Harmonie", 8.0, "ausgewogene Proportionen"),
        metric("Markanz", 7.8, "wiedererkennbare Konturen"),
        metric("Symmetrie", 8.1, "ausgeglichene Frontansicht"),
        metric("Ausdruck", 8.3, "natürliches Lächeln"),
        metric("Hautbild-Klarheit", 7.9, "sichtbare Textur berücksichtigt"),
        metric("Zahnlinien-Symmetrie", 7.8, "nur bei sichtbarem Lächeln")
      ],
      observations: [
        observation("Gesichtsform", "Harmonisch-ovale Grundwirkung mit klaren Konturen."),
        observation("Stirn & Haaransatz", "Ausgewogene Stirnpartie, ruhige Linienführung."),
        observation("Augenpartie", "Wacher, direkter Blick mit präsenter Ausdruckskraft."),
        observation("Nase", "Proportioniert und stimmig zur Gesichtsmitte."),
        observation("Falten & Linien", "Sichtbare Linien werden realistisch berücksichtigt und nicht weichgezeichnet."),
        observation("Hautqualität", "Hautbild wirkt im Foto gleichmäßig; Licht und Schärfe beeinflussen die Bewertung."),
        observation("Erkannter Hauttyp", "Optisch eher normal bis leicht trocken; keine medizinische Diagnose."),
        observation("Haare", "Haarlinie, Dichte und Kontur werden altersklassengerecht eingeordnet."),
        observation("Bart", "Bartstruktur wird nur bewertet, wenn sie sichtbar ist."),
        observation("Ohren", "Ohren-Proportion und seitliche Sichtbarkeit werden vorsichtig eingeschätzt."),
        observation("Zähne", "Zahnhelligkeit, sichtbare Frontlinie und Lücken werden nur bei ausreichender Sichtbarkeit benannt."),
        observation("Lippen", "Neutral kontrolliert, lächelnd deutlich wärmer.")
      ],
      archetype: { label: "Der präsente Beobachter", secondary: "Moderne Präsenz", icon: "star", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Edouard_Manet_-_The_Muse.jpg?width=180", description: "Ruhige Aufmerksamkeit, kontrollierte Ausstrahlung und klare Wirkungslinien." },
      reference: {
        disclaimer: "Modellbasierte visuelle Ähnlichkeit, keine Identifikation.",
        items: [
          { label: "Ernest Hemingway", era: "20. Jahrhundert", status: "historisch", percent: 64, note: "Ähnliche Wirkung in Blickruhe, Markanz und kontrollierter Präsenz.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Ernest_Hemingway_1923_passport_photo.jpg?width=180" },
          { label: "Humphrey Bogart", era: "klassisches Hollywood", status: "historisch", percent: 58, note: "Vergleichbare ruhige Ausstrahlung und kantige Gesamterscheinung.", image_url: "https://commons.wikimedia.org/wiki/Special:FilePath/Humphrey_Bogart_1940.jpg?width=180" }
        ]
      },
      critical: "Ein hochwertiger, klar strukturierter Premium-Look mit starker visueller Fuehrung und sympathischer Praesenz.",
      tips: [
        "Weiches Licht von vorne lässt Hautbild und Augenpartie hochwertiger wirken.",
        "Kamera auf Augenhöhe halten, damit Proportionen nicht verzerrt werden.",
        "Ein leichtes, echtes Lächeln steigert Sympathie ohne Präsenzverlust."
      ],
      legal_note: "Hinweis: visuelle Einschätzung anhand von Fotos. Ähnlichkeitswerte sind Unterhaltung, keine Identifikation, keine Verwandtschaftsaussage und keine medizinische Analyse."
    };
    state.lastReport = report;
    state.lastTestId = state.clientTestCode;
    setStep(3);
    const loading = $("[data-loading]");
    const reportNode = $("[data-report]");
    if (loading) loading.hidden = true;
    if (reportNode) reportNode.hidden = false;
    renderReport(report);
  }

  const next = $("[data-next]");
  const prev = $("[data-prev]");
  if (next) next.addEventListener("click", () => {
    if (!canContinue()) return;
    if (state.step === 2) return createReport();
    setStep(state.step + 1);
  });
  if (prev) prev.addEventListener("click", () => setStep(state.step - 1));
  const cookieBanner = $("[data-cookie-banner]");
  const cookieComfort = cookieBanner ? cookieBanner.querySelector("[data-cookie-comfort]") : null;
  const cookieBtns = cookieBanner ? {
    essential: cookieBanner.querySelector("[data-cookie-essential]"),
    save: cookieBanner.querySelector("[data-cookie-save]"),
    all: cookieBanner.querySelector("[data-cookie-all]")
  } : {};

  function hideCookieBanner(){
    if (!cookieBanner) return;
    cookieBanner.hidden = true;
    cookieBanner.setAttribute("aria-hidden", "true");
    document.body.classList.remove("fi-cookie-open");
  }

  function showCookieBanner(){
    if (!cookieBanner) return;
    cookieBanner.hidden = false;
    cookieBanner.setAttribute("aria-hidden", "false");
    document.body.classList.add("fi-cookie-open");
    const primary = cookieBanner.querySelector("[data-cookie-all]");
    if (primary) {
      window.setTimeout(() => {
        try { primary.focus({ preventScroll: true }); } catch (_) {}
      }, 40);
    }
  }

  function wireBannerButton(btn, handler){
    if (!btn || !cookieBanner) return;
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      handler();
    });
  }

  migrateLegacyCookieConsent();
  if (cookieBanner && !cookieConsentDismissed()) showCookieBanner();
  else hideCookieBanner();

  wireBannerButton(cookieBtns.essential, () => {
    if (cookieComfort) cookieComfort.checked = false;
    persistCookieConsent(false);
    hideCookieBanner();
  });
  wireBannerButton(cookieBtns.save, () => {
    persistCookieConsent(Boolean(cookieComfort && cookieComfort.checked));
    hideCookieBanner();
  });
  wireBannerButton(cookieBtns.all, () => {
    if (cookieComfort) cookieComfort.checked = true;
    persistCookieConsent(true);
    hideCookieBanner();
  });
  form.addEventListener("input", updateNav);
  form.addEventListener("change", updateNav);
  const cameraGate = $("[data-camera-gate]");
  const cameraGateOk = $("[data-camera-gate-ok]");
  function maybeStartCamera(key){
    const run = () => startCamera(key);
    try {
      if (window.sessionStorage && window.sessionStorage.getItem("fi_camera_intro_ok") === "1") {
        run();
        return;
      }
    } catch (_) {}
    if (!cameraGate) {
      run();
      return;
    }
    cameraGate.hidden = false;
    cameraGate.setAttribute("aria-hidden", "false");
    document.body.classList.add("fi-camera-gate-open");
    const hideGate = () => {
      cameraGate.hidden = true;
      cameraGate.setAttribute("aria-hidden", "true");
      document.body.classList.remove("fi-camera-gate-open");
    };
    const onOk = e => {
      e.preventDefault();
      try {
        window.sessionStorage.setItem("fi_camera_intro_ok", "1");
      } catch (_) {}
      hideGate();
      if (cameraGateOk) cameraGateOk.removeEventListener("click", onOk);
      run();
    };
    if (cameraGateOk) cameraGateOk.addEventListener("click", onOk, { once: true });
  }
  $$("[data-start-camera]").forEach(button =>
    button.addEventListener("click", () => maybeStartCamera(button.dataset.startCamera))
  );
  wireMemoryGame();
  $$("[data-capture]").forEach(button => button.addEventListener("click", () => capture(button.dataset.capture, false)));
  $$("[data-upload]").forEach(input => input.addEventListener("change", () => handleUpload(input)));
  imageKeys.forEach(key => updateCaptureControls(key, false));
  const printButton = $("[data-print]");
  const resetButton = $("[data-reset]");
  const shareButton = $("[data-share]");
  const directButton = $("[data-direct-report]");
  const reelButton = $("[data-reel-report]");
  if (printButton) printButton.addEventListener("click", () => window.print());
  if (resetButton) resetButton.addEventListener("click", () => window.location.reload());
  if (directButton) directButton.addEventListener("click", () => { window.location.href = directReportUrl(); });
  if (reelButton) reelButton.addEventListener("click", () => {
    const rtid = state.lastTestId || state.clientTestCode;
    const rsig = state.ownerAccessSig || (window.sessionStorage ? window.sessionStorage.getItem(ownerSigStorageKey(rtid)) : "") || "";
    let rurl = `steckbrief-reel.html?mode=owner&tid=${encodeURIComponent(rtid)}`;
    if (rsig) rurl += `&sig=${encodeURIComponent(rsig)}`;
    window.location.href = rurl;
  });
  if (shareButton) shareButton.addEventListener("click", async () => {
    const textValue = shareText();
    if (navigator.share) await navigator.share({ title: "FaceInsight Premium-Steckbrief", text: textValue, url: window.location.href });
    else if (navigator.clipboard) await navigator.clipboard.writeText(textValue);
  });
  window.addEventListener("beforeunload", () => {
    stopCamera();
    releaseWakeLock();
  });
  initClientTestCode();
  setStep(1);
  if (new URLSearchParams(window.location.search).get("demo") === "premium") {
    demoReport();
  }
})();
