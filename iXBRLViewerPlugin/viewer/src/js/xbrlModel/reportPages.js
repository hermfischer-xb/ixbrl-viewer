// See COPYRIGHT.md for copyright information

/*
 * Report pages: a model's facts shown, group by group, as the pages of a financial report, for
 * a model with no document to show them on and no grid layouts to place them in -- an xBRL-XML
 * (not inline) filing, or facts loaded on their own.
 *
 * The pages follow the familiar form of SEC's EDGAR renderer ("R files"): a menu of the
 * model's groups by their groupTree category (Cover, Statements, Notes, Policies, Tables,
 * Details), and for each group a table whose rows are its presentation network's concepts,
 * labelled by each relationship's preferredLabel, and whose columns are the periods (and
 * member combinations) of its cube's facts, under "12 Months Ended" / "Jun. 30, 2025"
 * headings, with the units and scale in the title.  The rules are a small subset of the EDGAR
 * renderer's; the facts' own values and properties are in the viewer's inspector.
 *
 * DOM-free, so that it can be tested without a browser.
 */

const CORE_DIMENSIONS = new Set(['xbrl:concept', 'xbrl:period', 'xbrl:entity', 'xbrl:unit', 'xbrl:language']);
const ROOT = 'xbrl:rootSource';
const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
const SCALE_WORDS = { 3: 'Thousands', 6: 'Millions', 9: 'Billions' };
const DAY = 86400000;

/*
 * labels(name, labelType) -> the object's label of that type in the first language available,
 * else its standard label.
 */
export function labelsByType(model, languages = ['en']) {
    const byKey = new Map();
    for (const label of model.labels ?? []) {
        const key = `${label.forObject}\u0000${label.labelType ?? 'xbrl:label'}`;
        const rank = languages.indexOf(label.language);
        const current = byKey.get(key);
        if (current === undefined || (rank >= 0 && (current.rank < 0 || rank < current.rank))) {
            byKey.set(key, { rank, value: label.value });
        }
    }
    return (name, labelType = 'xbrl:label') =>
        byKey.get(`${name}\u0000${labelType}`)?.value ?? byKey.get(`${name}\u0000xbrl:label`)?.value;
}

/*
 * A fact's period as { start, end } (Date, UTC) for a duration, or { end } for an instant.
 * OIM periods are datetimes; a date at midnight is the end of the previous day, as a period
 * ends at the start of the day after.
 */
export function parsePeriod(period) {
    if (typeof period !== 'string' || period === '') {
        return null;
    }
    const parse = (text) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(text);
        return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))) : null;
    };
    const [a, b] = period.split('/');
    return b === undefined ? { end: parse(a) } : { start: parse(a), end: parse(b) };
}

// A period end shown as the day it ends: a midnight end is the previous day's end.
function displayDate(date) {
    const d = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0
        ? new Date(date.getTime() - DAY) : date;
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// A duration's length in whole months, so that a leap year's extra day does not reorder or
// split columns of the same length.
function durationMonths(period) {
    return Math.round((period.end - period.start) / DAY / 30.4375);
}

function durationHeading(period) {
    const months = durationMonths(period);
    if (months >= 1) {
        return `${months} Months Ended`;
    }
    return `${Math.round((period.end - period.start) / DAY)} Days Ended`;
}

function factDims(fact) {
    return Object.entries(fact.factDimensions ?? {}).filter(([d]) => !CORE_DIMENSIONS.has(d));
}

function dimsKey(dims) {
    return JSON.stringify([...dims].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

function childrenBySource(relationships) {
    const children = new Map();
    (relationships ?? []).forEach((rel, i) => {
        if (!children.has(rel.source)) {
            children.set(rel.source, []);
        }
        children.get(rel.source).push({ rel, i });
    });
    for (const list of children.values()) {
        list.sort((a, b) => ((a.rel.order ?? 0) - (b.rel.order ?? 0)) || (a.i - b.i));
    }
    return new Map([...children].map(([s, list]) => [s, list.map(x => x.rel)]));
}

function preferredLabelOf(rel) {
    return (rel?.properties ?? []).find(p => p.property === 'xbrl:preferredLabel')?.value;
}

/*
 * The menu and the reports.  Returns { menu: [{ label, reports: [index] }], reports, placedFacts },
 * where each report is { name, label, title, headerRows, rows } (see reportPage), and placedFacts
 * maps each fact name to the number of cells it is in.
 */
export function reportPages(model, options = {}) {
    const label = labelsByType(model, options.languages ?? ['en']);
    const facts = model.facts ?? [];
    const factsByConcept = new Map();
    for (const fact of facts) {
        const concept = fact.factDimensions?.['xbrl:concept'];
        if (!factsByConcept.has(concept)) {
            factsByConcept.set(concept, []);
        }
        factsByConcept.get(concept).push(fact);
    }
    const index = {
        concepts: new Map((model.concepts ?? []).map(c => [c.name, c])),
        dimensions: new Set((model.dimensions ?? []).map(d => d.name)),
        networks: new Map((model.networks ?? []).map(n => [n.name, n])),
        cubes: new Map((model.cubes ?? []).map(c => [c.name, c])),
        domainNetworks: new Map((model.domainNetworks ?? []).map(d => [d.name, d])),
        units: new Map((model.units ?? []).map(u => [u.name, u])),
        groups: new Map((model.groups ?? []).map(g => [g.name, g])),
        factsByConcept,
        label,
        memberLabel: enumerationLabels(model, label),
    };
    const contents = new Map();
    for (const gc of model.groupContents ?? []) {
        if (!contents.has(gc.groupName)) {
            contents.set(gc.groupName, []);
        }
        contents.get(gc.groupName).push(gc.forObject);
    }

    // The menu: the groupTree's top groups are its categories; a top group with contents of its
    // own is a report in an unnamed category.  With no groupTree, every group with contents is
    // a report, in the model's order.
    const menu = [];
    const reportGroups = [];
    const addReport = (groupName, category) => {
        if (!(contents.get(groupName) ?? []).some(n => index.networks.has(n) || index.cubes.has(n))) {
            return;
        }
        category.reports.push(reportGroups.length);
        reportGroups.push(groupName);
    };
    const groupTree = Array.isArray(model.groupTree) ? model.groupTree[0] : model.groupTree;
    if (groupTree?.relationships?.length) {
        const children = childrenBySource(groupTree.relationships);
        let loose = null;
        for (const rel of children.get(ROOT) ?? []) {
            const sub = children.get(rel.target) ?? [];
            if (sub.length > 0) {
                const category = { label: label(rel.target) ?? rel.target.split(':').pop(), reports: [] };
                const walk = (name) => {
                    addReport(name, category);
                    for (const child of children.get(name) ?? []) {
                        walk(child.target);
                    }
                };
                sub.forEach(child => walk(child.target));
                menu.push(category);
            }
            else {
                if (loose === null) {
                    loose = { label: 'Reports', reports: [] };
                    menu.push(loose);
                }
                addReport(rel.target, loose);
            }
        }
    }
    else {
        const category = { label: 'Reports', reports: [] };
        (model.groups ?? []).forEach(g => addReport(g.name, category));
        menu.push(category);
    }

    const placedFacts = new Map();
    const reports = reportGroups.map(groupName => {
        const report = reportPage(groupName, contents.get(groupName) ?? [], index);
        for (const row of report.rows) {
            for (const cell of row.cells ?? []) {
                for (const name of cell.facts) {
                    placedFacts.set(name, (placedFacts.get(name) ?? 0) + 1);
                }
            }
        }
        return report;
    });
    return { menu: menu.filter(c => c.reports.length > 0), reports, placedFacts };
}

// The label of an enumeration value, a member named by its namespace URI#local name.
function enumerationLabels(model, label) {
    const namespaces = model.namespaces ?? {};
    const prefixOf = new Map(Object.entries(namespaces).map(([prefix, uri]) => [uri, prefix]));
    const byLocal = new Map();
    for (const obj of [...(model.members ?? []), ...(model.concepts ?? [])]) {
        const local = obj.name.split(':').pop();
        if (!byLocal.has(local)) {
            byLocal.set(local, obj.name);
        }
    }
    return (value) => {
        const [uri, local] = value.split('#');
        const name = prefixOf.has(uri) ? `${prefixOf.get(uri)}:${local}` : byLocal.get(local);
        return name ? label(name) : undefined;
    };
}

/*
 * One group's page: { name, label, title, headerRows, rows }.
 *
 * Rows come from the group's parent-child network in order: a concept is a line, any other
 * object (an abstract) a heading; axes and their members are not rows (they are column
 * headings).  A line with no fact in the page, and a heading with no line beneath, is left
 * out, as the EDGAR renderer does.  Each row is { kind: 'heading'|'line', label, depth,
 * total, cells: [{ facts: [names], text, negative, numeric }] }.
 *
 * Columns are the distinct (period, members) of the facts on the lines that the group's
 * cube admits (no dimension the cube does not have): durations, longest first, then
 * instants, latest first; an instant at a duration's end with the same members is in that
 * duration's column, as is, on a periodStartLabel line, one at its start.
 */
export function reportPage(groupName, groupObjects, index) {
    const { label } = index;
    const network = groupObjects.map(n => index.networks.get(n))
        .find(n => n && (n.relationshipTypeName ?? 'xbrl:parent-child') === 'xbrl:parent-child');
    const cube = groupObjects.map(n => index.cubes.get(n)).find(c => c);
    const cubeDims = new Set((cube?.cubeDimensions ?? []).map(cd => cd.dimension).filter(d => !CORE_DIMENSIONS.has(d)));

    // the line and heading nodes, in presentation order
    const nodes = [];
    if (network) {
        const children = childrenBySource(network.relationships);
        const targets = new Set((network.relationships ?? []).map(r => r.target));
        const roots = children.has(ROOT)
            ? children.get(ROOT)
            : [...children.keys()].filter(s => !targets.has(s)).map(s => ({ source: ROOT, target: s }));
        const seen = new Set();
        const walk = (rel, depth) => {
            const name = rel.target;
            if (seen.has(name + '\u0000' + depth) || index.dimensions.has(name)) {
                return;  // an axis, with its domain and members, is a column heading
            }
            seen.add(name + '\u0000' + depth);
            const preferred = preferredLabelOf(rel);
            nodes.push({
                name, depth, preferred,
                kind: index.concepts.has(name) ? 'line' : 'heading',
                label: label(name, preferred ?? 'xbrl:label') ?? name.split(':').pop(),
            });
            for (const child of children.get(name) ?? []) {
                walk(child, depth + 1);
            }
        };
        roots.forEach(rel => walk(rel, 0));
    }
    else {
        // a cube with no network: the concepts of its concept domain, in the domain's order
        const conceptDomain = index.domainNetworks.get(
            (cube?.cubeDimensions ?? []).find(cd => cd.dimension === 'xbrl:concept')?.domainNetwork);
        const concepts = new Set((conceptDomain?.relationships ?? []).map(r => r.target).filter(n => index.concepts.has(n)));
        concepts.forEach(name => nodes.push({ name, depth: 0, kind: 'line', label: label(name) ?? name.split(':').pop() }));
    }

    // the facts of the page: on a line, with no dimension the cube does not have
    const lineConcepts = new Set(nodes.filter(n => n.kind === 'line').map(n => n.name));
    const pageFacts = [];
    for (const concept of lineConcepts) {
        for (const fact of index.factsByConcept.get(concept) ?? []) {
            if (factDims(fact).every(([d]) => cubeDims.has(d))) {
                pageFacts.push(fact);
            }
        }
    }

    const scales = unitScales(pageFacts, index);
    if (TRANSPOSED_ROLES.test(index.groups.get(groupName)?.groupURI ?? '')) {
        return transposedPage(groupName, nodes, pageFacts, scales, index);
    }
    const columns = pageColumns(pageFacts);

    // rows, with each line's facts in their columns
    const rows = nodes.map(node => {
        if (node.kind !== 'line') {
            return { ...node };
        }
        const negated = /negated/i.test(node.preferred ?? '');
        const startLine = /periodStart/i.test(node.preferred ?? '');
        const cells = columns.map(col => ({ facts: [], text: '', numeric: false, negative: false, col }));
        for (const fact of index.factsByConcept.get(node.name) ?? []) {
            const period = parsePeriod(fact.factDimensions['xbrl:period']);
            const key = dimsKey(factDims(fact));
            if (!period || !factDims(fact).every(([d]) => cubeDims.has(d))) {
                continue;
            }
            const i = columns.findIndex(col => col.dimsKey === key && (
                period.start
                    ? col.start?.getTime() === period.start.getTime() && col.end.getTime() === period.end.getTime()
                    : (col.start && startLine
                        ? col.start.getTime() === period.end.getTime()
                        : col.end.getTime() === period.end.getTime() && (!col.start || !startLine))));
            if (i >= 0) {
                cells[i].facts.push(fact.name);
                if (cells[i].facts.length === 1) {
                    Object.assign(cells[i], cellValue(fact, negated, scales, index, index.concepts.get(node.name)));
                }
            }
        }
        cells.forEach(c => delete c.col);
        return { ...node, total: /total/i.test(node.preferred ?? ''), cells };
    });

    // a line with no fact is not shown, nor a heading with no line beneath it
    const shown = rows.map(r => r.kind === 'line' && r.cells.some(c => c.facts.length > 0));
    for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].kind === 'heading') {
            for (let j = i + 1; j < rows.length && rows[j].depth > rows[i].depth; j++) {
                if (shown[j]) {
                    shown[i] = true;
                    break;
                }
            }
        }
    }
    const pageRows = rows.filter((_, i) => shown[i]);

    applyCurrencySymbols(pageRows, columns.length);

    const groupLabel = label(groupName) ?? groupName.split(':').pop();
    return {
        name: groupName,
        label: groupLabel,
        title: scales.heading ? `${groupLabel} - ${scales.heading}` : groupLabel,
        headerRows: headerRows(columns, label),
        columns: columns.map(c => ({ period: c.period, members: c.dims })),
        rows: pageRows,
    };
}

/*
 * Roles the EDGAR renderer lays out with the concepts across and the members (and period) down,
 * as its Embedding.generateStandardEmbeddedCommandsFromPresentationGroup does: resource extraction
 * payments (Form SD), filing fee tables, share repurchase details.
 */
const TRANSPOSED_ROLES = /\/rxp\/role\/(Detail|ByCategory|ByProject|ByGovernment)$|\/ffd\/main\/role\/(feesOffering|feesOffset|feesByCmbdPrspcts)|ShareRepurchase.*Detail/i;

/*
 * A transposed page: a column per line concept (with a fact on the page), a row per member
 * combination (and period, when there is more than one) in the order of the facts, the
 * combination with no members first as "Total".  The period, when there is one, is in the
 * title, as the EDGAR renderer puts it.
 */
function transposedPage(groupName, nodes, pageFacts, scales, index) {
    const { label } = index;
    const lines = nodes.filter(n => n.kind === 'line' && pageFacts.some(f => f.factDimensions['xbrl:concept'] === n.name));
    const periods = [...new Set(pageFacts.map(f => f.factDimensions['xbrl:period']))];
    const rowKey = (fact) => dimsKey(factDims(fact)) + (periods.length > 1 ? `|${fact.factDimensions['xbrl:period']}` : '');
    const rowsByKey = new Map();
    for (const fact of pageFacts) {
        const key = rowKey(fact);
        if (!rowsByKey.has(key)) {
            const dims = factDims(fact);
            const memberText = dims.map(([d, m]) => label(m) ?? String(m)).join(' | ');
            const period = parsePeriod(fact.factDimensions['xbrl:period']);
            const periodText = periods.length > 1 && period ? displayDate(period.end) : '';
            rowsByKey.set(key, { kind: 'line', depth: 0, dims, label: [memberText || 'Total', periodText].filter(Boolean).join(' | '),
                cells: lines.map(() => ({ facts: [], text: '', numeric: false, negative: false })) });
        }
        const li = lines.findIndex(l => l.name === fact.factDimensions['xbrl:concept']);
        const cell = rowsByKey.get(key).cells[li];
        cell.facts.push(fact.name);
        if (cell.facts.length === 1) {
            Object.assign(cell, cellValue(fact, /negated/i.test(lines[li].preferred ?? ''), scales, index, index.concepts.get(lines[li].name)));
        }
    }
    const rows = [...rowsByKey.values()].sort((a, b) => (a.dims.length === 0 ? 0 : 1) - (b.dims.length === 0 ? 0 : 1));
    rows.forEach(r => delete r.dims);
    applyCurrencySymbols(rows, lines.length);
    const groupLabel = label(groupName) ?? groupName.split(':').pop();
    const period = periods.length === 1 ? parsePeriod(periods[0]) : null;
    const periodText = period ? (period.start ? `${durationHeading(period).toLowerCase()} ${displayDate(period.end)}` : displayDate(period.end)) : null;
    return {
        name: groupName,
        label: groupLabel,
        title: [groupLabel, periodText, scales.heading].filter(Boolean).join(' - '),
        headerRows: [lines.map(l => ({ text: l.label, colSpan: 1 }))],
        columns: lines.map(l => ({ concept: l.name })),
        rows,
        transposed: true,
    };
}

/*
 * A currency symbol, as the EDGAR renderer shows it: down each column, on the first and the last
 * number of each run of numbers in the same unit.
 */
function applyCurrencySymbols(rows, columnCount) {
    for (let ci = 0; ci < columnCount; ci++) {
        let previous = null;
        for (const row of rows) {
            const cell = row.cells?.[ci];
            if (!cell?.numeric) {
                continue;
            }
            if (previous === null || previous.unit !== cell.unit) {
                if (previous !== null) {
                    previous.showSymbol = true;
                }
                cell.showSymbol = true;
            }
            previous = cell;
        }
        if (previous !== null) {
            previous.showSymbol = true;
        }
    }
    for (const row of rows) {
        for (const cell of row.cells ?? []) {
            if (cell.showSymbol && cell.symbol) {
                cell.text = `${cell.symbol} ${cell.text}`;
            }
            delete cell.symbol;
            delete cell.showSymbol;
            delete cell.unit;
        }
    }
}

// The page's columns from its facts' periods and members (see reportPage).
function pageColumns(facts) {
    const byKey = new Map();
    const order = [];
    for (const fact of facts) {
        const period = parsePeriod(fact.factDimensions['xbrl:period']);
        if (!period?.end) {
            continue;
        }
        const dims = factDims(fact);
        const dk = dimsKey(dims);
        if (!order.includes(dk)) {
            order.push(dk);
        }
        const key = `${dk}|${period.start?.getTime() ?? ''}|${period.end.getTime()}`;
        if (!byKey.has(key)) {
            byKey.set(key, { dimsKey: dk, dims, start: period.start, end: period.end, period: fact.factDimensions['xbrl:period'] });
        }
    }
    let columns = [...byKey.values()];
    // an instant at the end of a duration with the same members is shown in that duration
    columns = columns.filter(c => c.start || !columns.some(d => d.start && d.dimsKey === c.dimsKey && d.end.getTime() === c.end.getTime()));
    // the no-member columns first, then each member combination in the order of the facts
    const dimsRank = (c) => (c.dims.length === 0 ? -1 : order.indexOf(c.dimsKey));
    columns.sort((a, b) =>
        (dimsRank(a) - dimsRank(b))
        || ((a.start ? 0 : 1) - (b.start ? 0 : 1))
        || (a.start && b.start ? durationMonths(b) - durationMonths(a) : 0)
        || (b.end - a.end));
    return columns;
}

/*
 * The heading rows: member combinations (when any column has members), duration lengths, and
 * dates.  Each heading cell is { text, colSpan }.
 */
function headerRows(columns, label) {
    const spans = (keyOf, textOf) => {
        const cells = [];
        columns.forEach(col => {
            const key = keyOf(col);
            const last = cells[cells.length - 1];
            if (last && last.key === key) {
                last.colSpan++;
            }
            else {
                cells.push({ key, text: textOf(col), colSpan: 1 });
            }
        });
        return cells.map(({ text, colSpan }) => ({ text, colSpan }));
    };
    const rows = [];
    if (columns.some(c => c.dims.length > 0)) {
        rows.push(spans(c => c.dimsKey, c => c.dims.map(([d, m]) => label(m) ?? String(m)).join(' | ')));
    }
    if (columns.some(c => c.start)) {
        rows.push(spans(c => `${c.dimsKey}|${c.start ? durationMonths(c) : 'i'}`,
            c => (c.start ? durationHeading(c) : '')));
    }
    rows.push(columns.map(c => ({ text: displayDate(c.end), colSpan: 1 })));
    return rows;
}

/*
 * The page's units and the scale its amounts are shown in: { heading, scaleOf(unit) }.  An
 * amount whose decimals are -6 for most of a unit's facts is shown in millions, as the EDGAR
 * renderer does, and the title says so ("USD ($) $ in Millions").
 */
function unitScales(facts, index) {
    const decimalsByUnit = new Map();
    for (const fact of facts) {
        const unit = fact.factDimensions['xbrl:unit'];
        const decimals = fact.factValues?.[0]?.decimals;
        if (unit === undefined || typeof decimals !== 'number') {
            continue;
        }
        if (!decimalsByUnit.has(unit)) {
            decimalsByUnit.set(unit, new Map());
        }
        const counts = decimalsByUnit.get(unit);
        counts.set(decimals, (counts.get(decimals) ?? 0) + 1);
    }
    const scale = new Map();
    const parts = [];
    let mainCurrency = null;
    for (const [unit, counts] of decimalsByUnit) {
        const decimals = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        const digits = decimals <= -3 ? Math.min(9, Math.floor(-decimals / 3) * 3) : 0;
        scale.set(unit, digits);
        const name = unitName(unit);
        if (mainCurrency === null && /^iso4217:/.test(unit)) {
            mainCurrency = unit;
        }
        parts.push(`${name.short} in ${SCALE_WORDS[digits] ?? 'Units'}`);
    }
    const heading = [mainCurrency ? unitName(mainCurrency).long : null, parts.join(', ')].filter(Boolean).join(' ');
    return { heading, scaleOf: (unit) => scale.get(unit) ?? 0 };
}

function unitName(unit) {
    const symbols = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
    const part = (u) => {
        const code = u.split(':').pop();
        return u.startsWith('iso4217:') ? (symbols[code] ?? code) : code;
    };
    const [num, den] = unit.split('/');
    const short = den ? `${part(num)} / ${part(den)}` : part(num);
    const long = unit.startsWith('iso4217:') && !den ? `${unit.split(':').pop()} (${part(unit)})` : short;
    return { short, long };
}

/*
 * A cell's text: a number scaled to the page's unit scale, grouped, with a negative (after a
 * negated label is applied) in parentheses; a date as a date; a member by its label; text
 * with its markup removed.
 */
function cellValue(fact, negated, scales, index, concept) {
    const fv = fact.factValues?.[0] ?? {};
    const unit = fact.factDimensions['xbrl:unit'];
    if (fv.value === undefined || fv.value === null) {
        return { text: (fact.properties ?? []).some(p => p.property === 'xbrl:nil') ? 'nil' : '' };
    }
    const value = String(fv.value);
    // numeric: it has a unit, or (pure, with the unit left out) a numeric data type
    const isNumber = value !== '' && !Number.isNaN(Number(value))
        && (unit !== undefined || /percent|pure|decimal|integer|float|double|shares|monetary/i.test(concept?.dataType ?? ''));
    if (isNumber && /percent/i.test(concept?.dataType ?? '')) {
        // a percent item is shown as a percentage, to its decimals less two
        let number = Number(value) * 100;
        if (negated) {
            number = -number;
        }
        const decimals = typeof fv.decimals === 'number' ? Math.max(0, fv.decimals - 2) : 2;
        const text = Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';
        return { text: number < 0 ? `(${text})` : text, numeric: true, negative: number < 0 };
    }
    if (isNumber) {
        const digits = unit !== undefined ? scales.scaleOf(unit) : 0;
        let number = Number(value) / 10 ** digits;
        if (negated) {
            number = -number;
        }
        const decimals = typeof fv.decimals === 'number' ? Math.max(0, fv.decimals + digits) : undefined;
        const text = Math.abs(number).toLocaleString('en-US', decimals !== undefined
            ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
            : { maximumFractionDigits: 10 });   // INF decimals: the value as reported
        // the currency of an amount, or of an amount per share
        const currency = /^iso4217:([A-Z]{3})(\/|$)/.exec(unit ?? '')?.[1];
        const symbol = currency ? unitName(`iso4217:${currency}`).short : undefined;
        return { text: number < 0 ? `(${text})` : text, numeric: true, negative: number < 0, symbol, unit };
    }
    const duration = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?$/.exec(value);
    if (duration && value !== 'P') {
        // an xs:duration as words, "5 years 6 months"
        const parts = [[duration[1], 'year'], [duration[2], 'month'], [duration[3], 'day']]
            .filter(([n]) => n !== undefined).map(([n, word]) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`);
        return { text: parts.join(' ') };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return { text: displayDate(new Date(`${value}T12:00:00Z`)) };
    }
    if (/^[A-Za-z_][\w.-]*:[\w.-]+$/.test(value)) {
        return { text: index.label(value) ?? value };
    }
    if (/^https?:\/\/\S+#\S+(\s+https?:\/\/\S+#\S+)*$/.test(value)) {
        // an enumeration's members, each named by namespace URI#local name
        return { text: value.split(/\s+/).map(v => index.memberLabel(v) ?? v.split('#').pop()).join(', ') };
    }
    if (value.includes('<')) {
        return { text: decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(), block: true };
    }
    return { text: value };
}

// The text of markup's character references (the cell's text is escaped again when written).
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
        if (ref[0] === '#') {
            const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return code === 160 ? ' ' : String.fromCodePoint(code);
        }
        return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
    });
}
