(() => {
    "use strict";

    const TEMPERATURE = 'temperature';
    const PRECIPITATION = 'precipitation';

    const MIN_YEAR = 1881;
    const MAX_YEAR = 2006;

    // Вписываем Canvas в экран, ограничивая минимальные и максимальные размеры.
    // На resize окна не подписываемся, а считаем, что Resize - редкое явление, а если и будет Resize,
    // то не страшно если появится скроллбар или наоборот Canvas будет меньше чем мог бы уместиться.
    const CANVAS_SIZE = {
        width: Math.min(1000, Math.max(400, window.innerWidth - 250)),
        height: Math.min(300, Math.max(150, window.innerHeight - 160))
    };

    const WORKER_STATES = {
        new: 'new',
        started: 'started',
        drawing: 'drawing',
        finished: 'finished',
        waitingTerminate: 'waiting-terminate'
    };

    const temperatureRadio = document.querySelector('#temperature');
    const precipitationRadio = document.querySelector('#precipitation');
    const fromSelect = document.querySelector('#from');
    const toSelect = document.querySelector('#to');
    const canvas = document.querySelector('#canvas');

    let currentChart = TEMPERATURE;
    let currentFrom = MIN_YEAR;
    let currentTo = MAX_YEAR;

    canvas.width = CANVAS_SIZE.width;
    canvas.height = CANVAS_SIZE.height;

    // заполняем варианты выбора года автоматически, чтобы не вбивать руками в HTML
    let year = MIN_YEAR;
    while (year <= MAX_YEAR) {
        const optionFrom = document.createElement('option');
        optionFrom.value = String(year);
        optionFrom.innerHTML = year;
        fromSelect.appendChild(optionFrom);

        const optionTo = document.createElement('option');
        optionTo.value = String(year);
        optionTo.innerHTML = year;
        toSelect.appendChild(optionTo);

        year++;
    }

    fromSelect.value = currentFrom;
    toSelect.value = currentTo;

    const spin = document.querySelector('.content__spin');
    const noData = document.querySelector('.content__no-data');

    // очистка Canvas-а перед новой отрисовкой
    const clearAll = () => {
        const canvasContext = canvas.getContext('2d');
        canvasContext.clearRect(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height);
        spin.classList.remove('content__spin_visible');
        noData.classList.remove('content__no-data_visible');
    };

    const validate = () => currentFrom <= currentTo;

    const worker = {
        instance: null,
        state: WORKER_STATES.new
    };

    const startWorker = () => {
        clearAll();
        if (validate()) {
            spin.classList.add('content__spin_visible');
            worker.state = WORKER_STATES.started;
            worker.instance.postMessage(Object.assign({
                currentChart,
                currentFrom,
                currentTo
            }, CANVAS_SIZE));
        } else {
            noData.classList.add('content__no-data_visible');
        }
    };

    const subscribeWorker = () => {
        worker.instance.onmessage = (event) => {
            const data = event.data;
            const canvasContext = canvas.getContext('2d');
            switch (data.action) {
                case 'clear':
                    clearAll();
                    break;
                case 'draw':
                    spin.classList.remove('content__spin_visible');
                    canvasContext.beginPath();
                    canvasContext.strokeStyle = '#000';
                    let x = data.data.shift();
                    let y = data.data.shift();
                    canvasContext.moveTo(x, y);
                    while (data.data.length) {
                        let x = data.data.shift();
                        let y = data.data.shift();
                        canvasContext.lineTo(x, y);
                    }
                    canvasContext.stroke();
                    canvasContext.closePath();
                    break;
                case 'draw-axis':
                    canvasContext.beginPath();
                    canvasContext.strokeStyle = '#ccc';
                    event.data.data.forEach(({ axis, value, x, y }) => {
                        if (axis === 'x') {
                            canvasContext.moveTo(0, y);
                            canvasContext.lineTo(CANVAS_SIZE.width, y);
                            canvasContext.textAlign = 'left';
                            canvasContext.textBaseline = 'bottom';
                            canvasContext.fillText(value, 1, y - 1);
                        } else {
                            canvasContext.moveTo(x, 0);
                            canvasContext.lineTo(x, CANVAS_SIZE.height);
                            canvasContext.textAlign = 'right';
                            canvasContext.textBaseline = 'bottom';
                            canvasContext.fillText(value, x - 1, CANVAS_SIZE.height - 1);
                        }
                    });
                    canvasContext.stroke();
                    canvasContext.closePath();
                    break;
                case 'draw-finish':
                    worker.state = WORKER_STATES.finished;
                    break;
                case 'base-ok':
                    if (worker.state === WORKER_STATES.waitingTerminate) {
                        // ждём окочания заполнения базы чтобы убить воркера и приходит окончание заполнения
                        worker.instance.terminate();
                        worker.instance = null;
                        worker.state = WORKER_STATES.new;
                        start();
                    } else {
                        worker.state = WORKER_STATES.drawing;
                    }
                    break;
            }
        };
    };

    const createNewWorker = () => {
        worker.instance = new Worker('worker.js');
        worker.state = WORKER_STATES.new;
        subscribeWorker();
    };

    // старт нового расчёта
    // если в текущий момент уже идёт рисование, то прерываем его, убивая воркер
    // но не убиваем воркер если он в процессе заполнения базы, а дождёмся окончания заполнения и только тогда убъём
    const start = () => {
        switch (worker.state) {
            case WORKER_STATES.new:
                createNewWorker();
                startWorker();
                break;
            case WORKER_STATES.finished:
                worker.state = WORKER_STATES.started;
                startWorker();
                break;
            case WORKER_STATES.drawing:
                worker.instance.terminate();
                createNewWorker();
                startWorker();
                break;
            case WORKER_STATES.started:
                worker.state = WORKER_STATES.waitingTerminate;
                break;
        }
    };

    start();

    temperatureRadio.onclick = () => {
        if (currentChart !== TEMPERATURE) {
            currentChart = TEMPERATURE;
            start();
        }
    };
    precipitationRadio.onchange = () => {
        if (currentChart !== PRECIPITATION) {
            currentChart = PRECIPITATION;
            start();
        }
    };
    fromSelect.onchange = () => {
        if (currentFrom !== fromSelect.value) {
            currentFrom = fromSelect.value;
            start();
        }
    };
    toSelect.onchange = () => {
        if (currentTo !== toSelect.value) {
            currentTo = toSelect.value;
            start();
        }
    };
})();
