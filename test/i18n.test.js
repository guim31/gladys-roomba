// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the texts of the code,
// the error descriptions, and the four documentation pages, which keep the
// same sections. German says "du", never the polite "Sie".
// Adapted from guim31/gladys-wled.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { TEXTS } from '../src/i18n.js';
import { ERROR_CODES, ERROR_MESSAGES, describeError } from '../src/roomba/errors.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres|Ihnen)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  section: 1000,
  message: 400,
  transport: 200,
  short: 40,
  featureName: 40,
  widgetButton: 24,
};

const sorted = (keys) => [...keys].sort();

function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key, parent) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key, parent));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : parent?.type === 'section' && key === 'description'
              ? MAX.section
              : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child, value);
    }
  };
  walk(root, 'manifest', null, null);
  return texts;
}

test('the configuration offers the four languages', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(sorted(Object.keys(TEXTS)), sorted(LANGS));
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 45, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language (a brand, not translated)', () => {
  assert.equal(typeof manifest.name, 'string');
  for (const widget of manifest.widgets) {
    assert.equal(new Set(Object.values(widget.label)).size, 1);
  }
});

// Tables written one language at a time: same keys everywhere, no empty text.
function tableProblems(name, pick, max, render = (value) => value) {
  const found = [];
  const reference = pick(TEXTS.en);
  for (const lang of LANGS) {
    const entries = pick(TEXTS[lang]) ?? {};
    if (
      JSON.stringify(sorted(Object.keys(entries))) !==
      JSON.stringify(sorted(Object.keys(reference)))
    ) {
      found.push(`${name}.${lang} does not have the keys of ${name}.en`);
    }
    for (const [key, value] of Object.entries(entries)) {
      const limit = typeof max === 'function' ? max(key) : max;
      found.push(...textProblems(render(value, key), `${name}.${lang}.${key}`, lang, limit));
    }
  }
  return found;
}

test('the texts of the code exist in every language', () => {
  const sample = (value) => {
    if (typeof value !== 'function') return value;
    return value.length >= 3
      ? value(2, 1, 'Dorita, Kitchen')
      : value.length === 2
        ? value('Dorita', true)
        : value('192.0.2.21');
  };
  const found = [
    ...tableProblems('features', (t) => t.features, MAX.featureName),
    ...tableProblems('runModes', (t) => t.runModes, MAX.short),
    ...tableProblems('states', (t) => ({ ...t.states }), MAX.short),
    ...tableProblems(
      'widget',
      (t) => t.widget,
      (key) =>
        ['pickRobot', 'unknownRobot'].includes(key)
          ? MAX.message
          : ['start', 'pause', 'resume', 'stop', 'dock'].includes(key)
            ? MAX.widgetButton
            : MAX.short,
    ),
    ...tableProblems('status', (t) => t.status, MAX.short),
    ...tableProblems('transport', (t) => t.transport, MAX.transport),
    ...tableProblems('toast', (t) => t.toast, MAX.short + 20),
    ...tableProblems('outcomes', (t) => t.outcomes, MAX.short),
    ...tableProblems('actions', (t) => t.actions, MAX.message, sample),
  ];
  assert.deepEqual(found, []);
  // The two forms of the "added" message.
  for (const lang of LANGS) {
    assert.notEqual(TEXTS[lang].actions.added('X', true), TEXTS[lang].actions.added('X', false));
  }
});

test('every error code is described in the four languages', () => {
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    assert.deepEqual(problems(value, `ERROR_MESSAGES.${key}`, MAX.short + 10), []);
  }
  for (const key of Object.values(ERROR_CODES)) {
    assert.ok(ERROR_MESSAGES[key], key);
  }
  assert.equal(describeError(17, 'fr'), 'Chemin bloqué (erreur 17)');
  assert.equal(describeError(0, 'es'), 'Ningún error');
  assert.equal(describeError(4242, 'de'), 'Roboterfehler (Fehler 4242)');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Light', fr: 'Éclairage', de: 'Licht' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Roboter', 'Ihre IP', 'mit Ihrem', 'Ihnen']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.actions[0].fields[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.equal(found.length, 1);
});

// --- Documentation -----------------------------------------------------------------

async function doc(lang) {
  return readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
}
const headings = (text, level) =>
  text.split('\n').filter((line) => line.startsWith(`${'#'.repeat(level)} `)).length;

test('the four documentation pages have the same sections', async () => {
  const counts = {};
  for (const lang of LANGS) {
    const text = await doc(lang);
    counts[lang] = [headings(text, 1), headings(text, 2), headings(text, 3)];
    assert.ok(text.length >= 3000, `docs/${lang}.md is too short`);
  }
  for (const lang of LANGS) {
    assert.deepEqual(counts[lang], counts.en, `docs/${lang}.md sections differ from docs/en.md`);
  }
  assert.ok(counts.en[1] >= 8, 'presentation, prerequisites, configuration... at least 8 sections');
});

test('the documentation says it was developed without the hardware, and German says du', async () => {
  const marks = {
    en: /without the hardware/i,
    fr: /sans le matériel/i,
    de: /ohne die Hardware/i,
    es: /sin el hardware/i,
  };
  for (const lang of LANGS) {
    assert.match(await doc(lang), marks[lang], lang);
  }
  assert.doesNotMatch(await doc('de'), POLITE_GERMAN);
});
