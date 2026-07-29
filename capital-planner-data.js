// Capital Allocation Planner & RoI Master Data Structure
const capitalPlannerMasterData = {
    defaultCapital: 5000000, // ₹ 50,00,000 (50 Lakhs)
    buckets: [
        {
            id: "p1",
            priority: 1,
            name: "Monthly Strategies - Priority 1",
            colorClass: "monthly",
            badgeText: "Priority 1 - Monthly",
            avgCapitalPct: 68,
            targetDeployPct: [40, 20, 80, 100, 100],
            defaultWinRate: 80,
            maxPotentialPct: 1.90, // 1.90% of total capital
            remarks: "If only one qualifies, deploy both allocations into it. Deploy all qualifying strategies.",
            strategies: [
                {
                    appStrategyId: "monthly-nobrainer",
                    displayName: "Bank Nifty No Brainer",
                    cycleLabel: "Week 2 Expiry",
                    allocationW: [0, 0, 10, 10, 10],
                    targetSlPct: 1.0,
                    maxProfitPct: 0.10 // 0.10% of total capital
                },
                {
                    appStrategyId: "monthly-autopilot",
                    displayName: "FinNifty Auto Pilot",
                    cycleLabel: "Week 2 Expiry",
                    allocationW: [0, 0, 10, 10, 10],
                    targetSlPct: 2.0,
                    maxProfitPct: 0.20
                },
                {
                    appStrategyId: "monthly-batman",
                    displayName: "Batman 1:3:2",
                    cycleLabel: "Mid-Month Expiry",
                    allocationW: [0, 0, 30, 30, 30],
                    targetSlPct: 2.0,
                    maxProfitPct: 0.60
                },
                {
                    appStrategyId: "monthly-hni",
                    displayName: "HNI PE + CE",
                    cycleLabel: "Mid-Month Expiry",
                    allocationW: [20, 0, 30, 30, 30],
                    targetSlPct: 2.0,
                    maxProfitPct: 0.60
                },
                {
                    appStrategyId: "monthly-nobrainer",
                    displayName: "Nifty No Brainer",
                    cycleLabel: "Month-End Expiry",
                    allocationW: [20, 20, 0, 20, 20],
                    targetSlPct: 2.0,
                    maxProfitPct: 0.40
                }
            ]
        },
        {
            id: "p2",
            priority: 2,
            name: "Weekly Strategies - Priority 2",
            colorClass: "biweekly",
            badgeText: "Priority 2 - Weekly",
            avgCapitalPct: 24,
            targetDeployPct: [40, 60, 20, 0, 0],
            defaultWinRate: 75,
            maxPotentialPct: 1.08, // 1.08% of total capital
            remarks: "Deploy 1–2 qualifying strategies.",
            strategies: [
                {
                    appStrategyId: "monthly-hni",
                    displayName: "HNI PE + CE (Mon)",
                    cycleLabel: "Monday Weekly",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 1.0,
                    maxProfitPct: 0.30
                },
                {
                    appStrategyId: "biwkly-blaze-bf",
                    displayName: "Blaze BF (Mon)",
                    cycleLabel: "Monday Weekly",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 1.0,
                    maxProfitPct: 0.30
                },
                {
                    appStrategyId: "wkly-nifty-bwb",
                    displayName: "Nifty BWB (Thur)",
                    cycleLabel: "Thursday Expiry",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 1.0,
                    maxProfitPct: 0.30
                },
                {
                    appStrategyId: "wkly-sensex-bwb",
                    displayName: "Sensex BWB (Thur)",
                    cycleLabel: "Thursday Expiry",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 0.6,
                    maxProfitPct: 0.18
                }
            ]
        },
        {
            id: "p3",
            priority: 3,
            name: "STBT Strategies - Priority 3",
            colorClass: "stbt",
            badgeText: "Priority 3 - STBT",
            avgCapitalPct: 8,
            targetDeployPct: [20, 20, 0, 0, 0],
            defaultWinRate: 70,
            maxPotentialPct: 0.304, // 0.304% of total capital (₹30,400 per 1Cr)
            remarks: "Deploy 1–2 qualifying strategies.",
            strategies: [
                {
                    appStrategyId: "stbt-3d-ladder",
                    displayName: "3D Ladder (Thur)",
                    cycleLabel: "Thursday STBT",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 0.70,
                    maxProfitPct: 0.070
                },
                {
                    appStrategyId: "stbt-matrix",
                    displayName: "Matrix Calendar (Fri)",
                    cycleLabel: "Friday STBT",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 1.00,
                    maxProfitPct: 0.094
                },
                {
                    appStrategyId: "stbt-ce-dominator",
                    displayName: "CE Dominator (Fri)",
                    cycleLabel: "Friday STBT",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 0.70,
                    maxProfitPct: 0.047
                },
                {
                    appStrategyId: "stbt-no-brainer",
                    displayName: "No Brainer STBT (Fri)",
                    cycleLabel: "Friday STBT",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 0.70,
                    maxProfitPct: 0.047
                },
                {
                    appStrategyId: "stbt-2d-ladder",
                    displayName: "2D Ladder (last Fri)",
                    cycleLabel: "Last Friday STBT",
                    allocationW: [0, 0, 0, 0, 0],
                    targetSlPct: 0.70,
                    maxProfitPct: 0.046
                }
            ]
        }
    ]
};
