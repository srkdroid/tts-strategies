// Calendar Calculation Engine (Node.js & Shared)
// Mirror of app.js calendar scheduling logic

function formatDateString(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

const DEFAULT_HOLIDAYS_2026 = {
    "2026-01-26": "Republic Day",
    "2026-03-03": "Holi",
    "2026-03-26": "Shri Ram Navami",
    "2026-03-31": "Shri Mahavir Jayanti",
    "2026-04-03": "Good Friday",
    "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
    "2026-05-01": "Maharashtra Day",
    "2026-05-28": "Bakri Id",
    "2026-06-26": "Muharram",
    "2026-09-14": "Ganesh Chaturthi",
    "2026-10-02": "Mahatma Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-11-10": "Diwali-Balipratipada",
    "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
    "2026-12-25": "Christmas"
};

function getHolidayOrWeekend(date, holidays = DEFAULT_HOLIDAYS_2026) {
    const dateCopy = new Date(date.getTime());
    const dateStr = formatDateString(dateCopy);
    
    if (holidays && holidays[dateStr]) {
        return holidays[dateStr];
    }
    
    const dayOfWeek = dateCopy.getDay();
    if (dayOfWeek === 0) return "Sunday (Weekend)";
    if (dayOfWeek === 6) return "Saturday (Weekend)";
    
    return null;
}

function getPreviousTradingDay(date, holidays = DEFAULT_HOLIDAYS_2026) {
    let temp = new Date(date.getTime());
    temp.setDate(temp.getDate() - 1);
    while (getHolidayOrWeekend(temp, holidays)) {
        temp.setDate(temp.getDate() - 1);
    }
    return temp;
}

function getExpiriesForMonth(year, month, dayOfWeek, holidays = DEFAULT_HOLIDAYS_2026) {
    let expiries = [];
    let d = new Date(year, month, 1);
    
    while (d.getMonth() === month) {
        if (d.getDay() === dayOfWeek) {
            let originalDate = new Date(d.getTime());
            let actualDate = new Date(d.getTime());
            
            let holidayName = getHolidayOrWeekend(originalDate, holidays);
            if (holidayName && holidayName !== "Saturday (Weekend)" && holidayName !== "Sunday (Weekend)") {
                actualDate = getPreviousTradingDay(originalDate, holidays);
            }
            
            expiries.push({
                original: originalDate,
                actual: actualDate,
                isMonthly: false
            });
        }
        d.setDate(d.getDate() + 1);
    }
    
    if (expiries.length > 0) {
        expiries[expiries.length - 1].isMonthly = true;
    }
    
    return expiries;
}

const EXIT_RULES = {
    "monthly-batman":               { type: "day_of_expiry_month", day: 7 },
    "monthly-no-brainer-nifty":     { type: "day_of_expiry_month", day: 21 },
    "monthly-no-brainer-banknifty": { type: "before_expiry", days: 1 },
    "monthly-hni-nifty":            { type: "nth_weekday_of_expiry_month", weekday: 5, n: 3 },
    "monthly-autopilot-finnifty":   { type: "next_weekday", weekday: 4 },
    "monthly-double-decker":        { type: "day_of_expiry_month", day: 12 },
    "biweekly-bwb-2":               { type: "next_weekday", weekday: 4 },
    "biweekly-broken-wing-3":       { type: "next_weekday", weekday: 2 },
    "biweekly-hni-4":               { type: "next_weekday", weekday: 5 },
    "biweekly-blazeBF-1":           { type: "next_weekday", weekday: 5 },
    "stbt-nifty-3d-ladder-2":       { type: "next_weekday", weekday: 5 },
    "stbt-ce-dominator-3":          { type: "next_weekday", weekday: 1 },
    "stbt-matrix-calendar-4":       { type: "next_weekday", weekday: 1 },
    "stbt-sensex-no-brainer-5":     { type: "next_weekday", weekday: 1 },
    "stbt-fin-nifty-2d-ladder-6":   { type: "next_weekday", weekday: 1 }
};

const DEPLOY_RULES = {
    "monthly-batman":               { type: "preceding_month_friday", dte_min: 39, dte_max: 44 },
    "monthly-no-brainer-nifty":     { type: "preceding_month_friday", dte_min: 29, dte_max: 34 },
    "monthly-no-brainer-banknifty": { type: "expiry_offset", offset_days: -12, monthly_only: true },
    "monthly-hni-nifty":            { type: "preceding_month_friday", dte_min: 39, dte_max: 43 },
    "monthly-autopilot-finnifty":   { type: "expiry_offset", offset_days: -12, monthly_only: true },
    "monthly-double-decker":        { type: "preceding_month_friday", dte_min: 39, dte_max: 43 },
    "biweekly-bwb-2":               { type: "expiry_offset", offset_days: -12 },
    "biweekly-broken-wing-3":       { type: "expiry_offset", offset_days: -7 },
    "biweekly-hni-4":               { type: "expiry_offset", offset_days: -8 },
    "biweekly-blazeBF-1":           { type: "expiry_offset", offset_days: -8 },
    "stbt-nifty-3d-ladder-2":       { type: "expiry_offset", offset_days: -5 },
    "stbt-ce-dominator-3":          { type: "expiry_offset", offset_days: -4 },
    "stbt-matrix-calendar-4":       { type: "expiry_offset", offset_days: -11 },
    "stbt-sensex-no-brainer-5":     { type: "expiry_offset", offset_days: -6 },
    "stbt-fin-nifty-2d-ladder-6":   { type: "expiry_offset", offset_days: -4, monthly_only: true }
};

function calculateExitDate(deployDate, expiryDate, exitRule, holidays = DEFAULT_HOLIDAYS_2026) {
    if (!exitRule) return null;
    let exitDate = null;

    if (exitRule.type === "day_of_expiry_month") {
        exitDate = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), exitRule.day);
    } else if (exitRule.type === "before_expiry") {
        exitDate = new Date(expiryDate.getTime());
        exitDate.setDate(exitDate.getDate() - exitRule.days);
    } else if (exitRule.type === "nth_weekday_of_expiry_month") {
        const { weekday, n } = exitRule;
        let d = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), 1);
        let count = 0;
        while (d.getMonth() === expiryDate.getMonth()) {
            if (d.getDay() === weekday) {
                count++;
                if (count === n) { exitDate = new Date(d); break; }
            }
            d.setDate(d.getDate() + 1);
        }
    } else if (exitRule.type === "next_weekday") {
        const { weekday } = exitRule;
        let d = new Date(deployDate.getTime());
        d.setDate(d.getDate() + 1);
        while (d.getDay() !== weekday) {
            d.setDate(d.getDate() + 1);
        }
        exitDate = d;
    }

    if (exitDate) {
        const holiday = getHolidayOrWeekend(exitDate, holidays);
        if (holiday) {
            exitDate = getPreviousTradingDay(exitDate, holidays);
        }
    }

    return exitDate;
}

function calculateDeploymentsForRange(startDate, endDate, strategiesData, holidays = DEFAULT_HOLIDAYS_2026) {
    let deployments = [];
    
    const startYear = startDate ? startDate.getFullYear() : 2026;
    const startMonth = startDate ? Math.max(0, startDate.getMonth() - 1) : 0;
    const endYear = endDate ? endDate.getFullYear() : 2026;
    const endMonth = endDate ? Math.min(11, endDate.getMonth() + 1) : 11;
    
    let niftyExpiries = [];
    let sensexExpiries = [];
    
    for (let y = startYear; y <= endYear; y++) {
        const mStart = (y === startYear) ? startMonth : 0;
        const mEnd = (y === endYear) ? endMonth : 11;
        for (let m = mStart; m <= mEnd; m++) {
            niftyExpiries = niftyExpiries.concat(getExpiriesForMonth(y, m, 2, holidays)); // Tuesdays
            sensexExpiries = sensexExpiries.concat(getExpiriesForMonth(y, m, 4, holidays)); // Thursdays
        }
    }
    
    const calendarStrategies = (strategiesData || []).filter(s => 
        !s.strategy_category || s.strategy_category === '0_adjustment'
    );

    calendarStrategies.forEach(strategy => {
        const masterDeploy = DEPLOY_RULES[strategy.id] || (strategy.name ? DEPLOY_RULES[Object.keys(DEPLOY_RULES).find(k => k && strategy.name.toLowerCase().includes(k.replace(/^(monthly|biweekly|stbt)-/, '').replace(/-\d+$/, '')))] : null);
        const deployRule = strategy.deploy_rule || masterDeploy;
        const masterExit = EXIT_RULES[strategy.id] || (strategy.name ? EXIT_RULES[Object.keys(EXIT_RULES).find(k => k && strategy.name.toLowerCase().includes(k.replace(/^(monthly|biweekly|stbt)-/, '').replace(/-\d+$/, '')))] : null);
        const exitRule = strategy.exit_rule || masterExit;

        const isSensex = (strategy.index || '').includes("Sensex");
        const expiries = isSensex ? sensexExpiries : niftyExpiries;
        
        expiries.forEach(expiry => {
            let nominalDate = null;
            
            if (deployRule) {
                if (deployRule.type === "expiry_offset") {
                    if (!deployRule.monthly_only || expiry.isMonthly) {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() + deployRule.offset_days);
                    }
                } else if (deployRule.type === "preceding_month_friday") {
                    if (expiry.isMonthly) {
                        let expMonth = expiry.actual.getMonth();
                        let expYear = expiry.actual.getFullYear();
                        let dTemp = new Date(expYear, expMonth - 1, 1);
                        while (dTemp.getMonth() === (expMonth - 1 + 12) % 12) {
                            if (dTemp.getDay() === 5) {
                                let diff = Math.round((expiry.actual - dTemp) / (1000 * 60 * 60 * 24));
                                if (diff >= deployRule.dte_min && diff <= deployRule.dte_max) {
                                    nominalDate = new Date(dTemp.getTime());
                                    break;
                                }
                            }
                            dTemp.setDate(dTemp.getDate() + 1);
                        }
                    }
                }
            }
            
            if (nominalDate) {
                let actualDeploymentDate = new Date(nominalDate.getTime());
                let holidayName = getHolidayOrWeekend(nominalDate, holidays);
                let shifted = false;
                
                if (holidayName) {
                    actualDeploymentDate = getPreviousTradingDay(nominalDate, holidays);
                    shifted = true;
                }
                
                if (actualDeploymentDate >= startDate && actualDeploymentDate <= endDate) {
                    const exitDate = calculateExitDate(actualDeploymentDate, expiry.actual, exitRule, holidays);
                    deployments.push({
                        strategy: strategy,
                        nominalDate: new Date(nominalDate.getTime()),
                        actualDate: actualDeploymentDate,
                        expiryDate: expiry.actual,
                        exitDate: exitDate,
                        shifted: shifted,
                        holidayName: holidayName
                    });
                }
            }
        });
    });
    
    return deployments;
}

/**
 * Get dynamic schedule for a specific date (e.g. '2026-08-20')
 */
function getDailyCalendarSchedule(targetDateStr, strategiesData, holidays = DEFAULT_HOLIDAYS_2026) {
    const targetDate = new Date(targetDateStr + 'T00:00:00');
    
    // Window: +/- 45 days to capture any holding positions & exits
    const rangeStart = new Date(targetDate.getTime());
    rangeStart.setDate(rangeStart.getDate() - 45);
    const rangeEnd = new Date(targetDate.getTime());
    rangeEnd.setDate(rangeEnd.getDate() + 45);
    
    const allDeployments = calculateDeploymentsForRange(rangeStart, rangeEnd, strategiesData, holidays);
    
    const deploymentsToday = [];
    const exitsToday = [];
    const activeHoldingPositions = [];

    allDeployments.forEach(dep => {
        const actStr = formatDateString(dep.actualDate);
        const exitStr = formatDateString(dep.exitDate);

        if (actStr === targetDateStr) {
            deploymentsToday.push(dep);
        } else if (exitStr === targetDateStr) {
            exitsToday.push(dep);
        } else if (dep.actualDate < targetDate && dep.exitDate && dep.exitDate > targetDate) {
            activeHoldingPositions.push(dep);
        }
    });

    return {
        date: targetDateStr,
        deploymentsToday,
        exitsToday,
        activeHoldingPositions
    };
}

module.exports = {
    formatDateString,
    getHolidayOrWeekend,
    getPreviousTradingDay,
    getExpiriesForMonth,
    calculateExitDate,
    calculateDeploymentsForRange,
    getDailyCalendarSchedule
};
