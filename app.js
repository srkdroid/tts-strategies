// Options Trading Calendar App Logic

// Test prices for strike calculations
const indexSpotPrices = {
    "Nifty": 25000,
    "Nifty (Expiry Tue)": 25000,
    "Bank Nifty": 56000,
    "Sensex (Exp Thur)": 85000,
    "Sensex (Expiry Thur)": 85000,
    "Fin Nifty (Expiry Tue)": 25000
};

// Machine-readable exit rules keyed by strategy ID
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
    "stbt-nifty-3d-ladder-2":       { type: "next_weekday", weekday: 5 },
    "stbt-ce-dominator-3":          { type: "next_weekday", weekday: 1 },
    "stbt-matrix-calendar-4":       { type: "next_weekday", weekday: 1 },
    "stbt-sensex-no-brainer-5":     { type: "next_weekday", weekday: 1 },
    "stbt-fin-nifty-2d-ladder-6":   { type: "next_weekday", weekday: 1 }
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
    
    // We need to look at expiries from May 2026 to October 2026 to cover all possible deployments for June-August 2026
    const startYear = 2026;
    const startMonth = 4; // May (0-indexed)
    const endMonth = 9;   // October
    
    // Generate expiries
    let niftyExpiries = [];
    let sensexExpiries = [];
    
    for (let m = startMonth; m <= endMonth; m++) {
        niftyExpiries = niftyExpiries.concat(getExpiriesForMonth(startYear, m, 2)); // Tuesdays
        sensexExpiries = sensexExpiries.concat(getExpiriesForMonth(startYear, m, 4)); // Thursdays
    }
    
    // Map each strategy to its nominal deployment dates
    strategiesData.forEach(strategy => {
        const isSensex = strategy.index.includes("Sensex");
        const expiries = isSensex ? sensexExpiries : niftyExpiries;
        
        expiries.forEach(expiry => {
            let nominalDate = null;
            let expiryLabel = formatDateString(expiry.actual);
            
            if (strategy.sheet === "STBT") {
                if (strategy.name === "Nifty 3D Ladder") {
                    // Thursday before Nifty weekly expiry (Tuesday) = E - 5 days
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 5);
                } else if (strategy.name === "CE Dominator") {
                    // Friday before Nifty weekly expiry = E - 4 days
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 4);
                } else if (strategy.name === "Fin Nifty 2D Ladder") {
                    // Only deploy on Monthly Expiries (E - 4 days)
                    if (expiry.isMonthly) {
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 4);
                    }
                } else if (strategy.name === "Sensex No brainer") {
                    // Friday before Sensex weekly expiry = E - 6 days
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 6);
                } else if (strategy.name === "Matrix Calendar") {
                    // Friday (11 DTE) before Nifty weekly expiry (Tuesday) = E - 11 days
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 11);
                }
            } else if (strategy.sheet === "BiWkly") {
                if (strategy.name === "BWB") {
                    // Thursday, 12 days before Nifty weekly expiry
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 12);
                } else if (strategy.name === "Broken Wing") {
                    // Thursday, 7 days before Sensex weekly expiry
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 7);
                } else if (strategy.name === "HNI") {
                    // Monday, 8 days before Nifty weekly expiry
                    nominalDate = new Date(expiry.actual.getTime());
                    nominalDate.setDate(nominalDate.getDate() - 8);
                }
            } else if (strategy.sheet === "Monthly") {
                // Monthly strategies only apply to Monthly Expiries
                if (expiry.isMonthly) {
                    if (strategy.name === "Batman 1:3:2" || strategy.name === "Double Decker" || strategy.name === "HNI (Nifty)") {
                        // Fridays 39-44 days before NEXT month's monthly expiry
                        // To find this, we check if the expiry is indeed the monthly expiry of next month
                        // Let's find the Friday in the preceding month.
                        let expMonth = expiry.actual.getMonth();
                        let expYear = expiry.actual.getFullYear();
                        
                        // We check Fridays in the month preceding the expiry month
                        let dTemp = new Date(expYear, expMonth - 1, 1);
                        while (dTemp.getMonth() === (expMonth - 1 + 12) % 12) {
                            if (dTemp.getDay() === 5) { // Friday
                                let diff = Math.round((expiry.actual - dTemp) / (1000 * 60 * 60 * 24));
                                let dteMin = strategy.name === "Double Decker" ? 39 : 39;
                                let dteMax = strategy.name === "Double Decker" ? 43 : 44;
                                if (diff >= dteMin && diff <= dteMax) {
                                    nominalDate = new Date(dTemp.getTime());
                                    break;
                                }
                            }
                            dTemp.setDate(dTemp.getDate() + 1);
                        }
                    } else if (strategy.name === "No Brainer (Nifty)") {
                        // Friday 29-34 days before NEXT month's monthly expiry
                        let expMonth = expiry.actual.getMonth();
                        let expYear = expiry.actual.getFullYear();
                        
                        let dTemp = new Date(expYear, expMonth - 1, 1);
                        while (dTemp.getMonth() === (expMonth - 1 + 12) % 12) {
                            if (dTemp.getDay() === 5) {
                                let diff = Math.round((expiry.actual - dTemp) / (1000 * 60 * 60 * 24));
                                if (diff >= 29 && diff <= 34) {
                                    nominalDate = new Date(dTemp.getTime());
                                    break;
                                }
                            }
                            dTemp.setDate(dTemp.getDate() + 1);
                        }
                    } else if (strategy.name === "No Brainer (Bank Nifty)") {
                        // Thursday 12 days before CURRENT month's monthly expiry
                        nominalDate = new Date(expiry.actual.getTime());
                        nominalDate.setDate(nominalDate.getDate() - 12);
                    } else if (strategy.name === "Auto-Pilot") {
                        // Thursday 12 days before monthly expiry
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
                    const exitRule = EXIT_RULES[strategy.id] || null;
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
            const filteredDeployments = dayDeployments.filter(dep => {
                const matchesIndex = activeFilters.index === "all" || dep.strategy.index.startsWith(activeFilters.index);
                const matchesType = activeFilters.type === "all" || dep.strategy.sheet === activeFilters.type;
                return matchesIndex && matchesType;
            });
            
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
                
                if (isAdminMode) {
                    const wrapper = document.createElement("div");
                    wrapper.className = "strategy-badge-wrapper";
                    badge.style.flexGrow = "1";
                    wrapper.appendChild(badge);
                    
                    const editBtn = document.createElement("button");
                    editBtn.className = "badge-btn";
                    editBtn.innerHTML = "✏️";
                    editBtn.title = "Edit Strategy";
                    editBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        openEditStrategyModal(dep.strategy);
                    });
                    wrapper.appendChild(editBtn);

                    const deleteBtn = document.createElement("button");
                    deleteBtn.className = "badge-btn";
                    deleteBtn.innerHTML = "🗑️";
                    deleteBtn.title = "Delete Strategy";
                    deleteBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        deleteStrategy(dep.strategy.id);
                    });
                    wrapper.appendChild(deleteBtn);

                    cell.appendChild(wrapper);
                } else {
                    cell.appendChild(badge);
                }
            });
            
            // Exit dot: find filtered deployments whose exitDate falls on this day
            const exitingToday = deployments.filter(dep => {
                if (!dep.exitDate) return false;
                const matchesIndex = activeFilters.index === "all" || dep.strategy.index.startsWith(activeFilters.index);
                const matchesType = activeFilters.type === "all" || dep.strategy.sheet === activeFilters.type;
                return matchesIndex && matchesType && formatDateString(dep.exitDate) === dateStr;
            });
            
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
    type: "all"
};

// Global deployments cache
let allCalculatedDeployments = [];
let strategiesData = []; // Loaded dynamically from secure API
let isAdminMode = false;
let whitelistData = {};
let activeDbTab = "users";

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", async () => {
    // Set current date in header
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const todayStr = new Date().toLocaleDateString('en-US', options);
    document.getElementById("current-time-display").innerText = `System Date: ${todayStr}`;
    
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
        if (resJson.holidays) {
            marketHolidays2026 = resJson.holidays;
        }
        isAdminMode = !!resJson.isAdmin;
        if (isAdminMode) {
            document.getElementById("admin-bar").style.display = "flex";
            document.getElementById("add-strategy-btn").style.display = "block";
            document.getElementById("modal-admin-actions").style.display = "flex";
            document.getElementById("admin-user-info").innerText = `Logged in as Admin (${resJson.userPhone})`;
        } else {
            const userLogoutBtn = document.getElementById("user-logout-btn");
            if (userLogoutBtn) userLogoutBtn.style.display = "block";
        }
    } catch (error) {
        console.error('Authentication check failed:', error);
        window.location.href = '/login.html';
        return;
    }
    
    const startDate = new Date(2026, 5, 1); // June 1, 2026
    const endDate = new Date(2026, 7, 31);   // August 31, 2026
    
    allCalculatedDeployments = calculateDeploymentsForRange(startDate, endDate);
    
    // Setup Filter Listeners
    document.getElementById("filter-index").addEventListener("change", (e) => {
        activeFilters.index = e.target.value;
        updateCalendars();
    });
    
    document.getElementById("filter-type").addEventListener("change", (e) => {
        activeFilters.type = e.target.value;
        updateCalendars();
    });
    
    updateCalendars();
    
    // Setup Theme Switcher
    const themeBtn = document.getElementById("theme-toggle-btn");
    if (themeBtn) {
        const currentTheme = localStorage.getItem("theme");
        if (currentTheme === "light") {
            document.body.classList.add("light-theme");
            themeBtn.innerText = "🌙 Dark Theme";
        }
        themeBtn.addEventListener("click", () => {
            document.body.classList.toggle("light-theme");
            const isLight = document.body.classList.contains("light-theme");
            localStorage.setItem("theme", isLight ? "light" : "dark");
            themeBtn.innerText = isLight ? "🌙 Dark Theme" : "☀️ Light Theme";
        });
    }

    // Modal close listeners
    document.querySelector(".close-btn").addEventListener("click", hideModal);
    window.addEventListener("click", (e) => {
        if (e.target === document.getElementById("strategy-modal")) {
            hideModal();
        }
    });
});

function updateCalendars() {
    // Render June (Month 5), July (Month 6), August (Month 7) 2026
    renderCalendar("calendar-june", 2026, 5, allCalculatedDeployments, activeFilters);
    renderCalendar("calendar-july", 2026, 6, allCalculatedDeployments, activeFilters);
    renderCalendar("calendar-august", 2026, 7, allCalculatedDeployments, activeFilters);
}

function showStrategyDetails(dep) {
    const strategy = dep.strategy;
    const modal = document.getElementById("strategy-modal");
    
    document.getElementById("modal-strategy-name").innerText = strategy.name;
    document.getElementById("modal-sheet-type").innerText = strategy.sheet;
    document.getElementById("modal-sheet-type").className = `badge ${strategy.sheet.toLowerCase()}`;
    
    document.getElementById("modal-index").innerText = strategy.index;
    document.getElementById("modal-expiry").innerText = strategy.expiry;
    document.getElementById("modal-dte").innerText = strategy.dte;
    document.getElementById("modal-deploy-day").innerText = `${strategy.day} at ${strategy.time}`;
    
    // Target deployment dates
    document.getElementById("modal-target-date").innerText = formatDateString(dep.actualDate);
    document.getElementById("modal-expiry-date").innerText = formatDateString(dep.expiryDate);
    
    if (dep.shifted) {
        document.getElementById("modal-holiday-notice").style.display = "block";
        document.getElementById("modal-original-date").innerText = formatDateString(dep.nominalDate);
        document.getElementById("modal-holiday-name").innerText = dep.holidayName;
    } else {
        document.getElementById("modal-holiday-notice").style.display = "none";
    }
    
    // Setup Legs and Strikes
    const legsContainer = document.getElementById("modal-legs-list");
    legsContainer.innerHTML = "";
    
    const strikeExampleContainer = document.getElementById("modal-strikes-list");
    strikeExampleContainer.innerHTML = "";
    
    // If double sided PE & CE
    if (strategy.type === "PE & CE") {
        // Legs
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
        
        // Strike Examples
        const strikeTitle = document.createElement("p");
        strikeTitle.innerHTML = `<strong>Strike Example (ATM = ${strategy.strike_example.ATM})</strong>`;
        strikeExampleContainer.appendChild(strikeTitle);
        
        const peStrikesTitle = document.createElement("h5");
        peStrikesTitle.innerText = "PE Strikes";
        strikeExampleContainer.appendChild(peStrikesTitle);
        
        strategy.strike_example.PE.forEach(st => {
            const li = document.createElement("div");
            li.className = "leg-item pe-side";
            li.innerText = st;
            strikeExampleContainer.appendChild(li);
        });
        
        const ceStrikesTitle = document.createElement("h5");
        ceStrikesTitle.innerText = "CE Strikes";
        strikeExampleContainer.appendChild(ceStrikesTitle);
        
        strategy.strike_example.CE.forEach(st => {
            const li = document.createElement("div");
            li.className = "leg-item ce-side";
            li.innerText = st;
            strikeExampleContainer.appendChild(li);
        });
    } else {
        // Single Sided
        const side = strategy.type.split(" ")[0]; // CE or PE
        const sideTitle = document.createElement("h5");
        sideTitle.innerText = `${side} Legs`;
        sideTitle.style.color = side === "CE" ? "#10b981" : "#ef4444";
        legsContainer.appendChild(sideTitle);
        
        strategy.setup[side].forEach(leg => {
            const li = document.createElement("div");
            li.className = `leg-item ${side.toLowerCase()}-side`;
            li.innerText = leg;
            legsContainer.appendChild(li);
        });
        
        if (strategy.setup.notes) {
            const note = document.createElement("p");
            note.className = "setup-note";
            note.innerHTML = `*Note:* ${strategy.setup.notes}`;
            legsContainer.appendChild(note);
        }
        
        // Strike Examples
        const strikeTitle = document.createElement("p");
        strikeTitle.innerHTML = `<strong>Strike Example (ATM = ${strategy.strike_example.ATM})</strong>`;
        strikeExampleContainer.appendChild(strikeTitle);
        
        strategy.strike_example[side].forEach(st => {
            const li = document.createElement("div");
            li.className = `leg-item ${side.toLowerCase()}-side`;
            li.innerText = st;
            strikeExampleContainer.appendChild(li);
        });
        
        if (strategy.strike_example.notes) {
            const note = document.createElement("p");
            note.className = "setup-note";
            note.innerHTML = `*Note:* ${strategy.strike_example.notes}`;
            strikeExampleContainer.appendChild(note);
        }
    }
    
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
    
    if (isAdminMode) {
        const editBtn = document.getElementById("modal-edit-btn");
        const deleteBtn = document.getElementById("modal-delete-btn");
        
        const newEditBtn = editBtn.cloneNode(true);
        const newDeleteBtn = deleteBtn.cloneNode(true);
        editBtn.parentNode.replaceChild(newEditBtn, editBtn);
        deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        
        newEditBtn.addEventListener("click", () => {
            hideModal();
            openEditStrategyModal(strategy);
        });
        
        newDeleteBtn.addEventListener("click", () => {
            hideModal();
            deleteStrategy(strategy.id);
        });
    }

    modal.style.display = "block";
}

function hideModal() {
    document.getElementById("strategy-modal").style.display = "none";
}

// -------------------------------------------------------------
// ADMIN CONTROLS INTERACTIVE LOGIC
// -------------------------------------------------------------

function showToast(msg, isError = false) {
    alert(msg);
}

// A. Strategy Creation / Editing Modals
function openAddStrategyModal() {
    document.getElementById("edit-modal-title").innerText = "Add Strategy";
    document.getElementById("edit-strat-id").value = "";
    document.getElementById("edit-strategy-form").reset();
    document.getElementById("edit-strategy-modal").style.display = "block";
}

function openEditStrategyModal(strategy) {
    document.getElementById("edit-modal-title").innerText = "Edit Strategy";
    document.getElementById("edit-strat-id").value = strategy.id;
    document.getElementById("edit-strat-name").value = strategy.name;
    document.getElementById("edit-strat-sheet").value = strategy.sheet;
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
        alert("Invalid Setup Legs JSON format! Please check brackets and quotes.");
        return;
    }
    
    const strike_example = { ATM: 25000 };
    if (setup.CE) {
        strike_example.CE = setup.CE.map(leg => `${leg.split(' ').slice(1).join(' ')} (Leg)`);
    }
    if (setup.PE) {
        strike_example.PE = setup.PE.map(leg => `${leg.split(' ').slice(1).join(' ')} (Leg)`);
    }

    const updatedStrat = {
        id: id || `strat_${Date.now()}`,
        sheet,
        name,
        index,
        expiry,
        dte,
        day,
        time,
        type,
        setup,
        strike_example,
        conditions: { credit_range, refine_credit, refine_blue_line, position_delta },
        exit: { target, sl, market_move, duration, gap_up }
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
        alert("Incorrect strategy name. Deletion canceled.");
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
    
    document.getElementById("tab-users-content").style.display = tab === 'users' ? 'flex' : 'none';
    document.getElementById("tab-holidays-content").style.display = tab === 'holidays' ? 'flex' : 'none';
}

async function fetchAdminDbData() {
    try {
        const response = await fetch('/api/admin/get');
        if (!response.ok) return;
        const resJson = await response.json();
        whitelistData = resJson.whitelist || {};
        renderWhitelistTable();
        renderHolidaysTable();
    } catch (e) {
        console.error("Failed to fetch DB details:", e);
    }
}

function renderWhitelistTable() {
    const tbody = document.getElementById("whitelist-table-body");
    tbody.innerHTML = "";
    
    const searchVal = document.getElementById("user-search-input").value.toLowerCase().trim();
    
    Object.entries(whitelistData).forEach(([phone, pin]) => {
        if (searchVal && !phone.includes(searchVal)) return;
        
        const tr = document.createElement("tr");
        
        const tdPhone = document.createElement("td");
        tdPhone.innerHTML = `<strong>${phone}</strong>`;
        tr.appendChild(tdPhone);
        
        const tdStatus = document.createElement("td");
        tdStatus.innerText = "Registered (PIN available)";
        tr.appendChild(tdStatus);
        
        const tdAction = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.className = "admin-btn logout";
        delBtn.style.padding = "0.25rem 0.6rem";
        delBtn.style.fontSize = "0.75rem";
        delBtn.innerText = "Remove";
        delBtn.addEventListener("click", () => deleteUser(phone));
        tdAction.appendChild(delBtn);
        tr.appendChild(tdAction);
        
        tbody.appendChild(tr);
    });
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
        alert("Please specify both a Date and Holiday Name.");
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

async function syncLocalCodebase() {
    if (!confirm("Are you sure you want to overwrite Vercel KV strategies and holidays with the local codebase files? Any direct changes made in the web UI will be overwritten.")) return;
    try {
        const response = await fetch('/api/admin/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync_local' })
        });
        const resJson = await response.json();
        if (response.ok && resJson.success) {
            showToast("Successfully synced from codebase files!");
            window.location.reload();
        } else {
            showToast(resJson.error || "Sync failed", true);
        }
    } catch (err) {
        showToast("Failed to connect to save API", true);
    }
}

async function logoutAdmin() {
    try {
        await fetch('/api/admin/logout', { method: 'POST' });
    } catch (e) {
        console.warn("Server logout failed, attempting local cookie overwrite fallback", e);
    }
    document.cookie = 'admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.reload();
}

async function logoutUser() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        console.warn("Server logout failed, attempting local cookie overwrite fallback", e);
    }
    document.cookie = 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.reload();
}
