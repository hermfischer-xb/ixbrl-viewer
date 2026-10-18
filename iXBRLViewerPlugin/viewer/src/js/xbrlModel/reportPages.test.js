// See COPYRIGHT.md for copyright information

import { reportPages, parsePeriod } from './reportPages.js';

const fact = (name, concept, period, value, extra = {}) => ({
    name,
    factDimensions: { 'xbrl:concept': concept, 'xbrl:entity': 'cik:1', 'xbrl:period': period, ...(extra.dims ?? {}),
        ...(extra.unit ? { 'xbrl:unit': extra.unit } : {}) },
    factValues: [{ name: `${name}_fv`, value, ...(extra.decimals !== undefined ? { decimals: extra.decimals } : {}) }],
});

const FY25 = '2024-07-01T00:00:00/2025-07-01T00:00:00';
const FY24 = '2023-07-01T00:00:00/2024-07-01T00:00:00';
const Q4 = '2025-04-01T00:00:00/2025-07-01T00:00:00';

// An income statement and a balance sheet under one category, as the legacy loader writes them.
function model(facts) {
    return {
        concepts: [
            { name: 'ex:Revenue', dataType: 'xbrlr:monetary' }, { name: 'ex:Costs', dataType: 'xbrlr:monetary' },
            { name: 'ex:NetIncome', dataType: 'xbrlr:monetary' }, { name: 'ex:Cash', dataType: 'xbrlr:monetary' },
            { name: 'ex:TaxRate', dataType: 'dtr-types:percentItemType' },
        ],
        members: [{ name: 'ex:IncomeAbstract' }, { name: 'ex:SegmentA' }],
        dimensions: [{ name: 'ex:SegmentAxis' }],
        labels: [
            { forObject: 'ex:Revenue', labelType: 'xbrl:label', language: 'en', value: 'Revenue standard' },
            { forObject: 'ex:Revenue', labelType: 'xbrl:terseLabel', language: 'en', value: 'Revenue' },
            { forObject: 'ex:Costs', labelType: 'xbrl:label', language: 'en', value: 'Costs' },
            { forObject: 'ex:Costs', labelType: 'xbrl:negatedLabel', language: 'en', value: 'Less costs' },
            { forObject: 'ex:NetIncome', labelType: 'xbrl:totalLabel', language: 'en', value: 'Net income' },
            { forObject: 'ex:IncomeAbstract', labelType: 'xbrl:label', language: 'en', value: 'Income [Abstract]' },
            { forObject: 'ex:SegmentA', labelType: 'xbrl:label', language: 'en', value: 'Segment A [Member]' },
            { forObject: 'ex:Statements', labelType: 'xbrl:label', language: 'en', value: 'Financial Statements' },
            { forObject: 'ex:Income', labelType: 'xbrl:label', language: 'en', value: 'INCOME STATEMENT' },
            { forObject: 'ex:Balance', labelType: 'xbrl:label', language: 'en', value: 'BALANCE SHEET' },
        ],
        groupTree: { name: 'ex:tree', relationships: [
            { source: 'xbrl:rootSource', target: 'ex:Statements', order: 1 },
            { source: 'ex:Statements', target: 'ex:Income', order: 1 },
            { source: 'ex:Statements', target: 'ex:Balance', order: 2 },
        ] },
        groupContents: [
            { groupName: 'ex:Income', forObject: 'ex:IncomePre' }, { groupName: 'ex:Income', forObject: 'ex:IncomeCube' },
            { groupName: 'ex:Balance', forObject: 'ex:BalancePre' }, { groupName: 'ex:Balance', forObject: 'ex:BalanceCube' },
        ],
        networks: [
            { name: 'ex:IncomePre', relationshipTypeName: 'xbrl:parent-child', relationships: [
                { source: 'xbrl:rootSource', target: 'ex:IncomeAbstract' },
                { source: 'ex:IncomeAbstract', target: 'ex:SegmentAxis', order: 0 },
                { source: 'ex:IncomeAbstract', target: 'ex:Costs', order: 2,
                    properties: [{ property: 'xbrl:preferredLabel', value: 'xbrl:negatedLabel' }] },
                { source: 'ex:IncomeAbstract', target: 'ex:Revenue', order: 1,
                    properties: [{ property: 'xbrl:preferredLabel', value: 'xbrl:terseLabel' }] },
                { source: 'ex:IncomeAbstract', target: 'ex:NetIncome', order: 3,
                    properties: [{ property: 'xbrl:preferredLabel', value: 'xbrl:totalLabel' }] },
                { source: 'ex:IncomeAbstract', target: 'ex:TaxRate', order: 4 },
            ] },
            { name: 'ex:BalancePre', relationshipTypeName: 'xbrl:parent-child', relationships: [
                { source: 'xbrl:rootSource', target: 'ex:Cash' },
            ] },
        ],
        cubes: [
            { name: 'ex:IncomeCube', cubeDimensions: [{ dimension: 'xbrl:concept' }, { dimension: 'ex:SegmentAxis' }] },
            { name: 'ex:BalanceCube', cubeDimensions: [{ dimension: 'xbrl:concept' }] },
        ],
        facts,
    };
}

describe('parsePeriod', () => {
    test('an instant and a duration; a midnight end is kept as given', () => {
        expect(parsePeriod('2025-07-01T00:00:00').end.toISOString()).toBe('2025-07-01T00:00:00.000Z');
        const d = parsePeriod(FY25);
        expect(d.start.toISOString()).toBe('2024-07-01T00:00:00.000Z');
        expect(d.end.toISOString()).toBe('2025-07-01T00:00:00.000Z');
        expect(parsePeriod('')).toBeNull();
    });
});

describe('reportPages', () => {
    test('the menu comes from the groupTree; a page per group in its order', () => {
        const pages = reportPages(model([fact('f1', 'ex:Revenue', FY25, '100000000', { unit: 'iso4217:USD', decimals: -6 })]));
        expect(pages.menu).toEqual([{ label: 'Financial Statements', reports: [0, 1] }]);
        expect(pages.reports.map(r => r.label)).toEqual(['INCOME STATEMENT', 'BALANCE SHEET']);
    });

    test('rows follow the network order with preferred labels; an axis is not a row', () => {
        const pages = reportPages(model([
            fact('r', 'ex:Revenue', FY25, '281724000000', { unit: 'iso4217:USD', decimals: -6 }),
            fact('c', 'ex:Costs', FY25, '87831000000', { unit: 'iso4217:USD', decimals: -6 }),
            fact('n', 'ex:NetIncome', FY25, '193893000000', { unit: 'iso4217:USD', decimals: -6 }),
        ]));
        const page = pages.reports[0];
        expect(page.rows.map(r => [r.kind, r.label])).toEqual([
            ['heading', 'Income [Abstract]'], ['line', 'Revenue'], ['line', 'Less costs'], ['line', 'Net income'],
        ]);
        expect(page.rows[3].total).toBe(true);
        expect(page.title).toBe('INCOME STATEMENT - USD ($) $ in Millions');
    });

    test('amounts are scaled to the page, a negated label shows a negative, the currency on the first and last', () => {
        const page = reportPages(model([
            fact('r', 'ex:Revenue', FY25, '281724000000', { unit: 'iso4217:USD', decimals: -6 }),
            fact('c', 'ex:Costs', FY25, '87831000000', { unit: 'iso4217:USD', decimals: -6 }),
            fact('n', 'ex:NetIncome', FY25, '193893000000', { unit: 'iso4217:USD', decimals: -6 }),
        ])).reports[0];
        expect(page.rows.slice(1).map(r => r.cells[0].text)).toEqual(['$ 281,724', '(87,831)', '$ 193,893']);
        expect(page.rows[2].cells[0].negative).toBe(true);
    });

    test('columns: durations longest first, latest first, under month headings; members as column groups', () => {
        const page = reportPages(model([
            fact('a', 'ex:Revenue', FY24, '1', { unit: 'iso4217:USD', decimals: 0 }),
            fact('b', 'ex:Revenue', Q4, '2', { unit: 'iso4217:USD', decimals: 0 }),
            fact('c', 'ex:Revenue', FY25, '3', { unit: 'iso4217:USD', decimals: 0 }),
            fact('d', 'ex:Revenue', FY25, '4', { unit: 'iso4217:USD', decimals: 0, dims: { 'ex:SegmentAxis': 'ex:SegmentA' } }),
        ])).reports[0];
        expect(page.headerRows.map(row => row.map(c => `${c.text}${c.colSpan > 1 ? '*' + c.colSpan : ''}`))).toEqual([
            ['*3', 'Segment A [Member]'],
            ['12 Months Ended*2', '3 Months Ended', '12 Months Ended'],
            ['Jun. 30, 2025', 'Jun. 30, 2024', 'Jun. 30, 2025', 'Jun. 30, 2025'],
        ]);
        expect(page.rows[1].cells.map(c => c.facts)).toEqual([['c'], ['a'], ['b'], ['d']]);
    });

    test('a fact with a dimension its cube does not have is not on the page', () => {
        const pages = reportPages(model([
            fact('x', 'ex:Cash', '2025-07-01T00:00:00', '5', { unit: 'iso4217:USD', decimals: 0, dims: { 'ex:SegmentAxis': 'ex:SegmentA' } }),
            fact('y', 'ex:Cash', '2025-07-01T00:00:00', '6', { unit: 'iso4217:USD', decimals: 0 }),
        ]));
        const balance = pages.reports[1];
        expect(balance.rows[0].cells.map(c => c.facts)).toEqual([['y']]);
        expect(pages.placedFacts.has('x')).toBe(false);
    });

    test('a percent item is a percentage; a line with no fact, and a heading with none beneath, are left out', () => {
        const page = reportPages(model([
            fact('t', 'ex:TaxRate', FY25, '0.21', { decimals: 4 }),
        ])).reports[0];
        expect(page.rows.map(r => r.label)).toEqual(['Income [Abstract]', 'TaxRate']);
        expect(page.rows[1].cells[0].text).toBe('21.00%');
    });

    test('text blocks lose their markup and keep their characters', () => {
        const m = model([fact('tb', 'ex:Revenue', FY25, '<p>NOTE 1 &#8212; Policies&nbsp;&amp; more</p>')]);
        const cell = reportPages(m).reports[0].rows[1].cells[0];
        expect(cell.text).toBe('NOTE 1 — Policies & more');
        expect(cell.block).toBe(true);
    });

    test('an EDGAR-transposed role (Form SD payments): concepts across, members down, Total first', () => {
        const m = model([
            fact('p1', 'ex:Revenue', FY25, '5000', { unit: 'iso4217:USD', decimals: 0, dims: { 'ex:SegmentAxis': 'ex:SegmentA' } }),
            fact('p2', 'ex:Costs', FY25, '7000', { unit: 'iso4217:USD', decimals: 0 }),
            fact('p3', 'ex:Revenue', FY25, '9000', { unit: 'iso4217:USD', decimals: 0 }),
        ]);
        m.groups = [{ name: 'ex:Income', groupURI: 'http://xbrl.sec.gov/rxp/role/ByProject' }];
        const page = reportPages(m).reports[0];
        expect(page.transposed).toBe(true);
        expect(page.title).toBe('INCOME STATEMENT - 12 months ended Jun. 30, 2025 - USD ($) $ in Units');
        expect(page.headerRows).toEqual([[{ text: 'Revenue', colSpan: 1 }, { text: 'Less costs', colSpan: 1 }]]);
        expect(page.rows.map(r => [r.label, ...r.cells.map(c => c.text)])).toEqual([
            ['Total', '$ 9,000', '$ (7,000)'], ['Segment A [Member]', '$ 5,000', ''],
        ]);
    });
});

