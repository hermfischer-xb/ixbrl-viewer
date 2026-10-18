// See COPYRIGHT.md for copyright information

import { iframeReady } from './surfaceUtil.js';
import { reportPages } from './reportPages.js';
import { TableDocumentSurface } from './tableDocumentSurface.js';

/*
 * ReportDocumentSurface shows a model's facts as the pages of a financial report, one page per
 * group, with a menu of the groups by category -- the form SEC's EDGAR renderer gives an XBRL
 * filing ("R files").  It is for a model with facts but no document to show them on and no
 * grid layouts to place them in.  reportPages.js builds the pages; this writes them as one
 * document, a menu beside the pages, and binds each fact's cells as TableDocumentSurface does
 * (span[data-facts]), so selection, the inspector, search and next/previous work as on a
 * document.  A fact in no page is kept as a hidden fact.
 */
export class ReportDocumentSurface extends TableDocumentSurface {

    // documentSource is { model }: the xbrlModel object whose groups and facts are shown.
    async prepareDocument(iframe, documentSource, iv) {
        const model = documentSource.model ?? {};
        const pages = reportPages(model, { languages: this.languages });
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(documentHtml(pages));
        doc.close();
        this._doc = doc;
        await iframeReady(iframe);
    }
}

function documentHtml(pages) {
    const parts = [`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reports</title><style>${STYLE}</style></head><body><div class="rp-layout">`];
    parts.push('<nav class="rp-menu">');
    if (pages.reports.length === 0) {
        parts.push('<p>No fact of this model is in a report group.</p>');
    }
    for (const category of pages.menu) {
        parts.push(`<details open><summary>${escapeHtml(category.label)}</summary><ol>`);
        for (const i of category.reports) {
            parts.push(`<li><a href="#rp-${i}">${escapeHtml(pages.reports[i].label)}</a></li>`);
        }
        parts.push('</ol></details>');
    }
    parts.push('</nav><main class="rp-pages">');
    pages.reports.forEach((page, i) => {
        parts.push(`<section id="rp-${i}"><table class="report">`);
        const columnCount = page.columns.length;
        page.headerRows.forEach((cells, r) => {
            parts.push('<tr>');
            if (r === 0) {
                parts.push(`<th class="tl" rowspan="${page.headerRows.length}"><div><strong>${escapeHtml(page.title)}</strong></div></th>`);
            }
            for (const cell of cells) {
                parts.push(`<th class="th"${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}><div>${escapeHtml(cell.text)}</div></th>`);
            }
            parts.push('</tr>');
        });
        if (columnCount === 0) {
            parts.push('<tr><td class="pl">No facts</td></tr>');
        }
        page.rows.forEach((row, r) => {
            const stripe = r % 2 === 0 ? 're' : 'ro';
            parts.push(`<tr class="${stripe}${row.total ? 'u' : ''}">`);
            const indent = row.depth > 0 ? ` style="padding-left: ${Math.min(row.depth, 6) * 0.6}em"` : '';
            const text = row.kind === 'heading' ? `<strong>${escapeHtml(row.label)}</strong>` : escapeHtml(row.label);
            parts.push(`<td class="pl"${indent}>${text}</td>`);
            for (let c = 0; c < columnCount; c++) {
                const cell = row.cells?.[c];
                if (!cell || cell.facts.length === 0) {
                    parts.push('<td class="text"></td>');
                    continue;
                }
                const cls = cell.numeric ? (cell.negative ? 'num' : 'nump') : 'text';
                const content = cell.block
                    ? `<div class="rp-block">${escapeHtml(cell.text)}</div>`
                    : escapeHtml(cell.text);
                parts.push(`<td class="${cls}"><span data-facts="${escapeHtml(JSON.stringify(cell.facts))}">${content}</span></td>`);
            }
            parts.push('</tr>');
        });
        parts.push('</table></section>');
    });
    parts.push('</main></div></body></html>');
    return parts.join('');
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The page styles follow the EDGAR renderer's report.css (public domain, 17 U.S.C. 105).
const STYLE = `
html, body { margin: 0; height: 100%; }
body { font: 13px system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2328; background: white; }
.rp-layout { display: grid; grid-template-columns: 280px 1fr; min-height: 100%; }
.rp-menu { position: sticky; top: 0; height: 100vh; overflow: auto; background: #f3f6fb; border-right: 1px solid #c8d3e6; padding: 8px 10px; box-sizing: border-box; font-size: 12px; }
.rp-menu summary { font-weight: 600; cursor: pointer; padding: 4px 0; color: #2f4497; }
.rp-menu ol { margin: 0 0 6px; padding-left: 1.6em; }
.rp-menu li { margin: 2px 0; }
.rp-menu a { color: #1f2328; text-decoration: none; }
.rp-menu a:hover { text-decoration: underline; }
.rp-pages { padding: 12px 16px; min-width: 0; }
.report { background-color: white; border: 2px solid #acf; color: black; font: normal 8pt Helvetica, Arial, sans-serif; margin-bottom: 2em; border-spacing: 2px; }
.report th { background-color: #acf; color: black; font-weight: bold; text-align: center; padding: 2px 4px; }
.report th.tl { text-align: left; vertical-align: top; width: 260px; }
.report .pl { text-align: left; vertical-align: top; white-space: normal; width: 260px; }
.report .re, .report .reu { background-color: #def; }
.report .ro, .report .rou { background-color: white; }
.report .reu td, .report .rou td { border-bottom: 1px solid black; }
.report .num, .report .nump { text-align: right; white-space: nowrap; }
.report .nump { padding-left: 2em; }
.report .text { vertical-align: top; }
.report .rp-block { max-height: 12em; max-width: 60em; overflow: auto; white-space: normal; }
`;
