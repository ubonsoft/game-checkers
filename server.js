const express = require('express');
const http = require('http');

const TURN_DURATION = 30; // seconds
const { Server } = require("socket.io");
const path = require('path');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

const gameRooms = {};

function createInitialBoard() {
    const board = [];
    for (let row = 0; row < 8; row++) {
        let r = [];
        for (let col = 0; col < 8; col++) {
            if (row < 3 && (row + col) % 2 === 1) {
                r.push('black'); // Thai checkers starts with 3 rows
            } else if (row > 4 && (row + col) % 2 === 1) {
                r.push('red');
            } else {
                r.push(null);
            }
        }
        board.push(r);
    }
    return board;
}

function createInitialGameState() {
    return {
        board: createInitialBoard(),
        turn: 'red', // Red player starts
        gameOver: false,
        winner: null,
        captured: { red: 0, black: 0 },
        movesSinceCapture: 0, // For draw detection
        timers: {
            black: TURN_DURATION,
            red: TURN_DURATION
        },
        turnTimerId: null
    };
}

function applyMove(gameState, from, to) {
    const { board, turn } = gameState;
    const piece = board[from.row][from.col];
    const opponentColor = turn === 'red' ? 'black' : 'red';

    // This move logic is now simplified as the validation is done in 'makeMove' handler
    const isKing = piece.includes('_king');
    const rowDiff = to.row - from.row;
    const colDiff = to.col - from.col;

    // Move the piece
    board[to.row][to.col] = piece;
    board[from.row][from.col] = null;

    // Check for capture
    if (Math.abs(rowDiff) > 1) {
        const stepRow = Math.sign(rowDiff);
        const stepCol = Math.sign(colDiff);
        let capturedPieceRow, capturedPieceCol;

        if (isKing) {
            // For kings, find the single piece in the path
            for (let i = 1; i < Math.abs(rowDiff); i++) {
                const r = from.row + i * stepRow;
                const c = from.col + i * stepCol;
                if (board[r][c] && board[r][c].startsWith(opponentColor)) {
                    capturedPieceRow = r;
                    capturedPieceCol = c;
                    break;
                }
            }
        } else {
            // For regular pieces, the captured piece is in the middle
            capturedPieceRow = from.row + stepRow;
            capturedPieceCol = from.col + stepCol;
        }

        if (capturedPieceRow !== undefined) {
            board[capturedPieceRow][capturedPieceCol] = null;
            if (turn === 'red') gameState.captured.red++;
            else gameState.captured.black++;
            gameState.movesSinceCapture = 0;
        }
    } else {
        gameState.movesSinceCapture++;
    }

    // Promote to king if it reaches the end
    let wasPromoted = false;
    if ((turn === 'red' && to.row === 0) || (turn === 'black' && to.row === 7)) {
        if (!isKing) {
            board[to.row][to.col] = piece + '_king';
            wasPromoted = true;
        }
    }

    // A capture move only continues the turn if another capture is possible
    // AND the piece was not just promoted.
    const isCaptureMove = Math.abs(to.row - from.row) > 1;
    let canCaptureAgain = false;

    if (isCaptureMove && !wasPromoted) {
        // Only if the current move was a capture (and no promotion), check for another one.
        const nextCaptures = findCapturesForPiece(board, to.row, to.col);
        canCaptureAgain = nextCaptures.length > 0;
    }

    // Switch turns if the player cannot capture again.
    if (!canCaptureAgain) {
        gameState.turn = opponentColor;
    }

    return { isValid: true, canCaptureAgain };
}

// Helper function to find ONLY captures for a single piece
function findCapturesForPiece(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];

    const captures = [];
    const playerColor = piece.startsWith('red') ? 'red' : 'black';
    const opponentColor = playerColor === 'red' ? 'black' : 'red';
    const isKing = piece.includes('_king');
    const allDirections = [{ r: -1, c: -1 }, { r: -1, c: 1 }, { r: 1, c: -1 }, { r: 1, c: 1 }];

    if (isKing) {
        // Kings can start a capture from any distance, but must land 1 square behind the captured piece.
        for (const dir of allDirections) {
            // Scan along the direction for the first piece
            for (let i = 1; i < 8; i++) {
                const checkR = row + i * dir.r;
                const checkC = col + i * dir.c;

                if (checkR < 0 || checkR >= 8 || checkC < 0 || checkC >= 8) break; // Off board

                const pieceAtCheck = board[checkR][checkC];
                if (pieceAtCheck) {
                    // If it's an opponent piece, check if we can jump it
                    if (pieceAtCheck.startsWith(opponentColor)) {
                        const landR = checkR + dir.r;
                        const landC = checkC + dir.c;
                        // Check if landing spot is on board and empty
                        if (landR >= 0 && landR < 8 && landC >= 0 && landC < 8 && board[landR][landC] === null) {
                            captures.push({ row: landR, col: landC });
                        }
                    }
                    // Whether it was our piece or an opponent's, we can't jump over it, so stop searching in this direction.
                    break;
                }
            }
        }
    } else {
        // Regular pieces can only capture FORWARD
        const forwardDirections = playerColor === 'red' ? [{ r: -1, c: -1 }, { r: -1, c: 1 }] : [{ r: 1, c: -1 }, { r: 1, c: 1 }];
        for (const dir of forwardDirections) {
            const midR = row + dir.r;
            const midC = col + dir.c;
            const landR = row + 2 * dir.r;
            const landC = col + 2 * dir.c;

            if (landR >= 0 && landR < 8 && landC >= 0 && landC < 8 && board[landR][landC] === null) {
                const midPiece = board[midR] ? board[midR][midC] : undefined;
                if (midPiece && midPiece.startsWith(opponentColor)) {
                    captures.push({ row: landR, col: landC });
                }
            }
        }
    }
    return captures;
}

// Helper function to find ONLY regular moves for a single piece
function findRegularMovesForPiece(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];

    const moves = [];
    const playerColor = piece.startsWith('red') ? 'red' : 'black';
    const isKing = piece.includes('_king');

    const directions = [
        { r: -1, c: -1 }, { r: -1, c: 1 },
        { r: 1, c: -1 }, { r: 1, c: 1 }
    ];

    if (isKing) {
        for (const dir of directions) {
            for (let i = 1; i < 8; i++) {
                const r = row + dir.r * i;
                const c = col + dir.c * i;
                if (r < 0 || r >= 8 || c < 0 || c >= 8 || board[r][c] !== null) {
                    break; // Stop if off board or blocked
                }
                moves.push({ row: r, col: c });
            }
        }
    } else { // Regular piece
        const forwardDirections = playerColor === 'red' ? [{ r: -1, c: -1 }, { r: -1, c: 1 }] : [{ r: 1, c: -1 }, { r: 1, c: 1 }];
        for (const dir of forwardDirections) {
            const r = row + dir.r;
            const c = col + dir.c;
            if (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r][c] === null) {
                moves.push({ row: r, col: c });
            }
        }
    }
    return moves;
}

// Main function to get moves, enforcing forced capture
function findPossibleMovesForPiece(board, row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    const playerColor = piece.startsWith('red') ? 'red' : 'black';

    // 1. Check if ANY piece of the current player can capture
    let anyCapturePossible = false;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c] && board[r][c].startsWith(playerColor)) {
                if (findCapturesForPiece(board, r, c).length > 0) {
                    anyCapturePossible = true;
                    break;
                }
            }
        }
        if (anyCapturePossible) break;
    }

    // 2. Return moves based on forced capture rule
    if (anyCapturePossible) {
        // If captures are possible, only return captures for the selected piece
        return findCapturesForPiece(board, row, col);
    } else {
        // Otherwise, return regular moves for the selected piece
        return findRegularMovesForPiece(board, row, col);
    }
}

function checkWinner(board) {
    let redCount = 0;
    let blackCount = 0;
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (board[r][c]) {
                if (board[r][c].startsWith('red')) redCount++;
                if (board[r][c].startsWith('black')) blackCount++;
            }
        }
    }
    if (redCount === 0) return 'black';
    if (blackCount === 0) return 'red';
    return null; // No winner yet
}

function getClientGameState(gameState) {
    const { turnTimerId, ...clientState } = gameState;
    return clientState;
}

function stopTurnTimer(room) {
    if (room && room.gameState && room.gameState.turnTimerId) {
        clearInterval(room.gameState.turnTimerId);
        room.gameState.turnTimerId = null;
    }
}

function startTurnTimer(roomId) {
    const room = gameRooms[roomId];
    if (!room || room.gameState.gameOver) return;

    stopTurnTimer(room); // Stop any existing timer

    const currentPlayer = room.gameState.turn;
    room.gameState.timers[currentPlayer] = TURN_DURATION; // Reset timer for the current player

    io.to(roomId).emit('timerUpdate', room.gameState.timers);

    room.gameState.turnTimerId = setInterval(() => {
        if (room.gameState.timers[currentPlayer] <= 0) {
            stopTurnTimer(room);
            const winner = currentPlayer === 'red' ? 'black' : 'red';
            room.gameState.gameOver = true;
            room.gameState.winner = winner;
            io.to(roomId).emit('gameOver', getClientGameState(room.gameState)); // Inform clients of timeout
            return;
        }

        room.gameState.timers[currentPlayer]--;
        io.to(roomId).emit('timerUpdate', room.gameState.timers);
    }, 1000);
}

io.on('connection', (socket) => {
    console.log('a user connected:', socket.id);

    socket.on('createGame', () => {
        const roomId = Math.random().toString(36).substr(2, 5).toUpperCase();
        const initialGameState = createInitialGameState();

        gameRooms[roomId] = {
            players: { [socket.id]: 'black' },
            gameState: initialGameState, // Store initial state right away
        };
        socket.join(roomId);

        // The creator is player 1 (black)
        socket.emit('gameCreated', { roomId, playerColor: 'black' });
        
        // Send the initial board state so it can be rendered behind the overlay
        socket.emit('updateBoard', getClientGameState(initialGameState));

        console.log(`Game created with ID: ${roomId} by ${socket.id} (black)`);
    });

    socket.on('joinGame', (roomId) => {
        const room = gameRooms[roomId];
        // Check if room exists and is not full
        if (room && Object.keys(room.players).length < 2) {
            socket.join(roomId);
            room.players[socket.id] = 'red'; // The joiner is player 2 (red)
            
            console.log(`${socket.id} joined game ${roomId} (red)`);

            // Both players are in, create and start the game
            const gameState = createInitialGameState();
            room.gameState = gameState;

            // Notify each player with their color and the initial game state
            for (const playerId in room.players) {
                const playerColor = room.players[playerId];
                io.to(playerId).emit('gameStart', { 
                    gameState: getClientGameState(gameState), 
                    roomId,
                    playerColor // Send each player their assigned color
                });
            }
            console.log(`Game ${roomId} started.`);
            startTurnTimer(roomId);
        } else {
            socket.emit('error', 'Room is full or does not exist.');
        }
    });

    socket.on('makeMove', ({ from, to, roomId }) => {
        const room = gameRooms[roomId];
        if (!room || !room.gameState) { return; }

        const { gameState } = room;
        const playerColor = room.players[socket.id];

        if (gameState.gameOver || gameState.turn !== playerColor) {
            socket.emit('invalidMove', { message: 'Not your turn or game is over.' });
            return;
        }

        const possibleMoves = findPossibleMovesForPiece(gameState.board, from.row, from.col);
        const isMovePossible = possibleMoves.some(move => move.row === to.row && move.col === to.col);

        if (!isMovePossible) {
            socket.emit('invalidMove', { message: 'Invalid move. You might be forced to capture.' });
            return;
        }

        const moveResult = applyMove(gameState, from, to);

        if (moveResult.isValid) {
            if (!moveResult.canCaptureAgain) {
                if (gameState.movesSinceCapture >= 50) {
                    gameState.gameOver = true;
                    gameState.winner = 'draw';
                } else {
                    const winner = checkWinner(gameState.board);
                    if (winner) {
                        gameState.gameOver = true;
                        gameState.winner = winner;
                    }
                }
            }

            if (gameState.gameOver) {
                stopTurnTimer(room);
            }

            io.to(roomId).emit('moveExecuted', { from, to, gameState: getClientGameState(gameState) });

            if (!gameState.gameOver && !moveResult.canCaptureAgain) {
                startTurnTimer(roomId);
            }
        } else {
            socket.emit('invalidMove', { message: moveResult.message });
        }
    });

    socket.on('getPossibleMoves', ({ piece, roomId }) => {
        const room = gameRooms[roomId];
        if (!room || !room.gameState) return;

        const moves = findPossibleMovesForPiece(room.gameState.board, piece.row, piece.col);
        socket.emit('possibleMoves', moves);
    });

    socket.on('resign', (roomId) => {
        const room = gameRooms[roomId];
        if (!room || !room.gameState || room.gameState.gameOver) return;

        const resigningPlayerColor = room.players[socket.id];
        const winnerColor = resigningPlayerColor === 'red' ? 'black' : 'red';

        room.gameState.gameOver = true;
        room.gameState.winner = winnerColor;

        stopTurnTimer(room);
        io.to(roomId).emit('gameOver', getClientGameState(room.gameState));
    });

    socket.on('disconnect', () => {
        console.log('user disconnected:', socket.id);
        // Find which room the player was in
        for (const roomId in gameRooms) {
            if (gameRooms[roomId].players[socket.id]) {
                const room = gameRooms[roomId];
                console.log(`Player ${socket.id} left room ${roomId}`);
                delete room.players[socket.id];
                
                stopTurnTimer(room);
                // Notify the other player
                io.to(roomId).emit('playerLeft', { disconnectedPlayerId: socket.id });

                // If the room is now empty, clean it up
                if (Object.keys(room.players).length === 0) {
                    console.log(`Room ${roomId} is empty, deleting.`);
                    delete gameRooms[roomId];
                }
                break;
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on *:${PORT}`);
});

