// Indian Stock Market Holidays 2026
let marketHolidays2026 = {
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

// Check if a date is a holiday or weekend
function getHolidayOrWeekend(date) {
    const dateCopy = new Date(date.getTime());
    // Format as YYYY-MM-DD in local time
    const year = dateCopy.getFullYear();
    const month = String(dateCopy.getMonth() + 1).padStart(2, '0');
    const day = String(dateCopy.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    if (marketHolidays2026[dateStr]) {
        return marketHolidays2026[dateStr];
    }
    
    const dayOfWeek = dateCopy.getDay();
    if (dayOfWeek === 0) return "Sunday (Weekend)";
    if (dayOfWeek === 6) return "Saturday (Weekend)";
    
    return null;
}

// Get the previous trading day (skips holidays and weekends)
function getPreviousTradingDay(date) {
    let temp = new Date(date.getTime());
    temp.setDate(temp.getDate() - 1);
    while (getHolidayOrWeekend(temp)) {
        temp.setDate(temp.getDate() - 1);
    }
    return temp;
}

// Get the next trading day (skips holidays and weekends)
function getNextTradingDay(date) {
    let temp = new Date(date.getTime());
    temp.setDate(temp.getDate() + 1);
    while (getHolidayOrWeekend(temp)) {
        temp.setDate(temp.getDate() + 1);
    }
    return temp;
}

// Helper to format date as YYYY-MM-DD
function formatDateString(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return "Not Scheduled";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Generate weekly and monthly expiries for Nifty (Tuesday = 2) and Sensex (Thursday = 4)
function getExpiriesForMonth(year, month, dayOfWeek) {
    // month is 0-indexed (0 = Jan, 11 = Dec)
    let expiries = [];
    let d = new Date(year, month, 1);
    
    while (d.getMonth() === month) {
        if (d.getDay() === dayOfWeek) {
            let originalDate = new Date(d.getTime());
            let actualDate = new Date(d.getTime());
            
            let holidayName = getHolidayOrWeekend(originalDate);
            // If the expiry falls on a holiday (and isn't a weekend), shift to previous trading day
            if (holidayName && holidayName !== "Saturday (Weekend)" && holidayName !== "Sunday (Weekend)") {
                actualDate = getPreviousTradingDay(originalDate);
            }
            
            expiries.push({
                original: originalDate,
                actual: actualDate,
                isMonthly: false
            });
        }
        d.setDate(d.getDate() + 1);
    }
    
    // The last expiry in the list is the monthly expiry
    if (expiries.length > 0) {
        expiries[expiries.length - 1].isMonthly = true;
    }
    
    return expiries;
}
