// ==========================================
// MAZE.JS — ПОЛНОСТЬЮ АВТОНОМНЫЙ МОДУЛЬ ИГРЫ
// ==========================================

(function() {
    // Внутреннее состояние игры (изолировано внутри файла)
    let mazeState = {
        active: false,
        role: null,         // 'light' или 'driver'
        map: [],            // Матрица стен
        playerX: 60,
        playerY: 60,
        finishX: 280,
        finishY: 480,
        wallSize: 40,
        myPointer: { x: 0, y: 0 },
        partnerPointer: { x: 0, y: 0 }
    };

    let canvas, ctx, animationFrameId;

    // Инициализация игры при загрузке страницы
    window.addEventListener('DOMContentLoaded', () => {
        initMazeElements();
        listenServerEvents();
    });

    // 1. Создаем Canvas и вешаем обработчики тачей
    function initMazeElements() {
        canvas = document.getElementById('gameCanvas'); 
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        // Ловим движения пальца/мыши
        canvas.addEventListener('pointermove', (e) => {
            if (!mazeState.active) return;

            const rect = canvas.getBoundingClientRect();
            let currentX = e.clientX - rect.left;
            let currentY = e.clientY - rect.top;

            if (mazeState.role === 'light') {
                mazeState.myPointer.x = currentX;
                mazeState.myPointer.y = currentY;
                // Отправляем координаты света через ТВОЮ глобальную функцию отправки
                if (typeof sendNetData === 'function') {
                    sendNetData({ type: 'touch_move_sync', x: currentX, y: currentY });
                }
            } 
            else if (mazeState.role === 'driver') {
                // Проверяем столкновение со стеной лабиринта
                if (isHittingWall(currentX, currentY)) {
                    if (typeof triggerHaptic === 'function') triggerHaptic('error');
                } else {
                    mazeState.playerX = currentX;
                    mazeState.playerY = currentY;
                    
                    if (typeof sendNetData === 'function') {
                        sendNetData({ type: 'maze_move_player', x: currentX, y: currentY });
                    }
                    
                    // Проверка на победу (дошли до финиша)
                    let dist = Math.sqrt(Math.pow(currentX - mazeState.finishX, 2) + Math.pow(currentY - mazeState.finishY, 2));
                    if (dist < 25 && typeof sendNetData === 'function') {
                        sendNetData({ type: 'maze_win' });
                    }
                }
            }
        });
    }

    // 2. Слушаем сетевые пакеты от твоего вебсокета
    function listenServerEvents() {
        // Подключаемся к твоему существующему обработчику ws, если он есть
        // Если у тебя объект вебсокета называется иначе (например, socket), поменяй имя ниже
        if (window.ws) {
            let originalOnMessage = window.ws.onmessage;
            
            window.ws.onmessage = function(event) {
                // Сначала даем отработать твоему основному коду index.js
                if (originalOnMessage) originalOnMessage(event);
                
                const data = JSON.parse(event.data);

                // Если сервер дал команду старта лабиринта
                if (data.type === 'maze_start') {
                    startMazeGame(data);
                }
                // Если партнер двигает фишку
                else if (data.type === 'maze_player_sync') {
                    mazeState.playerX = data.x;
                    mazeState.playerY = data.y;
                }
                // Если партнер двигает фонарик (а мы водитель)
                else if (data.type === 'touch_move_sync' && mazeState.role === 'driver') {
                    mazeState.partnerPointer.x = data.x;
                    mazeState.partnerPointer.y = data.y;
                }
                // Конец игры (выход или победа)
                else if (data.type === 'maze_end' || data.type === 'game_over') {
                    stopMazeGame();
                }
            };
        }
    }

    // Запуск игры и внутреннего цикла отрисовки
    function startMazeGame(data) {
        mazeState.active = true;
        mazeState.map = data.map;
        mazeState.role = data.role; // 'light' или 'driver'
        mazeState.playerX = data.startX || 60;
        mazeState.playerY = data.startY || 60;
        mazeState.finishX = data.finX || 280;
        mazeState.finishY = data.finY || 480;

        if (typeof window.currentMode !== 'undefined') window.currentMode = 'maze';
        if (typeof triggerHaptic === 'function') triggerHaptic('success');

        // Запускаем игровой цикл лабиринта
        tick();
    }

    // Остановка игры
    function stopMazeGame() {
        mazeState.active = false;
        cancelAnimationFrame(animationFrameId);
    }

    // Основной цикл отрисовки лабиринта на холсте
    function tick() {
        if (!mazeState.active) return;

        // Рисуем темноту
        ctx.fillStyle = '#0a0a14';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Определяем центр луча фонарика
        let lightX = (mazeState.role === 'light') ? mazeState.myPointer.x : mazeState.partnerPointer.x;
        let lightY = (mazeState.role === 'light') ? mazeState.myPointer.y : mazeState.partnerPointer.y;

        ctx.save();
        
        // Маска прожектора
        ctx.beginPath();
        ctx.arc(lightX, lightY, 75, 0, Math.PI * 2);
        ctx.clip();

        // Рисуем оранжевые стены
        ctx.fillStyle = '#ff9900';
        for (let r = 0; r < mazeState.map.length; r++) {
            for (let c = 0; c < mazeState.map[r].length; c++) {
                if (mazeState.map[r][c] === 1) {
                    ctx.fillRect(c * mazeState.wallSize, r * mazeState.wallSize, mazeState.wallSize - 1, mazeState.wallSize - 1);
                }
            }
        }

        // Рисуем финиш (бирюзовый)
        ctx.fillStyle = '#00ffcc';
        ctx.fillRect(mazeState.finishX, mazeState.finishY, mazeState.wallSize, mazeState.wallSize);
        
        ctx.restore();

        // Рисуем шарик игрока (поверх темноты)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(mazeState.playerX, mazeState.playerY, 12, 0, Math.PI * 2);
        ctx.fill();

        animationFrameId = requestAnimationFrame(tick);
    }

    // Проверка физики стен
    function isHittingWall(nextX, nextY) {
        let cellX = Math.floor(nextX / mazeState.wallSize);
        let cellY = Math.floor(nextY / mazeState.wallSize);
        if (mazeState.map[cellY] && mazeState.map[cellY][cellX] === 1) {
            return true;
        }
        return false;
    }

    // Делаем функцию генерации доступной глобально, чтобы кнопка "Старт" в index.html могла её вызвать
    window.generateMazeMap = function(cols = 9, rows = 13) {
        let map = [];
        for (let r = 0; r < rows; r++) {
            let row = [];
            for (let c = 0; c < cols; c++) {
                if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) row.push(1);
                else row.push(Math.random() < 0.22 ? 1 : 0);
            }
            map.push(row);
        }
        map[1][1] = 0; map[1][2] = 0; map[2][1] = 0;
        map[rows - 2][cols - 2] = 0; map[rows - 2][cols - 3] = 0;
        return map;
    };
})();
