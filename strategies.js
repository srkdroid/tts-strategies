// Options Trading Strategies Data
// Generated dynamically from Excel parsed data
const strategiesData = [
    {
        "id": "monthly-batman",
        "sheet": "Monthly",
        "name": "Batman 1:3:2",
        "index": "Nifty",
        "expiry": "Monthly, Next Month",
        "dte": "39 - 44 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "PE & CE",
        "setup": {
            "PE": [
                "Buy 1 ATM - 400",
                "Sell 3 ATM - 600",
                "Buy 2 ATM - 1400"
            ],
            "CE": [
                "Buy 1 ATM + 400",
                "Sell 3 ATM + 600",
                "Buy 2 ATM + 1400"
            ]
        },
        "strike_example": {
            "ATM": 25000,
            "PE": [
                "24600 (Buy 1)",
                "24400 (Sell 3)",
                "23600 (Buy 2)"
            ],
            "CE": [
                "25400 (Buy 1)",
                "25600 (Sell 3)",
                "26400 (Buy 2)"
            ]
        },
        "conditions": {
            "credit_range": "5 to 6%",
            "refine_credit": "If credit > 6%, shift all legs 100 points OTM until credit < 6%.\nStart with CE side, check credit, then shift PE side if needed and recheck.",
            "refine_blue_line": "Overhedge CE side, such that at CE Buy strike shows only slightly more loss than PE side; Keep increasing CE hedge Buy lots and check, till condition met."
        },
        "exit": {
            "target": "2 % Profit",
            "sl": "2.5 % Loss",
            "market_move": null,
            "duration": "10 to 15 days from deployment, \nHold max till 7th of month"
        }
    },
    {
        "id": "monthly-no-brainer-nifty",
        "sheet": "Monthly",
        "name": "No Brainer (Nifty)",
        "index": "Nifty",
        "expiry": "Monthly, Next Month",
        "dte": "29 - 34 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1 ATM + 300",
                "Sell 2 ATM + 600",
                "Buy 1 ATM + 1600"
            ],
            "notes": "Distance from spot is 1.25% of Index value"
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "25300 (Buy 1)",
                "25600 (Sell 2)",
                "26600 (Buy 1)"
            ]
        },
        "conditions": {
            "credit_range": "-1% (Debit) to +1% (Credit)",
            "refine_credit": "If credit > 1%, shift all legs 100 points OTM until credit <= 1%."
        },
        "exit": {
            "target": "2.5 % Profit",
            "sl": "3.0 % Loss",
            "market_move": "Market crosses sell leg strike",
            "duration": "a) if profit is 2% before 10th; (by end of day, if 1.8 or 1.9 then book)\nb) If by end of day, if profit is about 2.3, then exit do not wait for overnight (for 0.1 or 0.2)\nc) Hold max till 21st of month"
        }
    },
    {
        "id": "monthly-no-brainer-banknifty",
        "sheet": "Monthly",
        "name": "No Brainer (Bank Nifty)",
        "index": "Bank Nifty",
        "expiry": "Monthly",
        "dte": "12 DTE",
        "day": "Thur",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1 ATM + 1000",
                "Sell 2 ATM + 1500",
                "Buy 1 ATM + 3500"
            ],
            "notes": "1) pick only multiple of 500 strikes\n2) if ATM is not at multiple of 500 then consider next closest multiple of 500 as ATM"
        },
        "strike_example": {
            "ATM": 56000,
            "notes": "If ATM is 55800, consider 56000 as ATM",
            "CE": [
                "57000 (Buy 1)",
                "57500 (Sell 2)",
                "59500 (Buy 1)"
            ]
        },
        "conditions": {
            "credit_range": "-0.3% (Debit) to +0.6% (Credit)",
            "refine_credit": null
        },
        "exit": {
            "target": "1.0 % Profit",
            "sl": "1.0 % Loss",
            "market_move": null,
            "duration": "Max till 1 day before Expiry"
        }
    },
    {
        "id": "monthly-hni-nifty",
        "sheet": "Monthly",
        "name": "HNI (Nifty)",
        "index": "Nifty",
        "expiry": "Monthly",
        "dte": "39 - 44 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1 ATM + 300",
                "Sell 3 ATM + 600",
                "Buy 2 ATM + 900"
            ],
            "notes": "1) pick only multiple of 100 strikes"
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "1 ATM + 300 (Leg)",
                "3 ATM + 600 (Leg)",
                "2 ATM + 900 (Leg)"
            ]
        },
        "conditions": {
            "credit_range": "0.5% (Credit) to +1.6% (Credit)",
            "refine_credit": "If credit > 1.6%, shift all legs 100 points OTM until credit condition met\nIf credit < 0.5%, then skip that month",
            "refine_blue_line": "If as per DTE, deploy Fri is holiday then deploy on following week Fri",
            "position_delta": ""
        },
        "exit": {
            "target": "2 % Profit",
            "sl": "2.5 % Loss",
            "market_move": "Market crosses selling leg",
            "duration": "Max till 3rd Fri of Expiry month",
            "gap_up": ""
        }
    },
    {
        "id": "monthly-autopilot-finnifty",
        "sheet": "Monthly",
        "name": "Auto-Pilot",
        "index": "Fin Nifty (Expiry Tue)",
        "expiry": "Bi Weekly",
        "dte": "12 DTE",
        "day": "Thur",
        "time": "09:45:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1 ATM+300",
                "Sell 2 ATM+600",
                "Buy 1 ATM+1600"
            ],
            "notes": "1) For outer hedge pick only multiple of 500 strikes"
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "25300 (Buy 1)",
                "25600 (Sell 2)",
                "26600 (Buy 1)"
            ]
        },
        "conditions": {
            "credit_range": "-1.0 % (Debit) to +1.0 % (Credit)",
            "refine_credit": null,
            "refine_blue_line": null
        },
        "exit": {
            "target": "2.0 % Profit",
            "sl": "2.0 % Loss",
            "market_move": "Market crosses 1st Buy leg strike\nMax till next Thurday",
            "duration": "Max till next Thursday"
        }
    },
    {
        "id": "monthly-double-decker",
        "sheet": "Monthly",
        "name": "Double Decker",
        "index": "Nifty",
        "expiry": "Monthly, Next Month",
        "dte": "39 - 43 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "PE & CE",
        "setup": {
            "PE": [
                "Buy 1 ATM - 400",
                "Sell 1 ATM - 600",
                "Sell 2 ATM - 900",
                "Buy 2 ATM - 1600"
            ],
            "CE": [
                "Buy 1 ATM + 400",
                "Sell 1 ATM + 600",
                "Sell 2 ATM + 900",
                "Buy 2 ATM + 1600"
            ]
        },
        "strike_example": {
            "ATM": 25000,
            "PE": [
                "24600 (Buy 1)",
                "24400 (Sell 1)",
                "24100 (Sell 2)",
                "23400 (Buy 2)"
            ],
            "CE": [
                "25400 (Buy 1)",
                "25600 (Sell 1)",
                "25900 (Sell 2)",
                "26600 (Buy 2)"
            ]
        },
        "conditions": {
            "credit_range": "4 to 5 % Credit",
            "refine_credit": null,
            "refine_blue_line": null
        },
        "exit": {
            "target": "2.5 % Profit",
            "sl": "3 % Loss",
            "market_move": null,
            "duration": "max till 12th of Expiry month"
        }
    },
    {
        "id": "biweekly-bwb-2",
        "sheet": "BiWkly",
        "name": "BWB",
        "index": "Nifty (Expiry Tue)",
        "expiry": "Bi Weekly",
        "dte": "12 DTE",
        "day": "Thur",
        "time": "15:16:00",
        "type": "PE Only",
        "setup": {
            "PE": [
                "Buy 1  ATM-200",
                "Sell 2  ATM-400",
                "Buy 1  ATM-800"
            ],
            "notes": "1) pick only multiple of 100 strikes; since it is biweekly; if ATM is 25050; consider it as 25000;"
        },
        "strike_example": {
            "ATM": 25000,
            "PE": [
                "24800",
                "24600",
                "24200"
            ],
            "notes": null
        },
        "conditions": {
            "credit_range": "-0.4 % (Debit) to +0.5 % (Credit)",
            "refine_credit": "If Credit > 0.5% then shift all legs by 100 points further OTM, and check if credit is <= 0.5%"
        },
        "exit": {
            "target": "1.0 % Profit",
            "sl": "1.5 % Loss",
            "market_move": "Market crosses 1st Buy leg strike",
            "duration": "Max till next Thur morning 9:30 am"
        }
    },
    {
        "id": "biweekly-broken-wing-3",
        "sheet": "BiWkly",
        "name": "Broken Wing",
        "index": "Sensex (Exp Thur)",
        "expiry": "Weekly",
        "dte": "Previous Expiry day",
        "day": "Thur",
        "time": "15:16:00",
        "type": "PE Only",
        "setup": {
            "PE": [
                "Buy 1  ATM-500",
                "Sell 2  ATM-1000",
                "Buy 1  ATM-2000"
            ],
            "notes": "1) pick only multiple of 500 strikes"
        },
        "strike_example": {
            "ATM": 87000,
            "PE": [
                "86500",
                "86000",
                "85000"
            ],
            "notes": "2) if ATM is not at multiple of 500 then consider next closest multiple of 500 as ATM"
        },
        "conditions": {
            "credit_range": "-0.3 % (Debit) to +0.5 % (Credit)",
            "refine_credit": "If Credit > 0.5% then shift all legs by 500 points further OTM, and check if credit is <= 0.5%"
        },
        "exit": {
            "target": "0.6 % Profit",
            "sl": "1.0 % Loss",
            "market_move": "Market crosses sell leg strike",
            "duration": "Max 3 trading sessions, Tue 3:15"
        }
    },
    {
        "id": "biweekly-hni-4",
        "sheet": "BiWkly",
        "name": "HNI",
        "index": "Nifty (Expiry Tue)",
        "expiry": "Bi Weekly",
        "dte": "8 DTE",
        "day": "Monday",
        "time": "09:45:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1  ATM+200",
                "Sell 3  ATM+400",
                "Buy 2  ATM+600"
            ],
            "notes": "1) pick only multiple of 100 strikes; since it is biweekly; if ATM is 25050; consider it as 25100;"
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "25200",
                "25400",
                "25600"
            ],
            "notes": null
        },
        "conditions": {
            "credit_range": "-0.5 % (Debit) to +0.6 % (Credit)",
            "refine_credit": "If Credit > 0.6% then shift all legs by 100 points further OTM, till condition met"
        },
        "exit": {
            "target": "1.0 % Profit",
            "sl": "1.0 % Loss",
            "market_move": "Market crosses 1st Sell leg strike",
            "duration": "Max till next Fri 3:00 pm"
        }
    },

    {
        "id": "biweekly-blazeBF-1",
        "sheet": "BiWkly",
        "name": "Blaze Butterfly",
        "index": "Nifty (Expiry Tue)",
        "expiry": "Bi Weekly",
        "dte": "8 DTE",
        "day": "Monday",
        "time": "15:16:00",
        "type": "PE Only",
        "setup": {
            "PE": [
                "Buy 1  ATM-200",
                "Sell 3  ATM-600",
                "Buy 2  ATM-1000"
            ],
            "notes": "1) pick only multiple of 100 strikes; since it is biweekly; if ATM is 23050; consider it as 23000; Don't trade if Tuesday is holiday "
        },
        "strike_example": {
            "ATM": 23100,
            "PE": [
                "22900",
                "22700",
                "22300"
            ],
            "notes": null
        },
        "conditions": {
            "credit_range": "-0.5 % (Debit) to +0.6 % (Credit)",
            "refine_credit": "If Credit > 0.6% then shift all legs by 100 points further OTM, till condition met. Do not take trade if debit is > 0.5%"
        },
        "exit": {
            "target": "1.0 % Profit",
            "sl": "1.0 % Loss",
            "market_move": "Market crosses 1st buy leg strike on Tuesday",
            "duration": "Max till next Fri 3:00 pm"
        }
    },

    {
        "id": "stbt-nifty-3d-ladder-2",
        "sheet": "STBT",
        "name": "Nifty 3D Ladder",
        "index": "Nifty (Expiry Tue)",
        "expiry": "Weekly - STBT",
        "dte": "3 DTE",
        "day": "Thur",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1  ATM+150",
                "Sell 1  ATM+250",
                "Sell 1  ATM+300",
                "Buy 1  ATM+1000"
            ]
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "1 Buy 25150",
                "1 Sell 25250",
                "1 Sell 25300",
                "1 Buy 26000"
            ]
        },
        "conditions": {
            "credit_range": "-0.1 % (Debit)",
            "refine_credit": null,
            "position_delta": "Position Delta <= -0.1  (before outer hedge)\nIf more, than shift all legs 50 points OTM and check, repeat untill condition met"
        },
        "exit": {
            "target": "0.7 % Profit",
            "sl": "0.7 % Loss",
            "market_move": "Market crosses 1st Buy leg strike",
            "duration": "Next day trading sessions, Fri 3:15",
            "gap_up": null
        }
    },
    {
        "id": "stbt-ce-dominator-3",
        "sheet": "STBT",
        "name": "CE Dominator",
        "index": "Nifty (Expiry Tue)",
        "expiry": "Weekly - STBT",
        "dte": "2 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1  ATM+100",
                "Sell 3  ATM+200",
                "Buy 2  ATM+300"
            ]
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "1 Buy 25100",
                "3 Sell 25200",
                "2 Buy 25300"
            ]
        },
        "conditions": {
            "credit_range": "-0.1 % (Debit) to +0.4 % (Credit)",
            "refine_credit": "If Credit > 0.4% then shift all legs by 50 points further OTM, and check if credit is <= 0.4%",
            "position_delta": null
        },
        "exit": {
            "target": "0.7 % Profit",
            "sl": "0.7 % Loss",
            "market_move": "Market crosses Sell leg strike",
            "duration": "Next day trading sessions, Mon 3:15",
            "gap_up": null
        }
    },
    {
        "id": "stbt-matrix-calendar-4",
        "sheet": "STBT",
        "name": "Matrix Calendar",
        "index": "Nifty",
        "expiry": "Bi-Weekly - STBT",
        "dte": "11 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Sell 4  delta 0.23 ",
                "Buy 3  Sell Strike + 500",
                "Buy 2  Monthly same strike as Sell"
            ]
        },
        "strike_example": {
            "ATM": 24200,
            "CE": [
                "Deployment Date - 10-Jul",
                "4  Sell delta 0.23  (21JUL 24500 CE) only if premium is more than Rs. 70",
                "3  Buy sell Strike + 500 (21JUL 25000 CE)",
                "2  Buy monthly same strike as Sell (28JUL 24500 CE)"
            ]
        },
        "conditions": {
            "credit_range": "Sell strike min 400 point from ATM",
            "refine_credit": "Sell Premium min 70 Rs",
            "refine_blue_line": "",
            "position_delta": "For Last week of month, Buy hedge of following month"
        },
        "exit": {
            "target": "1 % Profit",
            "sl": "1 % Loss",
            "market_move": "",
            "duration": "Next day trading sessions, Mon 3:15",
            "gap_up": ""
        }
    },
    {
        "id": "stbt-sensex-no-brainer-5",
        "sheet": "STBT",
        "name": "Sensex No brainer",
        "index": "Sensex (Expiry Thur)",
        "expiry": "Weekly - STBT",
        "dte": "6 DTE",
        "day": "Fri",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1  ATM+500",
                "Sell 2  ATM+1000",
                "Buy 1  ATM+3000"
            ]
        },
        "strike_example": {
            "ATM": 85000,
            "CE": [
                "1 Buy 85500",
                "2 Sell 86000",
                "1 Buy 88000"
            ]
        },
        "conditions": {
            "credit_range": "-0.1 % (Debit)",
            "refine_credit": null,
            "position_delta": "Position Delta <= -0.1  (before outer hedge)\nIf more, than shift all legs 100 points OTM and check, repeat untill condition met"
        },
        "exit": {
            "target": "0.7 % Profit",
            "sl": "0.7 % Loss",
            "market_move": null,
            "duration": "Next day trading sessions, Mon 3:15",
            "gap_up": null
        }
    },
    {
        "id": "stbt-fin-nifty-2d-ladder-6",
        "sheet": "STBT",
        "name": "Fin Nifty 2D Ladder",
        "index": "Fin Nifty (Expiry Tue)",
        "expiry": "Weekly - STBT",
        "dte": "2 DTE",
        "day": "Last Fri before Expiry",
        "time": "15:16:00",
        "type": "CE Only",
        "setup": {
            "CE": [
                "Buy 1  ATM+150",
                "Sell 1  ATM+250",
                "Sell 1  ATM+300",
                "Buy 1  ATM+1000"
            ]
        },
        "strike_example": {
            "ATM": 25000,
            "CE": [
                "1 Buy 25150",
                "1 Sell 25250",
                "1 Sell 25300",
                "1 Buy 26000"
            ]
        },
        "conditions": {
            "credit_range": "-0.1 % (Debit)",
            "refine_credit": null,
            "position_delta": "Position Delta <= -0.1  (before outer hedge)\nIf more, than shift all legs 50 points OTM and check, repeat untill condition met"
        },
        "exit": {
            "target": "0.7 % Profit",
            "sl": "0.7 % Loss",
            "market_move": null,
            "duration": "Next day trading sessions, Mon 3:15",
            "gap_up": "If next day opens with Gap up of 140+ points, then exit at open whatever P/L"
        }
    }
];

if (typeof module !== 'undefined') {
    module.exports = strategiesData;
}
