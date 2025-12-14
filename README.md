<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="figure/logo-dark.svg">
    <img src="figure/logo-light.svg" alt="Guess & Draw" width="920">
  </picture>
</p>

## Key Features
- Real-time drawing with WebSocket
- AI-assisted answer judgment
- Room management system
- Scoring system

## Technology Stack
Frontend:
- React.js
- WebSocket
- HTML5 Canvas

Backend:
- FastAPI
- WebSocket
- OpenAI API

## System Architecture
### Main Frontend Components

1. **RoomManagement - Room Management Component**
   - Create a room
   - Join a room
   - Set room parameters

2. **DrawingCanvas - Drawing Component**
   - HTML5 Canvas drawing functionality
   - Pen/Eraser tools
   - Brush size/color selection

3. **Viewer - Viewer Component**
   - View real-time drawing
   - Submit guesses

4. **Judge - Judging Component**
   - Display AI judgment results
   - Manual confirmation of judgment

### Main Backend Modules

1. **websocket.py - WebSocket Management**
2. **game.py - Game Logic**

![Architecture.png](https://s2.loli.net/2024/12/14/pBNoh6nYQ8zIDAd.png)

## Game Flow



## API Documentation

### WebSocket Events


### REST API



## Deployment



## Configuration


## TODO


## Contributors

- Backend Engineer: 
- Frontend Engineer: 
