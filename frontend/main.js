// 全局状态区
let ws = null;
let currentRoomId = "";
let currentPlayerName = "";
let players = [];
const PLAYER_EMOJIS = [
  "🟡", "🟢", "🔵", "🟣", "🧡",
  "⭐️", "🌙", "🍀", "🔥", "🎨",
  "🐱", "🐶", "🐼", "🐸", "🐧"
];

let myPlayerIndex = null;
let isHost = false;

// waiting / playing / revealing
let gamePhase = "waiting"; 


let currentTask = null;


let canvas = null;
let ctx = null;
let drawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawing = false;
// "pen" / "eraser"
let drawMode = "pen"; 
let canvasInitialized = false;

// 是否处于“画画阶段”（用来控制弹幕和聊天显示）
let isDrawingPhase = false;

// 回放 & 评分
let revealChains = [];
let currentChainIndex = 0;
let currentChainId = null;

// 工具函数：视图切换
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.add("active");
}

// 连接 WebSocket 并 join
function connectWs(roomId, name) {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${location.host}/ws/${encodeURIComponent(roomId)}`;

  currentRoomId = roomId;
  currentPlayerName = name;

  ws = new WebSocket(url);

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "join",
        name: currentPlayerName,
      })
    );
    appendChatSystem(`已连接到房间 ${roomId}`);
    document.getElementById("room-id-display").textContent = `房间：${roomId}`;
    document.getElementById(
      "self-name-display"
    ).textContent = `你是：${currentPlayerName}`;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.error("解析消息失败:", e);
    }
  };

  ws.onclose = () => {
    appendChatSystem("与服务器连接已断开。");
  };

  ws.onerror = (err) => {
    console.error("WebSocket 错误:", err);
    appendChatSystem("连接发生错误。");
  };
}

// 处理服务器消息
function handleMessage(msg) {
  switch (msg.type) {
    case "player_joined":
      players = msg.players || [];
      updateMyPlayerIndex();
      updatePlayersUI();
      appendChatSystem("有新玩家加入。");
      break;

    case "player_left":
      players = players.filter((p) => p.name !== msg.name);
      updatePlayersUI();
      appendChatSystem(`${msg.name} 离开了房间。`);
      break;

    case "game_started":
      gamePhase = "playing";
      setRoomStatus("游戏进行中");
      appendChatSystem("游戏开始！");
      break;

    case "task_assigned":
      gamePhase = "playing";
      currentTask = msg;
      updateTaskUI();
      break;

    case "step_submitted":
      appendChatSystem(
        `一名玩家提交了${msg.stepType === "word" ? "词语" : "画"}。`
      );
      break;

    case "reveal_all":
      gamePhase = "revealing";
      revealChains = msg.chains || [];
      currentChainIndex = 0;
      switchView("reveal");
      showCurrentChain();
      break;

    case "chat":
      // 聊天列表
      appendChatLine(msg.playerName, msg.content);
      // 画画阶段：弹幕
      if (isDrawingPhase) {
        spawnDanmaku(`${msg.playerName}: ${msg.content}`);
      }
      break;

    case "chain_rated":
      handleChainRated(msg);
      break;

    case "room_reset":
      handleRoomReset();
      break;

    case "error":
      alert(msg.message || "发生错误");
      break;

    default:
      console.log("未知消息类型:", msg);
  }
}

// 更新自己在 players 中的索引 & 是否房主
function updateMyPlayerIndex() {
  myPlayerIndex = null;
  players.forEach((p) => {
    if (p.name === currentPlayerName && myPlayerIndex === null) {
      myPlayerIndex = p.index;
    }
  });
  isHost = myPlayerIndex === 0;
  const btnStart = document.getElementById("btn-start-game");
  const btnRestart = document.getElementById("btn-restart-game");
  if (btnStart) btnStart.style.display = isHost ? "inline-flex" : "none";
  if (btnRestart) btnRestart.style.display = isHost ? "inline-flex" : "none";
}

// 玩家列表 UI
function updatePlayersUI() {
  const ul = document.getElementById("player-list");
  if (!ul) return;
  ul.innerHTML = "";
  players.forEach((p, idx) => {
    const li = document.createElement("li");
    if (p.index === myPlayerIndex) li.classList.add("me");

    const avatar = document.createElement("span");
    avatar.className = "player-avatar";

    const emoji = PLAYER_EMOJIS[p.index % PLAYER_EMOJIS.length];
    avatar.textContent = emoji;
    li.appendChild(avatar);


    const nameSpan = document.createElement("span");
    nameSpan.className = "player-name";
    nameSpan.textContent = p.name;
    li.appendChild(nameSpan);

    if (idx === 0) {
      const tag = document.createElement("span");
      tag.className = "player-tag";
      tag.textContent = "房主";
      li.appendChild(tag);
    } else if (p.index === myPlayerIndex) {
      const tag = document.createElement("span");
      tag.className = "player-tag";
      tag.textContent = "你";
      li.appendChild(tag);
    }

    ul.appendChild(li);
  });
}

// 房间状态文本
function setRoomStatus(text) {
  const el = document.getElementById("room-status");
  if (el) el.textContent = text;
}

// 聊天 UI
function appendChatLine(name, content) {
  const box = document.getElementById("chat-messages");
  if (!box) return;
  const div = document.createElement("div");
  div.className = "chat-line";
  const nameSpan = document.createElement("span");
  nameSpan.className = "name";
  nameSpan.textContent = name + "：";
  div.appendChild(nameSpan);
  const textSpan = document.createElement("span");
  textSpan.textContent = content;
  div.appendChild(textSpan);
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function appendChatSystem(content) {
  const box = document.getElementById("chat-messages");
  if (!box) return;
  const div = document.createElement("div");
  div.className = "chat-line system";
  div.textContent = content;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// 控制聊天显示：只隐藏历史消息，保留输入框
function toggleChatVisibility() {
  const messages = document.getElementById("chat-messages");
  const title = document.getElementById("chat-title");
  if (!messages || !title) return;
  if (isDrawingPhase) {
    messages.style.display = "none";
    title.textContent = "聊天（当前消息只会以弹幕形式显示在画布上）";
  } else {
    messages.style.display = "";
    title.textContent = "聊天（画画时消息只会以弹幕形式显示在画布上）";
  }
}

// 任务 UI（写词/画画/等待）
function updateTaskUI() {
  const titleEl = document.getElementById("task-title");
  const descEl = document.getElementById("task-desc");
  const wordPanel = document.getElementById("word-panel");
  const drawingPanel = document.getElementById("drawing-panel");
  const waitingPanel = document.getElementById("waiting-panel");

  wordPanel.classList.add("hidden");
  drawingPanel.classList.add("hidden");
  waitingPanel.classList.add("hidden");

  // 默认不是画画阶段
  isDrawingPhase = false;
  toggleChatVisibility();

  if (!currentTask) {
    titleEl.textContent = "等待开始";
    descEl.textContent = "等待房主开始游戏。";
    waitingPanel.classList.remove("hidden");
    return;
  }

  const stepIndex = currentTask.stepIndex;
  const taskType = currentTask.taskType;

  if (taskType === "word") {
    titleEl.textContent = `第 ${stepIndex} 步：写词`;
    if (currentTask.prevStepType === "drawing") {
      descEl.textContent = "根据上一位玩家的画，写出你认为的词语。";
    } else {
      descEl.textContent = "输入你的起始词语（不要告诉其他玩家）。";
    }
    wordPanel.classList.remove("hidden");
    waitingPanel.classList.add("hidden");
    drawingPanel.classList.add("hidden");
    const wordInput = document.getElementById("word-input");
    if (wordInput) wordInput.value = "";
  } else if (taskType === "drawing") {
    titleEl.textContent = `第 ${stepIndex} 步：画画`;
    const prevWord = currentTask.prevWord;
    if (prevWord) {
      descEl.textContent = `根据词语「${prevWord}」画一幅画。不要写字！`;
    } else {
      descEl.textContent = "根据上一位玩家的内容画一幅画。";
    }
    drawingPanel.classList.remove("hidden");
    waitingPanel.classList.add("hidden");
    ensureCanvas();
    clearCanvas();
    isDrawingPhase = true;
    toggleChatVisibility();
  } else {
    titleEl.textContent = "等待中";
    descEl.textContent = "请等待其他玩家完成本轮任务。";
    waitingPanel.classList.remove("hidden");
  }
}

// 画布初始化
function ensureCanvas() {
  if (canvasInitialized) return;
  canvasInitialized = true;
  canvas = document.getElementById("drawingCanvas");
  if (!canvas) return;

  const wrapper = canvas.parentElement;
  const wrapperWidth = wrapper.clientWidth || 800;
  const displayHeight = 480;
  const ratio = window.devicePixelRatio || 1;

  canvas.style.width = wrapperWidth + "px";
  canvas.style.height = displayHeight + "px";
  canvas.width = wrapperWidth * ratio;
  canvas.height = displayHeight * ratio;

  ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  clearCanvas();

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return {
        x: e.touches[0].clientX - r.left,
        y: e.touches[0].clientY - r.top,
      };
    }
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    hasDrawing = true;
    const p = getPos(e);
    lastX = p.x;
    lastY = p.y;
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = getPos(e);
    const size = document.getElementById("sizeRange").value || 6;

    if (drawMode === "pen") {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle =
        document.getElementById("colorPicker").value || "#000000";
    } else {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    }
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
  }

  function end() {
    drawing = false;
  }

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseup", end);
  canvas.addEventListener("mouseleave", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);
}

function clearCanvas() {
  if (!ctx || !canvas) return;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  hasDrawing = false;
}

// 弹幕：在画布上创建一条从右向左移动的文本
function spawnDanmaku(text) {
  const layer = document.getElementById("danmaku-layer");
  if (!layer) return;

  const item = document.createElement("div");
  item.className = "danmaku-item";
  item.textContent = text;

  const h = layer.clientHeight || 480;
  const rowHeight = 26;
  const maxRows = Math.max(1, Math.floor(h / rowHeight));
  const rowIndex = Math.floor(Math.random() * maxRows);
  const top = 4 + rowIndex * rowHeight;

  item.style.top = `${top}px`;
  const duration = 10 + Math.random() * 5; // 10~15 秒
  item.style.animationDuration = `${duration}s`;

  item.addEventListener("animationend", () => {
    item.remove();
  });

  layer.appendChild(item);
}

// 回放：显示当前链
function showCurrentChain() {
  const progressEl = document.getElementById("reveal-progress");
  const stepsBox = document.getElementById("reveal-steps-list");
  const imgEl = document.getElementById("reveal-image");
  const wordEl = document.getElementById("reveal-word");
  const voteResultEl = document.getElementById("vote-result");
  const nextBtn = document.getElementById("btn-next-chain");

  if (!revealChains || !revealChains.length) {
    if (progressEl) progressEl.textContent = "没有接龙结果。";
    return;
  }

  if (currentChainIndex >= revealChains.length) {
    progressEl.textContent = "本局所有接龙已经评判完毕 🎉";
    imgEl.style.display = "none";
    imgEl.src = "";
    wordEl.textContent = "感谢参与！";
    nextBtn.disabled = true;
    return;
  }

  const ch = revealChains[currentChainIndex];
  currentChainId = ch.chainId;

  if (progressEl) {
    progressEl.textContent = `接龙 ${currentChainIndex + 1} / ${
      revealChains.length
    }（起始玩家 #${ch.ownerIndex}）`;
  }

  stepsBox.innerHTML = "";
  (ch.steps || []).forEach((st) => {
    const row = document.createElement("div");
    row.className = "step-row";
    const who = `P${st.fromPlayerIndex} → P${st.toPlayerIndex}`;
    if (st.type === "word") {
      row.textContent = `${who}：${st.word || "(空)"}`;
    } else {
      row.innerHTML = `${who}<br/><img src="${
        st.drawingId || ""
      }" class="step-img" />`;
    }
    stepsBox.appendChild(row);
  });

  const last = ch.steps[ch.steps.length - 1];
  if (last.type === "drawing") {
    imgEl.style.display = "block";
    imgEl.src = last.drawingId || "";
    wordEl.textContent = "";
  } else {
    imgEl.style.display = "none";
    imgEl.src = "";
    wordEl.textContent = last.word || "";
  }

  voteResultEl.textContent = "等待大家投票...";
  nextBtn.disabled = true;
}

// 处理评分结果广播
function handleChainRated(msg) {
  if (msg.chainId !== currentChainId) return;
  const { okCount, badCount, totalPlayers, finished } = msg;
  const el = document.getElementById("vote-result");
  el.textContent = `√ ${okCount} 票 / × ${badCount} 票（共 ${totalPlayers} 人）`;

  if (finished) {
    const final =
      okCount > badCount
        ? "✅ 这条接龙总体是合理的"
        : okCount < badCount
        ? "❌ 这条接龙已经走偏了"
        : "➖ 票数持平";
    const detail = document.createElement("div");
    detail.textContent = final;
    el.appendChild(detail);
    const btnNext = document.getElementById("btn-next-chain");
    btnNext.disabled = false;
  }
}

// 重置房间
function handleRoomReset() {
  gamePhase = "waiting";
  currentTask = null;
  revealChains = [];
  currentChainIndex = 0;
  currentChainId = null;
  isDrawingPhase = false;
  toggleChatVisibility();
  setRoomStatus("等待中");
  updateTaskUI();
  switchView("room");
  appendChatSystem("房间已重置，可以重新开始游戏。");
}

// DOM 事件绑定
document.addEventListener("DOMContentLoaded", () => {
  // 欢迎页：进入房间
  document.getElementById("btn-enter-room").addEventListener("click", () => {
    const nameInput = document.getElementById("welcome-name");
    const roomInput = document.getElementById("welcome-room");
    const name = nameInput.value.trim() || "玩家";
    const roomId = roomInput.value.trim() || "1";

    connectWs(roomId, name);
    switchView("room");
  });

  // 开始游戏
  document.getElementById("btn-start-game").addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!isHost) {
      alert("只有房主可以开始游戏。");
      return;
    }
    ws.send(JSON.stringify({ type: "start_game" }));
  });

  // 重新开局
  document.getElementById("btn-restart-game").addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!isHost) {
      alert("只有房主可以重新开局。");
      return;
    }
    ws.send(JSON.stringify({ type: "restart" }));
  });

  // 发送聊天
  document.getElementById("btn-chat-send").addEventListener("click", () => {
    sendChat();
  });
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
  });

  // 提交词语
  document.getElementById("btn-submit-word").addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentTask || currentTask.taskType !== "word") return;
    const input = document.getElementById("word-input");
    const word = input.value.trim();
    if (!word) {
      alert("请输入词语。");
      return;
    }
    ws.send(
      JSON.stringify({
        type: "submit_word",
        chainId: currentTask.chainId,
        word,
      })
    );
    currentTask = null;
    updateTaskUI();
  });

  // 画布相关按钮
  document.getElementById("btn-eraser").addEventListener("click", () => {
    drawMode = drawMode === "pen" ? "eraser" : "pen";
    const btn = document.getElementById("btn-eraser");
    if (drawMode === "eraser") {
      btn.classList.add("active");
      btn.textContent = "返回画笔";
    } else {
      btn.classList.remove("active");
      btn.textContent = "橡皮擦";
    }
  });

  document.getElementById("btn-clear").addEventListener("click", () => {
    clearCanvas();
  });

  document
    .getElementById("btn-submit-drawing")
    .addEventListener("click", () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!currentTask || currentTask.taskType !== "drawing") return;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL("image/png");
      ws.send(
        JSON.stringify({
          type: "submit_drawing",
          chainId: currentTask.chainId,
          drawingId: dataUrl,
        })
      );
      currentTask = null;
      updateTaskUI();
    });

  // 投票按钮
  document.getElementById("btn-vote-ok").addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentChainId) return;
    ws.send(
      JSON.stringify({
        type: "rate_chain",
        chainId: currentChainId,
        isOk: true,
      })
    );
  });

  document.getElementById("btn-vote-bad").addEventListener("click", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentChainId) return;
    ws.send(
      JSON.stringify({
        type: "rate_chain",
        chainId: currentChainId,
        isOk: false,
      })
    );
  });

  // 下一条接龙
  document.getElementById("btn-next-chain").addEventListener("click", () => {
    currentChainIndex++;
    showCurrentChain();
  });

  // 回放页返回房间按钮
  document.getElementById("btn-back-to-room").addEventListener("click", () => {
    switchView("room");
  });
});

// 发送聊天
function sendChat() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const input = document.getElementById("chat-input");
  const content = input.value.trim();
  if (!content) return;
  ws.send(
    JSON.stringify({
      type: "chat",
      content,
    })
  );
  input.value = "";
}
