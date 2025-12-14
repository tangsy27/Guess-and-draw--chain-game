# main.py（新的后端示例）

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from typing import Dict, List, Optional
from pydantic import BaseModel
import asyncio
import uuid
import time
import uvicorn

# ===== 数据结构 =====

class Step(BaseModel): # step记录步骤
    index: int
    from_player_index: int
    to_player_index: int
    type: str  # "word" or "drawing"
    word: Optional[str] = None
    drawing_id: Optional[str] = None

class Chain(BaseModel): # 记录是哪条流程
    id: str
    owner_index: int
    steps: List[Step] = [] # steps是一个list

class Player:
    def __init__(self, player_id: str, name: str, index: int, websocket: WebSocket):
        self.id = player_id
        self.name = name
        self.index = index
        self.websocket = websocket # 这个和每个客户端绑定

class Room:
    def __init__(self, room_id: str):
        self.id = room_id
        self.players: List[Player] = [] # 上面自定义了player类
        self.chains: List[Chain] = []
        self.step_index: int = 0
        self.max_steps: Optional[int] = None
        self.phase: str = "waiting"    # waiting / playing / revealing / finished
        self.lock = asyncio.Lock()
        # 新增：评分数据：chainId -> { player_index: bool(√=True / ×=False) }
        self.ratings: Dict[str, Dict[int, bool]] = {}

    @property # @装饰器 decorator 把方法变成属性 可以用.操作
    def player_count(self) -> int:
        return len(self.players)

    async def broadcast(self, message: dict): # 定义广播方法
        for p in list(self.players):
            try:
                await p.websocket.send_json(message)  #发送 循环单播实现广播
            except Exception:
                pass

    def find_chain(self, chain_id: str) -> Optional[Chain]:
        for c in self.chains:
            if c.id == chain_id:
                return c
        return None

    def all_chains_have_step(self, step_index: int) -> bool:
        for c in self.chains: # 遍历所有的 Chain 对象 c是chain类的实例
            if len(c.steps) <= step_index:  # 判断该 Chain 对象是否包含足够的步骤 steps定义为一个list
                return False # 如果某个 Chain 不包含 step_index 这个步骤，返回 False
        return True # 如果所有 Chain 都包含至少 step_index 步骤，返回 True

    async def dispatch_next_tasks(self):
        """根据当前 step_index 安排下一轮任务"""
        s = self.step_index
        task_type = "word" if s % 2 == 0 else "drawing"

        for chain in self.chains:
            p_index = (chain.owner_index + s) % self.player_count
            player = self.players[p_index]

            prev_step = chain.steps[s - 1] if s > 0 and len(chain.steps) >= s else None

            payload = {
                "type": "task_assigned",
                "roomId": self.id,
                "chainId": chain.id,
                "stepIndex": s,
                "taskType": task_type,
            }

            if prev_step is not None:
                payload["prevStepType"] = prev_step.type
                payload["prevWord"] = prev_step.word
                payload["prevDrawingId"] = prev_step.drawing_id
                payload["fromPlayerIndex"] = prev_step.from_player_index

            await player.websocket.send_json(payload) # 单播

    async def reveal_all(self):
        """揭晓所有链的完整内容"""
        result = []
        for chain in self.chains:
            chain_data = {
                "chainId": chain.id,
                "ownerIndex": chain.owner_index,
                "steps": []
            }
            for st in chain.steps:
                chain_data["steps"].append({
                    "index": st.index,
                    "fromPlayerIndex": st.from_player_index,
                    "toPlayerIndex": st.to_player_index,
                    "type": st.type,
                    "word": st.word,
                    "drawingId": st.drawing_id,
                })
            result.append(chain_data)

        await self.broadcast({
            "type": "reveal_all",
            "roomId": self.id,
            "chains": result
        }) # 等待整个广播循环完成
        # 客户端收到后进入“评分模式”

    def reset(self):
        self.chains = []
        self.step_index = 0
        self.max_steps = None
        self.phase = "waiting"
        self.ratings = {}

# ===== FastAPI 应用 =====

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态前端
app.mount("/static", StaticFiles(directory="frontend", html=True), name="static")

@app.get("/", response_class=HTMLResponse)
async def root():
    # 前端打包后的 index.html
    with open("frontend/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

rooms: Dict[str, Room] = {} # 定义字典 str字符串类型 Room自定义类结构

async def get_or_create_room(room_id: str) -> Room:
    if room_id not in rooms:
        rooms[room_id] = Room(room_id)
    return rooms[room_id]

# ---- WebSocket：房间逻辑 ----
@app.websocket("/ws/{room_id}") # 路由 当到room_id的时候这里会被触发
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    await websocket.accept() # 接受客户端 accept之后才有send和receive
    # accept就是三次握手和协议升级 后续还是ping pong心跳机制 只是比http占带宽少

    room = await get_or_create_room(room_id)
    player: Optional[Player] = None

    try:
        while True:
            data = await websocket.receive_json()  # 接受
            msg_type = data.get("type") # 这的类型可能是 join / start_game / submit_word / submit_drawing / chat

            # 1. 玩家加入
            if msg_type == "join":
                name = data.get("name", "匿名玩家") # 默认是匿名玩家
                async with room.lock: # 异步锁
                    index = room.player_count
                    player = Player( # 创建一个新的 Player 对象
                        player_id=str(uuid.uuid4()),  # 为玩家生成一个唯一的 UUID 作为玩家 ID
                        name=name,
                        index=index, # 玩家索引
                        websocket=websocket # 保存当前的 WebSocket 连接，供后续消息通信使用
                    )
                    room.players.append(player)

                    await room.broadcast({ # 广播
                        "type": "player_joined",
                        "roomId": room.id,
                        "players": [
                            {"index": p.index, "name": p.name} # 对每个玩家，广播他们的索引和名字
                            for p in room.players
                        ]
                    })

            # 2. 房主开始游戏
            elif msg_type == "start_game":
                async with room.lock:
                    if room.phase != "waiting":
                        continue

                    if room.player_count < 2:
                        await websocket.send_json({ # 单播 websocket本身是一对一连接的 这里是当前玩家与服务器
                            "type": "error",
                            "message": "至少需要两名玩家才能开始游戏"
                        })
                        continue

                    room.phase = "playing" # 标识状态
                    room.step_index = 0
                    room.max_steps = room.player_count
                    room.chains = []
                    room.ratings = {}

                    for i, p in enumerate(room.players): # 有多少个用户就有多少条链
                        chain = Chain(
                            id=str(uuid.uuid4()),
                            owner_index=i,
                            steps=[]
                        )
                        room.chains.append(chain) 

                    # 第 0 步：每个玩家写自己的起始词
                    for chain in room.chains:
                        owner = room.players[chain.owner_index]
                        await owner.websocket.send_json({ # 单播unicast
                            "type": "task_assigned",
                            "roomId": room.id,
                            "chainId": chain.id,
                            "stepIndex": 0,
                            "taskType": "word",
                            "prevStepType": None
                        })

                    await room.broadcast({   # broadcast  自定义类（room）调用
                        "type": "game_started",
                        "roomId": room.id,
                        "playerCount": room.player_count,
                        "maxSteps": room.max_steps,
                    })

            # 3. 提交词
            elif msg_type == "submit_word":
                if player is None:
                    continue
                chain_id = data["chainId"]
                word = data["word"]

                async with room.lock:
                    chain = room.find_chain(chain_id)
                    if chain is None:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"未找到 chain: {chain_id}"
                        })
                        continue

                    current_step_index = len(chain.steps)
                    if current_step_index != room.step_index:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"当前房间处于 step={room.step_index}，但该链步数为 {current_step_index}"
                        })
                        continue

                    from_index = player.index
                    to_index = (chain.owner_index + current_step_index + 1) % room.player_count

                    step = Step(
                        index=current_step_index,
                        from_player_index=from_index,
                        to_player_index=to_index,
                        type="word",
                        word=word
                    )
                    chain.steps.append(step)

                    await room.broadcast({
                        "type": "step_submitted",
                        "roomId": room.id,
                        "chainId": chain.id,
                        "stepIndex": current_step_index,
                        "fromPlayerIndex": from_index,
                        "stepType": "word"
                    })

                    if room.all_chains_have_step(room.step_index):
                        room.step_index += 1
                        if room.step_index >= room.max_steps:
                            room.phase = "revealing"
                            await room.reveal_all()
                        else:
                            await room.dispatch_next_tasks()

            # 4. 提交画
            elif msg_type == "submit_drawing":
                if player is None:
                    continue
                chain_id = data["chainId"]
                drawing_id = data["drawingId"]

                async with room.lock:  # 异步
                    chain = room.find_chain(chain_id)
                    if chain is None:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"未找到 chain: {chain_id}"
                        })
                        continue

                    current_step_index = len(chain.steps)
                    if current_step_index != room.step_index:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"当前房间处于 step={room.step_index}，但该链步数为 {current_step_index}"
                        })
                        continue

                    from_index = player.index
                    to_index = (chain.owner_index + current_step_index + 1) % room.player_count

                    step = Step(
                        index=current_step_index,
                        from_player_index=from_index,
                        to_player_index=to_index,
                        type="drawing",
                        drawing_id=drawing_id
                    )
                    chain.steps.append(step)

                    await room.broadcast({    # 广播
                        "type": "step_submitted",
                        "roomId": room.id,
                        "chainId": chain.id,
                        "stepIndex": current_step_index,
                        "fromPlayerIndex": from_index,
                        "stepType": "drawing"
                    })

                    if room.all_chains_have_step(room.step_index):
                        room.step_index += 1
                        if room.step_index >= room.max_steps:
                            room.phase = "revealing"
                            await room.reveal_all()
                        else:
                            await room.dispatch_next_tasks()

            # 5. 聊天
            elif msg_type == "chat":
                if player is None:
                    continue
                content = data.get("content", "").strip()
                if not content:
                    continue

                async with room.lock:
                    await room.broadcast({
                        "type": "chat",
                        "roomId": room.id,
                        "playerName": player.name,
                        "content": content,
                        "timestamp": int(time.time())
                    })

            # 6. 接龙评分：√ / ×
            elif msg_type == "rate_chain":
                if player is None: 
                    continue
                chain_id = data["chainId"]
                is_ok = bool(data.get("isOk", True))

                async with room.lock:
                    if room.phase != "revealing":
                        continue
                    chain = room.find_chain(chain_id)
                    if chain is None:
                        continue

                    r = room.ratings.setdefault(chain_id, {})
                    r[player.index] = is_ok

                    ok_count = sum(1 for v in r.values() if v)
                    bad_count = sum(1 for v in r.values() if not v)
                    finished = (len(r) == room.player_count)

                    await room.broadcast({
                        "type": "chain_rated",
                        "roomId": room.id,
                        "chainId": chain_id,
                        "okCount": ok_count,
                        "badCount": bad_count,
                        "totalPlayers": room.player_count,
                        "finished": finished
                    })

            # 7. 重开一局（可选）
            elif msg_type == "restart":
                async with room.lock:
                    room.reset()
                    await room.broadcast({
                        "type": "room_reset",
                        "roomId": room.id
                    })

    except WebSocketDisconnect: # 断开连接
        if player is not None: # 有效玩家   
            async with room.lock: # 异步锁
                if player in room.players: # 检查是否在房间中
                    room.players.remove(player) #移除
                    await room.broadcast({ # 等待广播 告诉其他玩家xx离开
                        "type": "player_left",
                        "roomId": room.id,
                        "playerId": player.id,
                        "name": player.name
                    })

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True) # 异步程度
