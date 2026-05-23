import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const POINT_IDS = [
  "S1_TL","S1_TM","S1_TR","S1_RM","S1_BR","S1_BM","S1_BL","S1_LM",
  "S2_TL","S2_TM","S2_TR","S2_RM","S2_BR","S2_BM","S2_BL","S2_LM",
  "S3_TL","S3_TM","S3_TR","S3_RM","S3_BR","S3_BM","S3_BL","S3_LM"
];
const RING_SIZE = { S1: 2.45, S2: 4.65, S3: 6.85 };
const SUFFIX_POS = { TL: [-1,-1], TM: [0,-1], TR: [1,-1], RM: [1,0], BR: [1,1], BM: [0,1], BL: [-1,1], LM: [-1,0] };
const ADJ = new Map();
const LINES = [];

function initGraph() {
  POINT_IDS.forEach(id => ADJ.set(id, []));
  for (let r = 1; r <= 3; r++) buildRing(r);
  link("S1_TM", "S2_TM"); link("S2_TM", "S3_TM");
  link("S1_BM", "S2_BM"); link("S2_BM", "S3_BM");
  link("S1_LM", "S2_LM"); link("S2_LM", "S3_LM");
  link("S1_RM", "S2_RM"); link("S2_RM", "S3_RM");
  for (let r = 1; r <= 3; r++) {
    const p = `S${r}_`;
    addLine(p + "TL", p + "TM", p + "TR");
    addLine(p + "TR", p + "RM", p + "BR");
    addLine(p + "BR", p + "BM", p + "BL");
    addLine(p + "BL", p + "LM", p + "TL");
  }
  addLine("S1_TM", "S2_TM", "S3_TM");
  addLine("S1_BM", "S2_BM", "S3_BM");
  addLine("S1_LM", "S2_LM", "S3_LM");
  addLine("S1_RM", "S2_RM", "S3_RM");
}
function buildRing(r) {
  const p = `S${r}_`;
  link(p + "TL", p + "TM"); link(p + "TM", p + "TR");
  link(p + "TR", p + "RM"); link(p + "RM", p + "BR");
  link(p + "BR", p + "BM"); link(p + "BM", p + "BL");
  link(p + "BL", p + "LM"); link(p + "LM", p + "TL");
}
function link(a, b) { ADJ.get(a).push(b); ADJ.get(b).push(a); }
function addLine(a, b, c) { LINES.push([a, b, c]); }
function opp(player) { return player === "stone" ? "stick" : "stone"; }
initGraph();

const state = {
  board: Object.fromEntries(POINT_IDS.map(id => [id, null])),
  currentPlayer: "stone",
  phase: "placing",
  placed: { stone: 0, stick: 0 },
  captured: { stone: 0, stick: 0 },
  captureMode: false,
  selectedPoint: null,
  winner: null,
  aiEnabled: true,
  difficulty: "mid",
  aiBusy: false,
  inputLocked: false,
  dropActive: false,
  dropMesh: null,
  dropStart: null,
  dropEnd: null,
  dropT: 0,
  dropPlayer: null,
  dropTarget: null,
  dropFromPoint: null,
  dropReserveIndex: -1,
  lastAIMove: null,
  recentAIMoves: [],
  usedTrainLines: { stone: new Set(), stick: new Set() }
};

const victoryOverlay = document.getElementById("victoryOverlay");
const victoryTitle = document.getElementById("victoryTitle");
const victorySubtitle = document.getElementById("victorySubtitle");
const victoryEmoji = document.getElementById("victoryEmoji");
const playAgainOverlayBtn = document.getElementById("playAgainOverlayBtn");
const confettiLayer = document.getElementById("confettiLayer");

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x72aeea);
// No fog in top-down view: it keeps all sides of the board visually equal.
scene.fog = null;

function isSmallScreen() { return window.innerWidth <= 760 || window.matchMedia("(pointer: coarse)").matches; }
function getViewportSize() {
  // Mobile browser address bars can make window.innerHeight lie.
  // visualViewport gives a better live size on iPhone/Android.
  const vv = window.visualViewport;
  return {
    width: vv ? vv.width : window.innerWidth,
    height: vv ? vv.height : window.innerHeight
  };
}
function getBoardViewSize() {
  const { width, height } = getViewportSize();
  const aspect = width / height;

  // The board plus top/bottom trays need about 18.8 world units of width.
  // In portrait mode, a normal orthographic view clips the left/right sides.
  // This grows the view only when needed so the whole 4x4 board fits on phones.
  const neededWorldWidth = isSmallScreen() ? 19.6 : 18.8;
  const minimumViewHeight = isSmallScreen() ? 22.0 : 18.6;
  return Math.max(minimumViewHeight, neededWorldWidth / aspect);
}
function makeCamera() {
  const { width, height } = getViewportSize();
  const aspect = width / height;
  const viewSize = getBoardViewSize();
  return new THREE.OrthographicCamera(
    -viewSize * aspect / 2,
     viewSize * aspect / 2,
     viewSize / 2,
    -viewSize / 2,
     0.1,
     140
  );
}
const camera = makeCamera();
function updateCameraFrustum() {
  const { width, height } = getViewportSize();
  const aspect = width / height;
  const viewSize = getBoardViewSize();
  camera.left = -viewSize * aspect / 2;
  camera.right = viewSize * aspect / 2;
  camera.top = viewSize / 2;
  camera.bottom = -viewSize / 2;
  camera.updateProjectionMatrix();
}
function resetCamera() {
  // True top-down orthographic camera. On phones, shift the board slightly
  // downward so the HUD no longer covers the top reserve tray.
  camera.up.set(0, 0, -1);
  camera.position.set(0, 44, 0);
  const mobileBoardOffsetZ = isSmallScreen() ? -1.0 : 0;
  controls.target.set(0, 0, mobileBoardOffsetZ);
  camera.lookAt(controls.target);
  controls.update();
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.enableRotate = false;
controls.enablePan = false;
controls.enableZoom = false;
updateCameraFrustum();
resetCamera();

scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 2.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(7, 11, 4);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(27, 120),
  new THREE.MeshStandardMaterial({ color: 0x3f4e16, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.08;
scene.add(ground);

const table = new THREE.Mesh(
  new THREE.BoxGeometry(16.4, 0.38, 16.4),
  new THREE.MeshStandardMaterial({ color: 0x5f7886, roughness: 0.78, metalness: 0.04 })
);
table.position.y = 0;
scene.add(table);

const boardGroup = new THREE.Group();
boardGroup.position.y = 0.28;
scene.add(boardGroup);
const reserveGroup = new THREE.Group();
scene.add(reserveGroup);

const pointMeshes = new Map();
const pieceMeshes = new Map();
const reserveMeshes = { stone: [], stick: [] };
const capturedMeshes = { stone: [], stick: [] };

const matBoardLine = new THREE.MeshStandardMaterial({ color: 0x8b6230, roughness: 0.66 });
const matPoint = new THREE.MeshStandardMaterial({ color: 0x8b6230, roughness: 0.58 });
const matStone = new THREE.MeshStandardMaterial({ color: 0x0f1418, roughness: 0.82, metalness: 0.04, emissive: 0x050607, emissiveIntensity: 0.18 });
const matStick = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.55, metalness: 0.02, emissive: 0x3a0000, emissiveIntensity: 0.22 });
const matEdge = new THREE.MeshStandardMaterial({ color: 0x4b097e, roughness: 0.78 });

function pointPosition(id) {
  const [ring, suffix] = id.split("_");
  const size = RING_SIZE[ring];
  const [x, z] = SUFFIX_POS[suffix];
  return new THREE.Vector3(x * size, 0.38, z * size);
}
function reservePosition(player, index) {
  // Player BLACK/stone tray stays at the bottom. AI RED/stick tray stays at the top.
  const x = -3.2 + index * 0.8;
  const z = player === "stone" ? 8.35 : -8.35;
  return new THREE.Vector3(x, 0.74, z);
}
function capturedPosition(capturer, index) {
  // Captured opponent pieces are shown on the capturer's tray.
  const x = -3.2 + index * 0.8;
  const z = capturer === "stone" ? 8.35 : -8.35;
  return new THREE.Vector3(x, 0.86, z);
}
function makePieceMesh(player) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.50, 32, 18),
    (player === "stone" ? matStone : matStick).clone()
  );
}
function makeCylinderBetween(a, b, radius, mat) {
  const start = pointPosition(a), end = pointPosition(b);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dir = end.clone().sub(start);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, dir.length(), 16), mat);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}
function createBoard() {
  const seen = new Set();
  for (const [a, nbs] of ADJ.entries()) {
    for (const b of nbs) {
      const key = [a, b].sort().join("-");
      if (seen.has(key)) continue;
      seen.add(key);
      boardGroup.add(makeCylinderBetween(a, b, 0.035, matBoardLine));
    }
  }
  for (const id of POINT_IDS) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.09, 14, 40), matPoint.clone());
    mesh.position.copy(pointPosition(id));
    mesh.rotation.x = Math.PI / 2;
    mesh.userData.pointId = id;
    boardGroup.add(mesh);
    pointMeshes.set(id, mesh);
  }
  const railLong = new THREE.BoxGeometry(16.0, 0.16, 0.16);
  const railShort = new THREE.BoxGeometry(0.16, 0.16, 16.0);
  [[0, 0.42, -7.95, railLong], [0, 0.42, 7.95, railLong], [-7.95, 0.42, 0, railShort], [7.95, 0.42, 0, railShort]].forEach(([x,y,z,geo]) => {
    const rail = new THREE.Mesh(geo, matEdge);
    rail.position.set(x, y, z);
    scene.add(rail);
  });
  const trayGeo = new THREE.BoxGeometry(7.4, 0.16, 0.82);
  const stoneTray = new THREE.Mesh(trayGeo, matEdge);
  stoneTray.position.set(0, 0.43, 8.35);
  reserveGroup.add(stoneTray);
  const stickTray = new THREE.Mesh(trayGeo, matEdge);
  stickTray.position.set(0, 0.43, -8.35);
  reserveGroup.add(stickTray);
}
function createReservePieces() {
  for (const player of ["stone", "stick"]) {
    reserveMeshes[player].forEach(m => reserveGroup.remove(m));
    reserveMeshes[player] = [];
    for (let i = 0; i < 9; i++) {
      const mesh = makePieceMesh(player);
      mesh.position.copy(reservePosition(player, i));
      reserveGroup.add(mesh);
      reserveMeshes[player].push(mesh);
    }
  }
}
function clearCapturedTrayPieces() {
  for (const player of ["stone", "stick"]) {
    capturedMeshes[player].forEach(m => {
      reserveGroup.remove(m);
      m.geometry.dispose();
    });
    capturedMeshes[player] = [];
  }
}
function addCapturedTrayPiece(capturer, capturedPlayer) {
  const index = capturedMeshes[capturer].length;
  const mesh = makePieceMesh(capturedPlayer);
  mesh.scale.setScalar(0.72);
  mesh.position.copy(capturedPosition(capturer, index));
  reserveGroup.add(mesh);
  capturedMeshes[capturer].push(mesh);
}
function createPiece(point, player) {
  const old = pieceMeshes.get(point);
  if (old) removePieceMesh(point);
  const mesh = makePieceMesh(player);
  mesh.position.copy(pointPosition(point));
  mesh.position.y += 0.38;
  mesh.userData.pointId = point;
  mesh.userData.player = player;
  boardGroup.add(mesh);
  pieceMeshes.set(point, mesh);
}
function removePieceMesh(point) {
  const mesh = pieceMeshes.get(point);
  if (!mesh) return;
  boardGroup.remove(mesh);
  mesh.geometry.dispose();
  pieceMeshes.delete(point);
}
function clearBoardPieces() {
  for (const mesh of pieceMeshes.values()) {
    boardGroup.remove(mesh);
    mesh.geometry.dispose();
  }
  pieceMeshes.clear();
}
function setReserveVisible(player, index, visible) {
  const mesh = reserveMeshes[player][index];
  if (mesh) mesh.visible = visible;
}
function showAllReservePieces() {
  for (const p of ["stone", "stick"]) reserveMeshes[p].forEach(m => m.visible = true);
}

function hideVictoryOverlay() {
  victoryOverlay.classList.add("hidden");
  confettiLayer.innerHTML = "";
}
function showVictoryOverlay(winner) {
  const aiMode = state.aiEnabled;
  if (winner === "stone") {
    victoryEmoji.textContent = "🎉";
    victoryTitle.textContent = "BLACK STONE WINS!";
    victorySubtitle.textContent = aiMode
      ? `Black Stone beat Red on ${state.difficulty.toUpperCase()} level.`
      : "Black Stone defeated Red Stick.";
  } else {
    victoryEmoji.textContent = "🏁";
    victoryTitle.textContent = "RED STICK WINS!";
    victorySubtitle.textContent = aiMode
      ? `Red won on ${state.difficulty.toUpperCase()} level. Press Play Again for a rematch.`
      : "Red Stick defeated Black Stone.";
  }
  victoryOverlay.classList.remove("hidden");
  spawnConfetti(winner === "stone" ? ["#ffd84a", "#39c7ff", "#7cff6f", "#ffffff"] : ["#ff4d4d", "#ff9d2e", "#ffd84a", "#ffffff"]);
}
function spawnConfetti(colors) {
  confettiLayer.innerHTML = "";
  const pieceCount = isSmallScreen() ? 55 : 90;
  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("div");
    piece.className = "confettiPiece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = `${2.2 + Math.random() * 1.7}s`;
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    piece.style.setProperty("--x-drift", `${-65 + Math.random() * 130}px`);
    piece.style.setProperty("--spin", `${360 + Math.random() * 720}deg`);
    const w = 7 + Math.random() * 7;
    const h = 10 + Math.random() * 12;
    piece.style.width = `${w}px`;
    piece.style.height = `${h}px`;
    confettiLayer.appendChild(piece);
  }
}

function getPiecesOnBoard(player) { return POINT_IDS.filter(id => state.board[id] === player).length; }
function trainsFor(player) { return LINES.filter(line => line.every(id => state.board[id] === player)); }
function findTrainThrough(player, point) { return trainsFor(player).find(line => line.includes(point)) || null; }
function lineKey(line) { return line.join("|"); }
function allTrainLineKeys() { return LINES.map(lineKey); }
function trainLinesMadeByMove(from, to, player) {
  if (state.board[to] !== null) return [];
  if (from) state.board[from] = null;
  state.board[to] = player;
  const made = LINES.filter(line => line.includes(to) && line.every(id => state.board[id] === player));
  state.board[to] = null;
  if (from) state.board[from] = player;
  return made;
}
function difficultyLevel() { return state.difficulty || "mid"; }
function isPointInTrain(player, point) {
  return LINES.some(line => line.includes(point) && line.every(id => state.board[id] === player));
}
function isTwoKataaraMove(from, to, player, madeLines) {
  // 2 Kataara: a piece moves from one completed train to another train,
  // and moving it back would remake the original train.
  if (!from || !madeLines.length) return false;
  const beforeLines = LINES.filter(line => line.includes(from) && line.every(id => state.board[id] === player));
  if (!beforeLines.length) return false;
  state.board[from] = null;
  state.board[to] = player;
  let canMoveBack = false;
  if (ADJ.get(to).includes(from)) {
    state.board[to] = null;
    state.board[from] = player;
    canMoveBack = beforeLines.some(line => line.every(id => state.board[id] === player));
    state.board[from] = null;
    state.board[to] = player;
  }
  state.board[to] = null;
  state.board[from] = player;
  return canMoveBack;
}
function trainRepeatInfo(from, to, player) {
  const made = trainLinesMadeByMove(from, to, player);
  if (!made.length) return { allowed: true, repeated: false, made, reason: "no-train" };
  if (difficultyLevel() === "easy") return { allowed: true, repeated: false, made, reason: "easy" };
  const used = state.usedTrainLines[player];
  const allUsed = used.size >= LINES.length;
  const repeated = made.some(line => used.has(lineKey(line)));
  if (!repeated || allUsed) return { allowed: true, repeated, made, reason: allUsed ? "all-lines-done" : "new-line" };
  if (difficultyLevel() === "mid" && isTwoKataaraMove(from, to, player, made)) {
    return { allowed: true, repeated, made, reason: "two-kataara" };
  }
  return { allowed: false, repeated, made, reason: "repeat-blocked" };
}
function canMakeTrainOnLine(from, to, player) { return trainRepeatInfo(from, to, player).allowed; }
function markTrainLinesUsed(lines, player) {
  for (const line of lines) state.usedTrainLines[player].add(lineKey(line));
}
function trainRuleMessage() {
  if (difficultyLevel() === "mid") {
    return "BLUE RULE: You cannot repeat the same train line unless all other train lines are done, or it is a true 2 Kataara move.";
  }
  if (difficultyLevel() === "hard") {
    return "BLUE RULE: You cannot repeat the same train line until all other train lines are done.";
  }
  return "Easy level: repeating the same train line is allowed.";
}
function canPlaceAt(point, player = state.currentPlayer) {
  if (state.phase !== "placing" || state.captureMode || state.board[point] !== null || state.placed[player] >= 9) return false;
  state.board[point] = player;
  const makesTrain = trainsFor(player).length > 0;
  state.board[point] = null;
  return !makesTrain;
}
function validPlacements(player = state.currentPlayer) { return POINT_IDS.filter(id => canPlaceAt(id, player)); }
function validMoveDests(from, player = state.currentPlayer) {
  if (state.phase !== "moving" || state.captureMode || state.board[from] !== player) return [];
  return ADJ.get(from).filter(nb => state.board[nb] === null && canMakeTrainOnLine(from, nb, player));
}
function allValidMoves(player = state.currentPlayer) {
  const moves = [];
  for (const id of POINT_IDS) if (state.board[id] === player) {
    for (const nb of ADJ.get(id)) if (state.board[nb] === null && canMakeTrainOnLine(id, nb, player)) moves.push([id, nb]);
  }
  return moves;
}
function captureCandidates(player = state.currentPlayer) {
  const enemy = opp(player);
  const enemies = POINT_IDS.filter(id => state.board[id] === enemy);
  if (difficultyLevel() === "easy") return enemies;
  const nonTrain = enemies.filter(id => !isPointInTrain(enemy, id));
  // Mid/Hard rule: a piece currently inside a train cannot be captured.
  return nonTrain;
}
function captureTargets(player = state.currentPlayer) {
  if (!state.captureMode) return [];
  return captureCandidates(player);
}
function placementWouldMakeTrain(pt, player) {
  if (state.phase !== "placing" || state.board[pt] !== null) return false;
  return LINES.some(line => line.includes(pt) && line.every(id => id === pt || state.board[id] === player));
}
function commitPlace(point, player) {
  state.board[point] = player;
  state.placed[player] += 1;
  createPiece(point, player);
  playTone(520, 0.08);
  if (state.placed.stone === 9 && state.placed.stick === 9) state.phase = "moving";
}
function commitMove(from, to, player) {
  state.board[from] = null;
  state.board[to] = player;
  createPiece(to, player);
  playTone(440, 0.08);
  const madeLines = LINES.filter(line => line.includes(to) && line.every(id => state.board[id] === player));
  if (madeLines.length) {
    markTrainLinesUsed(madeLines, player);
    state.captureMode = true;
    setStatus(`${player.toUpperCase()} made a train. Capture one opponent piece.`);
    updateVisuals();
    return true;
  }
  return false;
}
function commitCapture(point, player) {
  if (state.board[point] !== opp(player)) return false;
  const capturedPlayer = opp(player);
  removePieceMesh(point);
  state.board[point] = null;
  state.captured[player] += 1;
  addCapturedTrayPiece(player, capturedPlayer);
  state.captureMode = false;
  playTone(190, 0.13);
  const enemy = opp(player);
  if (getPiecesOnBoard(enemy) < 3 && state.phase === "moving") {
    state.winner = player;
    setStatus(`${player.toUpperCase()} WINS! Press Play Again.`);
    updateVisuals();
    showVictoryOverlay(player);
    return true;
  }
  return false;
}
function switchTurn() {
  state.currentPlayer = opp(state.currentPlayer);
  state.selectedPoint = null;
  checkWin();
  updateVisuals();
  if (!state.winner) setStatus(turnMessage());
  maybeRunAI();
}
function checkWin() {
  if (state.phase !== "moving") return;
  const p = state.currentPlayer;
  const prev = opp(p);
  if (getPiecesOnBoard(p) < 3 || allValidMoves(p).length === 0) {
    state.winner = prev;
    setStatus(`${prev.toUpperCase()} WINS! Press Play Again.`);
    showVictoryOverlay(prev);
  }
}
function turnMessage() {
  if (state.phase === "placing") return `${state.currentPlayer.toUpperCase()} turn: tap/click a green circle to place.`;
  return `${state.currentPlayer.toUpperCase()} turn: choose your piece, then choose a blue connected circle.`;
}
function canHumanAct() {
  if (state.winner || state.inputLocked || state.dropActive || state.aiBusy) return false;
  if (state.currentPlayer === "stone") return true;
  return state.currentPlayer === "stick" && !state.aiEnabled;
}

function handlePoint(point) {
  if (!point) return;
  hoveredPoint = point;
  if (!canHumanAct()) {
    if (state.currentPlayer === "stick") setStatus("AI is controlling STICK. Wait for its move.");
    return;
  }
  const player = state.currentPlayer;

  if (state.captureMode) {
    if (!captureTargets(player).includes(point)) {
      setStatus("CAPTURE: choose one opponent piece.");
      playTone(120, 0.06);
      return;
    }
    const won = commitCapture(point, player);
    if (!won) switchTurn();
    return;
  }

  if (state.phase === "placing") {
    if (!validPlacements(player).includes(point)) {
      if (state.board[point] != null) setStatus("That circle is already taken.");
      else if (placementWouldMakeTrain(point, player)) setStatus("You cannot make a train in the placing phase.");
      else setStatus("Choose a highlighted green circle.");
      playTone(120, 0.06);
      return;
    }
    startDropAnimation(player, point, null, state.placed[player]);
    return;
  }

  if (state.phase === "moving") {
    if (!state.selectedPoint) {
      if (state.board[point] !== player) {
        setStatus(`${player.toUpperCase()}: choose one of your own pieces first.`);
        playTone(120, 0.06);
        return;
      }
      if (validMoveDests(point, player).length === 0) {
        setStatus("That piece has no legal moves.");
        playTone(120, 0.06);
        return;
      }
      state.selectedPoint = point;
      setStatus(`${player.toUpperCase()}: now choose a blue connected circle.`);
      updateVisuals();
      return;
    }

    if (point === state.selectedPoint) {
      state.selectedPoint = null;
      setStatus("Selection cancelled. Choose another piece.");
      updateVisuals();
      return;
    }

    if (state.board[point] === player) {
      if (validMoveDests(point, player).length === 0) {
        setStatus("That piece has no legal moves.");
        playTone(120, 0.06);
        return;
      }
      state.selectedPoint = point;
      setStatus(`${player.toUpperCase()}: selected another piece. Choose a blue connected circle.`);
      updateVisuals();
      return;
    }

    if (!validMoveDests(state.selectedPoint, player).includes(point)) {
      if (state.board[point] === null && ADJ.get(state.selectedPoint).includes(point) && !canMakeTrainOnLine(state.selectedPoint, point, player)) {
        setStatus(trainRuleMessage());
      } else {
        setStatus("Move only to a highlighted blue connected circle.");
      }
      playTone(120, 0.06);
      return;
    }
    startDropAnimation(player, point, state.selectedPoint, -1);
  }
}

function startDropAnimation(player, targetPoint, fromPoint, reserveIndex = -1) {
  const mesh = makePieceMesh(player);
  let start;
  if (fromPoint) {
    start = pointPosition(fromPoint).clone().add(new THREE.Vector3(0, 0.64, 0));
    removePieceMesh(fromPoint);
  } else {
    const idx = reserveIndex >= 0 ? reserveIndex : Math.min(state.placed[player], 8);
    start = reservePosition(player, idx).clone();
    setReserveVisible(player, idx, false);
  }
  mesh.scale.setScalar(0.95);
  mesh.position.copy(start);
  scene.add(mesh);
  state.dropActive = true;
  state.dropMesh = mesh;
  state.dropStart = start.clone();
  state.dropEnd = pointPosition(targetPoint).clone().add(new THREE.Vector3(0, 0.64, 0));
  state.dropT = 0;
  state.dropPlayer = player;
  state.dropTarget = targetPoint;
  state.dropFromPoint = fromPoint;
  state.dropReserveIndex = reserveIndex;
  state.inputLocked = true;
  setStatus(`${player.toUpperCase()} piece is moving...`);
}
function updateDropAnimation(dt) {
  if (!state.dropActive || !state.dropMesh) return;
  state.dropT += dt / 0.45;
  const t = Math.min(1, state.dropT);
  const smooth = t * t * (3 - 2 * t);
  const pos = state.dropStart.clone().lerp(state.dropEnd, smooth);
  pos.y += Math.sin(t * Math.PI) * 0.65;
  state.dropMesh.position.copy(pos);
  if (t < 1) return;

  const player = state.dropPlayer, target = state.dropTarget, from = state.dropFromPoint;
  scene.remove(state.dropMesh);
  state.dropMesh.geometry.dispose();
  state.dropActive = false;
  state.dropMesh = null;
  state.inputLocked = false;
  state.dropReserveIndex = -1;

  let madeTrain = false;
  if (from) madeTrain = commitMove(from, target, player);
  else {
    commitPlace(target, player);
    const madeLines = LINES.filter(line => line.includes(target) && line.every(id => state.board[id] === player));
    madeTrain = madeLines.length > 0;
    if (madeTrain) {
      markTrainLinesUsed(madeLines, player);
      state.captureMode = true;
    }
  }
  if (player === "stick" && from) rememberAIMove(from, target);
  state.selectedPoint = null;
  updateVisuals();
  if (madeTrain) {
    const targets = captureTargets(player);
    if (!targets.length) {
      state.captureMode = false;
      setStatus(`${player.toUpperCase()} made a train, but there is no legal capture because every opponent piece is currently in a train.`);
      setTimeout(switchTurn, 650);
      return;
    }
    setStatus(`${player.toUpperCase()} made a train. Capture one opponent piece.`);
    if (player === "stick") maybeRunAI();
  } else switchTurn();
}

function maybeRunAI() {
  if (!state.aiEnabled || state.winner || state.aiBusy || state.dropActive || state.currentPlayer !== "stick") return;
  state.aiBusy = true;
  state.inputLocked = true;
  setStatus(`AI STICK (${state.difficulty.toUpperCase()}) is choosing the best move...`);
  setTimeout(runAI, 350);
}
function runAI() {
  if (state.winner || state.currentPlayer !== "stick") { state.aiBusy = false; state.inputLocked = false; return; }
  if (state.captureMode) {
    const target = chooseCapture("stick");
    if (target) {
      setTimeout(() => {
        const won = commitCapture(target, "stick");
        state.aiBusy = false;
        state.inputLocked = false;
        if (!won) switchTurn();
      }, 250);
      return;
    }
  }
  if (state.phase === "placing") {
    const point = choosePlacement("stick");
    if (point) { state.aiBusy = false; startDropAnimation("stick", point, null, state.placed.stick); return; }
  } else {
    const move = chooseMove("stick");
    if (move) { state.aiBusy = false; startDropAnimation("stick", move[1], move[0], -1); return; }
  }
  state.aiBusy = false;
  state.inputLocked = false;
}
function wouldBlockLineByPlacing(point, player) {
  const enemy = opp(player);
  return LINES.some(line => line.includes(point) && line.filter(id => state.board[id] === enemy).length === 2 && line.filter(id => state.board[id] === null).length === 1);
}
function placementCreatesFutureThreat(point, player) {
  state.board[point] = player;
  const score = LINES.reduce((sum, line) => {
    const mine = line.filter(id => state.board[id] === player).length;
    const empty = line.filter(id => state.board[id] === null).length;
    return sum + (mine === 2 && empty === 1 ? 1 : 0);
  }, 0);
  state.board[point] = null;
  return score;
}
function choosePlacement(player) {
  const legal = validPlacements(player);
  if (!legal.length) return null;
  if (difficultyLevel() === "easy" && Math.random() < 0.35) return legal[Math.floor(Math.random() * legal.length)];
  const scored = legal.map(pt => {
    let score = 0;
    score += ADJ.get(pt).length * 5;
    score += wouldBlockLineByPlacing(pt, player) ? 90 : 0;
    score += placementCreatesFutureThreat(pt, player) * 22;
    score += centerPreference(pt);
    if (difficultyLevel() !== "hard") score += Math.random() * 3.5;
    return [pt, score];
  }).sort((a,b) => b[1] - a[1]);
  if (difficultyLevel() === "mid" && Math.random() < 0.16 && scored[1]) return scored[1][0];
  return scored[0][0];
}
function centerPreference(point) {
  const p = pointPosition(point);
  return 10 - Math.sqrt(p.x * p.x + p.z * p.z);
}
function moveFormsTrain(from, to, player) {
  state.board[from] = null; state.board[to] = player;
  const forms = !!findTrainThrough(player, to);
  state.board[to] = null; state.board[from] = player;
  return forms;
}
function moveBlocksEnemy(from, to, player) {
  const enemy = opp(player);
  state.board[from] = null; state.board[to] = player;
  const blocks = LINES.some(line => line.includes(to) && line.filter(id => state.board[id] === enemy).length === 2 && line.filter(id => state.board[id] === player).length === 1);
  state.board[to] = null; state.board[from] = player;
  return blocks;
}
function moveOpensEnemyTrain(from, to, player) {
  const enemy = opp(player);
  state.board[from] = null; state.board[to] = player;
  const opens = allValidMoves(enemy).some(([efrom, eto]) => moveFormsTrain(efrom, eto, enemy));
  state.board[to] = null; state.board[from] = player;
  return opens;
}
function moveMobilityChange(from, to, player) {
  const before = allValidMoves(player).length;
  state.board[from] = null; state.board[to] = player;
  const after = allValidMoves(player).length;
  state.board[to] = null; state.board[from] = player;
  return after - before;
}
function sameAsRecentAIMove(from, to) {
  return state.recentAIMoves.some(m => m.from === from && m.to === to);
}
function isReverseOfLastAIMove(from, to) {
  return state.lastAIMove && state.lastAIMove.from === to && state.lastAIMove.to === from;
}
function rememberAIMove(from, to) {
  state.lastAIMove = { from, to };
  state.recentAIMoves.push({ from, to });
  if (state.recentAIMoves.length > 6) state.recentAIMoves.shift();
}
function evaluateBoardFor(player) {
  const enemy = opp(player);
  let score = 0;
  score += (getPiecesOnBoard(player) - getPiecesOnBoard(enemy)) * 420;
  score += (trainsFor(player).length - trainsFor(enemy).length) * 900;
  score += (allValidMoves(player).length - allValidMoves(enemy).length) * 22;
  for (const id of POINT_IDS) {
    if (state.board[id] === player) score += centerPreference(id) * 6 + ADJ.get(id).length * 8;
    if (state.board[id] === enemy) score -= centerPreference(id) * 6 + ADJ.get(id).length * 8;
  }
  for (const line of LINES) {
    const mine = line.filter(id => state.board[id] === player).length;
    const theirs = line.filter(id => state.board[id] === enemy).length;
    const empty = line.filter(id => state.board[id] === null).length;
    if (mine === 2 && empty === 1) score += 180;
    if (theirs === 2 && empty === 1) score -= 220;
  }
  return score;
}
function cloneUsedTrainLines() {
  return { stone: new Set(state.usedTrainLines.stone), stick: new Set(state.usedTrainLines.stick) };
}
function restoreUsedTrainLines(saved) {
  state.usedTrainLines = { stone: new Set(saved.stone), stick: new Set(saved.stick) };
}
function withSimulatedMove(from, to, player, callback) {
  const savedUsed = cloneUsedTrainLines();
  const oldFrom = state.board[from];
  const oldTo = state.board[to];
  state.board[from] = null;
  state.board[to] = player;
  const madeLines = LINES.filter(line => line.includes(to) && line.every(id => state.board[id] === player));
  if (madeLines.length) markTrainLinesUsed(madeLines, player);
  let result;
  try { result = callback(madeLines); }
  finally {
    state.board[from] = oldFrom;
    state.board[to] = oldTo;
    restoreUsedTrainLines(savedUsed);
  }
  return result;
}
function withSimulatedCapture(point, capturer, callback) {
  const old = state.board[point];
  state.board[point] = null;
  let result;
  try { result = callback(); }
  finally { state.board[point] = old; }
  return result;
}
function minimax(depth, turn, maximizingPlayer, alpha = -Infinity, beta = Infinity) {
  if (depth <= 0) return evaluateBoardFor(maximizingPlayer);
  const moves = allValidMoves(turn);
  if (!moves.length) return turn === maximizingPlayer ? -100000 : 100000;
  const maximizing = turn === maximizingPlayer;
  let best = maximizing ? -Infinity : Infinity;
  for (const [from, to] of moves) {
    const score = withSimulatedMove(from, to, turn, madeLines => {
      if (madeLines.length) {
        const caps = captureCandidates(turn);
        if (!caps.length) return minimax(depth - 1, opp(turn), maximizingPlayer, alpha, beta);
        let capBest = maximizing ? -Infinity : Infinity;
        for (const cap of caps) {
          const capScore = withSimulatedCapture(cap, turn, () => minimax(depth - 1, opp(turn), maximizingPlayer, alpha, beta));
          capBest = maximizing ? Math.max(capBest, capScore) : Math.min(capBest, capScore);
        }
        return capBest;
      }
      return minimax(depth - 1, opp(turn), maximizingPlayer, alpha, beta);
    });
    if (maximizing) { best = Math.max(best, score); alpha = Math.max(alpha, best); }
    else { best = Math.min(best, score); beta = Math.min(beta, best); }
    if (beta <= alpha) break;
  }
  return best;
}
function chooseMove(player) {
  const moves = allValidMoves(player);
  if (!moves.length) return null;
  if (difficultyLevel() === "easy" && Math.random() < 0.38) return moves[Math.floor(Math.random() * moves.length)];
  const scored = moves.map(([from, to]) => {
    let score = 0;
    if (difficultyLevel() === "hard") {
      score = withSimulatedMove(from, to, player, madeLines => {
        let after = evaluateBoardFor(player);
        if (madeLines.length) {
          const caps = captureCandidates(player);
          if (caps.length) {
            after = Math.max(...caps.map(cap => withSimulatedCapture(cap, player, () => evaluateBoardFor(player))));
          }
        }
        return after + minimax(3, opp(player), player) * 0.92;
      });
    } else {
      if (moveFormsTrain(from, to, player)) score += 1000;
      if (moveBlocksEnemy(from, to, player)) score += 180;
      if (moveOpensEnemyTrain(from, to, player)) score -= 220;
      score += ADJ.get(to).length * 12;
      score += centerPreference(to) * 3;
      score += moveMobilityChange(from, to, player) * 20;
      if (isReverseOfLastAIMove(from, to)) score -= 400;
      if (sameAsRecentAIMove(from, to)) score -= 260;
      if (state.lastAIMove && state.lastAIMove.to === from) score -= 120;
      score += Math.random() * 4;
    }
    return [[from, to], score];
  }).sort((a,b) => b[1] - a[1]);
  if (difficultyLevel() === "mid" && Math.random() < 0.13 && scored[1]) return scored[1][0];
  return scored[0][0];
}
function chooseCapture(player) {
  const targets = captureTargets(player);
  if (!targets.length) return null;
  if (difficultyLevel() === "easy" && Math.random() < 0.34) return targets[Math.floor(Math.random() * targets.length)];
  const enemy = opp(player);
  const scored = targets.map(pt => {
    let score = 0;
    score += ADJ.get(pt).length * 8;
    score += LINES.filter(line => line.includes(pt) && line.filter(id => state.board[id] === enemy).length >= 2).length * 70;
    score += isPointInTrain(enemy, pt) ? -1000 : 0;
    state.board[pt] = null;
    score += allValidMoves(enemy).length * -5;
    score += evaluateBoardFor(player) * 0.25;
    state.board[pt] = enemy;
    if (difficultyLevel() !== "hard") score += Math.random() * 5;
    return [pt, score];
  }).sort((a,b) => b[1] - a[1]);
  if (difficultyLevel() === "mid" && Math.random() < 0.12 && scored[1]) return scored[1][0];
  return scored[0][0];
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const tablePickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.66);
const pointerWorld = new THREE.Vector3();
let hoveredPoint = null;
let lastHoverTime = 0;

function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}
function findNearestPointFromPointer(event, sticky = true) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hitTable = raycaster.ray.intersectPlane(tablePickPlane, pointerWorld);
  if (!hitTable) return sticky ? hoveredPoint : null;
  let bestPoint = null, bestDist = Infinity;
  for (const id of POINT_IDS) {
    const p = pointPosition(id);
    const dx = pointerWorld.x - p.x;
    const dz = pointerWorld.z - p.z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) { bestDist = dist; bestPoint = id; }
  }
  const radius = isSmallScreen() ? 1.95 : 1.28;
  if (bestDist <= radius * radius) {
    lastHoverTime = performance.now();
    return bestPoint;
  }
  if (sticky && hoveredPoint && performance.now() - lastHoverTime < 1200) return hoveredPoint;
  return null;
}
renderer.domElement.addEventListener("pointermove", e => {
  hoveredPoint = findNearestPointFromPointer(e, true);
  updateVisuals();
});
renderer.domElement.addEventListener("pointerdown", e => {
  e.preventDefault();
  hoveredPoint = findNearestPointFromPointer(e, true);
  lastHoverTime = performance.now();
  updateVisuals();
  handlePoint(hoveredPoint);
});

function updateVisuals() {
  const player = state.currentPlayer;
  const legalPlacements = new Set(state.phase === "placing" && !state.captureMode ? validPlacements(player) : []);
  const legalMoves = new Set(state.selectedPoint ? validMoveDests(state.selectedPoint, player) : []);
  const captures = new Set(state.captureMode ? captureTargets(player) : []);
  for (const [id, mesh] of pointMeshes.entries()) {
    const active = id === hoveredPoint;
    const selected = id === state.selectedPoint;
    mesh.scale.setScalar(active ? 1.85 : selected ? 1.65 : 1.25);
    if (active) mesh.material.color.set(0xfff36d);
    else if (selected) mesh.material.color.set(0xffffff);
    else if (state.captureMode && captures.has(id)) mesh.material.color.set(0xe65252);
    else if (state.phase === "placing" && legalPlacements.has(id)) mesh.material.color.set(0x29d371);
    else if (state.selectedPoint && legalMoves.has(id)) mesh.material.color.set(0x7bd7ff);
    else mesh.material.color.set(0x8b6230);
  }
  for (const [id, mesh] of pieceMeshes.entries()) {
    if (state.captureMode && captures.has(id)) { mesh.material.color.set(0xe65252); mesh.scale.setScalar(id === hoveredPoint ? 1.32 : 1.12); }
    else if (id === state.selectedPoint) { mesh.material.color.set(0xfff36d); mesh.scale.setScalar(1.18); }
    else { mesh.material.color.set(mesh.userData.player === "stone" ? 0x0f1418 : 0xff0000); mesh.scale.setScalar(id === hoveredPoint ? 1.16 : 1.04); }
  }
  document.getElementById("stonePlaced").textContent = state.placed.stone;
  document.getElementById("stickPlaced").textContent = state.placed.stick;
  document.getElementById("stonePieces").textContent = getPiecesOnBoard("stone");
  document.getElementById("stickPieces").textContent = getPiecesOnBoard("stick");
  document.getElementById("turnBadge").textContent = state.winner ? `${state.winner.toUpperCase()} WINS` : state.currentPlayer.toUpperCase();
}
function setStatus(text) { document.getElementById("status").textContent = state.winner ? `${state.winner.toUpperCase()} WINS! Press New Game.` : text; }
function playTone(freq, seconds) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = playTone.ctx || new AC(); playTone.ctx = ctx;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.045;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + seconds);
  } catch {}
}

function resetGame() {
  POINT_IDS.forEach(id => state.board[id] = null);
  Object.assign(state, {
    currentPlayer: "stone", phase: "placing", captured: { stone: 0, stick: 0 }, captureMode: false,
    selectedPoint: null, winner: null, aiBusy: false, inputLocked: false, dropActive: false, dropMesh: null,
    lastAIMove: null, recentAIMoves: [], usedTrainLines: { stone: new Set(), stick: new Set() }
  });
  state.placed = { stone: 0, stick: 0 };
  clearBoardPieces();
  clearCapturedTrayPieces();
  showAllReservePieces();
  hoveredPoint = null;
  updateVisuals();
  hideVictoryOverlay();
  setStatus("Placing phase — STONE starts. Tap/click a green circle to place.");
}

document.getElementById("newGameBtn").addEventListener("click", resetGame);
playAgainOverlayBtn.addEventListener("click", resetGame);
document.getElementById("aiBtn").addEventListener("click", () => {
  state.aiEnabled = !state.aiEnabled;
  document.getElementById("aiBtn").textContent = `AI: ${state.aiEnabled ? "ON" : "OFF"}`;
  if (state.aiEnabled) { setStatus("AI mode is ON. Human controls STONE; AI controls STICK."); maybeRunAI(); }
  else setStatus("AI mode is OFF. Human controls both STONE and STICK.");
});

function refreshLevelButtons() {
  document.getElementById("levelEasy").classList.toggle("active", state.difficulty === "easy");
  document.getElementById("levelMid").classList.toggle("active", state.difficulty === "mid");
  document.getElementById("levelHard").classList.toggle("active", state.difficulty === "hard");
}
function setDifficulty(level) {
  state.difficulty = level;
  refreshLevelButtons();
  setStatus(`AI level is now ${state.difficulty.toUpperCase()}. Press New Game to start fresh with this level.`);
  updateVisuals();
}
document.getElementById("levelEasy").addEventListener("click", () => setDifficulty("easy"));
document.getElementById("levelMid").addEventListener("click", () => setDifficulty("mid"));
document.getElementById("levelHard").addEventListener("click", () => setDifficulty("hard"));
refreshLevelButtons();
document.getElementById("helpBtn").addEventListener("click", () => {
  const help = document.getElementById("help");
  const hud = document.getElementById("hud");
  const isOpening = help.classList.contains("hidden");
  help.classList.toggle("hidden");
  hud.classList.toggle("help-open", isOpening);
});
document.getElementById("cameraBtn").addEventListener("click", resetCamera);
function resizeGame() {
  const { width, height } = getViewportSize();
  renderer.setSize(width, height, false);
  updateCameraFrustum();
  resetCamera();
}
window.addEventListener("resize", resizeGame);
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeGame);

let lastTime = performance.now();
function animate(now = performance.now()) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  updateDropAnimation(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

createBoard();
createReservePieces();
resetGame();
animate();
