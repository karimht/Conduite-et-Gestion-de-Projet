import { useState, useEffect, useRef, useCallback } from "react";

const WINDOW_MS = 5000;
const BASELINE_WINDOW = 30000;
const IDLE_RESET_MS = 3000;
const RAGE_THRESHOLD = 70;
const ALERT_DURATION = 4000;
const HISTORY_SLOTS = 30;
const FACE_CHECK_INTERVAL = 200;

const BUTTON_NAMES = ["A","B","X","Y","LB","RB","LT","RT","Sel","Start","LS","RS","↑","↓","←","→"];

const RAGE_ALERTS = [
  "RAGE DETECTED — calme-toi champion",
  "Tu vas casser le clavier...",
  "Tes doigts sont en feu (mauvais signe)",
  "Le tilt est fort avec toi",
  "RAGE QUIT en approche imminente",
  "Ta cadence de frappe a triplé...",
  "Statistiquement, tu tiltes.",
  "Le sel est réel.",
];

const CALM_TIPS = [
  { title: "Respiration", text: "Inspire 4s, retiens 4s, expire 4s. Répète 3 fois." },
  { title: "Pause", text: "Lève-toi, étire-toi, bois un verre d'eau." },
  { title: "Reset mental", text: "Ferme les yeux 10 secondes. Visualise ton meilleur play." },
  { title: "Perspective", text: "C'est un jeu. Une défaite ≠ ta valeur. Next game." },
  { title: "Muscles", text: "Contracte tous tes muscles 5s, puis relâche d'un coup." },
  { title: "Déconnecte", text: "2 minutes loin de l'écran. Regarde par la fenêtre." },
];

const getColor = (pct) => {
  if (pct < 30) return "#22c55e";
  if (pct < 55) return "#eab308";
  if (pct < 75) return "#f97316";
  return "#ef4444";
};

const getLabel = (score) => {
  if (score < 15) return "ZEN";
  if (score < 35) return "CALME";
  if (score < 55) return "AGITÉ";
  if (score < 75) return "ÉNERVÉ";
  return "TILT TOTAL";
};

const getEmotionColor = (val) => {
  if (val < 0.3) return "#22c55e";
  if (val < 0.6) return "#eab308";
  if (val < 0.8) return "#f97316";
  return "#ef4444";
};

export default function TiltScan() {
  const [monitoring, setMonitoring] = useState(false);
  const [tiltScore, setTiltScore] = useState(0);
  const [signals, setSignals] = useState({ cadence: 0, variance: 0, spam: 0, chaos: 0 });
  const [totalKeys, setTotalKeys] = useState(0);
  const [rageCount, setRageCount] = useState(0);
  const [topKey, setTopKey] = useState("—");
  const [log, setLog] = useState([]);
  const [alert, setAlert] = useState(null);
  const [gpConnected, setGpConnected] = useState(false);
  const [history, setHistory] = useState(Array(HISTORY_SLOTS).fill(0));

  // Webcam & emotion state
  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState(null);
  const [emotions, setEmotions] = useState({
    anger: 0, stress: 0, tension: 0, focus: 0,
  });
  const [faceDetected, setFaceDetected] = useState(false);
  const [calmPopup, setCalmPopup] = useState(null);
  const [emotionHistory, setEmotionHistory] = useState(Array(20).fill(0));

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceIntervalRef = useRef(null);
  const angerAccum = useRef(0);
  const lastCalmPopup = useRef(0);
  const prevFrameData = useRef(null);

  // Keyboard/gamepad refs
  const pressTimestamps = useRef([]);
  const baselineIntervals = useRef([]);
  const keyFreq = useRef({});
  const recentKeys = useRef([]);
  const tiltRef = useRef(0);
  const alertTimer = useRef(null);
  const alertLock = useRef(false);
  const gpInterval = useRef(null);
  const prevBtns = useRef({});
  const idleTimer = useRef(null);
  const bucketCount = useRef(0);
  const bucketInterval = useRef(null);
  const rageRef = useRef(0);

  // ─── Webcam Analysis (heuristic-based, no ML library needed) ───
  const analyzeFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = 160;
    canvas.height = 120;
    ctx.drawImage(video, 0, 0, 160, 120);

    const imageData = ctx.getImageData(0, 0, 160, 120);
    const data = imageData.data;

    // Face region (center area - rough detection via skin tone)
    let skinPixels = 0;
    let totalPixels = 0;
    let brightnessSum = 0;
    let redIntensity = 0;
    let motionScore = 0;

    const faceRegion = { x1: 40, x2: 120, y1: 15, y2: 100 };

    for (let y = faceRegion.y1; y < faceRegion.y2; y++) {
      for (let x = faceRegion.x1; x < faceRegion.x2; x++) {
        const i = (y * 160 + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        totalPixels++;

        const brightness = (r + g + b) / 3;
        brightnessSum += brightness;

        // Simple skin detection (works for various tones)
        if (r > 60 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 10 && brightness > 50 && brightness < 230) {
          skinPixels++;
          redIntensity += (r - g) / 255;
        }

        // Motion detection vs previous frame
        if (prevFrameData.current) {
          const pr = prevFrameData.current[i], pg = prevFrameData.current[i + 1], pb = prevFrameData.current[i + 2];
          motionScore += Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb);
        }
      }
    }

    prevFrameData.current = new Uint8Array(data);

    const skinRatio = skinPixels / totalPixels;
    const detected = skinRatio > 0.15;
    setFaceDetected(detected);

    if (!detected) return;

    const avgBrightness = brightnessSum / totalPixels;
    const avgRedIntensity = skinPixels > 0 ? redIntensity / skinPixels : 0;
    const normalizedMotion = motionScore / (totalPixels * 765);

    // Brow region analysis (upper face - darker = furrowed brows)
    let browDarkness = 0;
    let browPixels = 0;
    for (let y = faceRegion.y1; y < faceRegion.y1 + 25; y++) {
      for (let x = faceRegion.x1 + 10; x < faceRegion.x2 - 10; x++) {
        const i = (y * 160 + x) * 4;
        browDarkness += (255 - (data[i] + data[i+1] + data[i+2]) / 3) / 255;
        browPixels++;
      }
    }
    const browTension = browPixels > 0 ? browDarkness / browPixels : 0;

    // Compute emotion heuristics
    const angerRaw = Math.min(1, (
      avgRedIntensity * 0.35 +
      browTension * 0.30 +
      normalizedMotion * 8 * 0.20 +
      (1 - avgBrightness / 180) * 0.15
    ));

    const stressRaw = Math.min(1, normalizedMotion * 12);
    const tensionRaw = Math.min(1, browTension * 1.5);
    const focusRaw = Math.min(1, detected ? (1 - normalizedMotion * 5) : 0);

    // Smooth values
    setEmotions(prev => ({
      anger: prev.anger * 0.7 + angerRaw * 0.3,
      stress: prev.stress * 0.7 + stressRaw * 0.3,
      tension: prev.tension * 0.7 + tensionRaw * 0.3,
      focus: prev.focus * 0.7 + focusRaw * 0.3,
    }));

    setEmotionHistory(prev => [...prev.slice(1), angerRaw]);

    // Accumulate anger for calm popup
    angerAccum.current = angerAccum.current * 0.92 + angerRaw * 0.08;
    const now = Date.now();
    if (angerAccum.current > 0.55 && now - lastCalmPopup.current > 15000) {
      lastCalmPopup.current = now;
      const tip = CALM_TIPS[Math.floor(Math.random() * CALM_TIPS.length)];
      setCalmPopup(tip);
      setTimeout(() => setCalmPopup(null), 8000);
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamActive(true);
      setCamError(null);
      faceIntervalRef.current = setInterval(analyzeFrame, FACE_CHECK_INTERVAL);
    } catch (err) {
      setCamError("Webcam inaccessible");
      setCamActive(false);
    }
  }, [analyzeFrame]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (faceIntervalRef.current) clearInterval(faceIntervalRef.current);
    setCamActive(false);
    setFaceDetected(false);
    setEmotions({ anger: 0, stress: 0, tension: 0, focus: 0 });
    prevFrameData.current = null;
    angerAccum.current = 0;
  }, []);

  // ─── Keyboard/Gamepad logic (same as before) ───
  const resetCounters = useCallback(() => {
    pressTimestamps.current = [];
    keyFreq.current = {};
    recentKeys.current = [];
    tiltRef.current = 0;
    bucketCount.current = 0;
    setTiltScore(0);
    setSignals({ cadence: 0, variance: 0, spam: 0, chaos: 0 });
  }, []);

  const restartIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => resetCounters(), IDLE_RESET_MS);
  }, [resetCounters]);

  const triggerAlert = useCallback(() => {
    if (alertLock.current) return;
    alertLock.current = true;
    rageRef.current += 1;
    setRageCount(rageRef.current);
    const msg = RAGE_ALERTS[Math.floor(Math.random() * RAGE_ALERTS.length)];
    setAlert(msg);
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => {
      setAlert(null);
      alertLock.current = false;
    }, ALERT_DURATION);
  }, []);

  const computeAndUpdate = useCallback(() => {
    const now = Date.now();
    const recent = pressTimestamps.current.filter((t) => now - t < WINDOW_MS);
    if (recent.length < 2) {
      const decayed = tiltRef.current * 0.85;
      tiltRef.current = decayed < 1 ? 0 : decayed;
      setTiltScore(Math.round(tiltRef.current));
      setSignals({ cadence: 0, variance: 0, spam: 0, chaos: 0 });
      return;
    }
    const intervals = [];
    for (let i = 1; i < recent.length; i++) intervals.push(recent[i] - recent[i - 1]);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const cadenceRaw = Math.max(0, 1000 - avgInterval) / 10;
    let baselineAvg = 800;
    if (baselineIntervals.current.length > 5) {
      const slice = baselineIntervals.current.slice(-20);
      baselineAvg = slice.reduce((a, b) => a + b, 0) / slice.length;
    }
    const cadenceVsBaseline = Math.max(0, ((baselineAvg - avgInterval) / baselineAvg) * 100);
    const cadence = Math.min(100, Math.max(cadenceRaw, cadenceVsBaseline));
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = Math.sqrt(intervals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / intervals.length);
    const variance = Math.min(100, (stdDev / 300) * 100);
    const maxFreq = Math.max(...Object.values(keyFreq.current), 0);
    const spam = Math.min(100, (maxFreq / 8) * 100);
    const uniqueRecent = new Set(recentKeys.current.slice(-10)).size;
    const chaos = Math.min(100, recent.length >= 6 ? (uniqueRecent / 10) * 100 : 0);

    // Blend with emotion data if cam is active
    const emotionBonus = camActive ? emotions.anger * 15 : 0;
    const composite = cadence * 0.35 + variance * 0.25 + spam * 0.2 + chaos * 0.2 + emotionBonus;
    tiltRef.current = tiltRef.current * 0.85 + composite * 0.15;
    tiltRef.current = Math.min(100, Math.max(0, tiltRef.current));

    setTiltScore(Math.round(tiltRef.current));
    setSignals({ cadence: Math.round(cadence), variance: Math.round(variance), spam: Math.round(spam), chaos: Math.round(chaos) });
    if (tiltRef.current >= RAGE_THRESHOLD) triggerAlert();
  }, [triggerAlert, camActive, emotions.anger]);

  const registerPress = useCallback((key) => {
    if (!monitoring) return;
    const now = Date.now();
    const last = pressTimestamps.current[pressTimestamps.current.length - 1] || 0;
    const delta = last ? now - last : 0;
    pressTimestamps.current = [...pressTimestamps.current.filter((t) => now - t < BASELINE_WINDOW), now];
    if (delta > 0 && delta < 5000) {
      baselineIntervals.current.push(delta);
      if (baselineIntervals.current.length > 100) baselineIntervals.current.shift();
    }
    keyFreq.current[key] = (keyFreq.current[key] || 0) + 1;
    recentKeys.current.push(key);
    if (recentKeys.current.length > 30) recentKeys.current.shift();
    bucketCount.current += 1;
    setTotalKeys((t) => t + 1);
    const topEntry = Object.entries(keyFreq.current).sort((a, b) => b[1] - a[1])[0];
    if (topEntry) setTopKey(topEntry[0]);
    const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog((prev) => [{ key, delta, time, id: now + Math.random() }, ...prev.slice(0, 59)]);
    computeAndUpdate();
    restartIdleTimer();
  }, [monitoring, computeAndUpdate, restartIdleTimer]);

  useEffect(() => {
    if (!monitoring) return;
    const handler = (e) => {
      const k = e.key === " " ? "Espace" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      registerPress(k);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [monitoring, registerPress]);

  useEffect(() => {
    if (!monitoring) return;
    gpInterval.current = setInterval(() => {
      const pads = navigator.getGamepads();
      let found = false;
      for (const gp of pads) {
        if (!gp) continue;
        found = true;
        gp.buttons.forEach((btn, i) => {
          const k = `${gp.index}-${i}`;
          if (btn.pressed && !prevBtns.current[k]) registerPress(BUTTON_NAMES[i] || `Btn${i}`);
          prevBtns.current[k] = btn.pressed;
        });
      }
      setGpConnected(found);
    }, 50);
    return () => clearInterval(gpInterval.current);
  }, [monitoring, registerPress]);

  useEffect(() => {
    const onC = () => setGpConnected(true);
    const onD = () => setGpConnected(false);
    window.addEventListener("gamepadconnected", onC);
    window.addEventListener("gamepaddisconnected", onD);
    return () => { window.removeEventListener("gamepadconnected", onC); window.removeEventListener("gamepaddisconnected", onD); };
  }, []);

  useEffect(() => {
    if (!monitoring) return;
    bucketInterval.current = setInterval(() => {
      setHistory((prev) => { const next = [...prev.slice(1), bucketCount.current]; bucketCount.current = 0; return next; });
    }, 1000);
    return () => clearInterval(bucketInterval.current);
  }, [monitoring]);

  const toggle = () => {
    if (monitoring) {
      setMonitoring(false);
      resetCounters();
      setTotalKeys(0);
      setRageCount(0);
      rageRef.current = 0;
      setTopKey("—");
      setLog([]);
      setAlert(null);
      setHistory(Array(HISTORY_SLOTS).fill(0));
      stopCamera();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    } else {
      setMonitoring(true);
    }
  };

  const toggleCam = () => {
    if (camActive) stopCamera();
    else startCamera();
  };

  const score = tiltScore;
  const color = getColor(score);
  const label = getLabel(score);
  const histMax = Math.max(...history, 1);
  const emotionMax = Math.max(...emotionHistory, 0.01);

  return (
    <div style={S.root}>
      <style>{css}</style>

      {/* Alert */}
      {alert && (
        <div style={S.alertOverlay} className="alert-anim">
          <div style={{ ...S.alertBar, borderColor: color, boxShadow: `0 0 40px ${color}33` }}>{alert}</div>
        </div>
      )}

      {/* Calm intervention popup */}
      {calmPopup && (
        <div style={S.calmOverlay} className="calm-anim">
          <div style={S.calmCard}>
            <div style={S.calmHeader}>
              <span style={S.calmPulse} />
              SESSION INTENSE DÉTECTÉE
            </div>
            <div style={S.calmTitle}>{calmPopup.title}</div>
            <div style={S.calmText}>{calmPopup.text}</div>
            <button style={S.calmBtn} onClick={() => setCalmPopup(null)}>J'ai compris</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={S.header}>
        <div>
          <div style={S.titleRow}>
            <span style={S.titleIcon}>◈</span>
            <span style={S.title}>TILTSCAN</span>
            <span style={S.version}>v3</span>
          </div>
          <div style={S.subtitle}>Détection composite · Clavier · Manette · Webcam</div>
        </div>
        <div style={S.pills}>
          <div style={{ ...S.pill, ...(monitoring ? S.pillActive : {}) }}>
            <div style={{ ...S.pillDot, background: monitoring ? "#22c55e" : "#333" }} className={monitoring ? "blink" : ""} />
            Clavier
          </div>
          <div style={{ ...S.pill, ...(gpConnected ? S.pillGp : {}) }}>
            <div style={{ ...S.pillDot, background: gpConnected ? "#3b82f6" : "#333" }} className={gpConnected ? "blink" : ""} />
            Manette
          </div>
          <div style={{ ...S.pill, ...(camActive ? S.pillCam : {}) }}>
            <div style={{ ...S.pillDot, background: camActive ? "#a855f7" : "#333" }} className={camActive ? "blink" : ""} />
            Webcam
          </div>
        </div>
      </header>

      {/* 3-column layout */}
      <div style={S.grid3}>

        {/* ─── Left: Webcam + Emotions ─── */}
        <div style={S.col}>
          <div style={S.sectionLabel}>Analyse faciale</div>

          {/* Camera feed */}
          <div style={S.camBox}>
            <video ref={videoRef} style={{ ...S.camVideo, display: camActive ? "block" : "none" }} muted playsInline />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            {!camActive && (
              <div style={S.camOff}>
                <div style={S.camOffIcon}>◎</div>
                <div style={S.camOffText}>{camError || "Webcam désactivée"}</div>
              </div>
            )}
            {camActive && (
              <div style={S.camOverlay}>
                <div style={{ ...S.camDot, background: faceDetected ? "#22c55e" : "#ef4444" }} />
                <span style={S.camStatus}>{faceDetected ? "Visage détecté" : "Aucun visage"}</span>
              </div>
            )}
          </div>

          <button onClick={toggleCam} style={{ ...S.camBtn, ...(camActive ? S.camBtnActive : {}) }}>
            {camActive ? "◉ Désactiver webcam" : "○ Activer webcam"}
          </button>

          {/* Emotion gauges */}
          <div style={S.sectionLabel}>Émotions détectées</div>
          {[
            { name: "ANGER", val: emotions.anger, emoji: "▲" },
            { name: "STRESS", val: emotions.stress, emoji: "≋" },
            { name: "TENSION", val: emotions.tension, emoji: "═" },
            { name: "FOCUS", val: emotions.focus, emoji: "◉" },
          ].map((em) => (
            <div key={em.name} style={S.emotionRow}>
              <div style={S.emotionHeader}>
                <span style={S.emotionEmoji}>{em.emoji}</span>
                <span style={S.emotionName}>{em.name}</span>
                <span style={{ ...S.emotionVal, color: getEmotionColor(em.val) }}>
                  {Math.round(em.val * 100)}%
                </span>
              </div>
              <div style={S.emotionTrack}>
                <div style={{
                  ...S.emotionFill,
                  width: `${Math.round(em.val * 100)}%`,
                  background: em.name === "FOCUS" ? "#3b82f6" : getEmotionColor(em.val),
                }} />
              </div>
            </div>
          ))}

          {/* Mini anger history */}
          <div style={S.sectionLabel}>Anger (20s)</div>
          <div style={S.miniHist}>
            {emotionHistory.map((v, i) => (
              <div key={i} style={{
                ...S.miniBar,
                height: Math.max(1, (v / Math.max(emotionMax, 0.01)) * 28),
                background: getEmotionColor(v),
              }} />
            ))}
          </div>
        </div>

        {/* ─── Center: Score + Signals ─── */}
        <div style={S.col}>
          <div style={S.scoreCard}>
            <div style={S.sectionLabel}>Score de tilt</div>
            <div style={{ ...S.scoreNum, color }}>{score}</div>
            <div style={S.scoreLabel}>{label}</div>
            <div style={S.gaugeTrack}>
              <div style={{ ...S.gaugeFill, width: `${score}%`, background: color }} />
            </div>
            <div style={S.idleNote}>Reset auto après 3s d'inactivité</div>
          </div>

          <div style={S.sectionLabel}>Signaux composites</div>
          <div style={S.signalGrid}>
            {[
              { name: "CADENCE", val: signals.cadence, w: "35%" },
              { name: "VARIANCE", val: signals.variance, w: "25%" },
              { name: "SPAM", val: signals.spam, w: "20%" },
              { name: "CHAOS", val: signals.chaos, w: "20%" },
            ].map((s) => (
              <div key={s.name} style={S.signalCard}>
                <div style={S.signalHeader}>
                  <span style={S.signalName}>{s.name}</span>
                  <span style={S.signalWeight}>{s.w}</span>
                </div>
                <div style={{ ...S.signalVal, color: getColor(s.val) }}>{s.val}%</div>
                <div style={S.sigBarTrack}>
                  <div style={{ ...S.sigBarFill, width: `${s.val}%`, background: getColor(s.val) }} />
                </div>
              </div>
            ))}
          </div>

          <div style={S.sectionLabel}>Historique frappes (30s)</div>
          <div style={S.histRow}>
            {history.map((v, i) => (
              <div key={i} style={{ ...S.histBar, height: Math.max(2, (v / histMax) * 44), background: getColor((v / histMax) * 100) }} />
            ))}
          </div>
        </div>

        {/* ─── Right: Controls + Log ─── */}
        <div style={S.col}>
          <div style={S.statsRow}>
            <div style={S.statCard}><div style={S.statVal}>{totalKeys}</div><div style={S.statLbl}>TOUCHES</div></div>
            <div style={S.statCard}><div style={{ ...S.statVal, color: rageCount > 0 ? "#ef4444" : undefined }}>{rageCount}</div><div style={S.statLbl}>RAGES</div></div>
            <div style={S.statCard}><div style={S.statVal}>{topKey}</div><div style={S.statLbl}>TOP KEY</div></div>
          </div>

          <button onClick={toggle} style={{ ...S.mainBtn, ...(monitoring ? S.btnStop : S.btnStart) }}>
            {monitoring ? "⏹ ARRÊTER LE SCAN" : "▶ DÉMARRER LE SCAN"}
          </button>

          <div style={S.sectionLabel}>Journal des frappes</div>
          <div style={S.logScroll}>
            {log.length === 0 ? (
              <div style={S.logEmpty}>{monitoring ? "En attente d'une touche..." : "Lance le scan pour commencer"}</div>
            ) : (
              log.map((entry) => (
                <div key={entry.id} style={S.logEntry} className="log-in">
                  <span style={S.logTime}>{entry.time}</span>
                  <span style={S.logKey}>{entry.key}</span>
                  {entry.delta > 0 && (
                    <span style={{ ...S.logDelta, color: entry.delta < 300 ? "#ef4444" : "#3f3f46" }}>{entry.delta}ms</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div style={S.footer}>
        Seuil tilt : ≥{RAGE_THRESHOLD} · Reset 3s · Webcam : analyse heuristique locale (aucune donnée envoyée)
      </div>
    </div>
  );
}

// ─── Styles ───
const S = {
  root: {
    minHeight: "100vh",
    background: "#09090b",
    color: "#d4d4d8",
    fontFamily: "'Courier New', 'Fira Code', monospace",
    padding: "16px 12px 40px",
    maxWidth: 1100,
    margin: "0 auto",
  },

  alertOverlay: { position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 999, width: "92%", maxWidth: 500 },
  alertBar: {
    background: "#18181b", border: "1px solid", borderRadius: 6, padding: "13px 18px",
    fontSize: 13, fontWeight: 700, fontFamily: "'Courier New', monospace", color: "#fafafa", textAlign: "center",
  },

  calmOverlay: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 998, width: "92%", maxWidth: 420 },
  calmCard: {
    background: "#0f172a", border: "1px solid #1e3a5f", borderRadius: 10,
    padding: "20px 24px", boxShadow: "0 0 60px #3b82f622",
  },
  calmHeader: {
    fontSize: 10, letterSpacing: 2, color: "#60a5fa", marginBottom: 10,
    display: "flex", alignItems: "center", gap: 8,
  },
  calmPulse: {
    width: 8, height: 8, borderRadius: "50%", background: "#3b82f6",
    display: "inline-block", animation: "blink 1.5s infinite",
  },
  calmTitle: { fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 },
  calmText: { fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 14 },
  calmBtn: {
    background: "#1e3a5f", border: "1px solid #2563eb", borderRadius: 6,
    color: "#60a5fa", padding: "8px 20px", fontSize: 12, fontFamily: "'Courier New', monospace",
    cursor: "pointer", fontWeight: 700, letterSpacing: 1,
  },

  header: {
    display: "flex", alignItems: "flex-end", justifyContent: "space-between",
    marginBottom: 16, borderBottom: "1px solid #1e1e22", paddingBottom: 14,
  },
  titleRow: { display: "flex", alignItems: "center", gap: 8 },
  titleIcon: { fontSize: 20, color: "#ef4444" },
  title: { fontSize: 24, fontWeight: 900, letterSpacing: 5, color: "#fafafa" },
  version: { fontSize: 10, color: "#3f3f46", border: "1px solid #27272a", borderRadius: 4, padding: "1px 6px" },
  subtitle: { fontSize: 10, color: "#3f3f46", letterSpacing: 1.5, marginTop: 2 },
  pills: { display: "flex", gap: 6 },
  pill: {
    fontSize: 10, padding: "4px 10px", borderRadius: 20, border: "1px solid #27272a",
    color: "#52525b", background: "#111113", display: "flex", alignItems: "center", gap: 5,
  },
  pillActive: { color: "#22c55e", borderColor: "#166534", background: "#052e1622" },
  pillGp: { color: "#3b82f6", borderColor: "#1d4ed8", background: "#1e3a5f22" },
  pillCam: { color: "#a855f7", borderColor: "#7c3aed", background: "#2e1065aa" },
  pillDot: { width: 5, height: 5, borderRadius: "50%" },

  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 },

  col: { display: "flex", flexDirection: "column", gap: 12 },

  sectionLabel: { fontSize: 9, color: "#3f3f46", letterSpacing: 2, textTransform: "uppercase" },

  // Webcam
  camBox: {
    background: "#0c0c0e", border: "1px solid #1e1e22", borderRadius: 8,
    overflow: "hidden", position: "relative", aspectRatio: "4/3",
  },
  camVideo: { width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" },
  camOff: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8 },
  camOffIcon: { fontSize: 32, color: "#27272a" },
  camOffText: { fontSize: 11, color: "#27272a" },
  camOverlay: {
    position: "absolute", bottom: 6, left: 8, display: "flex", alignItems: "center", gap: 5,
    background: "#000000aa", borderRadius: 4, padding: "3px 8px",
  },
  camDot: { width: 6, height: 6, borderRadius: "50%" },
  camStatus: { fontSize: 10, color: "#a1a1aa" },
  camBtn: {
    width: "100%", padding: "8px 0", fontSize: 11, fontFamily: "'Courier New', monospace",
    fontWeight: 700, letterSpacing: 1, border: "1px solid #27272a", borderRadius: 6,
    background: "transparent", color: "#52525b", cursor: "pointer",
  },
  camBtnActive: { borderColor: "#7c3aed", color: "#a855f7", background: "#2e106522" },

  // Emotions
  emotionRow: { marginBottom: 2 },
  emotionHeader: { display: "flex", alignItems: "center", gap: 6, marginBottom: 3 },
  emotionEmoji: { fontSize: 11, color: "#52525b", width: 14 },
  emotionName: { fontSize: 10, color: "#52525b", letterSpacing: 1, flex: 1 },
  emotionVal: { fontSize: 12, fontWeight: 700, transition: "color 0.3s" },
  emotionTrack: { height: 4, background: "#1e1e22", borderRadius: 2, overflow: "hidden" },
  emotionFill: { height: "100%", borderRadius: 2, transition: "width 0.4s, background 0.4s" },

  miniHist: { display: "flex", alignItems: "flex-end", gap: 2, height: 30 },
  miniBar: { flex: 1, borderRadius: "1px 1px 0 0", transition: "height 0.3s, background 0.3s", minHeight: 1 },

  // Score
  scoreCard: {
    background: "#111113", border: "1px solid #1e1e22", borderRadius: 8,
    padding: "16px 16px 12px", textAlign: "center",
  },
  scoreNum: { fontSize: 64, fontWeight: 900, lineHeight: 1, transition: "color 0.4s", margin: "4px 0" },
  scoreLabel: { fontSize: 13, color: "#71717a", letterSpacing: 4, fontWeight: 700 },
  gaugeTrack: { height: 6, background: "#1e1e22", borderRadius: 3, overflow: "hidden", marginTop: 10 },
  gaugeFill: { height: "100%", borderRadius: 3, transition: "width 0.5s cubic-bezier(.17,.67,.35,1.1), background 0.4s" },
  idleNote: { fontSize: 9, color: "#27272a", marginTop: 6, letterSpacing: 1 },

  signalGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  signalCard: { background: "#111113", border: "1px solid #1e1e22", borderRadius: 6, padding: "8px 10px" },
  signalHeader: { display: "flex", justifyContent: "space-between" },
  signalName: { fontSize: 9, color: "#52525b", letterSpacing: 1 },
  signalWeight: { fontSize: 8, color: "#3f3f46" },
  signalVal: { fontSize: 16, fontWeight: 700, marginTop: 2, transition: "color 0.3s" },
  sigBarTrack: { height: 3, background: "#1e1e22", borderRadius: 2, marginTop: 4 },
  sigBarFill: { height: 3, borderRadius: 2, transition: "width 0.4s, background 0.4s" },

  histRow: { display: "flex", alignItems: "flex-end", gap: 2, height: 46 },
  histBar: { flex: 1, borderRadius: "2px 2px 0 0", transition: "height 0.3s, background 0.3s", minHeight: 2 },

  // Stats
  statsRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 },
  statCard: { background: "#111113", border: "1px solid #1e1e22", borderRadius: 6, padding: "10px 6px", textAlign: "center" },
  statVal: { fontSize: 20, fontWeight: 900, color: "#fafafa" },
  statLbl: { fontSize: 8, color: "#3f3f46", marginTop: 2, letterSpacing: 2 },

  mainBtn: {
    width: "100%", padding: "12px 0", fontFamily: "'Courier New', monospace",
    fontSize: 13, fontWeight: 900, letterSpacing: 3, border: "1px solid",
    borderRadius: 6, cursor: "pointer", transition: "all 0.2s",
  },
  btnStart: { background: "#052e16", borderColor: "#166534", color: "#22c55e" },
  btnStop: { background: "#1c0a0a", borderColor: "#991b1b", color: "#ef4444" },

  logScroll: {
    flex: 1, minHeight: 240, maxHeight: 380, overflowY: "auto",
    background: "#0c0c0e", border: "1px solid #1e1e22", borderRadius: 6,
  },
  logEmpty: { color: "#27272a", textAlign: "center", padding: "40px 0", fontSize: 11 },
  logEntry: { display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderBottom: "1px solid #151517", fontSize: 10 },
  logTime: { color: "#27272a", minWidth: 54, fontSize: 9 },
  logKey: {
    background: "#18181b", border: "1px solid #27272a", borderRadius: 3,
    padding: "1px 7px", fontWeight: 700, color: "#a1a1aa", fontSize: 11,
  },
  logDelta: { marginLeft: "auto", fontSize: 9 },

  footer: { textAlign: "center", fontSize: 9, color: "#27272a", marginTop: 16, letterSpacing: 1 },
};

const css = `
  @keyframes alertAnim {
    0% { transform: translateY(-10px) scale(0.95); opacity: 0; }
    50% { transform: translateY(2px) scale(1.02); opacity: 1; }
    100% { transform: translateY(0) scale(1); opacity: 1; }
  }
  .alert-anim { animation: alertAnim 0.35s cubic-bezier(.17,.67,.35,1.4) forwards; }

  @keyframes calmSlide {
    0% { transform: translateY(20px); opacity: 0; }
    100% { transform: translateY(0); opacity: 1; }
  }
  .calm-anim { animation: calmSlide 0.5s cubic-bezier(.17,.67,.35,1.2) forwards; }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
  .blink { animation: blink 1.2s ease-in-out infinite; }

  @keyframes logIn {
    from { opacity: 0; transform: translateX(-6px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .log-in { animation: logIn 0.15s ease-out forwards; }

  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-track { background: #09090b; }
  ::-webkit-scrollbar-thumb { background: #27272a; border-radius: 2px; }

  * { box-sizing: border-box; }
`;
