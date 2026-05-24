// Обновленная структура состояния игры
let mazeGame = {
    active: false,
    role: null,         // 'light' или 'driver'
    grid: [],           // Матрица лабиринта [[1,1,...], [1,0,...]]
    cellSize: 40,       // Динамический размер ячейки в пикселях
    offsetX: 0,         // Смещение для центрирования по X
    offsetY: 0,         // Смещение для центрирования по Y
    
    // Позиции хранятся в индексах сетки (col, row), а не в пикселях!
    player: { x: 1, y: 1 },
    partnerLight: { x: 1, y: 1 }, // Индексы, где находится свет партнера
    
    // Пиксельные координаты для плавного перемещения фонарика (если роль light)
    localLightPix: { x: 0, y: 0 }, 
    
    fin: { x: 3, y: 3 }, // Автоматически найдем свободную точку внизу лабиринта
    canvas: null,
    ctx: null
};

// 1. Инициализация игры с новыми серверными данными
function initMazeGame(data) {
    mazeGame.active = true;
    mazeGame.role = data.role || 'driver'; // Если сервер не прислал, дефолтим
    mazeGame.grid = data.grid;             // Принимаем матрицу
    
    // Устанавливаем начальную позицию игрока по индексам сетки
    if (data.startPos) {
        mazeGame.player.x = data.startPos.x;
        mazeGame.player.y = data.startPos.y;
    } else {
        mazeGame.player. = { x: 1, y: 1 };
    }

    // Автоматически ищем финиш (последняя пустая ячейка с конца лабиринта)
    let foundFin = false;
    for (let r = mazeGame.grid.length - 1; r >= 0; r--) {
        for (let c = mazeGame.grid[r].length - 1; c >= 0; c--) {
            if (mazeGame.grid[r][c] === 0) {
                mazeGame.fin = { x: c, y: r };
                foundFin = true;
                break;
            }
        }
        if (foundFin) break;
    }

    // Переключаем активную кнопку в UI
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('btn-maze')?.classList.add('active');

    // Рассчитываем размеры под текущий экран
    updateMazeScales();

    // Задаем начальную пиксельную позицию фонаря в центр экрана
    mazeGame.localLightPix.x = mazeGame.canvas.width / 2;
    mazeGame.localLightPix.y = mazeGame.canvas.height / 2;

    setupMazeControls();
}

// Вспомогательная функция расчета масштаба и центрирования
function updateMazeScales() {
    const canvas = mazeGame.canvas;
    const rows = mazeGame.grid.length;
    const cols = mazeGame.grid[0].length;
    
    const scaleX = canvas.clientWidth / cols;
    const scaleY = canvas.clientHeight / rows;
    
    // Берем меньшее, чтобы лабиринт гарантированно влез на экран смартфона
    mazeGame.cellSize = Math.min(scaleX, scaleY) * 0.98; 

    // Рассчитываем отступы, чтобы лабиринт стоял ровно по центру холста
    mazeGame.offsetX = (canvas.width - (cols * mazeGame.cellSize)) / 2;
    mazeGame.offsetY = (canvas.height - (rows * mazeGame.cellSize)) / 2;
}

// 2. Улучшенное управление (нажатия по направлениям)
function setupMazeControls() {
    const canvas = mazeGame.canvas;
    
    const handleTouch = (e) => {
        if (!mazeGame.active) return;
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        const touch = e.touches ? e.touches[0] : e;
        const touchX = touch.clientX - rect.left;
        const touchY = touch.clientY - rect.top;

        if (mazeGame.role === 'light') {
            // Фонарик движется плавно за пальцем в пикселях
            mazeGame.localLightPix.x = touchX;
            mazeGame.localLightPix.y = touchY;

            // Переводим пиксели в индексы сетки, чтобы отправить партнеру
            const gridX = Math.floor((touchX - mazeGame.offsetX) / mazeGame.cellSize);
            const gridY = Math.floor((touchY - mazeGame.offsetY) / mazeGame.cellSize);
            
            sendMazeData({
                type: 'maze_move',
                role: 'light',
                x: gridX,
                y: gridY
            });
        } 
        else if (mazeGame.role === 'driver') {
            // Улучшенная дискретная логика для игрока: кликаешь/тапаешь в сторону от фишки
            // Находим пиксельный центр текущей ячейки игрока
            const pCenterX = mazeGame.offsetX + mazeGame.player.x * mazeGame.cellSize + mazeGame.cellSize / 2;
            const pCenterY = mazeGame.offsetY + mazeGame.player.y * mazeGame.cellSize + mazeGame.cellSize / 2;

            let nextX = mazeGame.player.x;
            let nextY = mazeGame.player.y;

            // Вычисляем вектор клика относительно игрока
            const diffX = touchX - pCenterX;
            const diffY = touchY - pCenterY;

            // Двигаемся на 1 шаг в сторону наибольшего отклонения
            if (Math.abs(diffX) > Math.abs(diffY)) {
                nextX += diffX > 0 ? 1 : -1;
            } else {
                nextY += diffY > 0 ? 1 : -1;
            }

            // Валидация шага: проверка на границы лабиринта и на стены (0 - проход)
            if (nextY >= 0 && nextY < mazeGame.grid.length && nextX >= 0 && nextX < mazeGame.grid[0].length) {
                if (mazeGame.grid[nextY][nextX] === 0) {
                    // Локально не меняем! Ждем подтверждения или шлем интент на бэкенд
                    sendMazeData({
                        type: 'maze_move',
                        role: 'driver',
                        x: nextX,
                        y: nextY
                    });
                } else {
                    if (typeof triggerHaptic === 'function') triggerHaptic('error'); // Вибро: уперся в стену
                }
            }
        }
    };

    // Слушаемpointer-события (работает и на десктопе, и на смартфонах)
    canvas.addEventListener('pointerdown', handleTouch, { passive: false });
    if (mazeGame.role === 'light') {
        canvas.addEventListener('pointermove', handleTouch, { passive: false });
    }
}

// 3. Исправленный и чистый рендеринг лабиринта
function renderMaze() {
    if (!mazeGame.active) return;

    const ctx = mazeGame.ctx;
    const canvas = mazeGame.canvas;
    const size = mazeGame.cellSize;
    const ox = mazeGame.offsetX;
    const oy = mazeGame.offsetY;

    // Ресайз буфера под CSS-размеры экрана смартфона
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        updateMazeScales();
    }

    // Черный фон
    ctx.fillStyle = '#05050d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Подсветка финиша
    ctx.save();
    const finPx = ox + mazeGame.fin.x * size + size / 2;
    const finPy = oy + mazeGame.fin.y * size + size / 2;
    ctx.beginPath();
    ctx.arc(finPx, finPy, size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#00f0ff';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00f0ff';
    ctx.fill();
    ctx.restore();

    // Рассчитываем пиксельный центр маски света фонарика
    let lightPx = 0, lightPy = 0;
    if (mazeGame.role === 'light') {
        lightPx = mazeGame.localLightPix.x;
        lightPy = mazeGame.localLightPix.y;
    } else {
        // Если мы водитель, получаем пиксельные координаты из сетки, куда светит партнер
        lightPx = ox + mazeGame.partnerLight.x * size + size / 2;
        lightPy = oy + mazeGame.partnerLight.y * size + size / 2;
    }

    // НАЛОЖЕНИЕ МАСКИ ТЕМНОТЫ
    ctx.save();
    
    // Создаем область видимости фонарика (радиус равен 2.5 ячейкам)
    ctx.beginPath();
    ctx.arc(lightPx, lightPy, size * 2.5, 0, Math.PI * 2);
    ctx.clip();

    // Внутри маски рендерим неоновые стены лабиринта
    for (let r = 0; r < mazeGame.grid.length; r++) {
        for (let c = 0; c < mazeGame.grid[r].length; c++) {
            if (mazeGame.grid[r][c] === 1) {
                ctx.fillStyle = '#111122';
                ctx.strokeStyle = '#ff9900'; // Оранжевый неон
                ctx.lineWidth = 1.5;
                ctx.fillRect(ox + c * size, oy + r * size, size, size);
                ctx.strokeRect(ox + c * size, oy + r * size, size, size);
            }
        }
    }
    ctx.restore();

    // Рисуем фишку игрока (Видна всегда, либо подгони под маску при желании)
    const playerPx = ox + mazeGame.player.x * size + size / 2;
    const playerPy = oy + mazeGame.player.y * size + size / 2;
    
    ctx.save();
    ctx.beginPath();
    ctx.arc(playerPx, playerPy, size * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#ff3366'; // Розовый неон
    ctx.shadowBlur = 15;
    ctx.shadowColor = '#ff3366';
    ctx.fill();
    ctx.restore();
}

// 4. Сетевой мост
function handleMazeNetwork(data) {
    if (data.type === 'maze_start') {
        initMazeGame(data);
    } 
    else if (data.type === 'maze_player_sync') {
        // Синхронизация позиции игрока от сервера по индексам
        mazeGame.player.x = data.x;
        mazeGame.player.y = data.y;
    } 
    else if (data.type === 'maze_light_sync') {
        // Синхронизация фонарика партнера по индексам
        mazeGame.partnerLight.x = data.x;
        mazeGame.partnerLight.y = data.y;
    } 
    else if (data.type === 'maze_win') {
        if (typeof triggerHaptic === 'function') triggerHaptic('success');
        alert('Вы прошли лабиринт! 🎉');
        stopMazeGame();
    }
}
