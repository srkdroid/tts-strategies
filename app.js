// Options Trading Calendar App Logic

// Sleek non-blocking toast notification helper
function showToast(message, type = 'info', duration = 3500) {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "toast-container";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span style="font-size: 1.1rem;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("fade-out");
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, duration);
}

// Test prices for strike calculations
const indexSpotPrices = {
    "Nifty": 25000,
    "Nifty (Expiry Tue)": 25000,
    "Bank Nifty": 56000,
    "Sensex (Exp Thur)": 85000,
    "Sensex (Expiry Thur)": 85000,
    "Fin Nifty (Expiry Tue)": 25000
};

// Machine-readable fallback exit rules for backward compatibility
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

// Calculate the max exit date for a deployment given its exit rule
function calculateExitDate(deployDate, expiryDate, exitRule) {
    if (!exitRule) return null;

    let exitDate = null;

    if (exitRule.type === "day_of_expiry_month") {
        // e.g., "max till 7th of expiry month"
        exitDate = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), exitRule.day);

    } else if (exitRule.type === "before_expiry") {
        // e.g., "1 day before expiry"
        exitDate = new Date(expiryDate.getTime());
        exitDate.setDate(exitDate.getDate() - exitRule.days);

    } else if (exitRule.type === "nth_weekday_of_expiry_month") {
        // e.g., "3rd Friday of expiry month"
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
        // e.g., "exit by next Monday/Thursday/Friday after deploy date"
        const { weekday } = exitRule;
        let d = new Date(deployDate.getTime());
        d.setDate(d.getDate() + 1); // start from the day after deploy
        while (d.getDay() !== weekday) {
            d.setDate(d.getDate() + 1);
        }
        exitDate = d;
    }

    // Shift exit date backward if it lands on a holiday or weekend
    if (exitDate) {
        const holiday = getHolidayOrWeekend(exitDate);
        if (holiday) {
            exitDate = getPreviousTradingDay(exitDate);
        }
    }

    return exitDate;
}

// Main calculation engine to find all strategy deployments
function calculateDeploymentsForRange(startDate, endDate) {
    let deployments = [];
    
    const startYear = startDate ? startDate.getFullYear() : 2026;
    const startMonth = startDate ? Math.max(0, startDate.getMonth() - 1) : 4;
    const endYear = endDate ? endDate.getFullYear() : 2026;
    const endMonth = endDate ? Math.min(11, endDate.getMonth() + 1) : 11;
    
    // Generate expiries across the required date range
    let niftyExpiries = [];
    let sensexExpiries = [];
    
    for (let y = startYear; y <= endYear; y++) {
        const mStart = (y === startYear) ? startMonth : 0;
        const mEnd = (y === endYear) ? endMonth : 11;
        for (let m = mStart; m <= mEnd; m++) {
            niftyExpiries = niftyExpiries.concat(getExpiriesForMonth(y, m, 2)); // Tuesdays
            sensexExpiries = sensexExpiries.concat(getExpiriesForMonth(y, m, 4)); // Thursdays
        }
    }
    
    // Map each strategy to its nominal deployment dates (0_adjustment calendar strategies only)
    const calendarStrategies = (strategiesData || []).filter(s => 
        !s.strategy_category || s.strategy_category === '0_adjustment'
    );

    calendarStrategies.forEach(strategy => {
        // Auto-heal missing or corrupted rules (e.g. from legacy saves)
        const masterDeploy = DEPLOY_RULES[strategy.id] || (strategy.name ? DEPLOY_RULES[Object.keys(DEPLOY_RULES).find(k => k && strategy.name.toLowerCase().includes(k.replace(/^(monthly|biweekly|stbt)-/, '').replace(/-\d+$/, '')))] : null);
        if (masterDeploy && (!strategy.deploy_rule || (strategy.deploy_rule.type === 'expiry_offset' && strategy.deploy_rule.offset_days === -5 && (strategy.sheet === 'Monthly' || strategy.name.includes('Batman'))))) {
            strategy.deploy_rule = masterDeploy;
        }
        const masterExit = EXIT_RULES[strategy.id] || (strategy.name ? EXIT_RULES[Object.keys(EXIT_RULES).find(k => k && strategy.name.toLowerCase().includes(k.replace(/^(monthly|biweekly|stbt)-/, '').replace(/-\d+$/, '')))] : null);
        if (masterExit && (!strategy.exit_rule || (strategy.exit_rule.type === 'next_weekday' && strategy.exit_rule.weekday === 5 && strategy.sheet === 'Monthly'))) {
            strategy.exit_rule = masterExit;
        }

        const isSensex = strategy.index.includes("Sensex");
        const expiries = isSensex ? sensexExpiries : niftyExpiries;
        
        expiries.forEach(expiry => {
            let nominalDate = null;
            let expiryLabel = formatDateString(expiry.actual);
            
            // Data-driven deployment date resolution
            const rule = strategy.deploy_rule;
            if (rule) {
                if (rule.type === "expiry_offset") {
                    if (!rule.monthly_only || expiry.isMonthly) {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() + rule.offset_days);
                    }
                } else if (rule.type === "preceding_month_friday") {
                    if (expiry.isMonthly) {
                        let expMonth = expiry.actual.getMonth();
                        let expYear = expiry.actual.getFullYear();
                        let dTemp = new Date(expYear, expMonth - 1, 1);
                        while (dTemp.getMonth() === (expMonth - 1 + 12) % 12) {
                            if (dTemp.getDay() === 5) { // Friday
                                let diff = Math.round((expiry.actual - dTemp) / (1000 * 60 * 60 * 24));
                                if (diff >= rule.dte_min && diff <= rule.dte_max) {
                                    nominalDate = new Date(dTemp.getTime());
                                    break;
                                }
                            }
                            dTemp.setDate(dTemp.getDate() + 1);
                        }
                    }
                }
            } else {
                // Fallback for legacy database strategies without deploy_rule field
                if (strategy.sheet === "STBT") {
                    if (strategy.name === "Nifty 3D Ladder") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 5);
                    } else if (strategy.name === "CE Dominator") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 4);
                    } else if (strategy.name === "Fin Nifty 2D Ladder") {
                        if (expiry.isMonthly) {
                            nominalDate = new Date(expiry.actual.getTime());
                            nominalDate.setDate(nominalDate.getDate() - 4);
                        }
                    } else if (strategy.name === "Sensex No brainer") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 6);
                    } else if (strategy.name === "Matrix Calendar") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 11);
                    } else {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 5);
                    }
                } else if (strategy.sheet === "BiWkly") {
                    if (strategy.name === "BWB") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 12);
                    } else if (strategy.name === "Broken Wing") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 7);
                    } else if (strategy.name === "HNI" || strategy.name === "Blaze Butterfly" || strategy.name === "Blaze BF (Nifty)" || strategy.id === "biweekly-blazeBF-1") {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 8);
                    } else {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 8);
                    }
                } else if (strategy.sheet === "Monthly" && expiry.isMonthly) {
                    if (strategy.name === "Batman 1:3:2" || strategy.name === "Double Decker" || strategy.name === "HNI (Nifty)" || strategy.name === "No Brainer (Nifty)") {
                        let expMonth = expiry.actual.getMonth();
                        let expYear = expiry.actual.getFullYear();
                        let dTemp = new Date(expYear, expMonth - 1, 1);
                        while (dTemp.getMonth() === (expMonth - 1 + 12) % 12) {
                            if (dTemp.getDay() === 5) {
                                let diff = Math.round((expiry.actual - dTemp) / (1000 * 60 * 60 * 24));
                                if (diff >= 29 && diff <= 44) {
                                    nominalDate = new Date(dTemp.getTime());
                                    break;
                                }
                            }
                            dTemp.setDate(dTemp.getDate() + 1);
                        }
                    } else {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 12);
                    }
                }
            }
            
            if (nominalDate) {
                // Shift nominal date if it lands on a holiday/weekend
                let actualDeploymentDate = new Date(nominalDate.getTime());
                let holidayName = getHolidayOrWeekend(nominalDate);
                let shifted = false;
                
                if (holidayName) {
                    actualDeploymentDate = getPreviousTradingDay(nominalDate);
                    shifted = true;
                }
                
                // Only include if actual date is within our June-August 2026 range
                if (actualDeploymentDate >= startDate && actualDeploymentDate <= endDate) {
                    const exitRule = strategy.exit_rule || EXIT_RULES[strategy.id] || null;
                    const exitDate = calculateExitDate(actualDeploymentDate, expiry.actual, exitRule);
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

// Generate Calendar HTML for a given month
function renderCalendar(containerId, year, month, deployments, activeFilters) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    
    // First day of the month
    const firstDay = new Date(year, month, 1);
    // Day of the week of the first day (0 = Sunday, ..., 6 = Saturday)
    // Shift so Monday is 0, ..., Sunday is 6
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) startDayOfWeek = 6;
    
    // Number of days in the month
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    // Create header row for days of the week
    const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    daysOfWeek.forEach(day => {
        const headerCell = document.createElement("div");
        headerCell.className = "calendar-header-cell";
        headerCell.innerText = day;
        container.appendChild(headerCell);
    });
    
    // Fill in empty cells before the first day of the month
    for (let i = 0; i < startDayOfWeek; i++) {
        const emptyCell = document.createElement("div");
        emptyCell.className = "calendar-cell empty";
        container.appendChild(emptyCell);
    }
    
    // Generate cells for all days of the month
    for (let d = 1; d <= totalDays; d++) {
        const currentDate = new Date(year, month, d);
        const cell = document.createElement("div");
        cell.className = "calendar-cell";
        
        // Check if weekend or holiday
        const holidayOrWeekend = getHolidayOrWeekend(currentDate);
        const dateStr = formatDateString(currentDate);
        
        // Add date number
        const dateNum = document.createElement("div");
        dateNum.className = "date-number";
        
        const dateSpan = document.createElement("span");
        dateSpan.innerText = d;
        dateNum.appendChild(dateSpan);
        
        const today = new Date();
        const isToday = currentDate.getDate() === today.getDate() && 
                        currentDate.getMonth() === today.getMonth() && 
                        currentDate.getFullYear() === today.getFullYear();
        if (isToday) {
            cell.classList.add("today");
            const todayTag = document.createElement("span");
            todayTag.className = "today-tag";
            todayTag.innerText = "Today";
            dateNum.appendChild(todayTag);
        }
        
        cell.appendChild(dateNum);
        
        if (holidayOrWeekend) {
            cell.classList.add("disabled");
            if (holidayOrWeekend !== "Saturday (Weekend)" && holidayOrWeekend !== "Sunday (Weekend)") {
                cell.classList.add("holiday");
                const holidayBadge = document.createElement("div");
                holidayBadge.className = "holiday-badge";
                holidayBadge.innerText = holidayOrWeekend;
                cell.appendChild(holidayBadge);
            } else {
                cell.classList.add("weekend");
            }
        } else {
            // Find deployments on this day
            const dayDeployments = deployments.filter(dep => formatDateString(dep.actualDate) === dateStr);
            
            // Filter according to active filters
            const showDeploys = activeFilters.view === "both" || activeFilters.view === "deploy";
            const filteredDeployments = showDeploys ? dayDeployments.filter(dep => {
                const matchesIndex = activeFilters.index === "all" || dep.strategy.index.startsWith(activeFilters.index);
                const matchesType = activeFilters.type === "all" || dep.strategy.sheet === activeFilters.type;
                const matchesPortfolio = !activeFilters.portfolioOnly || starredStrategies.has(dep.strategy.id);
                return matchesIndex && matchesType && matchesPortfolio;
            }) : [];
            
            filteredDeployments.forEach(dep => {
                const badge = document.createElement("div");
                badge.className = `strategy-badge ${dep.strategy.sheet.toLowerCase()}`;
                
                const cleanIndex = dep.strategy.index.split('(')[0].trim();
                let timeStr = "";
                if (dep.strategy.time) {
                    const parts = dep.strategy.time.split(":");
                    if (parts.length >= 2) {
                        const hrs = parseInt(parts[0], 10);
                        timeStr = ` (${hrs}:${parts[1]})`;
                    }
                }
                
                let baseName = dep.strategy.name;
                const indexSuffix = `(${cleanIndex})`;
                if (!baseName.includes(indexSuffix)) {
                    baseName = `${baseName} ${indexSuffix}`;
                }
                const badgeText = `${baseName}${timeStr}`;
                
                // Build badge content with main text + optional exit hint
                const mainLine = document.createElement("span");
                mainLine.className = "badge-main-text";
                mainLine.textContent = badgeText;
                badge.appendChild(mainLine);
                
                if (dep.exitDate) {
                    const exitHint = document.createElement("span");
                    exitHint.className = "exit-hint";
                    const exitLabel = dep.exitDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    exitHint.textContent = `\u21a9 exit by ${exitLabel}`;
                    badge.appendChild(exitHint);
                }
                
                badge.title = `${dep.strategy.name} (${dep.strategy.index})`;
                
                if (dep.shifted) {
                    badge.classList.add("shifted");
                    badge.title += ` (Shifted from ${formatDateString(dep.nominalDate)} due to holiday: ${dep.holidayName})`;
                }
                
                badge.addEventListener("click", () => {
                    showStrategyDetails(dep);
                });
                
                cell.appendChild(badge);
            });
            
            // Exit dot: find filtered deployments whose exitDate falls on this day
            const showExits = activeFilters.view === "both" || activeFilters.view === "exit";
            const exitingToday = showExits ? deployments.filter(dep => {
                if (!dep.exitDate) return false;
                const matchesIndex = activeFilters.index === "all" || dep.strategy.index.startsWith(activeFilters.index);
                const matchesType = activeFilters.type === "all" || dep.strategy.sheet === activeFilters.type;
                const matchesPortfolio = !activeFilters.portfolioOnly || starredStrategies.has(dep.strategy.id);
                return matchesIndex && matchesType && matchesPortfolio && formatDateString(dep.exitDate) === dateStr;
            }) : [];
            
            if (exitingToday.length > 0) {
                // Count pill in date header (at-a-glance)
                const exitDot = document.createElement("span");
                exitDot.className = "exit-dot-count";
                exitDot.textContent = `\u21a9 ${exitingToday.length}`;
                dateNum.appendChild(exitDot);
                
                // Horizontal divider — only if there are also deploy badges above
                if (filteredDeployments.length > 0) {
                    const divider = document.createElement("div");
                    divider.className = "cell-section-divider";
                    divider.textContent = "Exits";
                    cell.appendChild(divider);
                }
                
                // Individual exit entry badges in cell body
                exitingToday.forEach(dep => {
                    const exitEntry = document.createElement("div");
                    exitEntry.className = "exit-entry";
                    
                    const cleanIndex = dep.strategy.index.split('(')[0].trim();
                    let baseName = dep.strategy.name;
                    const indexSuffix = `(${cleanIndex})`;
                    if (!baseName.includes(indexSuffix)) {
                        baseName = `${baseName} ${indexSuffix}`;
                    }
                    
                    const mainLine = document.createElement("span");
                    mainLine.className = "exit-entry-name";
                    mainLine.textContent = `\u21a9 ${baseName}`;
                    exitEntry.appendChild(mainLine);
                    
                    const deployedLine = document.createElement("span");
                    deployedLine.className = "exit-entry-deployed";
                    const deployLabel = dep.actualDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    deployedLine.textContent = `deployed ${deployLabel}`;
                    exitEntry.appendChild(deployedLine);
                    
                    exitEntry.title = `${dep.strategy.name} (${dep.strategy.index}) — deployed ${deployLabel}, exits today`;
                    cell.appendChild(exitEntry);
                });
            }
        }
        
        container.appendChild(cell);
    }
}

// Global active filters
let activeFilters = {
    index: "all",
    type: "all",
    view: "both",
    portfolioOnly: false
};

let starredStrategies = new Set();

function loadStarredStrategies() {
    try {
        const stored = localStorage.getItem('my_deployed_strategies');
        if (stored) {
            starredStrategies = new Set(JSON.parse(stored));
        }
    } catch (e) {
        console.error("Failed to load portfolio strategies", e);
    }
}

function saveStarredStrategies() {
    try {
        localStorage.setItem('my_deployed_strategies', JSON.stringify(Array.from(starredStrategies)));
    } catch (e) {
        console.error("Failed to save portfolio strategies", e);
    }
}

function toggleStrategyStar(strategyId) {
    if (starredStrategies.has(strategyId)) {
        starredStrategies.delete(strategyId);
        showToast("Removed from My Portfolio");
    } else {
        starredStrategies.add(strategyId);
        showToast("Added to My Portfolio");
    }
    saveStarredStrategies();
    updateCalendars();
}

function togglePortfolioFilter(checked) {
    activeFilters.portfolioOnly = checked;
    updateCalendars();
}

let currentFlowViewMode = "flow";
const initialNow = new Date();
let currentFlowYear = initialNow.getFullYear();
let currentFlowMonth = initialNow.getMonth(); // Automatically picks August (7) when date is August

// Global deployments cache
let allCalculatedDeployments = [];
let strategiesData = []; // Loaded dynamically from secure API
let isAdminMode = false;
let whitelistData = {};
let auditLogsData = [];
let logsSortKey = null;
let logsSortDirection = 'asc';
let activeDbTab = "users";

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", async () => {
    loadStarredStrategies();
    // Set current date in header (DD/MM/YYYY format)
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    document.getElementById("current-time-display").innerText = `Date: ${dd}/${mm}/${yyyy}`;
    
    // Fetch secure strategies data
    try {
        const response = await fetch('/api/data');
        if (!response.ok) {
            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Unauthorized or failed to fetch strategies');
        }
        const resJson = await response.json();
        strategiesData = resJson.strategies;
        window.strategiesData = strategiesData;
        if (Array.isArray(strategiesData)) {
            strategiesData.forEach(strat => {
                const masterDeploy = DEPLOY_RULES[strat.id] || (strat.name ? DEPLOY_RULES[Object.keys(DEPLOY_RULES).find(k => k && strat.name.toLowerCase().includes(k.replace(/^(monthly|biweekly|stbt)-/, '').replace(/-\d+$/, '')))] : null);
                if (masterDeploy && (!strat.deploy_rule || (strat.deploy_rule.type === 'expiry_offset' && strat.deploy_rule.offset_days === -5 && (strat.sheet === 'Monthly' || strat.name.includes('Batman'))))) {
                    strat.deploy_rule = masterDeploy;
                }
                const masterExit = EXIT_RULES[strat.id] || (strat.name ? EXIT_RULES[Object.keys(EXIT_RULES).find(k => k && strat.name.toLowerCase().includes(k.replace(/^(monthly|biweekly|stbt)-/, '').replace(/-\d+$/, '')))] : null);
                if (masterExit && (!strat.exit_rule || (strat.exit_rule.type === 'next_weekday' && strat.exit_rule.weekday === 5 && strat.sheet === 'Monthly'))) {
                    strat.exit_rule = masterExit;
                }
                if (strat.index && strat.index.includes("Bank Nifty")) {
                    if (!strat.strike_example || !strat.strike_example.ATM || strat.strike_example.ATM < 40000) {
                        strat.strike_example = strat.strike_example || {};
                        strat.strike_example.ATM = 57500;
                    }
                }
                if (strat.index && strat.index.includes("Sensex")) {
                    if (!strat.strike_example || !strat.strike_example.ATM || strat.strike_example.ATM < 60000) {
                        strat.strike_example = strat.strike_example || {};
                        strat.strike_example.ATM = 87000;
                    }
                }
            });
        }
        if (resJson.holidays) {
            marketHolidays2026 = resJson.holidays;
        }
        isAdminMode = !!resJson.isAdmin;
        window.isAdminMode = isAdminMode;
        const plannerBtn = document.getElementById("mode-planner-btn");
        if (plannerBtn) plannerBtn.style.display = "inline-flex";

        if (isAdminMode) {
            document.getElementById("admin-bar").style.display = "flex";
            document.getElementById("admin-user-info").innerText = `Logged in as Admin (${resJson.userPhone})`;
            fetchAdminDbData();
        } else {
            const userLogoutBtn = document.getElementById("user-logout-btn");
            if (userLogoutBtn) userLogoutBtn.style.display = "block";
        }

        window.userPermissions = resJson.permissions || { catalog: false, journal: false };

        const headerCatalogBtn = document.getElementById("header-catalog-btn");
        const headerJournalBtn = document.getElementById("header-journal-btn");

        const canCatalog = window.isAdminMode || window.userPermissions.catalog === true;
        const canJournal = window.isAdminMode || window.userPermissions.journal === true;

        if (headerCatalogBtn) {
            headerCatalogBtn.style.display = canCatalog ? "inline-flex" : "none";
        }
        if (headerJournalBtn) {
            headerJournalBtn.style.display = canJournal ? "inline-flex" : "none";
        }

        const mobileNavCatalog = document.getElementById("mobile-nav-catalog-btn");
        const mobileNavJournal = document.getElementById("mobile-nav-journal-btn");
        const mobileNavPlanner = document.getElementById("mobile-nav-planner-btn");
        if (mobileNavCatalog) mobileNavCatalog.style.display = canCatalog ? "flex" : "none";
        if (mobileNavJournal) mobileNavJournal.style.display = canJournal ? "flex" : "none";
        if (mobileNavPlanner) mobileNavPlanner.style.display = "flex";

        const userInfoDisplay = document.getElementById("user-info-display");
        const userPhoneNumber = document.getElementById("user-phone-number");
        const mobileUserInfo = document.getElementById("mobile-user-info");
        const mobileUserPhone = document.getElementById("mobile-user-phone");
        const mobileUserLogout = document.getElementById("mobile-user-logout-btn");

        if (userPhoneNumber && resJson.userPhone) {
            userPhoneNumber.innerText = resJson.userPhone;
        }
        if (mobileUserPhone && resJson.userPhone) {
            mobileUserPhone.innerText = resJson.userPhone;
        }
        if (userInfoDisplay && resJson.userPhone) {
            userInfoDisplay.style.display = "inline-flex";
        }
        if (mobileUserInfo && resJson.userPhone) {
            mobileUserInfo.style.display = "block";
        }
        if (mobileUserLogout) {
            mobileUserLogout.style.display = "flex";
        }
    } catch (error) {
        console.error('Authentication check failed:', error);
        window.location.href = '/login.html';
        return;
    }
    
    const startDate = new Date(2026, 0, 1); // January 1, 2026
    const endDate = new Date(2026, 11, 31); // December 31, 2026
    
    allCalculatedDeployments = calculateDeploymentsForRange(startDate, endDate);
    
    // Render initial view
    updateCalendars();
    if (typeof renderCapitalPlannerView === 'function') {
        renderCapitalPlannerView();
    }
    
    // Fetch Notes Data
    if (typeof fetchNotesData === 'function') {
        fetchNotesData();
    }
    document.getElementById("filter-index").addEventListener("change", (e) => {
        activeFilters.index = e.target.value;
        updateCalendars();
    });
    
    document.getElementById("filter-type").addEventListener("change", (e) => {
        activeFilters.type = e.target.value;
        updateCalendars();
    });
    
    document.getElementById("filter-view").addEventListener("change", (e) => {
        activeFilters.view = e.target.value;
        updateCalendars();
    });
    
    updateCalendars();
    
    // Setup Theme Switcher
    const themeBtn = document.getElementById("theme-toggle-btn");
    if (themeBtn) {
        const currentTheme = localStorage.getItem("theme");
        if (currentTheme === "light") {
            document.body.classList.add("light-theme");
            themeBtn.innerText = "🌙";
            themeBtn.title = "Switch to Dark Theme";
        } else {
            themeBtn.innerText = "☀️";
            themeBtn.title = "Switch to Light Theme";
        }
        themeBtn.addEventListener("click", () => {
            document.body.classList.toggle("light-theme");
            const isLight = document.body.classList.contains("light-theme");
            localStorage.setItem("theme", isLight ? "light" : "dark");
            themeBtn.innerText = isLight ? "🌙" : "☀️";
            themeBtn.title = isLight ? "Switch to Dark Theme" : "Switch to Light Theme";
        });
    }

    // Modal close listeners
    document.querySelector(".close-btn").addEventListener("click", hideModal);
    window.addEventListener("click", (e) => {
        if (e.target === document.getElementById("strategy-modal")) {
            hideModal();
        }
        if (e.target === document.getElementById("app-guide-modal")) {
            closeAppGuideModal();
        }
    });
});

function dispatchAdminTrade(mode) {
    if (!currentActiveModalDep) {
        showToast("No active strategy deployment found.", true);
        return;
    }
    const strategy = currentActiveModalDep.strategy;
    const atmInput = document.getElementById("modal-atm-input");
    const currentAtm = atmInput ? parseInt(atmInput.value, 10) || 25000 : 25000;
    
    // Helper to parse individual leg details
    function parseLegDetails(st, side, activeAtm) {
        const formatted = generateConcreteStrikeText(st, side, activeAtm);
        const match = st.match(/^(Buy|Sell)\s+(\d+)\s+ATM\s*([+-]\s*\d+)?/i);
        if (match) {
            const action = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
            const qty = parseInt(match[2], 10);
            const offsetStr = match[3] ? match[3].replace(/\s+/g, '') : '0';
            const offset = parseInt(offsetStr, 10) || 0;
            const strike = activeAtm + offset;
            return {
                side: side,
                formula: st,
                action: action,
                quantity: qty,
                calculated_strike: strike,
                formatted: formatted
            };
        }
        return { side: side, formula: st, formatted: formatted };
    }

    // Build calculated legs
    const legs = [];
    if (strategy.type.includes("Both") || strategy.type.includes("Either") || (strategy.setup.PE && strategy.setup.CE)) {
        if (strategy.setup.PE) {
            strategy.setup.PE.forEach(st => {
                legs.push(parseLegDetails(st, "PE", currentAtm));
            });
        }
        if (strategy.setup.CE) {
            strategy.setup.CE.forEach(st => {
                legs.push(parseLegDetails(st, "CE", currentAtm));
            });
        }
    } else {
        const side = strategy.type.split(" ")[0];
        const source = (strategy.setup && strategy.setup[side]) ? strategy.setup[side] : [];
        source.forEach(st => {
            legs.push(parseLegDetails(st, side, currentAtm));
        });
    }

    const payload = {
        strategy_name: strategy.name,
        index: strategy.index,
        category: strategy.sheet,
        deployment_date: formatDateString(currentActiveModalDep.actualDate),
        expiry_date: formatDateString(currentActiveModalDep.expiryDate),
        atm_price: currentAtm,
        legs: legs,
        target_profit: strategy.exit.target || "N/A",
        stop_loss: strategy.exit.sl || "N/A"
    };

    if (mode === 'copy') {
        const jsonStr = JSON.stringify(payload, null, 2);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(jsonStr).then(() => {
                showToast("📋 Trade JSON payload copied to clipboard!");
            }).catch(() => {
                showToast("Failed to copy JSON to clipboard", true);
            });
        } else {
            alert("Trade JSON Payload:\n\n" + jsonStr);
        }
    } else if (mode === 'webhook') {
        const webhookUrl = localStorage.getItem("admin_webhook_url") || "";
        if (!webhookUrl) {
            showToast("⚠️ Webhook URL not configured. Please set it in Admin DB Management -> Dispatch Settings tab.", true);
            return;
        }
        try { new URL(webhookUrl); } catch (e) {
            showToast("⚠️ Invalid Webhook URL format. Please check your URL in Dispatch Settings.", true);
            return;
        }
        fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(res => {
            if (res.ok) {
                showToast("🚀 Trade payload dispatched to Webhook successfully!");
            } else {
                showToast("Webhook returned status: " + res.status, true);
            }
        }).catch(err => {
            showToast("Webhook dispatch error: " + err.message, true);
        });
    } else if (mode === 'link') {
        const appUrl = localStorage.getItem("admin_app_url") || "";
        if (!appUrl) {
            showToast("⚠️ External App Base URL not configured. Please set it in Admin DB Management -> Dispatch Settings tab.", true);
            return;
        }
        const fullUrl = `${appUrl}${appUrl.includes('?') ? '&' : '?'}data=${encodeURIComponent(JSON.stringify(payload))}`;
        if (fullUrl.length > 2000) {
            showToast("⚠️ URL is very long (" + fullUrl.length + " chars). Consider using Webhook or Copy JSON instead.", true);
        }
        window.open(fullUrl, '_blank');
    }
}

async function saveAdminDispatchSettings() {
    const webhookEl = document.getElementById("admin-webhook-url-input");
    const appEl = document.getElementById("admin-app-url-input");
    const waUrlEl = document.getElementById("admin-openwa-url-input");
    const waKeyEl = document.getElementById("admin-openwa-key-input");
    const waSessionEl = document.getElementById("admin-openwa-session-input");
    const waGroupEl = document.getElementById("admin-openwa-group-input");

    const settings = {
        admin_webhook_url: webhookEl ? webhookEl.value.trim() : "",
        admin_app_url: appEl ? appEl.value.trim() : "",
        admin_openwa_url: waUrlEl ? waUrlEl.value.trim() : "",
        admin_openwa_key: waKeyEl ? waKeyEl.value.trim() : "",
        admin_openwa_session: waSessionEl ? waSessionEl.value.trim() : "",
        admin_openwa_group: waGroupEl ? waGroupEl.value.trim() : ""
    };

    try {
        const res = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_dispatch_settings', data: settings })
        });
        const resJson = await res.json();
        
        if (res.ok) {
            localStorage.setItem("admin_webhook_url", settings.admin_webhook_url);
            localStorage.setItem("admin_app_url", settings.admin_app_url);
            localStorage.setItem("admin_openwa_url", settings.admin_openwa_url);
            localStorage.setItem("admin_openwa_key", settings.admin_openwa_key);
            localStorage.setItem("admin_openwa_session", settings.admin_openwa_session);
            localStorage.setItem("admin_openwa_group", settings.admin_openwa_group);
            
            showToast("💾 Admin Settings saved successfully!");
        } else {
            showToast(resJson.error || "Failed to save settings", "error");
        }
    } catch (e) {
        showToast("Error saving dispatch settings", "error");
    }
}

function loadAdminDispatchSettings() {
    const webhookInput = document.getElementById("admin-webhook-url-input");
    const appInput = document.getElementById("admin-app-url-input");
    const waUrlInput = document.getElementById("admin-openwa-url-input");
    const waKeyInput = document.getElementById("admin-openwa-key-input");
    const waSessionInput = document.getElementById("admin-openwa-session-input");
    const waGroupInput = document.getElementById("admin-openwa-group-input");

    if (webhookInput) webhookInput.value = localStorage.getItem("admin_webhook_url") || "";
    if (appInput) appInput.value = localStorage.getItem("admin_app_url") || "";
    if (waUrlInput) waUrlInput.value = localStorage.getItem("admin_openwa_url") || "https://openwa-api.duckdns.org/";
    if (waKeyInput) waKeyInput.value = localStorage.getItem("admin_openwa_key") || "";
    if (waSessionInput) waSessionInput.value = localStorage.getItem("admin_openwa_session") || "";
    if (waGroupInput) waGroupInput.value = localStorage.getItem("admin_openwa_group") || "";
}

async function syncWhatsAppGroup() {
    const baseUrl = localStorage.getItem("admin_openwa_url") || "https://openwa-api.duckdns.org/";
    const apiKey = localStorage.getItem("admin_openwa_key") || "";
    const sessionId = localStorage.getItem("admin_openwa_session") || "";
    const groupId = localStorage.getItem("admin_openwa_group") || "";

    if (!sessionId || !groupId) {
        switchDbTab('dispatch');
        showToast("⚠️ Please enter and save your OpenWA Session ID and Group ID in the Dispatch Settings tab first.", "warning");
        return;
    }

    const btn = event ? event.target : null;
    if (btn) {
        btn.disabled = true;
        btn.innerText = "⏳ Syncing...";
    }

    try {
        const response = await fetch('/api/admin/whatsapp-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl, apiKey, sessionId, groupId })
        });

        const resJson = await response.json();

        if (!response.ok) {
            showToast(resJson.error || "WhatsApp Sync Failed", "error");
            return;
        }

        // Populate and open WhatsApp Sync Audit Results Modal
        document.getElementById("wa-sync-group-name").innerText = `Group: ${resJson.groupName} (${resJson.totalParticipants} total members)`;
        document.getElementById("wa-stat-added").innerText = resJson.newlyAddedCount;
        document.getElementById("wa-stat-missing").innerText = resJson.missingInGroupCount;
        document.getElementById("wa-stat-synced").innerText = resJson.alreadySyncedCount;

        // Render Newly Added
        const addedContainer = document.getElementById("wa-added-container");
        addedContainer.innerHTML = "";
        if (resJson.newlyAdded.length === 0) {
            addedContainer.innerHTML = "<div style='padding: 0.8rem; font-size: 0.8rem; color: var(--text-secondary); text-align: center;'>No new users added (all group members already in whitelist).</div>";
        } else {
            const table = document.createElement("table");
            table.className = "admin-table";
            table.innerHTML = `<thead><tr><th>Phone Number</th><th>Generated PIN</th><th>Name</th></tr></thead>`;
            const tbody = document.createElement("tbody");
            resJson.newlyAdded.forEach(u => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td><strong>${u.phone}</strong></td><td style="font-family: monospace; color: #34d399; font-weight: 700;">${u.pin}</td><td>${u.name || '-'}</td>`;
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            addedContainer.appendChild(table);
        }

        // Render Missing in Group
        const missingContainer = document.getElementById("wa-missing-container");
        missingContainer.innerHTML = "";
        if (resJson.missingInGroup.length === 0) {
            missingContainer.innerHTML = "<div style='padding: 0.8rem; font-size: 0.8rem; color: var(--text-secondary); text-align: center;'>All whitelisted users are present in the WhatsApp group.</div>";
        } else {
            const table = document.createElement("table");
            table.className = "admin-table";
            table.innerHTML = `<thead><tr><th>Whitelisted Phone Number</th><th>Status</th></tr></thead>`;
            const tbody = document.createElement("tbody");
            resJson.missingInGroup.forEach(phone => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td><strong>${phone}</strong></td><td><span class="badge biweekly" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">App Whitelisted Only</span></td>`;
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            missingContainer.appendChild(table);
        }

        document.getElementById("whatsapp-sync-modal").style.display = "flex";
        showToast(`📱 WhatsApp Group Synced! ${resJson.newlyAddedCount} users added to whitelist.`);

    } catch (err) {
        console.error("Sync error:", err);
        showToast("Network error executing WhatsApp Sync", "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "📱 Sync WhatsApp Group";
        }
    }
}

function closeWhatsAppSyncModal() {
    document.getElementById("whatsapp-sync-modal").style.display = "none";
    fetchAdminDbData();
}

function updateCalendars() {
    if (currentFlowViewMode === "calendar") {
        const now = new Date();
        const curYear = now.getFullYear();
        const curMonth = now.getMonth(); // 0-indexed (0=Jan, 11=Dec)

        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        const curTitle = document.getElementById("month-title-current");
        const nextTitle = document.getElementById("month-title-next");
        const prevTitle = document.getElementById("month-title-prev");

        if (curTitle) curTitle.innerText = `${monthNames[curMonth]} ${curYear} (Current Month)`;
        
        const nextDate = new Date(curYear, curMonth + 1, 1);
        if (nextTitle) nextTitle.innerText = `${monthNames[nextDate.getMonth()]} ${nextDate.getFullYear()} (Next Month)`;

        const prevDate = new Date(curYear, curMonth - 1, 1);
        if (prevTitle) prevTitle.innerText = `${monthNames[prevDate.getMonth()]} ${prevDate.getFullYear()} (Previous Month)`;

        // Render Current, Next, Previous month calendars dynamically
        renderCalendar("calendar-july", curYear, curMonth, allCalculatedDeployments, activeFilters);
        renderCalendar("calendar-august", nextDate.getFullYear(), nextDate.getMonth(), allCalculatedDeployments, activeFilters);
        renderCalendar("calendar-june", prevDate.getFullYear(), prevDate.getMonth(), allCalculatedDeployments, activeFilters);
    } else {
        renderCapitalFlow();
    }
}

const INDEX_STRIKE_STEPS = {
    "Nifty": 50,
    "Bank Nifty": 100,
    "Fin Nifty": 50,
    "Fin Nifty (Expiry Tue)": 50,
    "Sensex": 100,
    "Sensex (Exp Thur)": 100,
    "Sensex (Expiry Thur)": 100
};

const INDEX_BENCHMARK_ATMS = {
    "Nifty": 25000,
    "Bank Nifty": 57500,
    "Fin Nifty": 25000,
    "Fin Nifty (Expiry Tue)": 25000,
    "Sensex": 87000,
    "Sensex (Exp Thur)": 87000,
    "Sensex (Expiry Thur)": 87000
};

let currentActiveModalDep = null;

// Determine if a strategy requires 500-multiple or 100-multiple strike selection
function getStrategyRoundingStep(strategy) {
    if (!strategy) return 50;
    if (typeof strategy.rounding_step === 'number' && strategy.rounding_step > 0) {
        return strategy.rounding_step;
    }
    const allNotesText = [
        strategy.setup && strategy.setup.notes,
        strategy.strike_example && strategy.strike_example.notes,
        strategy.conditions && strategy.conditions.credit_range,
        strategy.conditions && strategy.conditions.refine_credit
    ].filter(Boolean).join(" ").toLowerCase();

    if (allNotesText.includes("multiple of 500") || allNotesText.includes("500 strikes") || allNotesText.includes("closest multiple of 500")) {
        return 500;
    }
    if (allNotesText.includes("multiple of 100") || allNotesText.includes("100 strikes")) {
        return 100;
    }
    
    return INDEX_STRIKE_STEPS[strategy.index] || 50;
}

// Compute Effective ATM after applying strategy-specific rounding rules
function getEffectiveAtmForStrategy(strategy, rawAtm) {
    if (!strategy || isNaN(rawAtm)) return rawAtm;
    const roundStep = getStrategyRoundingStep(strategy);
    if (roundStep > 1) {
        return Math.round(rawAtm / roundStep) * roundStep;
    }
    return rawAtm;
}

function getSavedAtmForStrategy(strategy, defaultAtm) {
    if (!strategy) return defaultAtm;
    const key = `lastAtm_strat_${strategy.id}`;
    const saved = sessionStorage.getItem(key);
    if (saved && !isNaN(parseInt(saved, 10))) {
        const val = parseInt(saved, 10);
        // Validate if saved value is reasonable for this index to avoid cross-index contamination
        if (strategy.index.includes("Bank Nifty") && val < 40000) return defaultAtm;
        if (strategy.index.includes("Sensex") && val < 60000) return defaultAtm;
        if (strategy.index.includes("Nifty") && !strategy.index.includes("Bank") && val > 40000) return defaultAtm;
        return val;
    }
    return defaultAtm;
}

function saveAtmForStrategy(strategy, atmVal) {
    if (!strategy) return;
    const key = `lastAtm_strat_${strategy.id}`;
    sessionStorage.setItem(key, atmVal);
}

// Helper to dynamically calculate and format concrete strike labels with strategy rounding rules
function generateConcreteStrikeText(legStr, side, atmPrice, strategy) {
    if (!legStr) return legStr;
    const effectiveAtm = getEffectiveAtmForStrategy(strategy, atmPrice);
    
    // Parse setup leg strings like "Buy 1 ATM+1000", "Sell 2 ATM+1500", "Buy 1 ATM+3500", "Buy 1 ATM"
    const match = legStr.match(/^(Buy|Sell)\s+(\d+)\s+ATM\s*([+-]\s*\d+)?/i);
    if (match) {
        const action = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        const qty = match[2];
        const offsetStr = match[3] ? match[3].replace(/\s+/g, '') : '0';
        const offset = parseInt(offsetStr, 10) || 0;
        const strike = effectiveAtm + offset;
        return `${action} ${qty} ${strike} ${side}`;
    }
    
    // Parse numerical strike inputs like "25200" or "25200 CE"
    const numMatch = legStr.trim().match(/^(\d+)(\s+(CE|PE))?$/i);
    if (numMatch) {
        return `${numMatch[1]} ${side}`;
    }
    
    return legStr;
}

function showStrategyDetails(dep) {
    currentActiveModalDep = dep;
    window.currentActiveModalDep = dep;
    const strategy = dep.strategy;
    const modal = document.getElementById("strategy-modal");
    
    if (typeof trackUserActivity === 'function' && strategy) {
        trackUserActivity('VIEW_STRATEGY_DETAILS', `Opened details for strategy: ${strategy.name}`, { strategyId: strategy.id });
    }
    
    document.getElementById("modal-strategy-name").innerText = strategy.name;
    document.getElementById("modal-sheet-type").innerText = strategy.sheet;
    document.getElementById("modal-sheet-type").className = `badge ${strategy.sheet.toLowerCase()}`;
    
    // Priority Badge in Modal Header
    let priorityBadge = document.getElementById("modal-priority-badge");
    if (!priorityBadge) {
        priorityBadge = document.createElement("span");
        priorityBadge.id = "modal-priority-badge";
        priorityBadge.className = "badge";
        const headerLeft = document.querySelector(".modal-header-left");
        if (headerLeft) headerLeft.appendChild(priorityBadge);
    }
    
    let bucketMatch = null;
    if (typeof capitalPlannerMasterData !== 'undefined') {
        capitalPlannerMasterData.buckets.forEach(b => {
            if (b.strategies.some(s => s.appStrategyId === strategy.id)) {
                bucketMatch = b;
            }
        });
    }
    
    if (bucketMatch) {
        priorityBadge.innerText = bucketMatch.badgeText;
        priorityBadge.className = `badge ${bucketMatch.colorClass}`;
        priorityBadge.style.display = "inline-block";
    } else {
        priorityBadge.style.display = "none";
    }
    
    // Show Strategy Notes button ONLY if a note actually exists for this strategy
    const notesBtn = document.getElementById("modal-notes-btn");
    if (notesBtn) {
        const hasNote = typeof allNotes !== 'undefined' && Array.isArray(allNotes) && allNotes.some(n => 
            (n.strategyId && strategy.id && n.strategyId.toLowerCase() === strategy.id.toLowerCase()) || 
            (n.category === 'Strategy' && n.title && strategy.name && n.title.toLowerCase().includes(strategy.name.toLowerCase()))
        );
        notesBtn.style.display = hasNote ? "inline-flex" : "none";
    }
    
    document.getElementById("modal-index").innerText = strategy.index;
    document.getElementById("modal-expiry").innerText = strategy.expiry;
    document.getElementById("modal-dte").innerText = strategy.dte;
    document.getElementById("modal-deploy-day").innerText = strategy.day === "Any" ? (strategy.time ? `Any Day at ${strategy.time}` : "Any Day") : `${strategy.day} at ${strategy.time}`;
    
    // Target deployment dates
    if (dep.isInactiveFallback) {
        document.getElementById("modal-target-date").innerText = "Not Active in Current Calendar";
        document.getElementById("modal-expiry-date").innerText = "Not Active in Current Calendar";
    } else {
        document.getElementById("modal-target-date").innerText = formatDateString(dep.actualDate);
        document.getElementById("modal-expiry-date").innerText = formatDateString(dep.expiryDate);
    }
    
    if (dep.shifted) {
        document.getElementById("modal-holiday-notice").style.display = "block";
        document.getElementById("modal-original-date").innerText = formatDateString(dep.nominalDate);
        document.getElementById("modal-holiday-name").innerText = dep.holidayName;
    } else {
        document.getElementById("modal-holiday-notice").style.display = "none";
    }
    
    // Setup Legs
    const legsContainer = document.getElementById("modal-legs-list");
    legsContainer.innerHTML = "";
    
    const strikeExampleContainer = document.getElementById("modal-strikes-list");
    strikeExampleContainer.innerHTML = "";
    
    let defaultAtm = 25000;
    if (strategy.index && strategy.index.includes("Bank Nifty")) {
        defaultAtm = (strategy.strike_example && strategy.strike_example.ATM >= 40000) ? strategy.strike_example.ATM : 57500;
    } else if (strategy.index && strategy.index.includes("Sensex")) {
        defaultAtm = (strategy.strike_example && strategy.strike_example.ATM >= 60000) ? strategy.strike_example.ATM : 87000;
    } else if (strategy.strike_example && strategy.strike_example.ATM) {
        defaultAtm = strategy.strike_example.ATM;
    } else {
        defaultAtm = INDEX_BENCHMARK_ATMS[strategy.index] || 25000;
    }
    const stepSize = INDEX_STRIKE_STEPS[strategy.index] || 50;
    const roundStep = getStrategyRoundingStep(strategy);
    let currentAtm = getSavedAtmForStrategy(strategy, defaultAtm);
    
    // Configure interactive ATM input & reset button
    const atmInput = document.getElementById("modal-atm-input");
    if (atmInput) {
        atmInput.value = currentAtm;
        atmInput.step = stepSize;
        
        atmInput.oninput = (e) => {
            const raw = parseInt(e.target.value, 10);
            if (!isNaN(raw)) {
                saveAtmForStrategy(strategy, raw);
                renderStrikesForAtm(raw);
            }
        };
        
        atmInput.onchange = (e) => {
            const raw = parseInt(e.target.value, 10);
            if (!isNaN(raw)) {
                saveAtmForStrategy(strategy, raw);
                renderStrikesForAtm(raw);
            }
        };
    }
    
    const resetBtn = document.getElementById("modal-atm-reset-btn");
    if (resetBtn) {
        resetBtn.onclick = () => {
            saveAtmForStrategy(strategy, defaultAtm);
            if (atmInput) atmInput.value = defaultAtm;
            renderStrikesForAtm(defaultAtm);
        };
    }
    
    function renderStrikesForAtm(activeAtm) {
        strikeExampleContainer.innerHTML = "";
        
        const effectiveAtm = getEffectiveAtmForStrategy(strategy, activeAtm);
        if (effectiveAtm !== activeAtm) {
            const roundingNotice = document.createElement("p");
            roundingNotice.className = "setup-note";
            roundingNotice.style.color = "#fbbf24";
            roundingNotice.style.marginTop = "0";
            roundingNotice.style.marginBottom = "0.6rem";
            roundingNotice.style.fontSize = "0.78rem";
            roundingNotice.innerHTML = `💡 <strong>ATM ${activeAtm.toLocaleString('en-IN')}</strong> rounded to <strong>${effectiveAtm.toLocaleString('en-IN')}</strong> per strategy ${roundStep}-multiple rule.`;
            strikeExampleContainer.appendChild(roundingNotice);
        }
        
        if (strategy.type.includes("Both") || strategy.type.includes("Either") || (strategy.setup && strategy.setup.PE && strategy.setup.CE)) {
            const peSource = (strategy.setup && strategy.setup.PE) ? strategy.setup.PE : (strategy.strike_example ? strategy.strike_example.PE : null);
            if (peSource && peSource.length > 0) {
                const peStrikesTitle = document.createElement("h5");
                peStrikesTitle.innerText = "PE Strikes";
                strikeExampleContainer.appendChild(peStrikesTitle);
                peSource.forEach(st => {
                    const li = document.createElement("div");
                    li.className = "leg-item pe-side";
                    li.innerText = generateConcreteStrikeText(st, "PE", activeAtm, strategy);
                    strikeExampleContainer.appendChild(li);
                });
            }
            
            const ceSource = (strategy.setup && strategy.setup.CE) ? strategy.setup.CE : (strategy.strike_example ? strategy.strike_example.CE : null);
            if (ceSource && ceSource.length > 0) {
                const ceStrikesTitle = document.createElement("h5");
                ceStrikesTitle.innerText = "CE Strikes";
                strikeExampleContainer.appendChild(ceStrikesTitle);
                ceSource.forEach(st => {
                    const li = document.createElement("div");
                    li.className = "leg-item ce-side";
                    li.innerText = generateConcreteStrikeText(st, "CE", activeAtm, strategy);
                    strikeExampleContainer.appendChild(li);
                });
            }
        } else {
            const side = strategy.type.split(" ")[0]; // CE or PE
            const sideSource = (strategy.setup && strategy.setup[side]) ? strategy.setup[side] : (strategy.strike_example ? strategy.strike_example[side] : []);
            if (sideSource) {
                sideSource.forEach(st => {
                    const li = document.createElement("div");
                    li.className = `leg-item ${side.toLowerCase()}-side`;
                    li.innerText = generateConcreteStrikeText(st, side, activeAtm, strategy);
                    strikeExampleContainer.appendChild(li);
                });
            }
            
        }

        const strikeNoteText = (strategy.strike_example && strategy.strike_example.notes) || (strategy.setup && strategy.setup.notes);
        if (strikeNoteText) {
            const note = document.createElement("p");
            note.className = "setup-note";
            note.style.marginTop = "0.6rem";
            note.style.fontSize = "0.78rem";
            note.style.color = "#94a3b8";
            note.style.fontStyle = "italic";
            note.innerHTML = `*Note:* ${strikeNoteText}`;
            strikeExampleContainer.appendChild(note);
        }
    }

    if (strategy.type.includes("Both") || strategy.type.includes("Either") || (strategy.setup && strategy.setup.PE && strategy.setup.CE)) {
        // Multi-sided
        if (strategy.setup && strategy.setup.PE && strategy.setup.PE.length > 0) {
            const peTitle = document.createElement("h5");
            peTitle.innerText = "PE Legs";
            peTitle.style.color = "#ef4444";
            legsContainer.appendChild(peTitle);
            
            strategy.setup.PE.forEach(leg => {
                const li = document.createElement("div");
                li.className = "leg-item pe-side";
                li.innerText = leg;
                legsContainer.appendChild(li);
            });
        }
        
        if (strategy.setup && strategy.setup.CE && strategy.setup.CE.length > 0) {
            const ceTitle = document.createElement("h5");
            ceTitle.innerText = "CE Legs";
            ceTitle.style.color = "#10b981";
            legsContainer.appendChild(ceTitle);
            
            strategy.setup.CE.forEach(leg => {
                const li = document.createElement("div");
                li.className = "leg-item ce-side";
                li.innerText = leg;
                legsContainer.appendChild(li);
            });
        }
    } else {
        // Single Sided
        const side = strategy.type.split(" ")[0]; // CE or PE
        const sideTitle = document.createElement("h5");
        sideTitle.innerText = `${side} Legs`;
        sideTitle.style.color = side === "CE" ? "#10b981" : "#ef4444";
        legsContainer.appendChild(sideTitle);
        
        if (strategy.setup && strategy.setup[side]) {
            strategy.setup[side].forEach(leg => {
                const li = document.createElement("div");
                li.className = `leg-item ${side.toLowerCase()}-side`;
                li.innerText = leg;
                legsContainer.appendChild(li);
            });
        }
    }

    const legsNoteText = (strategy.setup && strategy.setup.notes) || (strategy.strike_example && strategy.strike_example.notes);
    if (legsNoteText) {
        const note = document.createElement("p");
        note.className = "setup-note";
        note.style.marginTop = "0.6rem";
        note.style.fontSize = "0.78rem";
        note.style.color = "#94a3b8";
        note.style.fontStyle = "italic";
        note.innerHTML = `*Note:* ${legsNoteText}`;
        legsContainer.appendChild(note);
    }
    
    // Render Strikes
    renderStrikesForAtm(currentAtm);
    
    // Conditions
    document.getElementById("modal-credit-range").innerText = strategy.conditions.credit_range || "N/A";
    document.getElementById("modal-refine-credit").innerText = strategy.conditions.refine_credit || "N/A";
    
    const refineBlueLineRow = document.getElementById("modal-refine-blueline-row");
    if (strategy.conditions.refine_blue_line) {
        refineBlueLineRow.style.display = "block";
        document.getElementById("modal-refine-blueline").innerText = strategy.conditions.refine_blue_line;
    } else {
        refineBlueLineRow.style.display = "none";
    }
    
    const deltaRow = document.getElementById("modal-delta-row");
    if (strategy.conditions.position_delta) {
        deltaRow.style.display = "block";
        document.getElementById("modal-delta").innerText = strategy.conditions.position_delta;
    } else {
        deltaRow.style.display = "none";
    }
    
    // Exit
    document.getElementById("modal-exit-target").innerText = strategy.exit.target || "N/A";
    document.getElementById("modal-exit-sl").innerText = strategy.exit.sl || "N/A";
    document.getElementById("modal-exit-move").innerText = strategy.exit.market_move || "N/A";
    document.getElementById("modal-exit-duration").innerText = strategy.exit.duration || "N/A";
    
    const gapUpRow = document.getElementById("modal-gapup-row");
    if (strategy.exit.gap_up) {
        gapUpRow.style.display = "block";
        document.getElementById("modal-gapup").innerText = strategy.exit.gap_up;
    } else {
        gapUpRow.style.display = "none";
    }
    
    // Setup Portfolio Star Button
    const pBtn = document.getElementById("modal-portfolio-btn");
    if (pBtn) {
        const updatePBtn = () => {
            const isStarred = starredStrategies.has(strategy.id);
            pBtn.innerHTML = isStarred ? "★ In Portfolio" : "☆ Add to Portfolio";
            if (isStarred) {
                pBtn.style.background = "rgba(245, 158, 11, 0.15)";
                pBtn.style.borderColor = "rgba(245, 158, 11, 0.4)";
                pBtn.style.color = "#f59e0b";
            } else {
                pBtn.style.background = "rgba(255, 255, 255, 0.05)";
                pBtn.style.borderColor = "var(--border-color)";
                pBtn.style.color = "var(--text-primary)";
            }
        };
        updatePBtn();
        pBtn.onclick = () => {
            toggleStrategyStar(strategy.id);
            updatePBtn();
        };
    }

    // Admin Only Trade Dispatch Card Control
    const adminDispatchCard = document.getElementById("modal-admin-dispatch-card");
    if (adminDispatchCard) {
        adminDispatchCard.style.display = isAdminMode ? "block" : "none";
    }
    
    modal.style.display = "flex";
}

function hideModal() {
    document.getElementById("strategy-modal").style.display = "none";
}

function openAppGuideModal() {
    const modal = document.getElementById("app-guide-modal");
    if (modal) modal.style.display = "flex";
}

function closeAppGuideModal() {
    const modal = document.getElementById("app-guide-modal");
    if (modal) modal.style.display = "none";
}

// -------------------------------------------------------------
// ADMIN CONTROLS INTERACTIVE LOGIC
// -------------------------------------------------------------

function showToast(msg, isError = false) {
    alert(msg);
}

// A. Strategy Creation / Editing Modals
function openAddStrategyModal() {
    document.getElementById("edit-modal-title").innerText = "Add New Strategy";
    document.getElementById("edit-strat-id").value = "";
    document.getElementById("edit-strategy-form").reset();
    document.getElementById("edit-strat-category").value = "0_adjustment";
    document.getElementById("edit-strat-legs").value = JSON.stringify({ CE: ["Sell 1 ATM+200"], PE: ["Sell 1 ATM-200"] }, null, 4);
    document.getElementById("edit-strategy-modal").style.display = "block";
}

function openNewStrategyModal() {
    openAddStrategyModal();
}

function openEditStrategyModal(strategy) {
    document.getElementById("edit-modal-title").innerText = "Edit Strategy";
    document.getElementById("edit-strat-id").value = strategy.id;
    document.getElementById("edit-strat-name").value = strategy.name;
    document.getElementById("edit-strat-sheet").value = strategy.sheet;
    document.getElementById("edit-strat-category").value = strategy.strategy_category || "0_adjustment";
    document.getElementById("edit-strat-index").value = strategy.index;
    document.getElementById("edit-strat-expiry").value = strategy.expiry;
    document.getElementById("edit-strat-dte").value = strategy.dte;
    document.getElementById("edit-strat-day").value = strategy.day;
    document.getElementById("edit-strat-time").value = strategy.time || "09:15:00";
    document.getElementById("edit-strat-type").value = strategy.type || "Both sides";
    
    document.getElementById("edit-strat-credit").value = strategy.conditions.credit_range || "";
    document.getElementById("edit-strat-delta").value = strategy.conditions.position_delta || "";
    document.getElementById("edit-strat-refine-credit").value = strategy.conditions.refine_credit || "";
    document.getElementById("edit-strat-refine-blueline").value = strategy.conditions.refine_blue_line || "";
    
    document.getElementById("edit-strat-target").value = strategy.exit.target || "";
    document.getElementById("edit-strat-sl").value = strategy.exit.sl || "";
    document.getElementById("edit-strat-exit-move").value = strategy.exit.market_move || "";
    document.getElementById("edit-strat-exit-duration").value = strategy.exit.duration || "";
    document.getElementById("edit-strat-gapup").value = strategy.exit.gap_up || "";
    
    document.getElementById("edit-strat-legs").value = JSON.stringify(strategy.setup, null, 4);
    
    document.getElementById("edit-strategy-modal").style.display = "block";
}

function closeEditStrategyModal() {
    document.getElementById("edit-strategy-modal").style.display = "none";
}

async function saveStrategyForm(event) {
    event.preventDefault();
    
    const id = document.getElementById("edit-strat-id").value;
    const name = document.getElementById("edit-strat-name").value;
    const sheet = document.getElementById("edit-strat-sheet").value;
    const strategy_category = document.getElementById("edit-strat-category").value;
    const index = document.getElementById("edit-strat-index").value;
    const expiry = document.getElementById("edit-strat-expiry").value;
    const dte = document.getElementById("edit-strat-dte").value;
    const day = document.getElementById("edit-strat-day").value;
    const time = document.getElementById("edit-strat-time").value;
    const type = document.getElementById("edit-strat-type").value;
    
    const credit_range = document.getElementById("edit-strat-credit").value;
    const position_delta = document.getElementById("edit-strat-delta").value;
    const refine_credit = document.getElementById("edit-strat-refine-credit").value;
    const refine_blue_line = document.getElementById("edit-strat-refine-blueline").value;
    
    const target = document.getElementById("edit-strat-target").value;
    const sl = document.getElementById("edit-strat-sl").value;
    const market_move = document.getElementById("edit-strat-exit-move").value;
    const duration = document.getElementById("edit-strat-exit-duration").value;
    const gap_up = document.getElementById("edit-strat-gapup").value;
    
    let setup = {};
    try {
        setup = JSON.parse(document.getElementById("edit-strat-legs").value);
    } catch (e) {
        showToast("Invalid Setup Legs JSON format! Please check brackets and quotes.", "warning");
        return;
    }
    
    const strike_example = { ATM: 25000 };
    if (setup.CE) {
        strike_example.CE = setup.CE.map(leg => generateConcreteStrikeText(leg, "CE", 25000));
    }
    if (setup.PE) {
        strike_example.PE = setup.PE.map(leg => generateConcreteStrikeText(leg, "PE", 25000));
    }

    const existingStrat = id ? strategiesData.find(s => s.id === id || s.name === name) : strategiesData.find(s => s.name === name);
    
    // Normalize position type string
    const normalizedType = type === "Both sides" ? "Both (CE & PE)" : type;

    // Resolve deployment rule with master fallback
    let deploy_rule = (existingStrat && existingStrat.deploy_rule) ? existingStrat.deploy_rule : null;
    if (!deploy_rule && id && DEPLOY_RULES[id]) deploy_rule = DEPLOY_RULES[id];
    if (!deploy_rule && existingStrat && DEPLOY_RULES[existingStrat.id]) deploy_rule = DEPLOY_RULES[existingStrat.id];
    if (!deploy_rule) {
        deploy_rule = {
            type: "expiry_offset",
            offset_days: dte.includes("8 DTE") ? -8 : (dte.includes("12 DTE") ? -12 : (dte.includes("39") ? -39 : -5)),
            monthly_only: sheet === "Monthly"
        };
    }

    // Resolve exit rule with master fallback
    let exit_rule = (existingStrat && existingStrat.exit_rule) ? existingStrat.exit_rule : null;
    if (!exit_rule && id && EXIT_RULES[id]) exit_rule = EXIT_RULES[id];
    if (!exit_rule && existingStrat && EXIT_RULES[existingStrat.id]) exit_rule = EXIT_RULES[existingStrat.id];
    if (!exit_rule) {
        exit_rule = { type: "next_weekday", weekday: 5 };
    }

    const updatedStrat = {
        id: id || `strat_${Date.now()}`,
        sheet,
        strategy_category,
        name,
        index,
        expiry,
        dte,
        day,
        time,
        type: normalizedType,
        setup,
        strike_example,
        conditions: { credit_range, refine_credit, refine_blue_line, position_delta },
        exit: { target, sl, market_move, duration, gap_up },
        deploy_rule,
        exit_rule
    };
    
    if (id) {
        const idx = strategiesData.findIndex(s => s.id === id);
        if (idx !== -1) {
            strategiesData[idx] = updatedStrat;
        }
    } else {
        strategiesData.push(updatedStrat);
    }
    
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_strategies', data: strategiesData })
        });
        const resJson = await response.json();
        if (response.ok) {
            showToast("Strategy saved successfully!");
            closeEditStrategyModal();
            allCalculatedDeployments = calculateDeploymentsForRange(new Date(2026, 5, 1), new Date(2026, 7, 31));
            updateCalendars();
        } else {
            showToast(resJson.error || "Save failed", true);
        }
    } catch (e) {
        showToast("Network save error", true);
    }
}

async function deleteStrategy(id) {
    const strategy = strategiesData.find(s => s.id === id);
    if (!strategy) return;
    
    const userInput = prompt(`To delete this strategy, please type its name to confirm:\n"${strategy.name}"`);
    if (userInput === null) return; // clicked Cancel
    if (userInput.trim() !== strategy.name) {
        showToast("Incorrect strategy name. Deletion canceled.", "warning");
        return;
    }
    
    strategiesData = strategiesData.filter(s => s.id !== id);
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_strategies', data: strategiesData })
        });
        if (response.ok) {
            showToast("Strategy deleted!");
            allCalculatedDeployments = calculateDeploymentsForRange(new Date(2026, 5, 1), new Date(2026, 7, 31));
            updateCalendars();
        } else {
            showToast("Failed to delete strategy", true);
        }
    } catch (e) {
        showToast("Network delete error", true);
    }
}

// B. Database Management (Holidays / Whitelist Users)
async function openDbManagementModal() {
    document.getElementById("db-management-modal").style.display = "block";
    switchDbTab(activeDbTab);
    await fetchAdminDbData();
}

function closeDbManagementModal() {
    document.getElementById("db-management-modal").style.display = "none";
}

function switchDbTab(tab) {
    activeDbTab = tab;
    document.getElementById("tab-users-btn").classList.toggle("active", tab === 'users');
    document.getElementById("tab-holidays-btn").classList.toggle("active", tab === 'holidays');
    document.getElementById("tab-strategies-btn").classList.toggle("active", tab === 'strategies');
    document.getElementById("tab-logs-btn").classList.toggle("active", tab === 'logs');
    const activityBtn = document.getElementById("tab-activity-btn");
    if (activityBtn) activityBtn.classList.toggle("active", tab === 'activity');
    const dispatchBtn = document.getElementById("tab-dispatch-btn");
    if (dispatchBtn) dispatchBtn.classList.toggle("active", tab === 'dispatch');
    
    document.getElementById("tab-users-content").style.display = tab === 'users' ? 'flex' : 'none';
    document.getElementById("tab-holidays-content").style.display = tab === 'holidays' ? 'flex' : 'none';
    document.getElementById("tab-strategies-content").style.display = tab === 'strategies' ? 'flex' : 'none';
    document.getElementById("tab-logs-content").style.display = tab === 'logs' ? 'flex' : 'none';
    const activityContent = document.getElementById("tab-activity-content");
    if (activityContent) activityContent.style.display = tab === 'activity' ? 'flex' : 'none';
    const dispatchContent = document.getElementById("tab-dispatch-content");
    if (dispatchContent) dispatchContent.style.display = tab === 'dispatch' ? 'flex' : 'none';
    
    if (tab === 'logs') {
        renderAuditLogsTable();
    } else if (tab === 'strategies') {
        renderStrategiesTable();
    } else if (tab === 'dispatch') {
        loadAdminDispatchSettings();
    } else if (tab === 'activity') {
        fetchAdminActivityLogs();
    }
}

async function fetchAdminDbData() {
    try {
        const response = await fetch(`/api/admin/get?_t=${Date.now()}`);
        if (!response.ok) return;
        const resJson = await response.json();
        whitelistData = resJson.whitelist || {};
        userPermissionsData = resJson.userPermissions || {};
        auditLogsData = resJson.auditLogs || [];
        
        if (resJson.dispatchSettings && Object.keys(resJson.dispatchSettings).length > 0) {
            const ds = resJson.dispatchSettings;
            localStorage.setItem("admin_webhook_url", ds.admin_webhook_url || "");
            localStorage.setItem("admin_app_url", ds.admin_app_url || "");
            localStorage.setItem("admin_openwa_url", ds.admin_openwa_url || "");
            localStorage.setItem("admin_openwa_key", ds.admin_openwa_key || "");
            localStorage.setItem("admin_openwa_session", ds.admin_openwa_session || "");
            localStorage.setItem("admin_openwa_group", ds.admin_openwa_group || "");
            loadAdminDispatchSettings();
        }

        if (logsSortKey) {
            applyLogsSort();
            updateLogsSortIcons();
        }
        if (resJson.strategies) {
            strategiesData = resJson.strategies;
            window.strategiesData = strategiesData;
        }
        renderWhitelistTable();
        renderHolidaysTable();
        renderAuditLogsTable();
        renderStrategiesTable();
    } catch (e) {
        console.error("Failed to fetch DB details:", e);
    }
}

// Render Strategies Table
function renderStrategiesTable() {
    const tbody = document.getElementById("strategies-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (!strategiesData || strategiesData.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 5;
        td.style.textAlign = "center";
        td.style.color = "var(--text-secondary)";
        td.innerText = "No strategies found.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    
    const sorted = [...strategiesData].sort((a, b) => a.name.localeCompare(b.name));
    
    sorted.forEach(strat => {
        const tr = document.createElement("tr");
        
        // Name
        const tdName = document.createElement("td");
        tdName.innerHTML = `<strong>${strat.name}</strong>`;
        tr.appendChild(tdName);
        
        // Index
        const tdIndex = document.createElement("td");
        tdIndex.innerText = strat.index;
        tr.appendChild(tdIndex);
        
        // Type / Sheet
        const tdType = document.createElement("td");
        const typeSpan = document.createElement("span");
        typeSpan.className = `badge ${strat.sheet.toLowerCase()}`;
        typeSpan.innerText = strat.sheet;
        tdType.appendChild(typeSpan);
        tr.appendChild(tdType);
        
        // Time
        const tdTime = document.createElement("td");
        tdTime.innerText = strat.time || "-";
        tr.appendChild(tdTime);
        
        // Actions
        const tdActions = document.createElement("td");
        tdActions.style.display = "flex";
        tdActions.style.gap = "0.5rem";
        
        const editBtn = document.createElement("button");
        editBtn.className = "admin-btn edit";
        editBtn.style.padding = "0.25rem 0.6rem";
        editBtn.style.fontSize = "0.75rem";
        editBtn.innerText = "✏️ Edit";
        editBtn.addEventListener("click", () => {
            closeDbManagementModal();
            openEditStrategyModal(strat);
        });
        tdActions.appendChild(editBtn);
        
        const delBtn = document.createElement("button");
        delBtn.className = "admin-btn logout";
        delBtn.style.padding = "0.25rem 0.6rem";
        delBtn.style.fontSize = "0.75rem";
        delBtn.style.background = "rgba(239, 68, 68, 0.12)";
        delBtn.style.borderColor = "rgba(239, 68, 68, 0.2)";
        delBtn.style.color = "#fca5a5";
        delBtn.innerText = "🗑️ Delete";
        delBtn.addEventListener("click", () => {
            deleteStrategy(strat.id);
        });
        tdActions.appendChild(delBtn);
        
        tr.appendChild(tdActions);
        tbody.appendChild(tr);
    });
}

// Render Audit Logs Table
function renderAuditLogsTable() {
    const tbody = document.getElementById("logs-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (auditLogsData.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.style.textAlign = "center";
        td.style.color = "var(--text-secondary)";
        td.innerText = "No log entries found.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    
    auditLogsData.forEach(log => {
        const tr = document.createElement("tr");
        
        // Format timestamp nicely
        const tdTime = document.createElement("td");
        const d = new Date(log.timestamp);
        tdTime.innerText = isNaN(d.getTime()) ? log.timestamp : d.toLocaleString();
        tr.appendChild(tdTime);
        
        const tdPhone = document.createElement("td");
        tdPhone.innerHTML = `<strong>${log.phone}</strong>`;
        tr.appendChild(tdPhone);
        
        const tdMethod = document.createElement("td");
        const methodSpan = document.createElement("span");
        methodSpan.style.padding = "0.2rem 0.5rem";
        methodSpan.style.borderRadius = "4px";
        methodSpan.style.fontSize = "0.75rem";
        methodSpan.style.fontWeight = "600";
        
        if (log.method === 'pin') {
            methodSpan.innerText = "PIN Login";
            methodSpan.style.background = "rgba(245, 158, 11, 0.15)";
            methodSpan.style.color = "#f59e0b";
            methodSpan.style.border = "1px solid rgba(245, 158, 11, 0.3)";
        } else if (log.method === 'session') {
            methodSpan.innerText = "Active Session";
            methodSpan.style.background = "rgba(16, 185, 129, 0.15)";
            methodSpan.style.color = "#10b981";
            methodSpan.style.border = "1px solid rgba(16, 185, 129, 0.3)";
        } else {
            methodSpan.innerText = "Telegram OTP";
            methodSpan.style.background = "rgba(59, 130, 246, 0.15)";
            methodSpan.style.color = "#3b82f6";
            methodSpan.style.border = "1px solid rgba(59, 130, 246, 0.3)";
        }
        tdMethod.appendChild(methodSpan);
        tr.appendChild(tdMethod);
        
        tbody.appendChild(tr);
    });
}

// Reusable sorting helper for Auth Audit Logs
function applyLogsSort() {
    if (!logsSortKey) return;
    auditLogsData.sort((a, b) => {
        let valA = a[logsSortKey] || '';
        let valB = b[logsSortKey] || '';
        
        if (logsSortKey === 'timestamp') {
            valA = new Date(valA).getTime() || 0;
            valB = new Date(valB).getTime() || 0;
        } else {
            valA = valA.toString().toLowerCase();
            valB = valB.toString().toLowerCase();
        }
        
        if (valA < valB) return logsSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return logsSortDirection === 'asc' ? 1 : -1;
        return 0;
    });
}

// Update UI headers to display sorting direction arrows
function updateLogsSortIcons() {
    const timeIcon = document.getElementById("sort-icon-timestamp");
    const phoneIcon = document.getElementById("sort-icon-phone");
    
    if (timeIcon) timeIcon.innerText = "";
    if (phoneIcon) phoneIcon.innerText = "";
    
    if (logsSortKey === 'timestamp' && timeIcon) {
        timeIcon.innerText = logsSortDirection === 'asc' ? ' 🔼' : ' 🔽';
    } else if (logsSortKey === 'phone' && phoneIcon) {
        phoneIcon.innerText = logsSortDirection === 'asc' ? ' 🔼' : ' 🔽';
    }
}

// Toggle sort key and trigger re-render
function toggleLogsSort(key) {
    if (logsSortKey === key) {
        logsSortDirection = logsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        logsSortKey = key;
        logsSortDirection = 'asc';
    }
    applyLogsSort();
    updateLogsSortIcons();
    renderAuditLogsTable();
}

// Refresh Auth Logs
async function refreshAuthLogs() {
    const refreshBtn = document.querySelector("#tab-logs-content .admin-btn.edit");
    if (refreshBtn) {
        refreshBtn.innerText = "Refreshing...";
        refreshBtn.disabled = true;
    }
    await fetchAdminDbData();
    if (refreshBtn) {
        refreshBtn.innerText = "🔄 Refresh Logs";
        refreshBtn.disabled = false;
    }
}

// Clear Auth Logs
async function clearAuthLogs() {
    if (!confirm("Are you sure you want to permanently clear all authentication audit logs? This action cannot be undone.")) {
        return;
    }
    
    const clearBtn = document.querySelector("#tab-logs-content .admin-btn.logout");
    if (clearBtn) {
        clearBtn.innerText = "Clearing...";
        clearBtn.disabled = true;
    }
    
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'clear_logs', action: 'clear_logs' })
        });
        
        const data = await response.json();
        if (response.ok && data.success) {
            showToast("Audit logs cleared successfully!");
            await fetchAdminDbData();
        } else {
            showToast(data.error || "Failed to clear audit logs", true);
        }
    } catch (e) {
        console.error("Failed to clear logs:", e);
        showToast("Network error clearing logs", true);
    } finally {
        if (clearBtn) {
            clearBtn.innerText = "🗑️ Clear Logs";
            clearBtn.disabled = false;
        }
    }
}

let userPermissionsData = {};

function updateHeaderPermissionCheckboxes() {
    const entries = Object.keys(whitelistData || {});
    const totalCount = entries.length;

    let catalogEnabledCount = 0;
    let journalEnabledCount = 0;

    entries.forEach(phone => {
        if (userPermissionsData[phone] && userPermissionsData[phone].catalog === true) {
            catalogEnabledCount++;
        }
        if (userPermissionsData[phone] && userPermissionsData[phone].journal === true) {
            journalEnabledCount++;
        }
    });

    const headerCatalogCb = document.getElementById("header-select-all-catalog");
    if (headerCatalogCb) {
        headerCatalogCb.checked = (totalCount > 0 && catalogEnabledCount === totalCount);
        headerCatalogCb.indeterminate = (catalogEnabledCount > 0 && catalogEnabledCount < totalCount);
    }

    const headerJournalCb = document.getElementById("header-select-all-journal");
    if (headerJournalCb) {
        headerJournalCb.checked = (totalCount > 0 && journalEnabledCount === totalCount);
        headerJournalCb.indeterminate = (journalEnabledCount > 0 && journalEnabledCount < totalCount);
    }
}

function toggleUserPermission(phone, feature, isChecked) {
    if (!userPermissionsData[phone]) {
        userPermissionsData[phone] = { catalog: false, journal: false };
    }
    userPermissionsData[phone][feature] = isChecked;

    updateHeaderPermissionCheckboxes();

    fetch('/api/admin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'save_user_permissions',
            data: { phone, permissions: userPermissionsData[phone] }
        })
    }).then(res => res.json()).then(resJson => {
        if (resJson.success) {
            if (typeof showToast === 'function') showToast(`Updated ${feature} access for ${phone}`, "success");
        } else {
            if (typeof showToast === 'function') showToast(resJson.error || "Failed to update permission", "error");
        }
    }).catch(e => {
        if (typeof showToast === 'function') showToast("Network error updating permission", "error");
    });
}

function bulkToggleUserPermissions(feature, enable) {
    const actionName = enable ? "enable" : "disable";
    let featureLabel = "Strategy Catalog & Trade Journal";
    if (feature === 'catalog') featureLabel = "Strategy Catalog";
    else if (feature === 'journal') featureLabel = "Trade Journal";

    if (!confirm(`Are you sure you want to ${actionName} ${featureLabel} for ALL whitelisted users?`)) {
        updateHeaderPermissionCheckboxes();
        return;
    }

    if (typeof showToast === 'function') {
        showToast(`Updating permissions for all users...`, "info");
    }

    fetch('/api/admin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'bulk_update_user_permissions',
            data: { feature, enable }
        })
    }).then(res => res.json()).then(resJson => {
        if (resJson.success) {
            Object.keys(whitelistData || {}).forEach(phone => {
                if (!userPermissionsData[phone]) {
                    userPermissionsData[phone] = { catalog: false, journal: false };
                }
                if (feature === 'all') {
                    userPermissionsData[phone].catalog = enable;
                    userPermissionsData[phone].journal = enable;
                } else if (feature === 'catalog') {
                    userPermissionsData[phone].catalog = enable;
                } else if (feature === 'journal') {
                    userPermissionsData[phone].journal = enable;
                }
            });

            renderWhitelistTable();
            if (typeof showToast === 'function') {
                showToast(`Successfully ${actionName}d ${featureLabel} for all ${resJson.count || 0} users`, "success");
            }
        } else {
            updateHeaderPermissionCheckboxes();
            if (typeof showToast === 'function') {
                showToast(resJson.error || "Failed to bulk update permissions", "error");
            }
        }
    }).catch(e => {
        updateHeaderPermissionCheckboxes();
        if (typeof showToast === 'function') {
            showToast("Network error bulk updating permissions", "error");
        }
    });
}

function renderWhitelistTable() {
    const tbody = document.getElementById("whitelist-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    const entries = Object.entries(whitelistData || {});
    const totalCount = entries.length;
    
    updateHeaderPermissionCheckboxes();
    
    const countBadge = document.getElementById("admin-user-count-badge");
    if (countBadge) {
        countBadge.innerText = `👥 Whitelisted Users: ${totalCount}`;
    }
    
    const searchVal = document.getElementById("user-search-input") ? document.getElementById("user-search-input").value.toLowerCase().trim() : "";
    let visibleCount = 0;
    
    entries.forEach(([phone, pin]) => {
        if (searchVal && !phone.includes(searchVal)) return;
        visibleCount++;
        
        const tr = document.createElement("tr");
        
        const tdPhone = document.createElement("td");
        tdPhone.innerHTML = `<strong>${phone}</strong>`;
        tr.appendChild(tdPhone);
        
        const tdStatus = document.createElement("td");
        tdStatus.style.fontFamily = "monospace";
        tdStatus.style.fontSize = "0.95rem";
        tdStatus.style.letterSpacing = "0.05em";
        
        const pinSpan = document.createElement("span");
        pinSpan.innerText = "••••••";
        pinSpan.style.marginRight = "0.5rem";
        tdStatus.appendChild(pinSpan);
        
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "admin-btn edit";
        toggleBtn.style.padding = "0.15rem 0.4rem";
        toggleBtn.style.fontSize = "0.7rem";
        toggleBtn.style.margin = "0";
        toggleBtn.innerText = "👁️ Show";
        toggleBtn.addEventListener("click", () => {
            if (pinSpan.innerText === "••••••") {
                pinSpan.innerText = pin;
                toggleBtn.innerText = "🔒 Hide";
            } else {
                pinSpan.innerText = "••••••";
                toggleBtn.innerText = "👁️ Show";
            }
        });
        tdStatus.appendChild(toggleBtn);
        tr.appendChild(tdStatus);
        
        // Catalog Access Checkbox
        const tdCatalog = document.createElement("td");
        tdCatalog.style.textAlign = "center";
        const catPerm = (userPermissionsData[phone] && userPermissionsData[phone].catalog) === true;
        tdCatalog.innerHTML = `<label style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; font-weight: 600; color: ${catPerm ? '#34d399' : 'var(--text-secondary)'};"><input type="checkbox" ${catPerm ? 'checked' : ''} onchange="toggleUserPermission('${phone}', 'catalog', this.checked)"> Catalog</label>`;
        tr.appendChild(tdCatalog);

        // Journal Access Checkbox
        const tdJournal = document.createElement("td");
        tdJournal.style.textAlign = "center";
        const journalPerm = (userPermissionsData[phone] && userPermissionsData[phone].journal) === true;
        tdJournal.innerHTML = `<label style="cursor: pointer; display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; font-weight: 600; color: ${journalPerm ? '#34d399' : 'var(--text-secondary)'};"><input type="checkbox" ${journalPerm ? 'checked' : ''} onchange="toggleUserPermission('${phone}', 'journal', this.checked)"> Journal</label>`;
        tr.appendChild(tdJournal);

        const tdAction = document.createElement("td");
        tdAction.style.display = "flex";
        tdAction.style.gap = "0.5rem";
        tdAction.style.justifyContent = "flex-end";
        
        const delBtn = document.createElement("button");
        delBtn.className = "admin-btn logout";
        delBtn.style.padding = "0.25rem 0.6rem";
        delBtn.style.fontSize = "0.75rem";
        delBtn.style.margin = "0";
        delBtn.innerText = "Remove";
        delBtn.addEventListener("click", () => deleteUser(phone));
        tdAction.appendChild(delBtn);
        
        const regenBtn = document.createElement("button");
        regenBtn.className = "admin-btn edit";
        regenBtn.style.padding = "0.25rem 0.6rem";
        regenBtn.style.fontSize = "0.75rem";
        regenBtn.style.margin = "0";
        regenBtn.innerText = "🔄 Regen PIN";
        regenBtn.addEventListener("click", () => regenerateUserPin(phone));
        tdAction.appendChild(regenBtn);
        
        tr.appendChild(tdAction);
        
        tbody.appendChild(tr);
    });

    const searchLabel = document.getElementById("users-search-count-label");
    if (searchLabel) {
        if (searchVal) {
            searchLabel.innerText = `Showing ${visibleCount} of ${totalCount} users`;
        } else {
            searchLabel.innerText = `Total: ${totalCount} whitelisted users`;
        }
    }
}

function filterUsersList() {
    renderWhitelistTable();
}

async function openAddUserForm() {
    const phone = prompt("Enter WhatsApp phone number with country code (e.g. +919876543210):");
    if (!phone) return;
    
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_user',
                data: { phone, pin }
            })
        });
        if (response.ok) {
            showToast(`User whitelisted successfully!\nDefault PIN: ${pin}`);
            await fetchAdminDbData();
        } else {
            const err = await response.json();
            showToast(err.error || "Failed to add user", true);
        }
    } catch (e) {
        showToast("Error adding user", true);
    }
}

async function deleteUser(phone) {
    if (!confirm(`Are you sure you want to remove user "${phone}"?`)) return;
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'delete_user',
                data: { phone }
            })
        });
        if (response.ok) {
            showToast("User removed successfully");
            await fetchAdminDbData();
        } else {
            showToast("Failed to remove user", true);
        }
    } catch (e) {
        showToast("Error removing user", true);
    }
}

async function regenerateUserPin(phone) {
    if (!confirm(`Are you sure you want to regenerate the access PIN for user "${phone}"?`)) return;
    
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_user',
                data: { phone, pin: newPin }
            })
        });
        if (response.ok) {
            showToast(`PIN regenerated successfully!\nNew PIN: ${newPin}`);
            await fetchAdminDbData();
        } else {
            const err = await response.json();
            showToast(err.error || "Failed to regenerate PIN", true);
        }
    } catch (e) {
        showToast("Error regenerating PIN", true);
    }
}

function renderHolidaysTable() {
    const tbody = document.getElementById("holidays-table-body");
    tbody.innerHTML = "";
    
    const sortedHolidays = Object.entries(marketHolidays2026).sort((a, b) => new Date(a[0]) - new Date(b[0]));
    
    sortedHolidays.forEach(([dateStr, name]) => {
        const tr = document.createElement("tr");
        
        const tdDate = document.createElement("td");
        tdDate.innerText = dateStr;
        tr.appendChild(tdDate);
        
        const tdName = document.createElement("td");
        tdName.innerText = name;
        tr.appendChild(tdName);
        
        const tdAction = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.className = "admin-btn logout";
        delBtn.style.padding = "0.25rem 0.6rem";
        delBtn.style.fontSize = "0.75rem";
        delBtn.innerText = "Remove";
        delBtn.addEventListener("click", () => deleteHoliday(dateStr));
        tdAction.appendChild(delBtn);
        tr.appendChild(tdAction);
        
        tbody.appendChild(tr);
    });
}

async function addNewHoliday() {
    const dateInput = document.getElementById("new-holiday-date").value;
    const nameInput = document.getElementById("new-holiday-name").value.trim();
    
    if (!dateInput || !nameInput) {
        showToast("Please specify both a Date and Holiday Name.", "warning");
        return;
    }
    
    marketHolidays2026[dateInput] = nameInput;
    
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_holidays',
                data: marketHolidays2026
            })
        });
        if (response.ok) {
            showToast("Holiday added successfully!");
            document.getElementById("new-holiday-date").value = "";
            document.getElementById("new-holiday-name").value = "";
            await fetchAdminDbData();
            allCalculatedDeployments = calculateDeploymentsForRange(new Date(2026, 5, 1), new Date(2026, 7, 31));
            updateCalendars();
        } else {
            showToast("Failed to add holiday", true);
        }
    } catch (e) {
        showToast("Error adding holiday", true);
    }
}

async function deleteHoliday(dateStr) {
    if (!confirm(`Are you sure you want to remove the holiday on ${dateStr}?`)) return;
    
    delete marketHolidays2026[dateStr];
    
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'save_holidays',
                data: marketHolidays2026
            })
        });
        if (response.ok) {
            showToast("Holiday removed");
            await fetchAdminDbData();
            allCalculatedDeployments = calculateDeploymentsForRange(new Date(2026, 5, 1), new Date(2026, 7, 31));
            updateCalendars();
        } else {
            showToast("Failed to remove holiday", true);
        }
    } catch (e) {
        showToast("Error removing holiday", true);
    }
}

async function syncWhitelist() {
    if (!confirm("Are you sure you want to overwrite Vercel KV whitelist with the codebase whitelist.json file? Any direct edits in the web UI will be overwritten.")) return;
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync_whitelist' })
        });
        const resJson = await response.json();
        if (response.ok && resJson.success) {
            showToast("Whitelist successfully synced from codebase!");
            await fetchAdminDbData();
        } else {
            showToast(resJson.error || "Sync failed", true);
        }
    } catch (err) {
        showToast("Failed to connect to save API", true);
    }
}

async function syncHolidays() {
    if (!confirm("Are you sure you want to overwrite Vercel KV holidays with the codebase holidays.js file? Any direct edits in the web UI will be overwritten.")) return;
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync_holidays' })
        });
        const resJson = await response.json();
        if (response.ok && resJson.success) {
            showToast("Holidays successfully synced from codebase!");
            await fetchAdminDbData();
        } else {
            showToast(resJson.error || "Sync failed", true);
        }
    } catch (err) {
        showToast("Failed to connect to save API", true);
    }
}

async function syncStrategies() {
    if (!confirm("Are you sure you want to overwrite Vercel KV strategies with the codebase strategies.js file? Any direct edits in the web UI will be overwritten.")) return;
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync_strategies' })
        });
        const resJson = await response.json();
        if (response.ok && resJson.success) {
            showToast("Strategies successfully synced from codebase!");
            await fetchAdminDbData();
        } else {
            showToast(resJson.error || "Sync failed", true);
        }
    } catch (err) {
        showToast("Failed to connect to save API", true);
    }
}

function exportWhitelist() {
    if (!whitelistData) {
        showToast("No whitelist data available to export", true);
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(whitelistData, null, 4));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "whitelist.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("whitelist.json exported successfully!");
}

function exportHolidays() {
    if (!marketHolidays2026) {
        showToast("No holiday data available to export", true);
        return;
    }
    const jsContent = `const marketHolidays2026 = ${JSON.stringify(marketHolidays2026, null, 4)};\n\nif (typeof module !== 'undefined') {\n    module.exports = marketHolidays2026;\n}\n`;
    const dataStr = "data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "holidays.js");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("holidays.js exported successfully!");
}

function exportStrategies() {
    if (!strategiesData) {
        showToast("No strategy data available to export", true);
        return;
    }
    const jsContent = `// Options Trading Strategies Data\n// Generated dynamically from Excel parsed data\nconst strategiesData = ${JSON.stringify(strategiesData, null, 4)};\n\nif (typeof module !== 'undefined') {\n    module.exports = strategiesData;\n}\n`;
    const dataStr = "data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "strategies.js");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast("strategies.js exported successfully!");
}

async function logoutAdmin() {
    try {
        await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {
        console.warn("Server logout failed, attempting local cookie overwrite fallback", e);
    }
    document.cookie = 'admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.href = '/admin.html';
}

async function logoutUser() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        console.warn("Server logout failed, attempting local cookie overwrite fallback", e);
    }
    document.cookie = 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.href = '/login.html';
}

/* ─── Capital Flow Timeline View Helpers ──────────────────────────────────── */

function toggleMobileMenu(forceClose) {
    const overlay = document.getElementById("mobile-nav-overlay");
    if (!overlay) return;
    if (forceClose === true || overlay.classList.contains("open")) {
        overlay.classList.remove("open");
    } else {
        overlay.classList.add("open");
    }
}

function switchViewMode(mode) {
    const canCatalog = window.isAdminMode || (window.userPermissions && window.userPermissions.catalog === true);
    const canJournal = window.isAdminMode || (window.userPermissions && window.userPermissions.journal === true);

    if (mode === "catalog" && !canCatalog) {
        if (typeof showToast === 'function') showToast("Strategy Catalog access is reserved for authorized accounts.", "warning");
        mode = "calendar";
    }
    if (mode === "journal" && !canJournal) {
        if (typeof showToast === 'function') showToast("Trade Journal access is reserved for authorized accounts.", "warning");
        mode = "calendar";
    }

    if (typeof trackUserActivity === 'function') {
        trackUserActivity('PAGE_VIEW', `Navigated to ${mode.toUpperCase()} view`, { mode });
    }

    currentFlowViewMode = mode;
    
    const calendarBtn = document.getElementById("mode-calendar-btn");
    const flowBtn = document.getElementById("mode-flow-btn");

    const headerNotesBtn = document.getElementById("header-notes-btn");
    const headerCatalogBtn = document.getElementById("header-catalog-btn");
    const headerJournalBtn = document.getElementById("header-journal-btn");
    const headerPlannerBtn = document.getElementById("header-planner-btn");

    if (calendarBtn) calendarBtn.classList.toggle("active", mode === "calendar");
    if (flowBtn) flowBtn.classList.toggle("active", mode === "flow");

    if (headerNotesBtn) headerNotesBtn.classList.toggle("active", mode === "notes");
    if (headerCatalogBtn) headerCatalogBtn.classList.toggle("active", mode === "catalog");
    if (headerJournalBtn) headerJournalBtn.classList.toggle("active", mode === "journal");
    if (headerPlannerBtn) headerPlannerBtn.classList.toggle("active", mode === "planner");

    // Update Mobile Nav buttons
    ['calendar', 'flow', 'planner', 'notes', 'catalog', 'journal'].forEach(m => {
        const mBtn = document.getElementById(`mobile-nav-${m}-btn`);
        if (mBtn) mBtn.classList.toggle("active", mode === m);
    });

    // Close mobile menu on view switch
    toggleMobileMenu(true);
    
    const calContainer = document.getElementById("calendar-view-container");
    const flowContainer = document.getElementById("capital-flow-view-container");
    const notesContainer = document.getElementById("notes-view-container");
    const plannerContainer = document.getElementById("capital-planner-view-container");
    const catalogContainer = document.getElementById("catalog-view-container");
    const journalContainer = document.getElementById("journal-view-container");

    if (calContainer) calContainer.style.display = mode === "calendar" ? "grid" : "none";
    if (flowContainer) flowContainer.style.display = mode === "flow" ? "grid" : "none";
    if (notesContainer) notesContainer.style.display = mode === "notes" ? "block" : "none";
    if (plannerContainer) plannerContainer.style.display = mode === "planner" ? "block" : "none";
    if (catalogContainer) catalogContainer.style.display = mode === "catalog" ? "block" : "none";
    if (journalContainer) journalContainer.style.display = mode === "journal" ? "block" : "none";
    
    [calendarBtn, flowBtn].forEach(btn => {
        if (btn) {
            btn.style.background = "";
            btn.style.color = "";
            btn.style.borderColor = "";
        }
    });

    if (mode === "notes" && typeof fetchNotesData === 'function') fetchNotesData();
    if (mode === "planner") renderCapitalPlannerView();
    if (mode === "catalog") renderStrategyCatalog();
    if (mode === "journal") fetchUserTradesData();
    
    if (mode === "calendar" || mode === "flow") {
        updateCalendars();
    }
}

// Navigate Capital Flow months
function navigateFlowMonth(dir) {
    currentFlowMonth += dir;
    if (currentFlowMonth > 11) {
        currentFlowMonth = 0;
        currentFlowYear += 1;
    } else if (currentFlowMonth < 0) {
        currentFlowMonth = 11;
        currentFlowYear -= 1;
    }
    renderCapitalFlow();
}

// Helper to get start symbol shape
function getStartSymbol(sheet, time) {
    const isSolid = !time || time.startsWith("15:16");
    if (sheet === "Monthly") {
        return isSolid ? "■" : "□";
    } else if (sheet === "BiWkly") {
        return isSolid ? "●" : "○";
    } else {
        return isSolid ? "▲" : "△";
    }
}

// Render the Capital Flow Timeline view
function renderCapitalFlow() {
    const grid = document.getElementById("capital-flow-grid");
    if (!grid) return;
    grid.innerHTML = "";
    
    const year = currentFlowYear;
    const month = currentFlowMonth;
    
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById("flow-month-title").innerText = `${monthNames[month]} ${year} (Capital Flow)`;
    
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    
    const today = new Date();
    
    // Extract valid trading days
    const tradingDays = [];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayOfWeek = date.getDay();
        const dateStr = formatDateString(date);
        
        // Skip weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        // Skip holidays
        const isHoliday = marketHolidays2026 && marketHolidays2026[dateStr];
        if (isHoliday) continue;
        
        tradingDays.push(date);
    }
    
    if (tradingDays.length === 0) {
        grid.style.gridTemplateColumns = "1fr";
        grid.innerHTML = "<div style='text-align:center; padding: 2.5rem; color: var(--text-secondary);'>No trading days in this month.</div>";
        return;
    }
    
    // Set grid columns: 40px Category + 180px Strategy Details + N trading days
    grid.style.gridTemplateColumns = `40px 180px repeat(${tradingDays.length}, minmax(0, 1fr))`;
    
    // Header row: sticky corner + days
    const cornerCell = document.createElement("div");
    cornerCell.className = "flow-header-cell sticky-corner";
    cornerCell.innerText = "Strategy / Index";
    cornerCell.style.gridColumn = "1 / 3";
    grid.appendChild(cornerCell);
    
    tradingDays.forEach(date => {
        const cell = document.createElement("div");
        
        const isToday = date.getDate() === today.getDate() &&
                        date.getMonth() === today.getMonth() &&
                        date.getFullYear() === today.getFullYear();
        cell.className = `flow-header-cell${isToday ? ' today' : ''}`;
        
        const daySpan = document.createElement("span");
        daySpan.className = "flow-header-day";
        daySpan.innerText = date.toLocaleDateString("en-US", { weekday: "short" });
        
        const dateSpan = document.createElement("span");
        dateSpan.className = "flow-header-date";
        dateSpan.innerText = date.getDate();
        
        cell.appendChild(daySpan);
        cell.appendChild(dateSpan);
        grid.appendChild(cell);
    });
    
    // Filter strategies
    const filteredStrategies = strategiesData.filter(strat => {
        const matchesIndex = activeFilters.index === "all" || strat.index.startsWith(activeFilters.index);
        const matchesType = activeFilters.type === "all" || strat.sheet === activeFilters.type;
        const matchesPortfolio = !activeFilters.portfolioOnly || starredStrategies.has(strat.id);
        return matchesIndex && matchesType && matchesPortfolio;
    });
    
    if (filteredStrategies.length === 0) {
        const noResults = document.createElement("div");
        noResults.style.gridColumn = `1 / span ${tradingDays.length + 2}`;
        noResults.style.textAlign = "center";
        noResults.style.padding = "2.5rem";
        noResults.style.color = "var(--text-secondary)";
        noResults.innerText = "No strategies match the active filters.";
        grid.appendChild(noResults);
        return;
    }
    
    // Group strategies by category
    const categoriesOrder = ["Monthly", "BiWkly", "STBT"];
    const grouped = { Monthly: [], BiWkly: [], STBT: [] };
    
    filteredStrategies.forEach(strat => {
        if (grouped[strat.sheet]) {
            grouped[strat.sheet].push(strat);
        }
    });
    
    let currentRowGridIndex = 2; // offset header row
    
    categoriesOrder.forEach(cat => {
        const strats = grouped[cat];
        if (!strats || strats.length === 0) return;
        
        const groupSize = strats.length;
        const startRow = currentRowGridIndex;
        const endRow = startRow + groupSize;
        
        // Render Vertical Category Header spanning all rows in this group
        const catCell = document.createElement("div");
        catCell.className = `flow-category-header ${cat.toLowerCase()}`;
        catCell.style.gridColumn = "1";
        catCell.style.gridRow = `${startRow} / ${endRow}`;
        
        let displayLabel = cat;
        if (cat === "BiWkly") displayLabel = "Bi-Weekly";
        catCell.innerText = displayLabel;
        grid.appendChild(catCell);
        
        // Render each strategy row in this group
        strats.forEach(strat => {
            const rowIdx = currentRowGridIndex;
            
            // Strategy Details Card
            const infoCard = document.createElement("div");
            infoCard.className = "flow-strategy-info";
            infoCard.style.gridColumn = "2";
            infoCard.style.gridRow = `${rowIdx}`;
            
            const isStarred = starredStrategies.has(strat.id);
            infoCard.innerHTML = `
                <div class="flow-strat-name-row" style="display: flex; align-items: center; gap: 0.3rem;">
                    <span class="flow-strat-star ${isStarred ? 'active' : ''}" onclick="event.stopPropagation(); toggleStrategyStar('${strat.id}')" title="${isStarred ? 'Remove from My Portfolio' : 'Add to My Portfolio'}">${isStarred ? '★' : '☆'}</span>
                    <span class="flow-strat-name" title="${strat.name}">${strat.name}</span>
                </div>
                <div class="flow-strat-meta">
                    <span>${strat.index}</span>
                    <span>${strat.time ? strat.time.slice(0, 5) : "-"}</span>
                </div>
            `;
            infoCard.style.cursor = "pointer";
            infoCard.addEventListener("click", () => {
                const stratDeps = allCalculatedDeployments.filter(d => d.strategy.id === strat.id);
                const targetDep = stratDeps.length > 0 ? stratDeps[0] : { strategy: strat, actualDate: new Date(), expiryDate: new Date(), nominalDate: new Date(), shifted: false };
                showStrategyDetails(targetDep);
            });
            grid.appendChild(infoCard);
            
            // Render slots
            tradingDays.forEach((date, dayColIndex) => {
                const dayCell = document.createElement("div");
                const isToday = date.getDate() === today.getDate() &&
                                date.getMonth() === today.getMonth() &&
                                date.getFullYear() === today.getFullYear();
                dayCell.className = `flow-day-cell${isToday ? ' today' : ''}`;
                dayCell.style.gridColumn = `${dayColIndex + 3}`;
                dayCell.style.gridRow = `${rowIdx}`;
                grid.appendChild(dayCell);
            });
            
            // Filter deployments for this strategy in month range
            const strategyDeployments = allCalculatedDeployments.filter(dep => {
                if (dep.strategy.id !== strat.id) return false;
                
                const overlaps = dep.actualDate <= monthEnd && dep.exitDate >= monthStart;
                if (!overlaps) return false;
                
                if (activeFilters.view === "deploy") {
                    return dep.actualDate >= monthStart && dep.actualDate <= monthEnd;
                }
                if (activeFilters.view === "exit") {
                    return dep.exitDate >= monthStart && dep.exitDate <= monthEnd;
                }
                return true;
            });
            
            // Draw bars
            strategyDeployments.forEach(dep => {
                let startIdx = tradingDays.findIndex(d => formatDateString(d) === formatDateString(dep.actualDate));
                let endIdx = tradingDays.findIndex(d => formatDateString(d) === formatDateString(dep.exitDate));
                
                const finalStartIdx = startIdx !== -1 ? startIdx : 0;
                const finalEndIdx = endIdx !== -1 ? endIdx : tradingDays.length - 1;
                
                const startCol = finalStartIdx + 3;
                const endCol = finalEndIdx + 4;
                
                const barContainer = document.createElement("div");
                barContainer.className = "flow-bar-container";
                barContainer.style.gridColumn = `${startCol} / ${endCol}`;
                barContainer.style.gridRow = `${rowIdx}`;
                
                const bar = document.createElement("div");
                bar.className = `flow-bar ${strat.sheet.toLowerCase()}`;
                
                if (startIdx !== -1) {
                    const startSymbol = document.createElement("span");
                    startSymbol.className = "flow-bar-start";
                    startSymbol.innerText = getStartSymbol(strat.sheet, strat.time);
                    bar.appendChild(startSymbol);
                }
                
                if (endIdx !== -1) {
                    const endSymbol = document.createElement("span");
                    endSymbol.className = "flow-bar-end";
                    endSymbol.innerText = "↩";
                    bar.appendChild(endSymbol);
                }
                
                barContainer.appendChild(bar);
                
                const deployLabel = dep.actualDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                const exitLabel = dep.exitDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                barContainer.title = `${strat.name} (${strat.index})\nDeployed: ${deployLabel}\nExit: ${exitLabel}`;
                
                barContainer.addEventListener("click", () => {
                    showStrategyDetails(dep);
                });
                
                grid.appendChild(barContainer);
            });
            
            currentRowGridIndex++;
        });
    });
}

// -------------------------------------------------------------
// CAPITAL ALLOCATION PLANNER ENGINE
// -------------------------------------------------------------

function renderCapitalPlannerView() {
    const masterData = window.capitalPlannerMasterData || (typeof capitalPlannerMasterData !== 'undefined' ? capitalPlannerMasterData : null);
    if (!masterData || !masterData.buckets) return;

    const capitalInput = document.getElementById("planner-capital-input");
    const totalCapital = capitalInput ? parseFloat(capitalInput.value) || 5000000 : 5000000;

    const heatmapBody = document.getElementById("planner-heatmap-body");
    const breakdownBody = document.getElementById("planner-breakdown-body");

    if (!heatmapBody || !breakdownBody) return;

    // 1. Render Week-wise Heatmap Matrix
    let heatmapHtml = "";
    masterData.buckets.forEach(bucket => {
        const badgeStyle = bucket.id === "p1" ? "background: rgba(168, 85, 247, 0.18); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.4);" :
                           bucket.id === "p2" ? "background: rgba(59, 130, 246, 0.18); color: #bfdbfe; border: 1px solid rgba(59, 130, 246, 0.4);" :
                           "background: rgba(16, 185, 129, 0.18); color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.4);";
        
        heatmapHtml += `
            <tr style="border-bottom: 1px solid var(--border-color);" class="planner-row">
                <td style="padding: 0.8rem; text-align: left;">
                    <span style="display: inline-block; padding: 0.25rem 0.6rem; border-radius: 4px; font-weight: 700; font-size: 0.8rem; ${badgeStyle}">${bucket.name}</span>
                </td>
                <td style="padding: 0.8rem; font-weight: 600;">${(bucket.targetDeployPct && bucket.targetDeployPct[0] !== undefined) ? bucket.targetDeployPct[0] : 0}%</td>
                <td style="padding: 0.8rem; font-weight: 600;">${(bucket.targetDeployPct && bucket.targetDeployPct[1] !== undefined) ? bucket.targetDeployPct[1] : 0}%</td>
                <td style="padding: 0.8rem; font-weight: 600;">${(bucket.targetDeployPct && bucket.targetDeployPct[2] !== undefined) ? bucket.targetDeployPct[2] : 0}%</td>
                <td style="padding: 0.8rem; font-weight: 600;">${(bucket.targetDeployPct && bucket.targetDeployPct[3] !== undefined) ? bucket.targetDeployPct[3] : 0}%</td>
                <td style="padding: 0.8rem; font-weight: 600;">${(bucket.targetDeployPct && bucket.targetDeployPct[4] !== undefined) ? bucket.targetDeployPct[4] : 0}%</td>
                <td style="padding: 0.8rem; font-weight: 700; color: var(--text-primary);">${bucket.avgCapitalPct}%</td>
                <td style="padding: 0.8rem; text-align: left; font-size: 0.8rem; color: var(--text-secondary);">${bucket.remarks}</td>
            </tr>
        `;
    });
    heatmapBody.innerHTML = heatmapHtml;

    // 2. Render Strategy-Wise RoI Breakdown Table
    let breakdownHtml = "";
    let grandMaxPotential = 0;
    let grandExpectedNetProfit = 0;

    masterData.buckets.forEach(bucket => {
        const winRateInput = document.getElementById(`winrate-input-${bucket.id}`);
        const winRate = winRateInput ? parseFloat(winRateInput.value) || bucket.defaultWinRate : bucket.defaultWinRate;
        const winRateDecimal = winRate / 100;

        // Mathematical Expectancy Factor: (WinRate * Target) - ((1 - WinRate) * SL)
        // With 1:1 RR (Target = SL), Factor = (2 * WinRateDecimal) - 1
        const netFactor = (2 * winRateDecimal) - 1;

        const bucketMaxPotential = (totalCapital * bucket.maxPotentialPct) / 100;
        const bucketExpectedNet = bucketMaxPotential * netFactor;
        const bucketNetRoiPct = bucket.maxPotentialPct * netFactor;

        grandMaxPotential += bucketMaxPotential;
        grandExpectedNetProfit += bucketExpectedNet;

        const bucketHeaderBg = bucket.id === "p1" ? "rgba(168, 85, 247, 0.12)" :
                               bucket.id === "p2" ? "rgba(59, 130, 246, 0.12)" :
                               "rgba(16, 185, 129, 0.12)";
        const bucketTextColor = bucket.id === "p1" ? "#d8b4fe" : bucket.id === "p2" ? "#93c5fd" : "#6ee7b7";

        breakdownHtml += `
            <tr style="background: ${bucketHeaderBg}; font-weight: 700; border-top: 2px solid var(--border-color);" class="planner-bucket-row">
                <td style="padding: 0.75rem 0.8rem; color: ${bucketTextColor}; font-size: 0.9rem;">${bucket.name}</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor};">${(bucket.targetDeployPct && bucket.targetDeployPct[0] !== undefined) ? bucket.targetDeployPct[0] : 0}%</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor};">${(bucket.targetDeployPct && bucket.targetDeployPct[1] !== undefined) ? bucket.targetDeployPct[1] : 0}%</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor};">${(bucket.targetDeployPct && bucket.targetDeployPct[2] !== undefined) ? bucket.targetDeployPct[2] : 0}%</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor};">${(bucket.targetDeployPct && bucket.targetDeployPct[3] !== undefined) ? bucket.targetDeployPct[3] : 0}%</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor};">${(bucket.targetDeployPct && bucket.targetDeployPct[4] !== undefined) ? bucket.targetDeployPct[4] : 0}%</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor};">${bucket.maxPotentialPct}%</td>
                <td style="padding: 0.75rem; text-align: right; color: ${bucketTextColor}; font-weight: 700;">₹ ${bucketMaxPotential.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                <td style="padding: 0.75rem; text-align: center;">
                    <input type="number" id="winrate-input-${bucket.id}" value="${winRate}" min="50" max="100" step="1" onchange="recalculateCapitalPlanner()" style="width: 55px; text-align: center; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px; padding: 0.25rem; font-weight: 700; font-size: 0.85rem;"> %
                </td>
                <td style="padding: 0.75rem; text-align: right; color: ${bucketTextColor}; font-weight: 700;">₹ ${bucketExpectedNet.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                <td style="padding: 0.75rem; text-align: center; color: ${bucketTextColor}; font-weight: 700;">${bucketNetRoiPct.toFixed(2)}%</td>
            </tr>
        `;

        bucket.strategies.forEach(strat => {
            const stratMaxPotential = (totalCapital * strat.maxProfitPct) / 100;
            const alloc = strat.allocationW || [];
            const w1Str = alloc[0] > 0 ? `${alloc[0]}%` : "-";
            const w2Str = alloc[1] > 0 ? `${alloc[1]}%` : "-";
            const w3Str = alloc[2] > 0 ? `${alloc[2]}%` : "-";
            const w4Str = alloc[3] > 0 ? `${alloc[3]}%` : "-";
            const w5Str = alloc[4] > 0 ? `${alloc[4]}%` : "-";

            breakdownHtml += `
                <tr style="border-bottom: 1px solid var(--border-color);" class="planner-strat-row" onclick="openPlannerStrategyModal('${strat.appStrategyId}')">
                    <td style="padding: 0.55rem 0.8rem 0.55rem 1.5rem; cursor: pointer;">
                        <strong style="color: var(--text-primary); font-size: 0.85rem; display: flex; align-items: center; gap: 0.3rem;">
                            ${strat.displayName} <span style="font-size: 0.7rem; color: #a855f7;">🔗</span>
                        </strong>
                        <span style="font-size: 0.72rem; color: var(--text-secondary); display: block;">${strat.cycleLabel}</span>
                    </td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">${w1Str}</td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">${w2Str}</td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">${w3Str}</td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">${w4Str}</td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">${w5Str}</td>
                    <td style="padding: 0.55rem; text-align: center; font-weight: 500;">${strat.targetSlPct}%</td>
                    <td style="padding: 0.55rem; text-align: right; font-weight: 600;">₹ ${stratMaxPotential.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">-</td>
                    <td style="padding: 0.55rem; text-align: right; color: var(--text-secondary);">-</td>
                    <td style="padding: 0.55rem; text-align: center; color: var(--text-secondary);">-</td>
                </tr>
            `;
        });
    });

    const grandMaxPct = (grandMaxPotential / totalCapital) * 100;
    const grandNetPct = (grandExpectedNetProfit / totalCapital) * 100;

    breakdownHtml += `
        <tr style="background: rgba(16, 185, 129, 0.15); font-weight: 700; border-top: 2px solid var(--border-color); font-size: 0.9rem;">
            <td style="padding: 0.8rem; color: #10b981;">Target Deployed Capital & Portfolio Totals</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">100%</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">100%</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">100%</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">100%</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">100%</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">-</td>
            <td style="padding: 0.8rem; text-align: right; color: #60a5fa;">₹ ${grandMaxPotential.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">-</td>
            <td style="padding: 0.8rem; text-align: right; color: #34d399;">₹ ${grandExpectedNetProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
            <td style="padding: 0.8rem; text-align: center; color: #34d399;">${grandNetPct.toFixed(2)}%</td>
        </tr>
    `;

    breakdownBody.innerHTML = breakdownHtml;

    // 3. Update Dashboard KPI Summary Cards
    const kpiCapital = document.getElementById("kpi-total-capital");
    const kpiMaxPotential = document.getElementById("kpi-max-potential");
    const kpiMaxPotentialPct = document.getElementById("kpi-max-potential-pct");
    const kpiNetMonthly = document.getElementById("kpi-net-monthly");
    const kpiNetMonthlyPct = document.getElementById("kpi-net-monthly-pct");
    const kpiAnnualized = document.getElementById("kpi-annualized");
    const kpiAnnualizedPct = document.getElementById("kpi-annualized-pct");

    if (kpiCapital) kpiCapital.innerText = `₹ ${totalCapital.toLocaleString('en-IN')}`;
    if (kpiMaxPotential) kpiMaxPotential.innerText = `₹ ${grandMaxPotential.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (kpiMaxPotentialPct) kpiMaxPotentialPct.innerText = `${grandMaxPct.toFixed(2)}% / month (100% Target)`;

    if (kpiNetMonthly) kpiNetMonthly.innerText = `₹ ${grandExpectedNetProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (kpiNetMonthlyPct) kpiNetMonthlyPct.innerText = `${grandNetPct.toFixed(2)}% / month (Probability Weighted)`;

    const annualizedRupees = grandExpectedNetProfit * 12;
    const annualizedPct = grandNetPct * 12;

    if (kpiAnnualized) kpiAnnualized.innerText = `₹ ${annualizedRupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    if (kpiAnnualizedPct) kpiAnnualizedPct.innerText = `${annualizedPct.toFixed(2)}% / annum`;
}

function recalculateCapitalPlanner() {
    renderCapitalPlannerView();
}

function resetPlannerDefaults() {
    const capitalInput = document.getElementById("planner-capital-input");
    if (capitalInput) capitalInput.value = 5000000;

    const p1Wr = document.getElementById("winrate-input-p1");
    const p2Wr = document.getElementById("winrate-input-p2");
    const p3Wr = document.getElementById("winrate-input-p3");

    if (p1Wr) p1Wr.value = 80;
    if (p2Wr) p2Wr.value = 75;
    if (p3Wr) p3Wr.value = 70;

    renderCapitalPlannerView();
}

function openPlannerStrategyModal(appStrategyId) {
    if (!appStrategyId) return;

    if (window.allDeploymentsCache && window.allDeploymentsCache.length > 0) {
        const dep = window.allDeploymentsCache.find(d => d.strategy && d.strategy.id === appStrategyId);
        if (dep) {
            showStrategyDetails(dep);
            return;
        }
    }

    const strat = (window.strategiesData || []).find(s => s.id === appStrategyId);
    if (strat) {
        showStrategyDetails({
            strategy: strat,
            actualDate: new Date(),
            originalDate: new Date(),
            isHolidayShifted: false
        });
    }
}

/* ==========================================================================
   FEATURE 1: STRATEGY CATALOG CLIENT LOGIC
   ========================================================================== */

let activeCatalogFilter = 'all';
let activeCatalogLayout = 'cards';

function switchCatalogLayout(layout) {
    activeCatalogLayout = layout;
    const cardsBtn = document.getElementById("catalog-layout-cards");
    const listBtn = document.getElementById("catalog-layout-list");

    if (cardsBtn) cardsBtn.classList.toggle("active", layout === "cards");
    if (listBtn) listBtn.classList.toggle("active", layout === "list");

    if (typeof trackUserActivity === 'function') {
        trackUserActivity('CATALOG_LAYOUT', `Switched catalog layout to ${layout.toUpperCase()}`, { layout });
    }

    renderStrategyCatalog();
}

function filterCatalogCategory(category) {
    activeCatalogFilter = category;
    ['all', '0_adjustment', 'discretionary', 'adjustments'].forEach(cat => {
        const btn = document.getElementById(`catalog-filter-${cat}`);
        if (btn) btn.classList.toggle('active', cat === category);
    });
    renderStrategyCatalog();
}

function renderStrategyCatalog() {
    const cardsGrid = document.getElementById("catalog-cards-grid");
    const listContainer = document.getElementById("catalog-list-table-container");
    const listTbody = document.getElementById("catalog-list-tbody");

    if (!cardsGrid || !listContainer || !listTbody) return;

    if (activeCatalogLayout === 'cards') {
        cardsGrid.style.display = "grid";
        listContainer.style.display = "none";
    } else {
        cardsGrid.style.display = "none";
        listContainer.style.display = "block";
    }

    const strats = window.strategiesData || [];
    const filtered = strats.filter(s => {
        const cat = s.strategy_category || '0_adjustment';
        if (activeCatalogFilter === 'all') return true;
        return cat === activeCatalogFilter;
    });

    if (activeCatalogLayout === 'cards') {
        cardsGrid.innerHTML = "";
        if (filtered.length === 0) {
            cardsGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-secondary);">No strategies found in this category.</div>`;
            return;
        }

        filtered.forEach(strat => {
            const cat = strat.strategy_category || '0_adjustment';
            const badgeText = cat === '0_adjustment' ? '⚡ 0 Adjustment' : cat === 'discretionary' ? '🎯 Discretionary' : '🛠️ Adjustment';
            const badgeColor = cat === '0_adjustment' ? 'rgba(168, 85, 247, 0.18); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.4);' :
                               cat === 'discretionary' ? 'rgba(59, 130, 246, 0.18); color: #bfdbfe; border: 1px solid rgba(59, 130, 246, 0.4);' :
                               'rgba(245, 158, 11, 0.18); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.4);';

            const card = document.createElement("div");
            card.className = "catalog-card";
            card.style.cssText = "background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 1.2rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.8rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15); transition: transform 0.2s, border-color 0.2s;";
            
            const ceLegs = (strat.setup && strat.setup.CE) || [];
            const peLegs = (strat.setup && strat.setup.PE) || [];
            const ceHtml = ceLegs.map(leg => `<li><strong style="color: #60a5fa;">CE:</strong> ${leg}</li>`).join('');
            const peHtml = peLegs.map(leg => `<li><strong style="color: #f87171;">PE:</strong> ${leg}</li>`).join('');
            const allLegsHtml = (ceHtml || peHtml) ? (ceHtml + peHtml) : '<li>No legs specified</li>';
            
            const cardNoteText = (strat.setup && strat.setup.notes) || (strat.strike_example && strat.strike_example.notes);
            const cardNoteHtml = cardNoteText ? `<div style="margin-top: 0.4rem; font-style: italic; color: #94a3b8; font-size: 0.75rem;">*Note:* ${cardNoteText}</div>` : '';

            card.innerHTML = `
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <h3 style="margin: 0; font-size: 1.15rem; color: var(--text-primary); font-weight: 700;">${strat.name}</h3>
                        <span style="padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; white-space: nowrap; ${badgeColor}">${badgeText}</span>
                    </div>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; font-size: 0.78rem; color: var(--text-secondary);">
                        <span>📊 <strong>${strat.index}</strong></span>
                        <span>•</span>
                        <span>⏳ ${strat.dte}</span>
                        <span>•</span>
                        <span>📅 ${strat.expiry}</span>
                    </div>
                    <div style="font-size: 0.82rem; background: rgba(0,0,0,0.18); padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid var(--border-color); max-height: 180px; overflow-y: auto;">
                        <span style="font-weight: 700; color: var(--text-primary); display: block; margin-bottom: 0.2rem;">Setup Overview:</span>
                        <ul style="margin: 0; padding-left: 1.1rem; color: var(--text-secondary); font-size: 0.78rem; line-height: 1.5;">
                            ${allLegsHtml}
                        </ul>
                        ${cardNoteHtml}
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 0.4rem;">
                    <button onclick="openCatalogStrategyDetails('${strat.id}')" class="admin-btn edit" style="font-size: 0.8rem; padding: 0.4rem 0.8rem; display: flex; align-items: center; gap: 0.3rem;">👁️ View Details</button>
                </div>
            `;
            cardsGrid.appendChild(card);
        });
    } else {
        // Single Line List View
        listTbody.innerHTML = "";
        if (filtered.length === 0) {
            listTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No strategies found in this category.</td></tr>`;
            return;
        }

        filtered.forEach(strat => {
            const cat = strat.strategy_category || '0_adjustment';
            const badgeText = cat === '0_adjustment' ? '⚡ 0 Adj' : cat === 'discretionary' ? '🎯 Discretionary' : '🛠️ Adjustment';
            const badgeColor = cat === '0_adjustment' ? 'rgba(168, 85, 247, 0.18); color: #e9d5ff; border: 1px solid rgba(168, 85, 247, 0.4);' :
                               cat === 'discretionary' ? 'rgba(59, 130, 246, 0.18); color: #bfdbfe; border: 1px solid rgba(59, 130, 246, 0.4);' :
                               'rgba(245, 158, 11, 0.18); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.4);';

            const ceLegs = (strat.setup && strat.setup.CE) || [];
            const peLegs = (strat.setup && strat.setup.PE) || [];
            const setupSummary = [...ceLegs, ...peLegs].join(" • ");

            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid var(--border-color)";
            tr.innerHTML = `
                <td>
                    <strong style="color: var(--text-primary); font-size: 0.9rem; margin-right: 0.4rem;">${strat.name}</strong>
                    <span style="padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.7rem; font-weight: 700; ${badgeColor}">${badgeText}</span>
                </td>
                <td><strong style="color: var(--text-primary);">${strat.index}</strong> • <span style="color: var(--text-secondary);">${strat.expiry}</span></td>
                <td><span style="color: var(--text-secondary);">${strat.dte}</span> ${strat.day ? `• <span style="font-weight:600;">${strat.day} ${strat.time || ''}</span>` : ''}</td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 380px; display: inline-block; vertical-align: middle;">${setupSummary || '-'}</span></td>
                <td style="text-align: center;">
                    <button onclick="openCatalogStrategyDetails('${strat.id}')" class="admin-btn edit" style="padding: 0.25rem 0.6rem; font-size: 0.76rem;">👁️ View Details</button>
                </td>
            `;
            listTbody.appendChild(tr);
        });
    }
}

function openCatalogStrategyDetails(strategyId) {
    const strat = (window.strategiesData || []).find(s => s.id === strategyId);
    if (typeof trackUserActivity === 'function') {
        trackUserActivity('VIEW_STRATEGY_DETAILS', `Opened details for strategy: ${strat ? strat.name : strategyId}`, { strategyId });
    }
    if (strat && typeof showStrategyDetails === 'function') {
        showStrategyDetails({
            strategy: strat,
            isInactiveFallback: true,
            actualDate: null,
            expiryDate: null,
            nominalDate: null,
            shifted: false
        });
    }
}


/* ==========================================================================
   FEATURE 2: TRADE JOURNAL & MULTI-LEVEL ROI ANALYTICS CLIENT LOGIC
   ========================================================================== */

let userTradesData = [];
let activeJournalTab = 'all';
let journalSearchQuery = '';

async function fetchUserTradesData() {
    try {
        const response = await fetch('/api/journal');
        if (!response.ok) {
            if (response.status === 401) {
                if (typeof showToast === 'function') showToast("Login required to access Trade Journal.", "warning");
            }
            return;
        }
        const resJson = await response.json();
        userTradesData = resJson.trades || [];
        renderJournalTradesTable();
    } catch (e) {
        console.error("Fetch journal error:", e);
    }
}

function filterJournalTab(tab) {
    activeJournalTab = tab;
    ['all', 'OPEN', 'CLOSED', 'ANALYTICS'].forEach(t => {
        const btn = document.getElementById(`journal-tab-${t.toLowerCase()}`);
        if (btn) btn.classList.toggle('active', t === tab);
    });

    if (typeof trackUserActivity === 'function') {
        trackUserActivity('JOURNAL_TAB', `Switched Trade Journal filter to ${tab.toUpperCase()}`, { tab });
    }

    const tradesTableContainer = document.getElementById("journal-trades-table-container");
    const analyticsContainer = document.getElementById("journal-analytics-dashboard-container");
    const searchInput = document.getElementById("journal-search-input");

    if (tab === 'ANALYTICS') {
        if (tradesTableContainer) tradesTableContainer.style.display = "none";
        if (analyticsContainer) analyticsContainer.style.display = "block";
        if (searchInput) searchInput.style.display = "none";
        renderAnalyticsView();
    } else {
        if (tradesTableContainer) tradesTableContainer.style.display = "block";
        if (analyticsContainer) analyticsContainer.style.display = "none";
        if (searchInput) searchInput.style.display = "block";
        renderJournalTradesTable();
    }
}

function onJournalSearchInput(query) {
    journalSearchQuery = (query || '').toLowerCase();
    renderJournalTradesTable();
}

function renderJournalTradesTable() {
    const tbody = document.getElementById("journal-trades-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtered = userTradesData.filter(t => {
        if (activeJournalTab !== 'all' && t.status !== activeJournalTab) return false;
        if (!journalSearchQuery) return true;
        const sName = (t.strategyName || '').toLowerCase();
        const cat = (t.category || '').toLowerCase();
        const index = (t.index || '').toLowerCase();
        const notesStr = `${t.notes?.entry || ''} ${t.notes?.exit || ''} ${t.notes?.psychology || ''}`.toLowerCase();
        return sName.includes(journalSearchQuery) || cat.includes(journalSearchQuery) || index.includes(journalSearchQuery) || notesStr.includes(journalSearchQuery);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No trade records found. Click "+ Record New Trade" to log your first trade position.</td></tr>`;
        return;
    }

    filtered.forEach(trade => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border-color)";

        const entryDateFormatted = trade.entryDate ? new Date(trade.entryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
        const isClosed = trade.status === 'CLOSED';
        const isWin = isClosed && trade.netPnl > 0;
        const isLoss = isClosed && trade.netPnl < 0;

        const statusBadge = isClosed ? 
            (isWin ? `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);">🏁 Closed (Win)</span>` :
             isLoss ? `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4);">🏁 Closed (Loss)</span>` :
             `<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.4);">🏁 Closed (Flat)</span>`) :
            `<span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);">🟢 Open</span>`;

        const marginVal = parseFloat(trade.marginUsed) || 0;
        const grossPnlVal = parseFloat(trade.grossPnl) || 0;
        const chargesVal = (parseFloat(trade.charges?.brokerage) || 0) + (parseFloat(trade.charges?.sttAndTaxes) || 0);
        const netPnlVal = parseFloat(trade.netPnl) || 0;
        const roiVal = parseFloat(trade.roiPct) || 0;

        const netPnlColor = netPnlVal > 0 ? '#34d399' : netPnlVal < 0 ? '#fca5a5' : 'var(--text-primary)';
        const roiColor = roiVal > 0 ? '#c084fc' : roiVal < 0 ? '#fca5a5' : 'var(--text-secondary)';

        tr.innerHTML = `
            <td>
                <strong style="color: var(--text-primary); font-size: 0.88rem; display: block;">${trade.strategyName}</strong>
                <span style="font-size: 0.74rem; color: var(--text-secondary);">${entryDateFormatted} • ${trade.index}</span>
            </td>
            <td>
                <span class="badge monthly" style="font-size: 0.72rem;">${trade.sheet || trade.category || 'Strategy'}</span>
            </td>
            <td>${statusBadge}</td>
            <td style="font-weight: 600;">₹ ${marginVal.toLocaleString('en-IN')}</td>
            <td style="font-weight: 600; color: ${grossPnlVal > 0 ? '#34d399' : grossPnlVal < 0 ? '#fca5a5' : 'inherit'};">₹ ${grossPnlVal.toLocaleString('en-IN')}</td>
            <td style="color: var(--text-secondary);">₹ ${chargesVal.toLocaleString('en-IN')}</td>
            <td style="font-weight: 700; font-size: 0.92rem; color: ${netPnlColor};">₹ ${netPnlVal.toLocaleString('en-IN')}</td>
            <td style="font-weight: 700; font-size: 0.92rem; color: ${roiColor};">${isClosed ? `${roiVal.toFixed(2)}%` : '-'}</td>
            <td style="text-align: center;">
                <div style="display: flex; gap: 0.3rem; justify-content: center;">
                    ${!isClosed ? `<button onclick="openTradeExitModal('${trade.id}')" class="admin-btn add" style="padding: 0.25rem 0.55rem; font-size: 0.74rem; background: #10b981; border-color: #059669;">🏁 Exit</button>` : ''}
                    <button onclick="editTradeRecord('${trade.id}')" class="admin-btn edit" style="padding: 0.25rem 0.55rem; font-size: 0.74rem;">✏️ Edit</button>
                    <button onclick="deleteTradeRecord('${trade.id}')" class="admin-btn logout" style="padding: 0.25rem 0.55rem; font-size: 0.74rem; background: rgba(239,68,68,0.15); color: #fca5a5; border-color: rgba(239,68,68,0.3);">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function onTradeStatusChange(status) {
    const exitDateGroup = document.getElementById("trade-exit-date-group");
    const legExitHeader = document.getElementById("trade-leg-exit-header");
    const chargesGroup = document.getElementById("trade-charges-group");
    const exitNotesGroup = document.getElementById("trade-exit-notes-group");
    const legExitCells = document.querySelectorAll(".leg-exit-cell");

    const isClosed = status === "CLOSED";

    if (exitDateGroup) exitDateGroup.style.display = isClosed ? "block" : "none";
    if (legExitHeader) legExitHeader.style.display = isClosed ? "table-cell" : "none";
    if (chargesGroup) chargesGroup.style.display = isClosed ? "grid" : "none";
    if (exitNotesGroup) exitNotesGroup.style.display = isClosed ? "block" : "none";

    legExitCells.forEach(cell => {
        cell.style.display = isClosed ? "table-cell" : "none";
    });
}

function openNewTradeModal() {
    document.getElementById("trade-id-input").value = "";
    document.getElementById("trade-modal-title").innerText = "📔 Record New Trade";
    document.getElementById("trade-margin-input").value = "250000";
    document.getElementById("trade-entry-notes").value = "";
    document.getElementById("trade-exit-notes").value = "";
    document.getElementById("trade-psychology-notes").value = "";

    const statusSelect = document.getElementById("trade-status-select");
    if (statusSelect) statusSelect.value = "OPEN";

    // Set default entry date to current local datetime
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById("trade-entry-date").value = now.toISOString().slice(0, 16);
    document.getElementById("trade-exit-date").value = now.toISOString().slice(0, 16);

    // Populate strategy dropdown
    const select = document.getElementById("trade-strategy-select");
    select.innerHTML = "";
    
    const strats = window.strategiesData || [];
    strats.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        const catLabel = s.strategy_category === 'discretionary' ? '🎯 Discretionary' : s.strategy_category === 'adjustments' ? '🛠️ Adjustment' : '⚡ 0 Adj';
        opt.innerText = `${s.name} (${catLabel} • ${s.index})`;
        select.appendChild(opt);
    });

    if (strats.length > 0) {
        onTradeStrategySelect(strats[0].id);
    }

    onTradeStatusChange("OPEN");

    document.getElementById("trade-modal").style.display = "flex";
}

function editTradeRecord(tradeId) {
    const trade = userTradesData.find(t => t.id === tradeId);
    if (!trade) return;

    document.getElementById("trade-id-input").value = trade.id;
    document.getElementById("trade-modal-title").innerText = `✏️ Edit Trade (${trade.strategyName})`;
    document.getElementById("trade-margin-input").value = trade.marginUsed || 250000;

    // Trade status
    const statusSelect = document.getElementById("trade-status-select");
    if (statusSelect) statusSelect.value = trade.status || "OPEN";

    // Entry date
    if (trade.entryDate) {
        const d = new Date(trade.entryDate);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        document.getElementById("trade-entry-date").value = d.toISOString().slice(0, 16);
    }

    // Exit date (if closed)
    if (trade.exitDate) {
        const dEx = new Date(trade.exitDate);
        dEx.setMinutes(dEx.getMinutes() - dEx.getTimezoneOffset());
        document.getElementById("trade-exit-date").value = dEx.toISOString().slice(0, 16);
    } else {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById("trade-exit-date").value = now.toISOString().slice(0, 16);
    }

    // Populate strategy dropdown
    const select = document.getElementById("trade-strategy-select");
    select.innerHTML = "";
    const strats = window.strategiesData || [];
    strats.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.id;
        const catLabel = s.strategy_category === 'discretionary' ? '🎯 Discretionary' : s.strategy_category === 'adjustments' ? '🛠️ Adjustment' : '⚡ 0 Adj';
        opt.innerText = `${s.name} (${catLabel} • ${s.index})`;
        if (s.id === trade.strategyId) opt.selected = true;
        select.appendChild(opt);
    });

    document.getElementById("trade-index-display").value = `${trade.index || 'Nifty'} • ${trade.sheet || 'Monthly'} (${trade.category || '0_adjustment'})`;

    // Charges & Taxes
    if (trade.charges) {
        document.getElementById("trade-brokerage-input").value = trade.charges.brokerage || 160;
        document.getElementById("trade-stt-input").value = trade.charges.sttAndTaxes || 240;
    }

    // Notes
    document.getElementById("trade-entry-notes").value = trade.notes?.entry || "";
    document.getElementById("trade-exit-notes").value = trade.notes?.exit || "";
    document.getElementById("trade-psychology-notes").value = trade.notes?.psychology || "";

    // Populate Legs with entry and exit prices
    const tbody = document.getElementById("trade-legs-tbody");
    tbody.innerHTML = "";

    const isClosed = trade.status === "CLOSED";

    (trade.legs || []).forEach(leg => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <select class="leg-action" style="padding: 0.25rem; font-weight: 700;">
                    <option value="BUY" ${leg.action === 'BUY' ? 'selected' : ''}>BUY</option>
                    <option value="SELL" ${leg.action === 'SELL' ? 'selected' : ''}>SELL</option>
                </select>
            </td>
            <td>
                <select class="leg-type" style="padding: 0.25rem;">
                    <option value="CE" ${leg.optionType === 'CE' ? 'selected' : ''}>CE</option>
                    <option value="PE" ${leg.optionType === 'PE' ? 'selected' : ''}>PE</option>
                </select>
            </td>
            <td><input type="number" class="leg-strike" value="${leg.strike || 25000}" step="50" style="width: 85px; font-weight: 700;"></td>
            <td><input type="number" class="leg-qty" value="${leg.quantity || 25}" step="10" style="width: 70px;"></td>
            <td><input type="number" class="leg-entry-price" value="${leg.entryPrice || 0}" step="0.5" style="width: 80px; font-weight: 600;"></td>
            <td class="leg-exit-cell" style="display: ${isClosed ? 'table-cell' : 'none'};"><input type="number" class="leg-exit-price" value="${leg.exitPrice !== undefined && leg.exitPrice !== null ? leg.exitPrice : leg.entryPrice}" step="0.5" style="width: 80px; font-weight: 700;"></td>
            <td style="text-align: center;"><button type="button" onclick="this.closest('tr').remove()" style="background: none; border: none; cursor: pointer; font-size: 1rem;">🗑️</button></td>
        `;
        tbody.appendChild(tr);
    });

    onTradeStatusChange(trade.status || "OPEN");

    document.getElementById("trade-modal").style.display = "flex";
}

function closeTradeModal() {
    document.getElementById("trade-modal").style.display = "none";
}

function onTradeStrategySelect(strategyId) {
    const strat = (window.strategiesData || []).find(s => s.id === strategyId);
    if (!strat) return;

    document.getElementById("trade-index-display").value = `${strat.index} • ${strat.sheet || 'Monthly'} (${strat.strategy_category || '0_adjustment'})`;

    // Populate default legs
    const tbody = document.getElementById("trade-legs-tbody");
    tbody.innerHTML = "";

    const defaultLotSize = strat.index.includes("Bank Nifty") ? 15 : strat.index.includes("Sensex") ? 10 : 25;
    const isClosed = document.getElementById("trade-status-select")?.value === "CLOSED";

    const addLegRow = (action, optType, strikeText) => {
        let parsedStrike = 25000;
        if (strat.index.includes("Bank Nifty")) parsedStrike = 57500;
        if (strat.index.includes("Sensex")) parsedStrike = 85000;

        const matchNum = (strikeText || '').match(/\d+/);
        if (matchNum) parsedStrike = parseInt(matchNum[0]);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <select class="leg-action" style="padding: 0.25rem; font-weight: 700;">
                    <option value="BUY" ${action === 'BUY' ? 'selected' : ''}>BUY</option>
                    <option value="SELL" ${action === 'SELL' ? 'selected' : ''}>SELL</option>
                </select>
            </td>
            <td>
                <select class="leg-type" style="padding: 0.25rem;">
                    <option value="CE" ${optType === 'CE' ? 'selected' : ''}>CE</option>
                    <option value="PE" ${optType === 'PE' ? 'selected' : ''}>PE</option>
                </select>
            </td>
            <td><input type="number" class="leg-strike" value="${parsedStrike}" step="50" style="width: 85px; font-weight: 700;"></td>
            <td><input type="number" class="leg-qty" value="${defaultLotSize}" step="${defaultLotSize}" style="width: 70px;"></td>
            <td><input type="number" class="leg-entry-price" value="100.00" step="0.5" style="width: 80px; font-weight: 600;"></td>
            <td class="leg-exit-cell" style="display: ${isClosed ? 'table-cell' : 'none'};"><input type="number" class="leg-exit-price" value="100.00" step="0.5" style="width: 80px; font-weight: 700;"></td>
            <td style="text-align: center;"><button type="button" onclick="this.closest('tr').remove()" style="background: none; border: none; cursor: pointer; font-size: 1rem;">🗑️</button></td>
        `;
        tbody.appendChild(tr);
    };

    if (strat.strike_example) {
        if (strat.strike_example.CE) {
            strat.strike_example.CE.forEach(leg => addLegRow(leg.includes("Sell") ? "SELL" : "BUY", "CE", leg));
        }
        if (strat.strike_example.PE) {
            strat.strike_example.PE.forEach(leg => addLegRow(leg.includes("Sell") ? "SELL" : "BUY", "PE", leg));
        }
    }

    if (tbody.children.length === 0) {
        addLegRow("BUY", "CE", "ATM 25000");
    }
}

function addTradeLegRow() {
    const tbody = document.getElementById("trade-legs-tbody");
    if (!tbody) return;
    const isClosed = document.getElementById("trade-status-select")?.value === "CLOSED";
    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>
            <select class="leg-action" style="padding: 0.25rem; font-weight: 700;">
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
            </select>
        </td>
        <td>
            <select class="leg-type" style="padding: 0.25rem;">
                <option value="CE">CE</option>
                <option value="PE">PE</option>
            </select>
        </td>
        <td><input type="number" class="leg-strike" value="25000" step="50" style="width: 85px; font-weight: 700;"></td>
        <td><input type="number" class="leg-qty" value="25" step="25" style="width: 70px;"></td>
        <td><input type="number" class="leg-entry-price" value="100.00" step="0.5" style="width: 80px; font-weight: 600;"></td>
        <td class="leg-exit-cell" style="display: ${isClosed ? 'table-cell' : 'none'};"><input type="number" class="leg-exit-price" value="100.00" step="0.5" style="width: 80px; font-weight: 700;"></td>
        <td style="text-align: center;"><button type="button" onclick="this.closest('tr').remove()" style="background: none; border: none; cursor: pointer; font-size: 1rem;">🗑️</button></td>
    `;
    tbody.appendChild(tr);
}

async function saveTradeFromModal(e) {
    e.preventDefault();

    const tradeId = document.getElementById("trade-id-input").value || `trade_${Date.now()}`;
    const strategyId = document.getElementById("trade-strategy-select").value;
    const strat = (window.strategiesData || []).find(s => s.id === strategyId) || {};
    const status = document.getElementById("trade-status-select").value || 'OPEN';
    const marginUsed = parseFloat(document.getElementById("trade-margin-input").value) || 250000;
    const entryDate = document.getElementById("trade-entry-date").value;
    const exitDate = document.getElementById("trade-exit-date").value;
    
    const brokerage = parseFloat(document.getElementById("trade-brokerage-input").value) || 160;
    const sttAndTaxes = parseFloat(document.getElementById("trade-stt-input").value) || 240;

    const entryNotes = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(document.getElementById("trade-entry-notes").value) : document.getElementById("trade-entry-notes").value;
    const exitNotes = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(document.getElementById("trade-exit-notes").value) : document.getElementById("trade-exit-notes").value;
    const psychologyNotes = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(document.getElementById("trade-psychology-notes").value) : document.getElementById("trade-psychology-notes").value;

    const legRows = document.querySelectorAll("#trade-legs-tbody tr");
    const legs = [];

    legRows.forEach((row, idx) => {
        const action = row.querySelector(".leg-action").value;
        const optionType = row.querySelector(".leg-type").value;
        const strike = parseFloat(row.querySelector(".leg-strike").value) || 0;
        const quantity = parseFloat(row.querySelector(".leg-qty").value) || 0;
        const entryPrice = parseFloat(row.querySelector(".leg-entry-price").value) || 0;
        
        const exitInput = row.querySelector(".leg-exit-price");
        const exitPrice = exitInput ? parseFloat(exitInput.value) || 0 : 0;

        legs.push({
            legId: idx + 1,
            action,
            optionType,
            strike,
            quantity,
            entryPrice,
            exitPrice: status === 'CLOSED' ? exitPrice : null
        });
    });

    if (legs.length === 0) {
        if (typeof showToast === 'function') showToast("Please add at least 1 option leg to the trade.", "warning");
        return;
    }

    const tradePayload = {
        id: tradeId,
        strategyId,
        strategyName: strat.name || 'Custom Trade',
        category: strat.strategy_category || '0_adjustment',
        sheet: strat.sheet || 'Monthly',
        index: strat.index || 'Nifty',
        status,
        marginUsed,
        entryDate,
        exitDate: status === 'CLOSED' ? exitDate : null,
        charges: {
            brokerage,
            sttAndTaxes
        },
        legs,
        notes: {
            entry: entryNotes,
            exit: exitNotes,
            psychology: psychologyNotes
        }
    };

    try {
        const response = await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_trade', data: tradePayload })
        });
        const resJson = await response.json();
        if (response.ok) {
            if (typeof showToast === 'function') showToast("💾 Trade record saved successfully!", "success");
            closeTradeModal();
            fetchUserTradesData();
        } else {
            if (typeof showToast === 'function') showToast(resJson.error || "Failed to save trade", "error");
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast("Network error saving trade record", "error");
    }
}

function openTradeExitModal(tradeId) {
    const trade = userTradesData.find(t => t.id === tradeId);
    if (!trade) return;

    document.getElementById("exit-trade-id").value = trade.id;
    document.getElementById("exit-margin-display").value = `₹ ${(trade.marginUsed || 0).toLocaleString('en-IN')}`;

    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById("exit-date-input").value = now.toISOString().slice(0, 16);

    const tbody = document.getElementById("exit-legs-tbody");
    tbody.innerHTML = "";

    (trade.legs || []).forEach(leg => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${leg.action} ${leg.strike} ${leg.optionType}</strong></td>
            <td>₹ ${leg.entryPrice}</td>
            <td>${leg.quantity}</td>
            <td><input type="number" class="exit-price-input" data-legid="${leg.legId}" value="${leg.entryPrice}" step="0.5" style="width: 100px; font-weight: 700;"></td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById("trade-exit-modal").style.display = "flex";
}

function closeTradeExitModal() {
    document.getElementById("trade-exit-modal").style.display = "none";
}

async function confirmTradeExit(e) {
    e.preventDefault();

    const tradeId = document.getElementById("exit-trade-id").value;
    const exitDate = document.getElementById("exit-date-input").value;
    const brokerage = parseFloat(document.getElementById("exit-brokerage-input").value) || 0;
    const sttAndTaxes = parseFloat(document.getElementById("exit-stt-input").value) || 0;
    const exitNotes = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(document.getElementById("exit-notes-input").value) : document.getElementById("exit-notes-input").value;

    const exitInputs = document.querySelectorAll(".exit-price-input");
    const legs = [];
    exitInputs.forEach(input => {
        legs.push({
            legId: parseInt(input.dataset.legid),
            exitPrice: parseFloat(input.value) || 0
        });
    });

    const exitPayload = {
        id: tradeId,
        exitDate,
        legs,
        charges: { brokerage, sttAndTaxes },
        notes: { exit: exitNotes }
    };

    try {
        const response = await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'exit_trade', data: exitPayload })
        });
        const resJson = await response.json();
        if (response.ok) {
            if (typeof showToast === 'function') showToast(`🏁 Trade position closed! Net P&L: ₹ ${resJson.trade.netPnl.toLocaleString('en-IN')} (${resJson.trade.roiPct.toFixed(2)}% RoI)`, "success");
            closeTradeExitModal();
            fetchUserTradesData();
        } else {
            if (typeof showToast === 'function') showToast(resJson.error || "Failed to exit trade", "error");
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast("Network error closing trade position", "error");
    }
}

async function deleteTradeRecord(tradeId) {
    if (!confirm("Are you sure you want to delete this trade record from your journal?")) return;

    try {
        const response = await fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_trade', data: { id: tradeId } })
        });
        const resJson = await response.json();
        if (response.ok) {
            if (typeof showToast === 'function') showToast("🗑️ Trade record deleted", "success");
            fetchUserTradesData();
        } else {
            if (typeof showToast === 'function') showToast(resJson.error || "Failed to delete trade", "error");
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast("Network error deleting trade record", "error");
    }
}


/* ==========================================================================
   MULTI-LEVEL ROI & PERFORMANCE ANALYTICS ENGINE
   ========================================================================== */

function renderAnalyticsView() {
    const timeframeSelect = document.getElementById("analytics-timeframe-select");
    const timeframe = timeframeSelect ? timeframeSelect.value : "monthly";

    const closedTrades = userTradesData.filter(t => t.status === 'CLOSED');

    let totalNetPnl = 0;
    let totalMarginUsed = 0;
    let totalWins = 0;
    let totalGrossProfit = 0;
    let totalGrossLoss = 0;
    let totalCharges = 0;

    closedTrades.forEach(t => {
        const net = parseFloat(t.netPnl) || 0;
        const gross = parseFloat(t.grossPnl) || 0;
        const margin = parseFloat(t.marginUsed) || 0;
        const charges = (parseFloat(t.charges?.brokerage) || 0) + (parseFloat(t.charges?.sttAndTaxes) || 0);

        totalNetPnl += net;
        totalMarginUsed += margin;
        totalCharges += charges;

        if (net > 0) {
            totalWins += 1;
            totalGrossProfit += gross;
        } else if (net < 0) {
            totalGrossLoss += Math.abs(gross);
        }
    });

    const totalClosed = closedTrades.length;
    const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
    const portfolioRoi = totalMarginUsed > 0 ? (totalNetPnl / totalMarginUsed) * 100 : 0;
    const profitFactor = totalGrossLoss > 0 ? (totalGrossProfit / totalGrossLoss) : (totalGrossProfit > 0 ? 99.99 : 0);

    // Populate Top KPI Cards
    const kpiNet = document.getElementById("analytics-kpi-net-pnl");
    const kpiRoi = document.getElementById("analytics-kpi-roi");
    const kpiWin = document.getElementById("analytics-kpi-winrate");
    const kpiPf = document.getElementById("analytics-kpi-pf");
    const kpiCharges = document.getElementById("analytics-kpi-charges");

    if (kpiNet) {
        kpiNet.innerText = `₹ ${totalNetPnl.toLocaleString('en-IN')}`;
        kpiNet.style.color = totalNetPnl >= 0 ? "#34d399" : "#fca5a5";
    }
    if (kpiRoi) {
        kpiRoi.innerText = `${portfolioRoi.toFixed(2)}%`;
        kpiRoi.style.color = portfolioRoi >= 0 ? "#c084fc" : "#fca5a5";
    }
    if (kpiWin) kpiWin.innerText = `${winRate.toFixed(1)}%`;
    if (kpiPf) kpiPf.innerText = profitFactor.toFixed(2);
    if (kpiCharges) kpiCharges.innerText = `₹ ${totalCharges.toLocaleString('en-IN')}`;

    // 1. Render Category / Sheet Level RoI Breakdown Table
    const catTbody = document.getElementById("analytics-category-tbody");
    if (catTbody) {
        catTbody.innerHTML = "";
        const categories = [
            { id: "Monthly", name: "Monthly Strategies" },
            { id: "BiWkly", name: "Bi-Weekly & Weekly Strategies" },
            { id: "STBT", name: "STBT Strategies" },
            { id: "discretionary", name: "Discretionary & Adjustments" }
        ];

        categories.forEach(cat => {
            const catTrades = closedTrades.filter(t => 
                (t.sheet === cat.id) || (t.category === cat.id) || (cat.id === 'discretionary' && (t.category === 'discretionary' || t.category === 'adjustments'))
            );

            let catMargin = 0;
            let catNet = 0;
            let catWins = 0;

            catTrades.forEach(t => {
                catMargin += parseFloat(t.marginUsed) || 0;
                catNet += parseFloat(t.netPnl) || 0;
                if (t.netPnl > 0) catWins += 1;
            });

            const catTotal = catTrades.length;
            const catWinRate = catTotal > 0 ? (catWins / catTotal) * 100 : 0;
            const catRoi = catMargin > 0 ? (catNet / catMargin) * 100 : 0;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${cat.name}</strong></td>
                <td>${catTotal}</td>
                <td>${catWinRate.toFixed(1)}%</td>
                <td>₹ ${catMargin.toLocaleString('en-IN')}</td>
                <td style="font-weight: 700; color: ${catNet >= 0 ? '#34d399' : '#fca5a5'};">₹ ${catNet.toLocaleString('en-IN')}</td>
                <td style="font-weight: 700; color: ${catRoi >= 0 ? '#c084fc' : '#fca5a5'};">${catRoi.toFixed(2)}%</td>
            `;
            catTbody.appendChild(tr);
        });
    }

    // 2. Render Strategy Level RoI Breakdown Table
    const stratTbody = document.getElementById("analytics-strategy-tbody");
    if (stratTbody) {
        stratTbody.innerHTML = "";
        const stratMap = {};

        closedTrades.forEach(t => {
            const sName = t.strategyName || 'Custom';
            if (!stratMap[sName]) {
                stratMap[sName] = { name: sName, category: t.sheet || t.category || 'Strategy', trades: 0, wins: 0, margin: 0, netPnl: 0 };
            }
            stratMap[sName].trades += 1;
            if (t.netPnl > 0) stratMap[sName].wins += 1;
            stratMap[sName].margin += parseFloat(t.marginUsed) || 0;
            stratMap[sName].netPnl += parseFloat(t.netPnl) || 0;
        });

        const stratList = Object.values(stratMap);
        if (stratList.length === 0) {
            stratTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: var(--text-secondary);">No closed trades recorded yet for strategy-level analysis.</td></tr>`;
        } else {
            stratList.forEach(s => {
                const sWinRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0;
                const sRoi = s.margin > 0 ? (s.netPnl / s.margin) * 100 : 0;
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><strong>${s.name}</strong></td>
                    <td><span class="badge monthly" style="font-size: 0.72rem;">${s.category}</span></td>
                    <td>${s.trades}</td>
                    <td>${sWinRate.toFixed(1)}%</td>
                    <td>₹ ${s.margin.toLocaleString('en-IN')}</td>
                    <td style="font-weight: 700; color: ${s.netPnl >= 0 ? '#34d399' : '#fca5a5'};">₹ ${s.netPnl.toLocaleString('en-IN')}</td>
                    <td style="font-weight: 700; color: ${sRoi >= 0 ? '#c084fc' : '#fca5a5'};">${sRoi.toFixed(2)}%</td>
                `;
                stratTbody.appendChild(tr);
            });
        }
    }

    // 3. Render Timeframe Breakdown Table
    const tfTbody = document.getElementById("analytics-timeframe-tbody");
    if (tfTbody) {
        tfTbody.innerHTML = "";
        const periodMap = {};

        closedTrades.forEach(t => {
            const dateObj = t.exitDate ? new Date(t.exitDate) : new Date(t.entryDate);
            let key = dateObj.toISOString().slice(0, 7); // Default YYYY-MM

            if (timeframe === 'daily') {
                key = dateObj.toISOString().slice(0, 10);
            } else if (timeframe === 'weekly') {
                const oneJan = new Date(dateObj.getFullYear(), 0, 1);
                const weekNum = Math.ceil((((dateObj - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
                key = `${dateObj.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
            } else if (timeframe === 'quarterly') {
                const q = Math.floor(dateObj.getMonth() / 3) + 1;
                key = `${dateObj.getFullYear()}-Q${q}`;
            } else if (timeframe === 'annual') {
                key = `${dateObj.getFullYear()}`;
            }

            if (!periodMap[key]) {
                periodMap[key] = { period: key, trades: 0, wins: 0, margin: 0, gross: 0, charges: 0, net: 0 };
            }

            periodMap[key].trades += 1;
            if (t.netPnl > 0) periodMap[key].wins += 1;
            periodMap[key].margin += parseFloat(t.marginUsed) || 0;
            periodMap[key].gross += parseFloat(t.grossPnl) || 0;
            periodMap[key].charges += (parseFloat(t.charges?.brokerage) || 0) + (parseFloat(t.charges?.sttAndTaxes) || 0);
            periodMap[key].net += parseFloat(t.netPnl) || 0;
        });

        const periodList = Object.values(periodMap).sort((a, b) => b.period.localeCompare(a.period));
        if (periodList.length === 0) {
            tfTbody.innerHTML = `<tr><td colspan="8" style="text-align: center; padding: 1.5rem; color: var(--text-secondary);">No closed trade data available for ${timeframe} timeframe.</td></tr>`;
        } else {
            periodList.forEach(p => {
                const pWinRate = (p.wins / p.trades) * 100;
                const pRoi = p.margin > 0 ? (p.net / p.margin) * 100 : 0;
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><strong>${p.period}</strong></td>
                    <td>${p.trades}</td>
                    <td>${pWinRate.toFixed(1)}%</td>
                    <td>₹ ${p.margin.toLocaleString('en-IN')}</td>
                    <td style="color: ${p.gross >= 0 ? '#34d399' : '#fca5a5'};">₹ ${p.gross.toLocaleString('en-IN')}</td>
                    <td style="color: var(--text-secondary);">₹ ${p.charges.toLocaleString('en-IN')}</td>
                    <td style="font-weight: 700; color: ${p.net >= 0 ? '#34d399' : '#fca5a5'};">₹ ${p.net.toLocaleString('en-IN')}</td>
                    <td style="font-weight: 700; color: ${pRoi >= 0 ? '#c084fc' : '#fca5a5'};">${pRoi.toFixed(2)}%</td>
                `;
                tfTbody.appendChild(tr);
            });
        }
    }
}

/* ─── User Activity & Audit Tracking Client Helpers ─────────────────────── */

let adminActivityLogsCache = [];

function trackUserActivity(eventType, details, meta) {
    if (window.isAdminMode) return; // Do not log admin activity
    try {
        const payload = JSON.stringify({ eventType, details, meta });
        if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon('/api/track', blob);
        } else {
            fetch('/api/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload
            }).catch(() => {});
        }
    } catch (e) {}
}

async function fetchAdminActivityLogs() {
    const tbody = document.getElementById("activity-logs-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 1.5rem; color: var(--text-secondary);">Loading activity feed...</td></tr>`;

    try {
        const res = await fetch(`/api/admin/get-activity?_t=${Date.now()}`);
        if (!res.ok) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 1.5rem; color: #fca5a5;">Failed to fetch activity logs (${res.status})</td></tr>`;
            return;
        }
        const data = await res.json();
        adminActivityLogsCache = data.logs || [];
        filterAdminActivityLogs();
    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 1.5rem; color: #fca5a5;">Error loading activity logs: ${err.message}</td></tr>`;
    }
}

function filterAdminActivityLogs() {
    const phoneInput = document.getElementById("activity-search-phone");
    const typeSelect = document.getElementById("activity-filter-type");
    const countLabel = document.getElementById("activity-logs-count-label");
    const tbody = document.getElementById("activity-logs-tbody");
    if (!tbody) return;

    const phoneQuery = phoneInput ? phoneInput.value.trim().toLowerCase() : "";
    const typeQuery = typeSelect ? typeSelect.value : "ALL";

    let filtered = adminActivityLogsCache.filter(item => {
        if (!item) return false;
        if (item.phone === 'Admin' || (item.phone && item.phone.toLowerCase() === 'admin')) return false;
        const matchesPhone = !phoneQuery || (item.phone && item.phone.toLowerCase().includes(phoneQuery));
        let matchesType = true;
        if (typeQuery !== "ALL") {
            if (typeQuery === "JOURNAL") {
                matchesType = item.eventType && item.eventType.startsWith("JOURNAL");
            } else if (typeQuery === "NOTE") {
                matchesType = item.eventType && item.eventType.includes("NOTE");
            } else {
                matchesType = item.eventType === typeQuery;
            }
        }
        return matchesPhone && matchesType;
    });

    if (countLabel) countLabel.innerText = `Showing ${filtered.length} of ${adminActivityLogsCache.length} activity log entries`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 1.5rem; color: var(--text-secondary);">No matching user activity logs found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        const d = item.timestamp ? new Date(item.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-';
        let badgeBg = 'rgba(59, 130, 246, 0.18)';
        let badgeColor = '#bfdbfe';
        let badgeBorder = 'rgba(59, 130, 246, 0.4)';

        if (item.eventType && item.eventType.startsWith('JOURNAL')) {
            badgeBg = 'rgba(16, 185, 129, 0.18)';
            badgeColor = '#a7f3d0';
            badgeBorder = 'rgba(16, 185, 129, 0.4)';
        } else if (item.eventType && item.eventType.includes('NOTE')) {
            badgeBg = 'rgba(245, 158, 11, 0.18)';
            badgeColor = '#fde68a';
            badgeBorder = 'rgba(245, 158, 11, 0.4)';
        } else if (item.eventType === 'VIEW_STRATEGY_DETAILS') {
            badgeBg = 'rgba(168, 85, 247, 0.18)';
            badgeColor = '#e9d5ff';
            badgeBorder = 'rgba(168, 85, 247, 0.4)';
        }

        return `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 0.55rem 0.8rem; font-family: monospace; white-space: nowrap; color: var(--text-secondary);">${d}</td>
                <td style="padding: 0.55rem 0.8rem; font-weight: 700; color: var(--text-primary); font-family: monospace;">${item.phone || 'Unknown'}</td>
                <td style="padding: 0.55rem 0.8rem;">
                    <span style="padding: 0.2rem 0.55rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; border: 1px solid ${badgeBorder};">${item.eventType || 'ACTIVITY'}</span>
                </td>
                <td style="padding: 0.55rem 0.8rem; color: var(--text-primary);">${item.details || '-'}</td>
            </tr>
        `;
    }).join('');
}

async function clearAdminActivityLogs() {
    if (!confirm("Are you sure you want to clear all recorded user activity logs? This action cannot be undone.")) return;

    try {
        const res = await fetch('/api/admin/clear-activity', { method: 'POST' });
        if (res.ok) {
            if (typeof showToast === 'function') showToast("🧹 Activity logs cleared!");
            adminActivityLogsCache = [];
            filterAdminActivityLogs();
        } else {
            const data = await res.json();
            alert("Failed to clear activity logs: " + (data.error || 'Unknown error'));
        }
    } catch (err) {
        alert("Error clearing activity logs: " + err.message);
    }
}

// Reverted PDF generation feature
