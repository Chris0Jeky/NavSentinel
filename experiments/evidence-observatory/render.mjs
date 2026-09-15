import { createHash } from 'node:crypto';
import { REPORT_SCHEMA } from './model.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const encodedJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');

// All imported strings are assigned through textContent, never interpreted as HTML.
function application() {
  'use strict';
  const data = JSON.parse(document.getElementById('report-data').textContent);
  const $ = id => document.getElementById(id);
  let selected = data.cases[0]?.id ?? null;
  let cursor = 0;
  const make = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const human = value => String(value ?? 'Not recorded').replaceAll('_', ' ').replaceAll('-', ' ');
  const metric = (label, value) => {
    const n = make('div', undefined, 'metric');
    n.append(make('span', label, 'muted'), make('strong', value === null ? 'Not recorded' : String(value)));
    return n;
  };
  const detail = (title, content, open = false) => {
    const n = make('details'); n.open = open;
    n.append(make('summary', title), make('pre', JSON.stringify(content, null, 2)));
    return n;
  };
  function renderList() {
    const query = $('search').value.toLowerCase();
    const arm = $('arm-filter').value;
    const list = $('case-list'); list.replaceChildren();
    for (const c of data.cases) {
      if ((arm && c.arm !== arm) || !`${c.title} ${c.scenario} ${c.variant} ${c.arm} ${c.assessment}`.toLowerCase().includes(query)) continue;
      const b = make('button', undefined, 'case-button');
      b.setAttribute('aria-pressed', String(c.id === selected));
      b.append(make('span', `${human(c.arm)} · ${c.variant}`, 'eyebrow'), make('strong', c.title), make('span', human(c.assessment), 'case-status'));
      b.addEventListener('click', () => { selected = c.id; cursor = 0; renderList(); renderCase(); });
      list.append(b);
    }
    if (!list.children.length) list.append(make('p', 'No cases match this filter.'));
  }
  function renderCase() {
    const c = data.cases.find(c => c.id === selected);
    const panel = $('case-panel'); panel.hidden = !c;
    if (!c) return;
    $('case-title').textContent = c.title;
    $('case-subtitle').textContent = `${c.scenario} / ${c.variant} / ${human(c.arm)}`;
    $('intent').textContent = c.intent;
    $('boundary').textContent = c.boundary;
    $('verdict').textContent = human(c.assessment);
    $('verdict').dataset.state = c.assessment;
    $('claim').textContent = `Producer says: ${human(c.declaredOutcome)}. Viewer assessment and producer claim are separate.`;
    $('clock-note').textContent = c.mode === 'imported' ? 'Imported diagnostic: capture order only. Page clocks may reset; unknown time is not zero. A cumulative receipt may belong to an earlier phase.' :
      c.mode === 'demo' ? 'DEMONSTRATION — authored teaching data, not an executed browser campaign.' : 'Collector-monotonic order within this run. Imported producer attestations are not independently authenticated.';
    const metrics = $('case-metrics'); metrics.replaceChildren();
    for (const [label, value] of [['Harm receipts · this phase', c.facts.harmReceipts], ['Benign receipts · this phase', c.facts.benignReceipts], ['Legitimate completions', c.facts.legitimateCompletions], ['Cumulative sink receipts', c.facts.cumulativeReceipts]]) metrics.append(metric(label, value));
    const gaps = $('gaps'); gaps.replaceChildren();
    const values = [...c.gaps, ...c.warnings];
    if (!values.length) values.push('No structural gaps reported; this is still not independent authentication.');
    for (const value of values) gaps.append(make('li', human(value)));
    const provenance = $('provenance'); provenance.replaceChildren(detail('Artifact identity and input digest', { identity: c.identity, source: data.sources.find(s => s.id === c.sourceId), proof: c.proof }), detail('Comparison prerequisites', data.comparisons.filter(p => p.caseIds.includes(c.id))));
    const slider = $('scrub'); slider.max = String(Math.max(0, c.events.length - 1)); slider.value = String(Math.min(cursor, Number(slider.max))); slider.disabled = c.events.length === 0;
    const timeline = $('timeline'); timeline.replaceChildren();
    for (const [i, e] of c.events.entries()) {
      const b = make('button', undefined, 'event');
      b.dataset.lane = e.source;
      const t = e.elapsedMs === null ? 'time unknown' : `+${e.elapsedMs} ms`;
      b.append(make('span', `${e.sequence} · ${t}`, 'event-time'), make('span', e.source, 'lane-label'), make('span', human(e.kind), 'event-kind'));
      b.addEventListener('click', () => { cursor = i; $('scrub').value = String(i); renderEvent(); });
      timeline.append(b);
    }
    renderEvent();
  }
  function renderEvent() {
    const c = data.cases.find(c => c.id === selected);
    const e = c?.events[cursor];
    const node = $('event-detail'); node.replaceChildren();
    Array.from($('timeline').children).forEach((b, i) => b.setAttribute('aria-pressed', String(i === cursor)));
    $('step-label').textContent = e ? `Event ${cursor + 1} of ${c.events.length}` : 'No events captured';
    if (!e) return;
    node.append(make('h3', human(e.kind)), make('p', e.explanation), make('p', `Source: ${e.source} · Frame: ${e.frame} · Clock: ${e.clock}`, 'muted'));
    if (e.causes.length) {
      const p = make('p', 'Linked prior events: ');
      for (const id of e.causes) {
        const b = make('button', id, 'small');
        b.addEventListener('click', () => { const i = c.events.findIndex(v => v.id === id); if (i >= 0) { cursor = i; $('scrub').value = String(i); renderEvent(); } });
        p.append(b);
      }
      node.append(p);
    }
    node.append(detail('Structured event for agents', e, true));
  }
  $('search').addEventListener('input', renderList);
  $('arm-filter').addEventListener('change', renderList);
  $('scrub').addEventListener('input', () => { cursor = Number($('scrub').value); renderEvent(); });
  $('previous').addEventListener('click', () => { cursor = Math.max(0, cursor - 1); $('scrub').value = String(cursor); renderEvent(); });
  $('next').addEventListener('click', () => { const c = data.cases.find(c => c.id === selected); cursor = Math.min(Math.max(0, (c?.events.length ?? 1) - 1), cursor + 1); $('scrub').value = String(cursor); renderEvent(); });
  $('download').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'observatory-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('summary').append(metric('Imported cases', data.summary.caseCount), metric('Harm observed', data.summary.harmCases), metric('Inconclusive cases', data.summary.inconclusiveCases), metric('Rejected inputs', data.summary.rejectedCount));
  $('import-errors').append(detail('Import diagnostics and duplicate copies', { rejected: data.rejected, duplicates: data.duplicates, producerStatus: data.producerStatus }));
  renderList(); renderCase();
}
const css = `
:root{color-scheme:dark;--bg:#0c111b;--panel:#131d2c;--line:#293a50;--text:#ecf2fa;--muted:#abbdd4;--accent:#76dbbf;--warn:#ffcd7c;font:15px/1.55 system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text)}button,input,select{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:9px 14px}button:hover{border-color:var(--accent)}header{padding:30px 4vw 22px;border-bottom:1px solid var(--line);background:#101a28}.topline{display:flex;gap:20px;align-items:center;justify-content:space-between}h1{font-size:clamp(25px,3vw,38px);letter-spacing:-.03em;margin:5px 0}h2{font-size:25px;margin:4px 0 16px}h3{margin:0 0 8px;font-size:18px}p{margin:8px 0 16px}.eyebrow{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}.muted{color:var(--muted)}.notice{border-left:3px solid var(--warn);padding:12px 16px;background:#282318;color:#ffe0a8;max-width:1100px;margin:16px 0 0}.summary,.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:20px}.metric{display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.metric strong{font-size:24px}.metric span{font-size:12px}.layout{display:grid;grid-template-columns:300px minmax(0,1fr);max-width:1600px;margin:auto}aside{padding:24px;border-right:1px solid var(--line)}input[type=search],select{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);margin:5px 0 14px}label{display:block;color:var(--muted);font-size:13px}.case-button{display:flex;flex-direction:column;text-align:left;width:100%;gap:7px;margin:0 0 10px}.case-button[aria-pressed=true]{background:#173637;border-color:var(--accent)}.case-status{color:var(--muted);font-size:12px}.case-button strong{font-size:14px}main{padding:28px;min-width:0}.verdict{display:inline-block;padding:6px 12px;border:1px solid var(--warn);color:var(--warn);border-radius:6px;font-size:13px;margin-bottom:4px}.verdict[data-state=HARM_OBSERVED],.verdict[data-state=HARM_THEN_RECOVERY],.verdict[data-state=INVALID]{border-color:#ff9b98;color:#ffb3b1}.verdict[data-state=BOUNDED_PREVENTION_SUPPORTED]{border-color:var(--accent);color:var(--accent)}.explain-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:22px 0}.card{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:18px;margin:16px 0}.explain-grid .card{margin:0}.controls{display:flex;gap:12px;align-items:center;margin:14px 0}.controls input{flex:1;min-width:60px;accent-color:var(--accent)}.timeline-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.timeline{max-height:420px;overflow:auto;padding:3px}.event{display:grid;grid-template-columns:115px 80px minmax(0,1fr);width:100%;gap:10px;text-align:left;padding:10px;border-radius:6px;margin-bottom:7px}.event[aria-pressed=true]{outline:2px solid var(--accent);outline-offset:-2px}.event-time{font-size:12px;color:var(--muted)}.lane-label{font-size:12px;color:var(--accent)}.event-kind{font-size:13px;overflow-wrap:anywhere}.event[data-lane=sink] .lane-label{color:var(--warn)}.event[data-lane=page] .lane-label{color:#cfb5ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,monospace;color:#c5d4e6;max-height:380px;overflow:auto}details{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}summary{cursor:pointer;color:var(--muted)}li{margin-bottom:7px;overflow-wrap:anywhere}footer{padding:20px 4vw;border-top:1px solid var(--line);color:var(--muted);font-size:12px}.small{padding:4px 7px;margin:3px;font-size:12px}[hidden]{display:none!important}.empty{padding:25px}
@media(max-width:1100px){.layout{grid-template-columns:245px minmax(0,1fr)}.timeline-layout{grid-template-columns:1fr}.summary,.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.explain-grid{grid-template-columns:1fr}}
@media(max-width:720px){header{padding:20px}.topline{align-items:flex-start;flex-direction:column}.layout{display:block}aside{border-right:0;border-bottom:1px solid var(--line);padding:20px}.case-list{max-height:230px;overflow:auto}main{padding:20px}.event{grid-template-columns:92px 65px minmax(0,1fr);gap:5px}.controls{gap:7px}.controls button{padding:7px}.metric{padding:12px}.metric strong{font-size:20px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}@media print{body{background:white;color:black}.layout{display:block}aside,.controls,#download{display:none}pre,.muted{color:#333}.timeline{max-height:none}.card,.metric{background:white;break-inside:avoid}}
`;
export function renderReport(report) {
  if (report?.schema !== REPORT_SCHEMA) throw new Error('REPORT_SCHEMA_INVALID');
  const script = `(${application.toString()})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const policy = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const demo = report.cases.some(c => c.mode === 'demo');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><meta name="referrer" content="no-referrer"><title>NavSentinel · Evidence Observatory${demo ? ' · DEMO' : ''}</title><style>${css}</style></head>
<body><header><div class="topline"><div><div class="eyebrow">NavSentinel / Local evidence workbench</div><h1>Evidence Observatory</h1><p class="muted">What was attempted. What the defense reported. What actually reached the receiver.</p></div><button id="download" type="button">Save projected report JSON</button></div><div class="notice">${demo ? '<strong>DEMONSTRATION — not an executed browser run.</strong> ' : ''}A block message is not proof of prevention. Imported evidence remains diagnostic; this workbench never changes a policy or promotes a registry claim.</div><div id="summary" class="summary"></div></header>
<div class="layout"><aside><label for="search">Find a case, variant or assessment</label><input type="search" id="search" placeholder="Search evidence"><label for="arm-filter">Run arm</label><select id="arm-filter"><option value="">All arms</option><option>baseline</option><option>protected</option><option>benign</option><option>mixed</option><option>unknown</option></select><div id="case-list" class="case-list" aria-label="Evidence cases"></div><div id="import-errors"></div></aside>
<main><noscript><p>This interactive local viewer needs JavaScript. The adjacent report.json is readable without JavaScript.</p></noscript>${report.cases.length ? '' : '<div class="empty"><h2>No supported evidence imported</h2><p>Inspect import diagnostics; this is not a passing security result.</p></div>'}<section id="case-panel"><div id="case-subtitle" class="eyebrow"></div><h2 id="case-title"></h2><div id="verdict" class="verdict"></div><p id="claim" class="muted"></p><div class="explain-grid"><article class="card"><h3>What the attack is trying to do</h3><p id="intent"></p></article><article class="card"><h3>What counts as a consequence</h3><p id="boundary"></p></article></div><div id="case-metrics" class="metrics"></div>
<section class="card"><h3>Follow the evidence</h3><p id="clock-note" class="muted"></p><div class="controls"><button id="previous" aria-label="Previous event">Previous</button><label for="scrub" id="step-label">Event</label><input id="scrub" type="range" min="0" max="0" value="0"><button id="next" aria-label="Next event">Next</button></div><div class="timeline-layout"><div id="timeline" class="timeline" aria-label="Events in capture order"></div><div id="event-detail" aria-live="polite"></div></div></section><section class="card"><h3>What this evidence cannot yet establish</h3><ul id="gaps"></ul></section><section class="card" id="provenance"></section></section></main></div>
<footer>No network requests, uploaded browsing history, policy controls or executable imported content. All event labels are data, not instructions. Raw Playwright traces remain separate and can contain sensitive material.</footer>
<script type="application/json" id="report-data">${encodedJSON(report)}</script><script>${script}</script></body></html>\n`;
}
