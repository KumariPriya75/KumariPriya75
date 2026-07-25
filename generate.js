#!/usr/bin/env node
// Builds an SVG of a bug crawling over the contribution graph, eating each square as it goes.

const fs = require('fs');
const path = require('path');

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

async function fetchContributions(token, username) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: QUERY, variables: { login: username } })
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

function levelFromCount(count, max) {
  if (count === 0) return 0;
  const ratio = count / Math.max(max, 1);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function buildSvg(weeks, palette) {
  const CELL = 11;
  const GAP = 3;
  const STEP = CELL + GAP;
  const PADDING = 20;
  const cols = weeks.length;
  const rows = 7;

  const width = PADDING * 2 + cols * STEP;
  const height = PADDING * 2 + rows * STEP;

  let maxCount = 0;
  weeks.forEach(w => w.contributionDays.forEach(d => {
    if (d.contributionCount > maxCount) maxCount = d.contributionCount;
  }));

  const cells = [];
  weeks.forEach((week, colIdx) => {
    week.contributionDays.forEach((day, rowIdx) => {
      cells.push({
        col: colIdx,
        row: rowIdx,
        count: day.contributionCount,
        level: levelFromCount(day.contributionCount, maxCount),
        date: day.date
      });
    });
  });

  // walk down one column, up the next, so the bug moves in a zigzag
  const order = [];
  for (let c = 0; c < cols; c++) {
    const colCells = cells.filter(cell => cell.col === c);
    if (c % 2 === 0) {
      order.push(...colCells);
    } else {
      order.push(...colCells.slice().reverse());
    }
  }

  const totalCells = order.length;
  const totalDuration = Math.max(20, Math.min(60, totalCells / 10));
  const perCell = totalDuration / totalCells;

  function cx(col) { return PADDING + col * STEP + CELL / 2; }
  function cy(row) { return PADDING + row * STEP + CELL / 2; }

  let rectsSvg = '';
  order.forEach((cell, i) => {
    const x = PADDING + cell.col * STEP;
    const y = PADDING + cell.row * STEP;
    const beginTime = (i * perCell).toFixed(3);
    const eatDuration = Math.min(0.6, perCell * 0.8).toFixed(3);
    const startColor = palette.levels[cell.level];
    const eatenColor = palette.eaten;

    const animate = cell.level > 0
      ? `<animate attributeName="fill" begin="${beginTime}s" dur="${eatDuration}s" fill="freeze" values="${startColor};${eatenColor}" />
      <animate attributeName="rx" begin="${beginTime}s" dur="${eatDuration}s" fill="freeze" values="2;5" />`
      : '';

    rectsSvg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${CELL}" height="${CELL}" rx="2" fill="${startColor}">${animate}</rect>\n`;
  });

  const pathPoints = order.map(cell => `${cx(cell.col).toFixed(1)},${cy(cell.row).toFixed(1)}`);
  const motionPath = `M ${pathPoints[0]} ` + pathPoints.slice(1).map(p => `L ${p}`).join(' ') + ` L ${pathPoints[0]}`;

  const bugSvg = `
  <g id="bug">
    <ellipse cx="0" cy="0" rx="5.5" ry="4" fill="${palette.bugBody}" stroke="${palette.bugOutline}" stroke-width="0.6"/>
    <circle cx="4.2" cy="0" r="2.4" fill="${palette.bugHead}" stroke="${palette.bugOutline}" stroke-width="0.5"/>
    <circle cx="-2" cy="-1.3" r="1.1" fill="${palette.bugSpot}"/>
    <circle cx="0.5" cy="1.4" r="1.1" fill="${palette.bugSpot}"/>
    <circle cx="-1" cy="1.6" r="0.9" fill="${palette.bugSpot}"/>
    <line x1="5.5" y1="-1" x2="7.5" y2="-2.6" stroke="${palette.bugOutline}" stroke-width="0.5"/>
    <line x1="5.5" y1="1" x2="7.5" y2="2.6" stroke="${palette.bugOutline}" stroke-width="0.5"/>
    <animateMotion dur="${totalDuration}s" repeatCount="indefinite" rotate="auto" path="${motionPath}" />
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" width="${width.toFixed(0)}" height="${height.toFixed(0)}">
  <rect x="0" y="0" width="${width.toFixed(0)}" height="${height.toFixed(0)}" fill="${palette.background}" rx="8"/>
  <g>
${rectsSvg}  </g>
  ${bugSvg}
</svg>`;
}

const LIGHT_PALETTE = {
  background: '#F5EEDD',
  levels: ['#E4D9BE', '#D8C77A', '#C6A94A', '#A67C2E', '#7A5218'],
  eaten: '#DDD0B0',
  bugBody: '#C0392B',
  bugHead: '#1B1B1B',
  bugSpot: '#1B1B1B',
  bugOutline: '#3B2A1F'
};

const DARK_PALETTE = {
  background: '#1B1712',
  levels: ['#33291C', '#5B4A22', '#8A6B24', '#C0932E', '#F2C14E'],
  eaten: '#241D14',
  bugBody: '#E94B3C',
  bugHead: '#151515',
  bugSpot: '#151515',
  bugOutline: '#0D0A07'
};

async function main() {
  const token = process.env.GH_TOKEN;
  const username = process.env.GH_USERNAME;

  if (!token || !username) {
    console.error('Missing GH_TOKEN or GH_USERNAME environment variables.');
    process.exit(1);
  }

  console.log(`Fetching contributions for ${username}...`);
  const weeks = await fetchContributions(token, username);

  const outDir = path.join(__dirname, 'dist');
  fs.mkdirSync(outDir, { recursive: true });

  const lightSvg = buildSvg(weeks, LIGHT_PALETTE);
  const darkSvg = buildSvg(weeks, DARK_PALETTE);

  fs.writeFileSync(path.join(outDir, 'bug-graph.svg'), lightSvg);
  fs.writeFileSync(path.join(outDir, 'bug-graph-dark.svg'), darkSvg);

  console.log('Done. Files written to dist/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
