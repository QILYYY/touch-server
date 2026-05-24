// Переменные состояния игры «Лабиринт» (Переведены на сеточную и нормализованную логику)
let mazeGame = {
    active: false,
    role: null,         // 'light' или 'driver'
    grid: null,         // Двумерный массив лабиринта с сервера
    cellSize: 40,       // Динамический размер ячейки под экран
    offsetX: 0,         // Смещение для центрирования по X
    offsetY: 0,         // Смещение для центрирования по Y

    // Позиции игрока в индексах сетки (строки/колонки)
    playerX: 1, 
    playerY: 1,

    // Координаты финиша в индексах сетки
    finX: 1, 
    finY: 1,

    // Локальные пиксельные координаты фонарика (для того, кто светит)
    localLightX: 0,
    localLightY: 0,

    // Нормализованные координаты фонарика партнера (от 0.0 до 1.0) для синхронизации
    partnerLightPctX: 0.5,
    partnerLightPctY: 0.5,

    canvas: null,
    ctx: null
};

// Инициализация при загрузке скрипта
document.addEventListener('DOMContentLoaded', () => {
    mazeGame.canvas = document.getElementById('touch-canvas');
    if (mazeGame.canvas) {
        mazeGame.ctx = mazeGame.canvas.getContext('2d');
    }

    const mazeBtn = document.getElementById('btn-maze');
    if (mazeBtn) {
        mazeBtn.addEventListener('click', () => {
            if (typeof sendNetData === 'function') {
                sendNetData({ type: 'maze_start_request' });
            } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
                window.ws.send(JSON.stringify({ type: 'maze_start_request' }));
            }
        });
    }
});

// Перехват сетевых сообщений от сервера
function handleMazeNetwork(data) {
    if (data.type === 'maze_start') {
        initMazeGame(data);
    } 
    else if (data.type === 'maze_player_sync') {
        // Сервер присылает индексы ячеек, они одинаковы для всех экранов
        mazeGame.playerX = data.x;
        mazeGame.playerY = data.y;
    } 
    else if (data.type === 'maze_light_sync') {
        // Принимаем нормализованные координаты (проценты) от партнера
        mazeGame.partnerLightPctX = data.pctX;
        mazeGame.partnerLightPctY = data.pctY;
    } 
    else if (data.type === 'maze_win') {
        if (typeof triggerHaptic === 'function') triggerHaptic('success');
        alert('Вы прошли лабиринт! 🎉');
        stopMazeGame();
    }
}

function initMazeGame(data) {
    mazeGame.active = true;
    mazeGame.role = data.role || 'driver';
    mazeGame.grid = data.grid; // Принимаем матрицу (теперь она может быть любого размера, хоть 20х20)

    // Задаем начальные индексы игрока
    if (data.startPos) {
        mazeGame.playerX = data.startPos.x;
        mazeGame.playerY = data.startPos.y;
    } else {
        mazeGame.playerX = 1;
        mazeGame.playerY = 1;
    }

    // 🎯 ФИКС ВЫХОДА: Ищем свободную ячейку (0) с конца матрицы, чтобы финиш не был в стене
    let foundFin = false;
    for (let r = mazeGame.grid.length - 1; r >= 0; r--) {
        for (let c = mazeGame.grid[r].length - 1; c >= 0; c--) {
            if (mazeGame.grid[r][c] === 0) {
                mazeGame.finX = c;
                mazeGame.finY = r;
                foundFin = true;
                break;
            }
        }
        if (foundFin) break;
    }

    // UI менеджмент кнопок
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    const mazeBtn = document.getElementById('btn-maze');
    if (mazeBtn) mazeBtn.classList.add('active');

    // Считаем пропорции экрана
    recalcMazeMetrics();

    // Начальная позиция фонарика — центр лабиринта
    mazeGame.localLightX = mazeGame.canvas.width / 2;
    mazeGame.localLightY = mazeGame.canvas.height / 2;
    mazeGame.partnerLightPctX = 0.5;
    mazeGame.partnerLightPctY = 0.5;

    setupMazeControls();
}

// Вынесли расчет метрик в отдельную функцию для удобства ресайза
function recalcMazeMetrics() {
    const canvas = mazeGame.canvas;
    if (!canvas || !mazeGame.grid) return;

    const rows = mazeGame.grid.length;
    const cols = mazeGame.grid[0].length;

    // Автоматическое масштабирование под экран телефона
    const scaleX = canvas.clientWidth / cols;
    const scaleY = canvas.clientHeight / rows;
    mazeGame.cellSize = Math.min(scaleX, scaleY) * 0.95; // 5% запас на адаптивные отступы

    // Центрирование сетки на Canvas
    mazeGame.offsetX = (canvas.width - (cols * mazeGame.cellSize)) / 2;
    mazeGame.offsetY = (canvas.height - (rows * mazeGame.cellSize)) / 2;
}

function stopMazeGame() {
    mazeGame.active = false;
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-tap')?.classList.add('active');
}

function setupMazeControls() {
    const canvas = mazeGame.canvas;
    
    const handleMove = (e) => {
        if (!mazeGame.active) return;
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        if (mazeGame.role === 'light') {
            // 1. Локально сохраняем точные пиксели для плавной отрисовки у себя
            mazeGame.localLightX = touchX;
            mazeGame.localLightY = touchY;

            // 2. 🎯 ФИКС РАЗНЫХ ЭКРАНОВ: Переводим пиксели в нормализованные проценты (0.0 - 1.0) внутри лабиринта
            const mazeWidth = mazeGame.grid[0].length * mazeGame.cellSize;
            const mazeHeight = mazeGame.grid.length * mazeGame.cellSize;
            
            const pctX = (touchX - mazeGame.offsetX) / mazeWidth;
            const pctY = (touchY - mazeGame.offsetY) / mazeHeight;

            // Отправляем партнеру проценты, а не пиксели!
            sendMazeData({
                type: 'maze_move',
                role: 'light',
                pctX: Math.max(0, Math.min(1, pctX)),
                pctY: Math.max(0, Math.min(1, pctY))
            });
        } 
        else if (mazeGame.role === 'driver') {
            // Водитель управляет дискретными шагами (кликами в сторону от фишки)
            const size = mazeGame.cellSize;
            const currentPixelX = mazeGame.offsetX + mazeGame.playerX * size + size / 2;
            const currentPixelY = mazeGame.offsetY + mazeGame.playerY * size + size / 2;

            let nextX = mazeGame.playerX;
            let nextY = mazeGame.playerY;

            const diffX = touchX - currentPixelX;
            const diffY = touchY - currentPixelY;

            if (Math.abs(diffX) > Math.abs(diffY)) {
                nextX += diffX > 0 ? 1 : -1;
            } else {
                nextY += diffY > 0 ? 1 : -1;
            }

            // Проверяем коллизию локально перед отправкой
            if (nextY >= 0 && nextY < mazeGame.grid.length && nextX >= 0 && nextX < mazeGame.grid[0].length) {
                if (mazeGame.grid[nextY][nextX] === 0) {
                    sendMazeData({
                        type: 'maze_move',
                        role: 'driver',
                        x: nextX,
                        y: nextY
                    });
                } else {
                    if (typeof triggerHaptic === 'function') triggerHaptic('error');
                }
            }
        }
    };

    // Используем pointer-события для универсальной поддержки тачей и мыши
    canvas.addEventListener('pointerdown', handleMove, { passive: false });
    if (mazeGame.role === 'light') {
        canvas.addEventListener('pointermove', handleMove, { passive: false });
    }
}

function renderMaze() {
    if (!mazeGame.active || !mazeGame.grid) return;

    const ctx = mazeGame.ctx;
    const canvas = mazeGame.canvas;
    const size = mazeGame.cellSize;

    // Ресайз буфера под CSS
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        recalcMazeMetrics();
    }

    const ox = mazeGame.offsetX;
    const oy = mazeGame.offsetY;
    const mazeWidth = mazeGame.grid[0].length * size;
    const mazeHeight = mazeGame.grid.length * size;

    // 1. Очистка экрана
    ctx.fillStyle = '#050512';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Подложка под лабиринт (чтобы ограничить темноту игровым полем)
    ctx.fillStyle = '#020207';
    ctx.fillRect(ox, oy, mazeWidth, mazeHeight);

    // 2. Рендеринг финиша (Рассчитывается динамически из безопасных индексов)
    const finPixelX = ox + mazeGame.finX * size + size / 2;
    const finPixelY = oy + mazeGame.finY * size + size / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(finPixelX, finPixelY, size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00f0ff';
    ctx.fill();
    ctx.restore();

    // 3. Вычисляем физическую пиксельную координату центра фонарика на текущем экране
    let renderLightX = 0;
    let renderLightY = 0;

    if (mazeGame.role === 'light') {
        // Мы сами свет — берем свои точные пиксели тача
        renderLightX = mazeGame.localLightX;
        renderLightY = mazeGame.localLightY;
    } else {
        // Мы водитель — восстанавливаем пиксели партнера из нормализованных процентов под наш экран
        renderLightX = ox + mazeGame.partnerLightPctX * mazeWidth;
        renderLightY = oy + mazeGame.partnerLightPctY * mazeHeight;
    }

    // 4. НАЛОЖЕНИЕ ТЕМНОТЫ И МАСКИ ФОНАРЯ
    ctx.save();
    
    // Создаем круглую маску видимости фонаря (радиус равен 2.5 ячейкам)
    ctx.beginPath();
    ctx.arc(renderLightX, renderLightY, size * 2.5, 0, Math.PI * 2);
    ctx.clip();

    // Отрисовываем неоновые стены ТОЛЬКО внутри маски фонаря
    for (let r = 0; r < mazeGame.grid.length; r++) {
        for (let c = 0; c < mazeGame.grid[r].length; c++) {
            if (mazeGame.grid[r][c] === 1) {
                ctx.fillStyle = '#131326';
                ctx.strokeStyle = '#ff9900'; // Оранжевый неон
                ctx.lineWidth = 1.5;
                ctx.fillRect(ox + c * size, oy + r * size, size, size);
                ctx.strokeRect(ox + c * size, oy + r * size, size, size);
            }
        }
    }
    ctx.restore();

    // 5. Рисуем игрока (Фишку) по его индексам сетки
    const playerPixelX = ox + mazeGame.playerX * size + size / 2;
    const playerPixelY = oy + mazeGame.playerY * size + size / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(playerPixelX, playerPixelY, size * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3366'; // Розовая светящаяся фишка
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff3366';
    ctx.fill();
    ctx.restore();
}

function sendMazeData(payload) {
    if (typeof sendNetData === 'function') {
        sendNetData(payload);
    } else if (window.ws && window.ws.readyState === WebSocket.OPEN) {
        window.ws.send(JSON.stringify(payload));
    }
}
