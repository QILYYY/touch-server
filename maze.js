// maze.js — Полная логика игры "Лабиринт" на клиенте
(function() {
    let state = {
        active: false,
        role: null,
        map: [],
        playerX: 0, playerY: 0,
        finishX: 0, finishY: 0,
        wallSize: 40,
        myPointer: { x: 0, y: 0 },
        partnerPointer: { x: 0, y: 0 }
    };

    let canvas, ctx, animId;

    window.addEventListener('DOMContentLoaded', () => {
        canvas = document.getElementById('gameCanvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        // Клик по кнопке "Лабиринт" отправляет запрос на сервер
        document.getElementById('btn-maze').addEventListener('click', () => {
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'maze_start_request' }));
            }
        });

        // Отслеживание движений пальца
        canvas.addEventListener('pointermove', (e) => {
            if (!state.active) return;
            const rect = canvas.getBoundingClientRect();
            let x = e.clientX - rect.left;
            let y = e.clientY - rect.top;

            state.myPointer.x = x;
            state.myPointer.y = y;

            // Шлем данные на сервер с указанием своей роли
            if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({
                    type: 'maze_move',
                    role: state.role,
                    x: x, y: y
                }));
            }
        });

        // Инициализируем перехватчик сообщений вебсокета
        initSocketInterception();
    });

    function initSocketInterception() {
        // Проверяем наличие сокета с небольшим интервалом, если index.js грузится параллельно
        let checkTimer = setInterval(() => {
            if (window.ws) {
                clearInterval(checkTimer);
                let originalOnMessage = window.ws.onmessage;

                window.ws.onmessage = function(event) {
                    const data = JSON.parse(event.data);

                    if (data.type === 'maze_start') {
                        // Переключаем глобальный режим приложения (если используется в index.js)
                        if (typeof window.currentMode !== 'undefined') window.currentMode = 'maze';
                        
                        state.active = true;
                        state.role = data.role;
                        state.map = data.map;
                        state.playerX = data.startX; state.playerY = data.startY;
                        state.finishX = data.finX; state.finishY = data.finY;
                        
                        if (typeof triggerHaptic === 'function') triggerHaptic('success');
                        tick(); // Запуск цикла отрисовки
                    }
                    else if (data.type === 'maze_light_sync') {
                        // Обновляем координаты чужого фонарика
                        state.partnerPointer.x = data.x;
                        state.partnerPointer.y = data.y;
                    }
                    else if (data.type === 'maze_player_sync') {
                        // Синхронизируем положение фишки игрока от сервера
                        state.playerX = data.x;
                        state.playerY = data.y;
                    }
                    else if (data.type === 'maze_win') {
                        state.active = false;
                        cancelAnimationFrame(animId);
                        if (typeof window.currentMode !== 'undefined') window.currentMode = 'idle';
                        if (typeof triggerHaptic === 'function') triggerHaptic('success');
                        
                        // Рисуем экран победы
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.fillStyle = '#00ffcc';
                        ctx.font = 'bold 24px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('СВЯЗЬ УСТАНОВЛЕНА! 🧡', canvas.width / 2, canvas.height / 2);
                    }

                    // Передаем управление обратно основному index.js
                    if (originalOnMessage) originalOnMessage(event);
                };
            }
        }, 100);
    }

    // Игровой цикл отрисовки
    function tick() {
        if (!state.active) return;

        // Полная темнота
        ctx.fillStyle = '#06060c';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Позиция фонарика на экране зависит от роли
        let lx = (state.role === 'light') ? state.myPointer.x : state.partnerPointer.x;
        let ly = (state.role === 'light') ? state.myPointer.y : state.partnerPointer.y;

        ctx.save();
        // Маска светового луча фонарика
        ctx.beginPath();
        ctx.arc(lx, ly, 75, 0, Math.PI * 2);
        ctx.clip();

        // Отрисовка стен внутри светового пятна
        ctx.fillStyle = '#ff9900';
        for (let r = 0; r < state.map.length; r++) {
            for (let c = 0; c < state.map[r].length; c++) {
                if (state.map[r][c] === 1) {
                    ctx.fillRect(c * state.wallSize, r * state.wallSize, state.wallSize - 1, state.wallSize - 1);
                }
            }
        }

        // Выход (финиш)
        ctx.fillStyle = '#00ffcc';
        ctx.fillRect(state.finishX, state.finishY, state.wallSize, state.wallSize);
        ctx.restore();

        // Белая фишка игрока видна всегда и всем
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(state.playerX, state.playerY, 12, 0, Math.PI * 2);
        ctx.fill();

        animId = requestAnimationFrame(tick);
    }
})();
