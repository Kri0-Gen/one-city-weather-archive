"use strict";

const TEMPERATURE = 'temperature';
const PRECIPITATION = 'precipitation';

const MIN_YEAR = 1881;
const MAX_YEAR = 2006;

const UNITS = {
    DAY: 'day',
    WEEK: 'week',
    MONTH: 'month',
    YEAR: 'year'
};

const onBaseOk = () => postMessage({ action: 'base-ok' });
const onDrawFinish = () => postMessage({ action: 'draw-finish' });
const drawAxis = (data) => postMessage({ action: 'draw-axis', data });
const clear = () => postMessage({ action: 'clear' });
const draw = (data) => postMessage({ action: 'draw', data });

const getDaysInMonth = (month, year) => {
    switch (month) {
        case 1:
        case 3:
        case 5:
        case 7:
        case 8:
        case 10:
        case 12:
            return 31;
        case 4:
        case 6:
        case 9:
        case 11:
            return 30;
        case 2:
            return (year % 4 === 0 && !(year % 100 === 0 && year % 400 !== 0)) ? 29 : 28
    }
};

/**
 * Parse date to object
 * @param {string} date in format "YYYY-MM-DD"
 * @returns {{year: string, month: string, day: string}}
 */
const parseDate = (date) => {
    const [year, month, day] = date.split('-');
    return { year, month, day };
};

/**
 * @param year
 * @param month
 * @returns string in format "YYYY_MM"
 */
const getRecordName = (year, month) => `${year}_${(month < 10 ? '0' : '') + Number(month)}`;

/**
 * @param baseName
 * @returns {Promise}
 */
const openBase = (baseName) => {
    return new Promise((resolve, reject) => {
        const base = indexedDB.open(baseName);
        base.onsuccess = (event) => {
            resolve(event.target.result);
        };
        base.onupgradeneeded = (event) => {
            const base = event.target.result;
            const promises = [];
            for (let year = MIN_YEAR; year <= MAX_YEAR; year++) {
                for (let month = 1; month <= 12; month++) {
                    promises.push(new Promise((resolve) => {
                        const createObjectStoreRequest = base
                            .createObjectStore(getRecordName(year, month));
                        createObjectStoreRequest.onsuccess = resolve;
                    }));
                }
            }
            Promise.all(promises)
                .then(() => resolve(base));
        };
        base.onerror = () => {
            reject();
        };
    });
};

/**
 * @param chart current chart name
 * @returns {Promise}
 */
const fillBase = (chart) => {
    return fetch(`/${chart}.json`)
        .then((res) => {
            return res.json().then((data) => {
                const groups = {};
                data.forEach((item) => {
                    const date = parseDate(item.t);
                    const groupName = getRecordName(date.year, date.month);
                    if (!groups[groupName]) {
                        groups[groupName] = {
                            year: date.year,
                            month: date.month,
                            days: []
                        };
                    }
                    groups[groupName].days.push({ day: date.day, value: item.v });
                });

                return openBase(chart).then((base) => {
                    const promises = [];
                    Object.keys(groups).forEach((groupName) => {
                        promises.push(new Promise((resolve) => {
                            const objectStore = base
                                .transaction([groupName], 'readwrite')
                                .objectStore(groupName);
                            const count = objectStore.count();
                            count.onsuccess = () => {
                                if (!count.result) {
                                    const putPromises = [];
                                    groups[groupName].days.forEach((dayObject) => {
                                        putPromises.push(new Promise((putResolve) => {
                                            const putRequest = objectStore
                                                .put(dayObject.value, Number(dayObject.day));
                                            putRequest.onsuccess = putResolve;
                                        }));
                                    });
                                    Promise.all(putPromises).then(resolve);
                                } else {
                                    resolve();
                                }
                            };
                        }));
                    });
                    return Promise.all(promises);
                });
            });
        });
};

/**
 * @param chart
 * @param from
 * @param to
 * @returns {Promise}
 */
const checkDataExists = (chart, from, to) => {
    return openBase(chart).then((base) => {
        const promises = [];
        for (let year = from; year <= to; year++) {
            for (let month = 1; month <= 12; month++) {
                promises.push(new Promise((resolve, reject) => {
                    const objectName = getRecordName(year, month);
                    const objectStore = base.transaction([objectName], 'readonly').objectStore(objectName);
                    const count = objectStore.count();
                    count.onsuccess = () => {
                        return count.result ? resolve() : reject();
                    };
                }));
            }
        }
        return Promise.all(promises).catch(() => {
            return fillBase(chart);
        });
    });
};

class DataDrawer {
    constructor({ currentChart, from, to, width, height }) {
        this.chart = currentChart;
        this.from = from;
        this.to = to;
        this.currentYear = null;
        this.width = width;
        this.height = height;

        this.groups = [];
        this.unit = null;
        this.groupWidth = null;
        this.lastDrawIndex = -1;

        this.base = null;
        this.minValue = null;
        this.maxValue = null;
        this.minimumInAxis = null;
        this.maximumInAxis = null;
    }

    /**
     * Получает список значений по дням в группе и считает значение группы
     * Для температуры - это средняя температра по группе
     * Для осадков - это сумма осадков по группе
     * @param {Array<Number>} valueArray - список значений по дням в группе
     * @private
     */
    _addGroup(valueArray) {
        // считаем среднее за период и записываем
        const sum = valueArray.reduce((accumulator, nextItem) => accumulator + nextItem, 0);
        const groupValue = this.chart === TEMPERATURE ? sum / valueArray.length : sum;
        this.groups.push(groupValue);
        if (this.minValue === null || this.minValue > groupValue) {
            this.minValue = groupValue;
        }
        if (this.maxValue === null || this.maxValue < groupValue) {
            this.maxValue = groupValue;
        }
    }

    /**
     * Рисует шкалу по значениям и по годам
     * @private
     */
    _drawMeasures() {
        const data = [];

        // рисуем шкалы по значениям температур / осадков
        const xCount = Math.ceil(this.height / 20);
        const growthVal = Math.max(Math.ceil((this.maximumInAxis - this.minimumInAxis) / xCount), 1);
        for (let value = this.minimumInAxis + growthVal; value <= this.maximumInAxis; value += growthVal) {
            data.push({
                axis: 'x',
                value,
                y: (this.maximumInAxis - value) * this.height / (this.maximumInAxis - this.minimumInAxis)
            });
        }

        // рисуем шкалы по годам
        const yearAxisCount = Math.min(Math.ceil(this.width / 60), this.to - this.from + 1);
        const yearGrowthVal = Math.ceil((this.to - this.from + 1) / yearAxisCount);

        // при группировке по годам, год - это одна точка
        // при группировке по менбьшему периоду, год - это промежуток из нескольких точек,
        // поэтому по сути расчёты начинаются с конца прошлого года и надо вывести на оси больше на 1 год
        const isGroupByYears = this.unit === UNITS.YEAR;
        const yearWidth = this.width / (this.to - this.from + (isGroupByYears ? 0 : 1));
        for (let year = this.to; year >= this.from + Math.floor(yearGrowthVal / 2); year -= yearGrowthVal) {
            data.push({
                axis: 'y',
                value: year,
                x: (year - this.from + (isGroupByYears ? 0 : 1)) * yearWidth
            });
        }

        drawAxis(data);
    }

    /**
     * Проверяет накопленные данные и отрисовывает новые (которые не были отрисованы ранее)
     * @private
     */
    _drawGroups() {
        // за первые 5 лет накапливаем данные чтобы примерно представлять разброс значений и нарисовать шкалы значений
        // с учётом минимального и максимального значений
        if (this.currentYear - this.from < 4 && this.currentYear < this.to) {
            return;
        }

        // если вылезли за текущие минимальные и максимальные шкалы -
        // сбросим график и перерисуем заново с большим запасом шкал
        if (this.minValue < this.minimumInAxis || this.maxValue > this.maximumInAxis) {
            clear();
            this.lastDrawIndex = -1;
        }

        const data = [];

        const isFirstDrawing = this.lastDrawIndex === -1;
        // при первой отрисовке надо посчитать максимальное и минимальное значения по шкале значений и нарисовать шкалы
        if (isFirstDrawing) {
            // выводим на осях значения с небольшим запасом (плюс 10 процентов вверх и вниз)
            const reserve = Math.max((this.maxValue - this.minValue) * 0.1, 1);
            this.minimumInAxis = Math.floor(this.minValue - reserve);
            this.maximumInAxis = Math.ceil(this.maxValue + reserve);
            this._drawMeasures();
        } else {
            // берём последнее значение - с него начнём рисовать
            const previousValue = this.groups[this.lastDrawIndex];
            data.push(
                this.groupWidth * this.lastDrawIndex,
                (this.maximumInAxis - previousValue) * this.height / (this.maximumInAxis - this.minimumInAxis)
            );
        }
        // рисуем все значения, которые появились с прошлой отрисовки
        while (this.lastDrawIndex < this.groups.length - 1) {
            const currentIndex = this.lastDrawIndex + 1;
            const currentGroupValue = this.groups[currentIndex];
            data.push(
                this.groupWidth * currentIndex,
                (this.maximumInAxis - currentGroupValue) * this.height / (this.maximumInAxis - this.minimumInAxis)
            );
            this.lastDrawIndex++;
        }

        // для осадков возможна ситуация когда надо отрисовать 1 значение (осадки за 1 год) -
        // рисуем просто горизонтальную прямую
        if (this.chart === PRECIPITATION && this.from === this.to) {
            data.push(this.groupWidth, data[1]);
        }

        draw(data);
    }

    /**
     * Читаем значения за год и собираем их в группы значений
     * @param {Number} year - год, за который собираем значения
     * @returns {Promise.<TResult>}
     * @private
     */
    _handleYear(year) {
        let dayValueAccumulator = [];

        // обрабатываем месяца по порядку, для чего записываем их обработку в цепочку промисов
        let monthPromiseChain = Promise.resolve();
        for (let month = 1; month <= 12; month++) {
            const objectName = getRecordName(year, month);
            monthPromiseChain = monthPromiseChain.then(() => {
                let day = 1;
                // обрабатываем дни по порядку
                const daysInMonth = getDaysInMonth(month, year);
                let dayPromiseChain = Promise.resolve();
                while (day <= daysInMonth) {
                    ((dayScoped) => {
                        dayPromiseChain = dayPromiseChain.then(() => new Promise((resolve) => {
                            const objectStore = this.base
                                .transaction([objectName], 'readonly')
                                .objectStore(objectName);
                            const getDayValueRequest = objectStore.get(dayScoped);
                            getDayValueRequest.onsuccess = () => {
                                const value = getDayValueRequest.result;
                                if (this.unit === UNITS.DAY) {
                                    let a = dayScoped;
                                    this._addGroup([value]);
                                } else {
                                    dayValueAccumulator.push(value);
                                    if (this.unit === UNITS.WEEK && dayValueAccumulator.length === 7) {
                                        this._addGroup(dayValueAccumulator);
                                        dayValueAccumulator = [];
                                    }
                                }
                                resolve();
                            };
                        }));
                    })(day);
                    day++;
                }
                return dayPromiseChain.then(() => {
                    if (this.unit === UNITS.MONTH) {
                        this._addGroup(dayValueAccumulator);
                        dayValueAccumulator = [];
                    }
                });
            });
        }

        return monthPromiseChain.then(() => {
            if (this.unit === UNITS.YEAR) {
                this._addGroup(dayValueAccumulator);
            } else if (this.unit === UNITS.WEEK && dayValueAccumulator.length) {
                // в году 52 недели + 1 день (2 для високосного года)
                // выводить 1 день как отдельную неделю кажется не очень корректно,
                // поэтому просто приплюсуем его к предыдущей
                const lastGroupValue = this.groups.pop();
                const newSumm = dayValueAccumulator.reduce(
                    (accumulator, netValue) => accumulator + netValue,
                    lastGroupValue * 7
                );
                this.groups.push(newSumm / (7 + dayValueAccumulator.length));
                dayValueAccumulator = [];
            }
            this._drawGroups();
        });
    }

    /**
     * В зависимости от ширины экрана и числа дней считаем за какой период будем группировать данные
     * и считаем ширину 1 группы на графике
     * Для осадков всегда группируем данные за 1 год, суммируя осадки за год
     * Для температуры:
     *  - если в график влезает температура по дням - рисуем по дням
     *  - если влезает график по неделям - рисуем по неделям
     *  - если влезает график по месяцам - рисуем  по месяцам
     *  - иначе рисуем среднегодовые температуры
     * @private
     */
    _calcUnitAndGroupWidth() {
        const years = this.to - this.from + 1;

        // для осадков всегда выводим расшифровку по годам, так как осадки суммируются
        if (this.chart === PRECIPITATION) {
            this.unit = UNITS.YEAR;
            this.groupWidth = this.width / (years > 1 ? years - 1 : years);
            return;
        }

        // для температуры берём среднюю, поэтому можно нарисовать её более детально
        // (колебания по месяцам / неделям / дням)
        const pixelsForOneYear = this.width / years;
        if (pixelsForOneYear >= 365) {
            this.unit = UNITS.DAY;
            let longYearCount = 0;
            // считаем число високосных годов в промежутке
            for (let year = this.from; year <= this.to; year++) {
                if (year % 4 === 0) {
                    longYearCount++;
                }
            }
            this.groupWidth = this.width / (years * 365 + longYearCount - 1);
        } else if (pixelsForOneYear >= 52) {
            this.unit = UNITS.WEEK;
            this.groupWidth = this.width / (years * 52 - 1);
        } else if (pixelsForOneYear >= 12) {
            this.unit = UNITS.MONTH;
            this.groupWidth = this.width / (years * 12 - 1);
        } else {
            this.unit = UNITS.YEAR;
            this.groupWidth = this.width / (years - 1);
        }
    }

    /**
     * Запускаем новую отрисовку графика
     */
    draw() {
        openBase(this.chart).then((base) => {
            this.base = base;

            this._calcUnitAndGroupWidth();

            // обрабатываем года по порядку, для чего записываем их обработку в цепочку промисов
            let promiseChain = Promise.resolve();

            let groupIndex = 0;
            for (let year = this.from; year <= this.to; year++) {
                promiseChain = promiseChain.then(() => {
                    this.currentYear = year;
                    return this._handleYear(year);
                });
            }
            promiseChain.then(() => {
                this.currentYear = null;
                onDrawFinish();
            });
        });
    }
}

/**
 * @param currentChart
 * @param currentFrom
 * @param currentTo
 * @param width
 * @param height
 */
const calcGraphForData = ({ currentChart, currentFrom, currentTo, width, height }) => {
    if (
        ![TEMPERATURE, PRECIPITATION].includes(currentChart) ||
        isNaN(Number(currentFrom)) || isNaN(Number(currentTo)) ||
        currentFrom > currentTo ||
        currentFrom > MAX_YEAR || currentTo < MIN_YEAR
    ) {
        // ToDo: log it
        return;
    }
    const from = Math.max(currentFrom, MIN_YEAR);
    const to = Math.min(currentTo, MAX_YEAR);

    checkDataExists(currentChart, from, to)
        .then(() => {
            onBaseOk();
            (new DataDrawer({ currentChart, from, to, width, height })).draw();
        });
};

onmessage = (event) => {
    calcGraphForData(event.data);
};
