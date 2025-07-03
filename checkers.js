document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // UI Elements
    const lobbyDiv = document.getElementById('lobby');
    const gameContainerDiv = document.getElementById('game-container');
    const createGameBtn = document.getElementById('create-game-btn');
    const joinGameBtn = document.getElementById('join-game-btn');
    const roomIdInput = document.getElementById('room-id-input');
    const waitingInfoDiv = document.getElementById('waiting-info');
    const waitingGameIdText = document.getElementById('waiting-game-id-text');
    const qrCodeWaitingContainer = document.getElementById('qr-code-waiting');
    const partialOverlayContainer = document.getElementById('partial-overlay-container');
    const playerInfoH2 = document.getElementById('player-info');
    const playerCaptureCountSpan = document.getElementById('player-capture-count');
    const opponentCaptureCountSpan = document.getElementById('opponent-capture-count');
    const playerCaptureIconDiv = document.getElementById('captured-by-player');
    const opponentCaptureIconDiv = document.getElementById('captured-by-opponent');
    const boardEl = document.getElementById('board');
    const turnEl = document.getElementById('turn');
    const resignBtn = document.getElementById('resign-btn');
    const newGameBtn = document.getElementById('new-game-btn');
    const playerTimerEl = document.getElementById('player-timer');
    const opponentTimerEl = document.getElementById('opponent-timer');
    const popupModal = document.getElementById('popup-modal');
    const popupMessage = document.getElementById('popup-message');
    const popupCloseBtn = document.getElementById('popup-close-btn');
    const moveSound = document.getElementById('move-sound');
    const captureSound = document.getElementById('capture-sound');

    // Game State
    let board = [];
    let selected = null;
    let turn = 'red';
    let playerColor = null;
    let roomId = null;
    let gameOver = false;
    let possibleMoves = []; // To store possible moves for the selected piece
    let isWaitingForOpponent = false;

    // --- Event Listeners ---
    createGameBtn.addEventListener('click', () => {
        // --- Unlock audio on first user interaction ---
        moveSound.play().catch(() => {});
        moveSound.pause();
        captureSound.play().catch(() => {});
        captureSound.pause();
        // ---------------------------------------------

        socket.emit('createGame');
        playerColor = 'black'; // The creator is always black
    });

    joinGameBtn.addEventListener('click', () => {
        const roomIdToJoin = roomIdInput.value.trim();
        if (roomIdToJoin) {
            socket.emit('joinGame', roomIdToJoin);
        }
    });

    newGameBtn.addEventListener('click', () => {
        location.reload(); // Simple way to go back to lobby
    });

    popupCloseBtn.addEventListener('click', () => {
        popupModal.style.display = 'none';
    });

    resignBtn.addEventListener('click', () => {
        if (!gameOver) {
            showPopup('คุณแน่ใจหรือไม่ว่าต้องการยอมแพ้?', true, () => {
                socket.emit('resign', roomId);
            });
        }
    });

    // --- Socket Event Handlers ---

    // 1. When a room is created, show the waiting UI
    socket.on('gameCreated', (data) => {
        roomId = data.roomId;
        playerColor = data.playerColor;
        isWaitingForOpponent = true;
        const link = `${window.location.origin}?room=${roomId}`;

        // Hide lobby, show game container
        lobbyDiv.style.display = 'none';
        gameContainerDiv.style.display = 'block';

        // Show and populate the new waiting info box
        waitingInfoDiv.style.display = 'block';
        waitingGameIdText.textContent = roomId;
        qrCodeWaitingContainer.innerHTML = ''; // Clear previous QR code
        new QRCode(qrCodeWaitingContainer, {
            text: link,
            width: 100,
            height: 100,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
        // The initial board and overlay will be drawn by the 'updateBoard' event
    });

    // 2. When a second player joins, the game starts for both
    socket.on('gameStart', (data) => {
        roomId = data.roomId;
        playerColor = data.playerColor; // Server assigns our color
        isWaitingForOpponent = false;

        // Hide lobby and any waiting UI
        lobbyDiv.style.display = 'none';
        waitingInfoDiv.style.display = 'none';
        partialOverlayContainer.innerHTML = ''; // Clear overlays

        // Show game UI
        gameContainerDiv.style.display = 'block';
        resignBtn.style.display = 'inline-block';
        newGameBtn.style.display = 'none';
        playerInfoH2.textContent = `คุณคือสี ${playerColor === 'red' ? 'แดง' : 'ดำ'}`;
        updateGameState(data.gameState);
    });

    // 3. When a move is executed, animate it and update state
    socket.on('moveExecuted', ({ from, to, gameState }) => {
        animatePieceMove(from, to, () => {
            updateGameState(gameState);
        });
    });
    
    // 4. For general game state updates (e.g., reconnecting)
    socket.on('updateBoard', (gameState) => {
        updateGameState(gameState);
        // If we are waiting for an opponent, draw the partial overlay
        if (isWaitingForOpponent) {
            drawPartialWaitingOverlay(gameState.board);
        }
    });

    socket.on('gameOver', (gameState) => {
        updateGameState(gameState);
    });

    socket.on('playerLeft', () => {
        gameOver = true;
        showPopup('ผู้เล่นอีกฝ่ายออกจากเกมแล้ว');
    });

    socket.on('invalidMove', ({ message }) => {
        console.warn(`Invalid move: ${message}`);
        // Optionally, show a subtle error message to the user here
    });

    socket.on('error', (message) => {
        showPopup(`เกิดข้อผิดพลาด: ${message}`);
        // Consider not reloading automatically for some errors
    });

    socket.on('possibleMoves', (moves) => {
        possibleMoves = moves;
        renderBoard(board); // Re-render to show highlights
    });

    socket.on('timerUpdate', (timers) => {
        updateTimersUI(timers);
    });

    // --- Game Logic & Rendering ---
    function countPieces(board) {
        return board.flat().filter(p => p !== null).length;
    }

    function drawPartialWaitingOverlay(board) {
        partialOverlayContainer.innerHTML = ''; // Clear old overlays

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                // As per user request, cover the RED pieces' starting area
                if (row > 4 && board[row][col] && board[row][col].startsWith('red')) {
                    const overlayCell = document.createElement('div');
                    overlayCell.className = 'partial-overlay-cell';
                    overlayCell.style.gridRowStart = row + 1;
                    overlayCell.style.gridColumnStart = col + 1;

                    // Add text to one of the cells
                    if (row === 6 && col === 3) {
                        overlayCell.textContent = 'กดที่ลิ้งใต้คอมเม้น เพื่อเข้าเล่น';
                    }

                    partialOverlayContainer.appendChild(overlayCell);
                }
            }
        }
    }

    function updateGameState(newState) {
        const oldBoard = board; // Keep a copy of the old board for sound comparison
        const oldPieceCount = countPieces(oldBoard);

        // Update main game state variables
        board = newState.board;
        turn = newState.turn;
        gameOver = newState.gameOver;

        // Update UI elements
        renderBoard(board);
        updateTurnIndicator(turn);
        updateCaptureCount(newState.captured);
        updateTimersUI(newState.timers);

        // Play sounds based on board changes
        const newPieceCount = countPieces(board);
        if (oldPieceCount > 0 && newPieceCount < oldPieceCount) {
            captureSound.play().catch(e => console.error("Error playing capture sound:", e));
        } else if (oldPieceCount > 0 && JSON.stringify(board) !== JSON.stringify(oldBoard)) {
            moveSound.play().catch(e => console.error("Error playing move sound:", e));
        }

        // Handle UI changes for game over state
        if (gameOver) {
            resignBtn.style.display = 'none';
            newGameBtn.style.display = 'block';
            let message = '';
            if (newState.winner === 'draw') {
                message = 'เกมเสมอ!';
            } else if (newState.winner === playerColor) {
                message = 'คุณชนะ!';
            } else {
                message = 'คุณแพ้!';
            }
            showPopup(message, false);
        } else {
            resignBtn.style.display = 'block';
            newGameBtn.style.display = 'none';
        }
    }

    function updateCaptureCount(captured) {
        if (!playerColor) return;

        const myColor = playerColor;
        const opponentColor = playerColor === 'red' ? 'black' : 'red';

        playerCaptureCountSpan.textContent = captured[myColor];
        opponentCaptureCountSpan.textContent = captured[opponentColor];

        // Update icon colors to show which color piece was captured
        playerCaptureIconDiv.className = `captured-piece-icon ${opponentColor}-piece`;
        opponentCaptureIconDiv.className = `captured-piece-icon ${myColor}-piece`;
    }

    function renderBoard(boardData) {
        boardEl.innerHTML = '';
        const canMove = !gameOver && turn === playerColor;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell ' + ((row + col) % 2 === 0 ? 'white' : 'black');
                cell.dataset.row = row;
                cell.dataset.col = col;

                if (selected && selected.row === row && selected.col === col) {
                    cell.classList.add('selected');
                }

                // Highlight possible moves
                if (possibleMoves.some(move => move.row === row && move.col === col)) {
                    cell.classList.add('possible-move');
                }

                const pieceType = boardData[row][col];
                if (pieceType) {
                    const piece = document.createElement('div');
                    piece.className = 'piece';
                    piece.dataset.row = row;
                    piece.dataset.col = col;
                    const color = pieceType.startsWith('red') ? 'red' : 'black';
                    piece.classList.add(`${color}-piece`);
                    if (pieceType.includes('_king')) {
                        piece.classList.add('king');
                    }
                    cell.appendChild(piece);
                }

                if (canMove) {
                    cell.addEventListener('click', () => onCellClick(row, col));
                }
                boardEl.appendChild(cell);
            }
        }
    }

    function updateTurnIndicator(currentTurn) {
        const turnColorClass = currentTurn === 'red' ? 'red-piece' : 'black-piece';
        const turnTextColor = currentTurn === 'red' ? 'แดง' : 'ดำ';
        turnEl.innerHTML = `
            <span>ถึงตา: ${turnTextColor}</span>
            <div class="turn-indicator-piece ${turnColorClass}"></div>
        `;
    }

    function updateTimersUI(timers) {
        if (!timers || !playerColor) return;

        const playerTime = timers[playerColor];
        const opponentColor = playerColor === 'red' ? 'black' : 'red';
        const opponentTime = timers[opponentColor];

        playerTimerEl.querySelector('.time').textContent = `${playerTime} วินาที`;
        opponentTimerEl.querySelector('.time').textContent = `${opponentTime} วินาที`;

        if (turn === playerColor) {
            playerTimerEl.classList.add('active');
            opponentTimerEl.classList.remove('active');
        } else {
            opponentTimerEl.classList.add('active');
            playerTimerEl.classList.remove('active');
        }
    }

    function onCellClick(row, col) {
        if (turn !== playerColor) return;
        const pieceData = board[row][col];

        // If a piece is already selected, try to move it
        if (selected) {
            const isPossibleMove = possibleMoves.some(move => move.row === row && move.col === col);
            // Also allow clicking the same piece to deselect
            if (selected.row === row && selected.col === col) {
                selected = null;
                possibleMoves = [];
                renderBoard(board);
                return;
            }
            // If the click is on a valid move, make the move
            if (isPossibleMove) {
                socket.emit('makeMove', { from: selected, to: { row, col }, roomId });
                selected = null;
                possibleMoves = [];
            } else {
                // If the click is on another of your pieces, select that one instead
                if (pieceData && pieceData.startsWith(playerColor)) {
                    selected = { row, col };
                    socket.emit('getPossibleMoves', { piece: selected, roomId });
                } else { // Otherwise, deselect
                    selected = null;
                    possibleMoves = [];
                    renderBoard(board);
                }
            }
        } else if (pieceData && pieceData.startsWith(playerColor)) {
            // If no piece is selected, select this one and get its moves
            selected = { row, col };
            socket.emit('getPossibleMoves', { piece: selected, roomId });
        }
    }

    function animatePieceMove(from, to, onAnimationEnd) {
        const pieceEl = document.querySelector(`.piece[data-row='${from.row}'][data-col='${from.col}']`);
        if (!pieceEl) {
            onAnimationEnd();
            return;
        }
        const cellWidth = boardEl.querySelector('.cell').offsetWidth;
        const deltaX = (to.col - from.col) * cellWidth;
        const deltaY = (to.row - from.row) * cellWidth;
        pieceEl.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        setTimeout(() => {
            // The transform reset is now handled by the CSS transition ending.
            // We just need to wait for the animation to finish before updating the board state.
            onAnimationEnd();
        }, 400); // This duration MUST match the CSS transition duration
    }

    function showPopup(message, showConfirm = false, onConfirm = null) {
        popupMessage.textContent = message;
        popupModal.style.display = 'flex';

        // Create new buttons each time to avoid multiple event listeners
        const oldBtn = document.getElementById('popup-confirm-btn');
        if(oldBtn) oldBtn.remove();

        if (showConfirm) {
            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = 'ยืนยัน';
            confirmBtn.id = 'popup-confirm-btn';
            confirmBtn.onclick = () => {
                if(onConfirm) onConfirm();
                popupModal.style.display = 'none';
            };
            popupCloseBtn.parentNode.insertBefore(confirmBtn, popupCloseBtn.nextSibling);
            popupCloseBtn.textContent = 'ยกเลิก';
        } else {
            popupCloseBtn.textContent = 'ตกลง';
        }
    }

    // --- Initialization ---
    // --- Initialization ---
    function initialize() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomToJoin = urlParams.get('room');

        if (roomToJoin) {
            // If joining via link, automatically join the game
            socket.emit('joinGame', roomToJoin);
        } else {
            // Otherwise, show the main lobby
            lobbyDiv.style.display = 'block';
            gameContainerDiv.style.display = 'none';
        }
    }

    initialize();
});
