/*
 * Rendering for Today, Past day, Journey, First-year-complete and Settings.
 * Builds DOM nodes directly; user text only ever goes in via textContent.
 */
import './days.js';

const D = globalThis.NBDays;
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCALE = (typeof navigator !== 'undefined' && /^en\b/i.test(navigator.language || '')) ? navigator.language : 'en-GB';

/* ---------- DOM helpers ---------- */

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function icon(id, cls = 'icon') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/* ---------- Formatting ---------- */

function localDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function formatLongDate(dateStr) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(localDate(dateStr));
}

function formatShortDate(dateStr) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(localDate(dateStr));
}

function formatMonth(year, month) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1, 12));
}

function formatReadAt(iso) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' }).format(d);
  return `${date} at ${time}`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* ---------- Reading (Today and Past day) ---------- */

/** "Amara is 3 weeks old" / "Amara was 5 days old" / "The day Amara was born". */
function ageLine(birthDate, date, name, past) {
  const a = D.age(birthDate, date);
  if (!a) return null;
  const who = D.cleanName(name) || 'Your little one';
  if (a.days === 0) {
    return h('p', { class: 'age' }, past ? 'The day ' : '', h('strong', { text: who }), past ? ' was born' : ' was born today');
  }
  const tail = !past && a.milestone ? ' today' : '';
  return h('p', { class: 'age' }, h('strong', { text: who }), ` ${past ? 'was' : 'is'} ${a.text}${tail}`);
}

/**
 * model: { mode: 'today'|'past', n, date, entry, name, birthDate, status, read,
 *          missed, earlier (counts, today only), justRead }
 * status is a day state from NBDays.dayState.
 */
export function renderReading(container, model, { onMarkRead }) {
  const { mode, n, date, entry, name, status, read } = model;
  const headingId = `${mode}-heading`;
  const index = D.contentIndex(n);
  const cycle = D.cycleNumber(n);
  container.setAttribute('aria-labelledby', headingId);

  const nodes = [];

  if (mode === 'past') {
    nodes.push(h('a', { class: 'back-link', href: '#journey' }, icon('i-back'), 'Journey'));
  }

  nodes.push(h('header', { class: 'reading-head' },
    h('p', { class: 'eyebrow', text: formatLongDate(date) }),
    h('h1', { class: 'day-title', id: headingId, tabindex: '-1' },
      `Day ${index} `, h('span', { class: 'of', text: `of ${D.PLAN_LENGTH}` })),
    cycle > 1 ? h('p', { class: 'cycle', text: `Year ${cycle} · Day ${n} overall` }) : null,
    ageLine(model.birthDate, date, name, mode === 'past'),
    h('p', { class: 'theme', text: entry.theme }),
  ));

  if (mode === 'today' && (model.missed > 0 || model.earlier > 0)) {
    const text = model.missed > 0
      ? `You have ${plural(model.missed, 'day', 'days')} to catch up`
      : `${plural(model.earlier, 'earlier day', 'earlier days')} to read`;
    const cls = model.missed > 0 ? 'banner' : 'banner banner--soft';
    nodes.push(h('a', { class: cls, href: '#journey' }, h('span', { text }), icon('i-arrow')));
  }

  nodes.push(h('article', { class: 'card verse-card', 'aria-label': 'Verse' },
    h('blockquote', { class: 'verse' }, h('p', { text: entry.verse })),
    h('p', { class: 'ref', text: `${entry.ref}, WEB` }),
  ));

  const who = D.cleanName(name) || D.NAME_FALLBACK;
  nodes.push(h('article', { class: 'card prayer-card', 'aria-labelledby': `${mode}-prayer-label` },
    h('h2', { class: 'card-label', id: `${mode}-prayer-label`, text: `A prayer for ${who}` }),
    h('p', { class: 'prayer', text: D.fillName(entry.prayer, name) }),
  ));

  const action = h('div', { class: 'read-action' });
  const justRead = model.justRead === date;
  if (status === 'today' || status === 'missed' || status === 'earlier') {
    action.append(h('button', {
      class: 'btn btn-primary',
      type: 'button',
      'data-action': 'mark-read',
      onclick: (e) => { e.currentTarget.disabled = true; onMarkRead(date); },
    }, 'Mark as read'));
  } else if (status === 'read') {
    // Days from before joining can be read any time and still count as read.
    const readDate = read && D.localDateOf(read.readAt);
    let label = mode === 'today' ? 'Read today' : 'Read on the day';
    if (mode === 'past' && readDate && readDate > date) label = justRead ? 'Read' : `Read on ${formatReadAt(read.readAt)}`;
    action.append(readState(label, justRead, false, read));
  } else if (status === 'late') {
    const label = justRead ? 'Caught up' : `Read later, on ${formatReadAt(read.readAt)}`;
    action.append(readState(label, justRead, !justRead, read));
  }
  nodes.push(action);

  container.replaceChildren(...nodes);
}

function readState(label, justRead, late, read) {
  const attrs = {
    class: `read-state${late ? ' late' : ''}${justRead ? ' just-read' : ''}`,
    tabindex: '-1',
    'data-read-state': '',
  };
  if (read && read.readAt && !late) attrs.title = `Read ${formatReadAt(read.readAt)}`;
  return h('p', attrs, icon('i-check'), h('span', { text: label }));
}

/* ---------- First year complete ---------- */

export function renderComplete(container, { name, summary, birthday }, { onStartAgain, onKeepReading }) {
  container.setAttribute('aria-labelledby', 'complete-heading');
  const who = D.cleanName(name) || D.NAME_FALLBACK;
  // When Day 1 was the birthday, Day 366 is the first birthday.
  const title = birthday ? `Happy first birthday, ${who}!` : 'First year complete';
  const lede = birthday
    ? `A whole year of verses and prayers, from the day ${who} was born until today. Thank you for every one.`
    : `A whole year of verses and prayers for ${who}. Thank you for every one.`;
  container.replaceChildren(h('div', { class: 'stack complete' },
    icon('i-sprout', 'welcome-mark'),
    h('h1', { class: 'screen-title', id: 'complete-heading', tabindex: '-1', text: title }),
    h('p', { class: 'lede', text: lede }),
    h('div', { class: 'totals' },
      total(summary.read, summary.read === 1 ? 'day read' : 'days read'),
      total(summary.onTime, 'on the day'),
      total(summary.missed, 'missed'),
    ),
    h('div', { class: 'stack-s' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: onKeepReading }, 'Keep reading'),
      h('p', { class: 'hint', text: 'The plan repeats from Day 1 and your history is kept.' }),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: onStartAgain }, 'Start again from Day 1'),
      h('p', { class: 'hint', text: 'Starts a fresh year today. Keeps the name and birthday, clears the history.' }),
    ),
  ));
}

function total(value, label) {
  return h('div', { class: 'total' }, h('strong', { text: String(value) }), h('span', { text: label }));
}

/* ---------- Journey ---------- */

const STATE_LABEL = {
  read: 'read',
  late: 'read late',
  missed: 'missed',
  earlier: 'not read yet',
  today: 'today, not read yet',
};

function weekdayInitials() {
  const fmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'narrow' });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i, 12)));
}

export function renderJourney({ headingEl, summaryEl, monthsEl, legendEarlierEl }, { name, startDate, joined, today, reads, summary }) {
  headingEl.textContent = `${D.possessive(name)} journey`;
  const parts = [
    'Read ', h('strong', { text: String(summary.read) }),
    ' · Missed ', h('strong', { text: String(summary.missed) }),
    ' · Current streak ', h('strong', { text: plural(summary.streak, 'day', 'days') }),
  ];
  if (summary.earlier > 0) parts.push(' · Not yet read ', h('strong', { text: String(summary.earlier) }));
  summaryEl.replaceChildren(...parts);
  legendEarlierEl.hidden = summary.earlier === 0;

  const initials = weekdayInitials();
  const months = D.monthsForJourney(startDate, today).reverse(); // newest month first
  const frag = document.createDocumentFragment();

  for (const month of months) {
    const title = formatMonth(month.year, month.month);
    const headingId = `m-${month.year}-${month.month}`;
    const list = h('ol', { class: 'grid', 'aria-labelledby': headingId });
    for (let i = 0; i < month.lead; i++) list.append(h('li', { 'aria-hidden': 'true' }));
    for (const date of month.dates) {
      const n = D.dayNumber(startDate, date);
      const status = D.dayState(date, today, reads.get(date), joined);
      const isToday = date === today;
      const cls = ['day', `day--${status === 'today' ? 'today' : status}`];
      if (isToday && status !== 'today') cls.push('day--today');
      const label = `Day ${n}, ${formatShortDate(date)}, ${isToday && status === 'read' ? 'today, read' : STATE_LABEL[status]}`;
      const circle = h('span', { class: cls.join(' ') }, h('span', { 'aria-hidden': 'true', text: String(+date.slice(8)) }));
      if (status === 'read' || status === 'late') circle.append(icon('i-check', 'mark'));
      else if (status === 'missed') circle.append(h('span', { class: 'mark mark-dot', 'aria-hidden': 'true' }));
      list.append(h('li', null, h('a', {
        class: 'day-link',
        href: isToday ? '#today' : `#day/${n}`,
        'aria-label': label,
        'aria-current': isToday ? 'date' : null,
      }, circle)));
    }
    frag.append(h('section', { class: 'month' },
      h('h2', { id: headingId, text: title }),
      h('div', { class: 'weekdays', 'aria-hidden': 'true' }, initials.map((c) => h('span', { text: c }))),
      list,
    ));
  }
  monthsEl.replaceChildren(frag);
}
