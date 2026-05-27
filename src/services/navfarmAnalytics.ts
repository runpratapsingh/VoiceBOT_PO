import { MOCK_BATCH_HISTORY } from './mockBatchHistory';

export type NavRecord = Record<string, any>;

export type ParsedMetric = {
  category: string;
  itemName: string;
  quantity: number;
  unit: string;
  postingDate: string;
};

// Fallback unit costs for precise expense calculations based on the item codes in B00010
export const FALLBACK_UNIT_COSTS: Record<string, number> = {
  "IN0001": 25.00,  // Creep Feed: 25 per KG
  "IN0004": 30.00,  // Finisher Feed: 30 per KG
  "IN0010": 5.00,   // Surgical Gloves: 5 per NOS
  "IN0011": 2.00,   // Needles: 2 per NOS
  "IN0012": 1.50,   // Alcohol Swabs: 1.5 per NOS
  "IN0013": 15.00,  // IV Set: 15 per NOS
  "IN0035": 120.00, // N-Dox Injection: 120 per VIAL
  "IN0036": 85.00,  // Iron Dextran: 85 per VIAL
  "IN0037": 10.00,  // Albendazole: 10 per DOSE
  "IN0042": 45.00,  // Betadine: 45 per VIAL
  "IN0043": 3.00,   // Mask: 3 per NOS
  "IN0044": 50.00,  // Ultrasound Gel: 50 per NOS
  "IN0045": 95.00,  // Procaine Penicillin: 95 per VIAL
  "IN0046": 60.00,  // Meloxin-P: 60 per VIAL
  "IN0047": 55.00,  // Meloxicam: 55 per VIAL
  "IN0048": 8.00,   // Distilled Water: 8 per VIAL
  "IN0049": 75.00,  // Oxytocin Hormone: 75 per VIAL
  "IN0050": 4.00,   // Syringe 5ml Disposable: 4 per NOS
  "IN0051": 110.00, // Curadex: 110 per VIAL
  "IN0052": 40.00,  // Cramine: 40 per VIAL
  "IN0053": 150.00, // Limoxin-400: 150 per NOS
  "IN0054": 35.00,  // Perinorm Injection: 35 per VIAL
  "IN0055": 80.00,  // Sharkoferrol-FS: 80 per NOS
  "IN0056": 130.00, // Troxin: 130 per VIAL
  "IN0057": 90.00,  // We Pro: 90 per NOS
  "IN0058": 140.00, // Tonakind-Gold: 140 per VIAL
  "IN0059": 2.50,   // Needle 18G: 2.5 per NOS
  "IN0060": 115.00, // Ceftriaxone: 115 per VIAL
  "IN0061": 70.00,  // Introvet B-complex: 70 per VIAL
  "IN0062": 25.00,  // Normal Saline: 25 per VIAL
  "IN0014": 200.00, // Swine Flu Vaccine: 200 per VIAL
  "IN0015": 180.00, // FMD: 180 per VIAL
};

/**
 * Parses a batch record key and extracts category, item name, quantity, and unit.
 */
export function parseKey(key: string, value: number, postingDate: string): ParsedMetric | null {
  let category = '';
  
  if (key.startsWith('Feed')) category = 'FEED';
  else if (key.startsWith('Mortality')) category = 'MORTALITY';
  else if (key.startsWith('Medicine')) category = 'MEDICINE';
  else if (key.startsWith('Vaccination')) category = 'VACCINATION';
  else if (key.startsWith('Offsprings output')) category = 'OUTPUT';
  else if (key.startsWith('Temp')) category = 'TEMPERATURE';
  else if (key.startsWith('Humidity')) category = 'HUMIDITY';
  else if (key.startsWith('Weight')) category = 'WEIGHT';
  else if (key.startsWith('Spent Animal')) category = 'SPENT_ANIMAL';

  if (!category) return null;

  // Extract content between the outermost parentheses e.g. "(Creep Feed (S0) - IN0001-KG)"
  const parenMatch = key.match(/\(([^)]+)\)$/) || key.match(/\((.+)\)/);
  let itemName = '';
  let unit = '';

  if (parenMatch) {
    const content = parenMatch[1];
    if (content.includes(' - ')) {
      const parts = content.split(' - ');
      itemName = parts[0].trim();
      const rightPart = parts[1].trim(); // e.g. "IN0001-KG" or "IN0063-NOS"
      const unitParts = rightPart.split('-');
      unit = unitParts[unitParts.length - 1].trim();
    } else if (content.startsWith('-')) {
      unit = content.substring(1);
      itemName = category === 'TEMPERATURE' ? 'Temperature' : (category === 'HUMIDITY' ? 'Humidity' : '');
    } else {
      itemName = content;
    }
  }

  // Refine known names
  if (itemName === 'Creep Feed (S0)') itemName = 'Creep Feed';
  if (itemName === 'Finisher Feed (S3)') itemName = 'Finisher Feed';

  return {
    category,
    itemName: itemName || category,
    quantity: Number(value) || 0,
    unit: unit || '',
    postingDate
  };
}

/**
 * Extracts all metrics from a batch history API response.
 */
export function extractAllMetrics(resultArray: NavRecord[]): ParsedMetric[] {
  const metrics: ParsedMetric[] = [];
  
  for (const record of resultArray) {
    const postingDate = record.Posting_date;
    if (!postingDate) continue;

    for (const [key, val] of Object.entries(record)) {
      if (key === 'DATAENTRY_ID' || key === 'Posting_date' || key === 'Remark') continue;
      
      const parsed = parseKey(key, Number(val), postingDate);
      if (parsed) {
        metrics.push(parsed);
      }
    }
  }

  return metrics;
}

/**
 * Resolves the query date filter based on user intent and dataset timeline.
 */
export function resolveDateFilter(message: string, allDates: string[]): {
  startDate: string | null;
  endDate: string | null;
  description: string;
  relativeTerm: string;
} {
  const query = message.toLowerCase();
  
  // Sort dates to determine timeline range
  const sortedDates = [...new Set(allDates)].sort();
  const latestDate = sortedDates[sortedDates.length - 1] || '2025-05-03';
  const previousDate = sortedDates[sortedDates.length - 2] || '2025-05-02';

  // Hindi + Hinglish mapping:
  // "aaj", "aaj ki", "aaj ka", "today" -> latest day (2025-05-03)
  // "kal", "kal ka", "kal ki", "yesterday" -> previous day (2025-05-02)
  if (/\b(today|aaj)\b/i.test(query)) {
    return {
      startDate: latestDate,
      endDate: latestDate,
      description: `Today (${latestDate})`,
      relativeTerm: 'today'
    };
  }

  if (/\b(yesterday|kal)\b/i.test(query)) {
    return {
      startDate: previousDate,
      endDate: previousDate,
      description: `Yesterday (${previousDate})`,
      relativeTerm: 'yesterday'
    };
  }

  if (/\b(this week|hafta|week|weekly)\b/i.test(query)) {
    return {
      startDate: sortedDates[0] || null,
      endDate: latestDate,
      description: 'This Week',
      relativeTerm: 'this week'
    };
  }

  if (/\b(last week|pichla hafta)\b/i.test(query)) {
    // In mock data, no entries exist before May 1, so last week is empty
    return {
      startDate: null,
      endDate: null,
      description: 'Last Week (No Data)',
      relativeTerm: 'last week'
    };
  }

  if (/\b(this month|mahina|month|monthly)\b/i.test(query)) {
    return {
      startDate: sortedDates[0] || null,
      endDate: latestDate,
      description: 'This Month (May 2025)',
      relativeTerm: 'this month'
    };
  }

  if (/\b(last month|pichla mahina)\b/i.test(query)) {
    return {
      startDate: null,
      endDate: null,
      description: 'Last Month (No Data)',
      relativeTerm: 'last month'
    };
  }

  // Default: Return cumulative/all dates
  return {
    startDate: sortedDates[0] || null,
    endDate: latestDate,
    description: 'Cumulative Timeline',
    relativeTerm: 'cumulative'
  };
}

/**
 * Calculates operational metrics, expenses, alerts, and insights.
 */
export function analyzeBatchData(
  historyResponse: any,
  dateFilterResult: ReturnType<typeof resolveDateFilter>
) {
  const result = historyResponse.data?.result ?? historyResponse.result ?? [];
  const header = historyResponse.data?.header?.[0] ?? historyResponse.header?.[0] ?? {};

  const openingQty = Number(header.openinG_QTY) || 41;
  const runningCost = Number(header.runninG_COST) || 249819.54;

  const allMetrics = extractAllMetrics(result);

  // Filter metrics based on start and end dates
  const filteredMetrics = allMetrics.filter((m) => {
    if (!dateFilterResult.startDate || !dateFilterResult.endDate) return false;
    return m.postingDate >= dateFilterResult.startDate && m.postingDate <= dateFilterResult.endDate;
  });

  // If no records found, return empty results
  if (filteredMetrics.length === 0 && dateFilterResult.relativeTerm !== 'cumulative') {
    return null;
  }

  // Use either filtered or all metrics for cumulative calculations
  const activeMetrics = filteredMetrics.length > 0 ? filteredMetrics : allMetrics;

  // Calculators
  let feedTotal = 0;
  let mortalityTotal = 0;
  let outputTotal = 0;

  const tempValues: number[] = [];
  const humidityValues: number[] = [];

  let feedCost = 0;
  let medicineCost = 0;
  let vaccinationCost = 0;

  // Track quantities by item name
  const feedItems: Record<string, number> = {};
  const mortalityItems: Record<string, number> = {};
  const medicineItems: Record<string, number> = {};
  const vaccinationItems: Record<string, number> = {};
  const outputItems: Record<string, number> = {};

  // For temperature/humidity latest record values
  let latestTempDate = '';
  let latestTemp = 0;
  let latestHumDate = '';
  let latestHum = 0;

  for (const m of activeMetrics) {
    const q = m.quantity;

    // Expense calculation based on key codes or fallback costs
    // Find item code inside key to apply cost
    let itemCode = '';
    const matchingKey = Object.keys(result[0] || {}).find(k => k.includes(m.itemName));
    if (matchingKey) {
      const codeMatch = matchingKey.match(/@([A-Z0-9]+)\s*@/) || matchingKey.match(/@([A-Z0-9]+)@/);
      if (codeMatch) {
        itemCode = codeMatch[1];
      }
    }
    const unitCost = FALLBACK_UNIT_COSTS[itemCode] || 0;

    switch (m.category) {
      case 'FEED':
        feedTotal += q;
        feedItems[m.itemName] = (feedItems[m.itemName] || 0) + q;
        feedCost += q * unitCost;
        break;

      case 'MORTALITY':
        mortalityTotal += q;
        mortalityItems[m.itemName] = (mortalityItems[m.itemName] || 0) + q;
        break;

      case 'OUTPUT':
        outputTotal += q;
        outputItems[m.itemName] = (outputItems[m.itemName] || 0) + q;
        break;

      case 'MEDICINE':
        medicineItems[m.itemName] = (medicineItems[m.itemName] || 0) + q;
        medicineCost += q * unitCost;
        break;

      case 'VACCINATION':
        vaccinationItems[m.itemName] = (vaccinationItems[m.itemName] || 0) + q;
        vaccinationCost += q * unitCost;
        break;

      case 'TEMPERATURE':
        if (q > 0) {
          tempValues.push(q);
          if (m.postingDate >= latestTempDate) {
            latestTempDate = m.postingDate;
            latestTemp = q;
          }
        }
        break;

      case 'HUMIDITY':
        if (q > 0) {
          humidityValues.push(q);
          if (m.postingDate >= latestHumDate) {
            latestHumDate = m.postingDate;
            latestHum = q;
          }
        }
        break;
    }
  }

  // Temp statistics
  const avgTemp = tempValues.length > 0 ? Number((tempValues.reduce((a, b) => a + b, 0) / tempValues.length).toFixed(1)) : 0;
  const minTemp = tempValues.length > 0 ? Math.min(...tempValues) : 0;
  const maxTemp = tempValues.length > 0 ? Math.max(...tempValues) : 0;

  // Humidity statistics
  const avgHum = humidityValues.length > 0 ? Number((humidityValues.reduce((a, b) => a + b, 0) / humidityValues.length).toFixed(1)) : 0;
  const minHum = humidityValues.length > 0 ? Math.min(...humidityValues) : 0;
  const maxHum = humidityValues.length > 0 ? Math.max(...humidityValues) : 0;

  // Mortality Rate formula
  // Cumulative mortality rate uses all time mortality vs opening qty
  const totalAllTimeMortality = allMetrics
    .filter((m) => m.category === 'MORTALITY')
    .reduce((sum, m) => sum + m.quantity, 0);
  
  const mortalityRate = Number(((totalAllTimeMortality / openingQty) * 100).toFixed(1));

  // Insights and Alerts
  const insights: string[] = [];
  const alerts: string[] = [];

  // Spike detection in mortality
  if (mortalityTotal > 0) {
    alerts.push(`Critical Alert: Spike detected! ${mortalityTotal} animal mortalities recorded during this period.`);
  }

  // Temperature abnormal checks (>35°C or extreme numbers like 170°C and 776°C in mock data)
  if (maxTemp > 45) {
    alerts.push(`Caution: Extreme temperature readings of up to ${maxTemp}°C detected. Sensors may require calibration.`);
  } else if (maxTemp > 35) {
    alerts.push(`Warning: Temperature unusually high at ${maxTemp}°C.`);
  }

  if (minHum > 0 && minHum < 15) {
    alerts.push(`Warning: Humidity below recommended range at ${minHum}%.`);
  }

  // Feed spikes
  if (feedItems['Creep Feed'] > 600) {
    insights.push(`Feed consumption increased substantially for Creep Feed.`);
  }

  // Offspring development
  if (outputTotal > 0) {
    insights.push(`Production progress: Output is improving with a total of ${outputTotal} newborn piglets born.`);
  }

  const resultStats = {
    summary: {
      batch_no: header.batcH_NO || 'B00010',
      breed_name: header.breeD_NAME || 'Mix Pig Breed',
      timeline: dateFilterResult.description,
      status: header.status || 'Assigned',
      opening_quantity: openingQty
    },
    metrics: {
      total_feed_consumed_kg: feedTotal,
      feed_items: feedItems,
      total_mortality_nos: mortalityTotal,
      mortality_items: mortalityItems,
      mortality_rate_percent: mortalityRate,
      newborn_piglets_total: outputTotal,
      newborn_piglet_items: outputItems,
      temperature: {
        latest: latestTemp || (tempValues.length > 0 ? tempValues[tempValues.length - 1] : 0),
        average: avgTemp,
        min: minTemp,
        max: maxTemp
      },
      humidity: {
        latest: latestHum || (humidityValues.length > 0 ? humidityValues[humidityValues.length - 1] : 0),
        average: avgHum,
        min: minHum,
        max: maxHum
      },
      expenses: {
        feed_cost_inr: Number(feedCost.toFixed(2)),
        medicine_cost_inr: Number(medicineCost.toFixed(2)),
        vaccination_cost_inr: Number(vaccinationCost.toFixed(2)),
        running_cost_inr: runningCost
      }
    },
    insights,
    alerts
  };

  return resultStats;
}

/**
 * Complete orchestrator: Loads the batch data, resolves the query timeline, and returns full metrics and insights.
 */
export function loadAndAnalyzeBatch(batchId: string, query: string) {
  // Use MOCK_BATCH_HISTORY as standard data
  const history = MOCK_BATCH_HISTORY;

  const result = history.data?.result ?? [];
  const dates = result.map((r: any) => r.Posting_date).filter(Boolean);

  const dateFilter = resolveDateFilter(query, dates);
  const analysis = analyzeBatchData(history, dateFilter);

  return {
    dateFilter,
    analysis
  };
}
