// Переменные состояния игры «Лабиринт»
let mazeGame = {
    active: false,
    role: null,         // 'light' или 'driver'
    map: null,          // Матрица лабиринта с сервера
    wallSize: 40,       // Будет пересчитано динамически под экран
    startX: 0, startY: 0,
    finX: 0, finY: 0,
    playerX: 0, playerY: 0,
    lightX: 0, lightY: 0,
    canvas: null,
    ctx: null
};

// Инициализация при загрузке скрипта
document.addEventListener('DOMContentLoaded', () => {
    mazeGame.canvas = document.getElementById('touch-canvas');
    if (mazeGame.canvas) {
        mazeGame.ctx = mazeGame.canvas.getContext('2d');
    }

    // Навешиваем событие на кнопку в доке
    const mazeBtn = document.getElementById('btn-maze');
    if (mazeBtn) {
        mazeBtn.addEventListener('click', () => {
            // Если игра уже идет — можно её перезапросить, иначе — шлем запрос старта на сервер
            if (typeof sendNetData === 'function') {
                sendNetData({ type: 'maze_start_request' });
            } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'maze_start_request' }));
            }
        });
    }
});

// Перехват сетевых сообщений от сервера (вызывать внутри твоего ws.onmessage в index.js)
// Или данный код зарегистрирует себя сам, если у тебя глобальный слушатель:
function handleMazeNetwork(data) {
    if (data.type === 'maze_start') {
        initMazeGame(data);
    } 
    else if (data.type === 'maze_player_sync') {
        mazeGame.playerX = data.x;
        mazeGame.playerY = data.y;
    } 
    else if (data.type === 'maze_light_sync') {
        mazeGame.lightX = data.x;
        mazeGame.lightY = data.y;
    } 
    else if (data.type === 'maze_win') {
        alert('Вы прошли лабиринт! 🎉');
        stopMazeGame();
    }
}

// Если в твоем основном скрипте index.js парсинг идет глобально, 
// просто добавь handleMazeNetwork(data) внутрь ws.onmessage.

function initMazeGame(data) {
    mazeGame.active = true;
    mazeGame.role = data.role;
    mazeGame.map = data.map;

    // Снимаем класс active со всех кнопок и вешаем на Лабиринт
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    const mazeBtn = document.getElementById('btn-maze');
    if (mazeBtn) mazeBtn.classList.add('active');

    // Адаптивный расчет размера ячейки под размер контейнера/экрана
    const rows = mazeGame.map.length;
    const cols = mazeGame.map[0].length;
    
    // Подгоняем wallSize, чтобы весь лабиринт гарантированно влез на экран телефона
    const scaleX = mazeGame.canvas.clientWidth / cols;
    const scaleY = mazeGame.canvas.clientHeight / rows;
    mazeGame.wallSize = Math.min(scaleX, scaleY) * 0.95; // 5% запас на отступы

    // Пересчитываем серверные координаты под наше разрешение экрана
    const serverWallSize = 40; // Коэффициент из сервера
    const ratio = mazeGame.wallSize / serverWallSize;

    mazeGame.startX = data.startX * ratio;
    mazeGame.startY = data.startY * ratio;
    mazeGame.finX = data.finX * ratio;
    mazeGame.finY = data.finY * ratio;

    // Установка начальных позиций
    mazeGame.playerX = mazeGame.startX;
    mazeGame.playerY = mazeGame.startY;
    mazeGame.lightX = mazeGame.canvas.clientWidth / 2;
    mazeGame.lightY = mazeGame.canvas.clientHeight / 2;

    // Включаем тач-трекеры
    setupMazeControls();

    // Запускаем изолированный цикл рендеринга
    requestAnimationFrame(renderMaze);
}

function stopMazeGame() {
    mazeGame.active = false;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-tap')?.classList.add('active'); // Возврат к Искре
}

// Обработка управления (Свайпы / Перетаскивание)
function setupMazeControls() {
    const canvas = mazeGame.canvas;
    
    const handleMove = (e) => {
        if (!mazeGame.active) return;
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        const serverWallSize = 40;
        const ratio = mazeGame.wallSize / serverWallSize;

        if (mazeGame.role === 'light') {
            // Фонарик просто следует за пальцем
            mazeGame.lightX = touchX;
            mazeGame.lightY = touchY;
            
            sendMazeData({
                type: 'maze_move',
                role: 'light',
                x: touchX,
                y: touchY
            });
        } 
        else if (mazeGame.role === 'driver') {
            // Водитель отправляет желаемую точку на сервер для физической проверки
            // Переводим локальные координаты обратно в серверный масштаб перед отправкой
            sendMazeData({
                type: 'maze_move',
                role: 'driver',
                x: touchX / ratio,
                y: touchY / ratio
            });
        }
    };

    canvas.addEventListener('touchstart', handleMove, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
}

function sendMazeData(payload) {
    if (typeof sendNetData === 'function') {
        sendNetData(payload);
    } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify(payload));
    }
}

// Цикл отрисовки холста
function renderMaze() {
    if (!mazeGame.active) return;

    const ctx = mazeGame.ctx;
    const canvas = mazeGame.canvas;
    const size = mazeGame.wallSize;

    // Корректный ресайз внутреннего буфера канваса под CSS-размеры
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        // Пересчитаем размеры, если экран повернулся
        if (mazeGame.map) {
            const scaleX = canvas.width / mazeGame.map[0].length;
            const scaleY = canvas.height / mazeGame.map.length;
            mazeGame.wallSize = Math.min(scaleX, scaleY) * 0.95;
        }
    }

    // 1. Очистка экрана (Черный фон лабиринта)
    ctx.fillStyle = '#02020b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Центрируем лабиринт на холсте
    const offsetX = (canvas.width - (mazeGame.map[0].length * size)) / 2;
    const offsetY = (canvas.height - (mazeGame.map.length * size)) / 2;

    // 2. Рисуем стены и проходы
    for (let r = 0; r < mazeGame.map.length; r++) {
        for (let c = 0; c < mazeGame.map[r].length; c++) {
            if (mazeGame.map[r][c] === 1) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'; // Едва заметные контуры стен для отладки
                ctx.fillRect(offsetX + c * size, offsetY + r * size, size, size);
            }
        }
    }

    // 3. Рисуем финиш (Светящаяся зона)
    ctx.beginPath();
    ctx.arc(offsetX + mazeGame.finX, offsetY + mazeGame.finY, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#00f0ff';
    ctx.fill();
    ctx.shadowBlur = 0; // Сброс тени

    // 4. Рисуем игрока (Фишку)
    ctx.beginPath();
    ctx.arc(offsetX + mazeGame.playerX, offsetY + mazeGame.playerY, size / 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3366';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff3366';
    ctx.fill();
    ctx.shadowBlur = 0;

    // 5. НАЛОЖЕНИЕ ТЕМНОТЫ И ЭФФЕКТА ФОНАРИКА (Маскирование)
    // Создаем закадровый слой для маски фонаря
    ctx.save();
    
    if (mazeGame.role === 'driver') {
        // Водитель видит только там, где сейчас водит пальцем его партнер-фонарик
        applyLightMask(ctx, offsetX + mazeGame.lightX, offsetY + mazeGame.lightY, size * 2.5);
    } else {
        // Фонарик видит вокруг своего собственного пальца
        applyLightMask(ctx, offsetX + mazeGame.lightX, offsetY + mazeGame.lightY, size * 2.5);
    }

    // Отрисовываем реальные физические неоновые стены ТОЛЬКО внутри маски фонаря
    for (let r = 0; r < mazeGame.map.length; r++) {
        for (let c = 0; c < mazeGame.map[r].length; c++) {
            if (mazeGame.map[r][c] === 1) {
                ctx.fillStyle = '#151525';
                ctx.strokeStyle = '#ff9900';
                ctx.lineWidth = 1;
                ctx.fillRect(offsetX + c * size, offsetY + r * size, size, size);
                ctx.strokeRect(offsetX + c * size, offsetY + r * size, size, size);
            }
        }
    }
    ctx.restore();

    // Зацикливаем анимацию
    requestAnimationFrame(renderMaze);
}

// Функция создания конуса/круга видимости
function applyLightMask(ctx, x, y, radius) {
    // Временный холст-маска не нужен, используем clip
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();
}
