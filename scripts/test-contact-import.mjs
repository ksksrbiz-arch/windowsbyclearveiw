// Contact import for the new-job form: vCard parsing (iPhone, Android, older 2.1 exports,
// address-book files, hostile input), the browser Contact Picker mapping, and the contract
// between the parser and the page (field names, hooks). No network, no DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONTACT_FIELDS,
  MAX_VCARDS,
  describeContact,
  fromPickerContact,
  parseVcards,
} from '../src/lib/contact-import.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
let groups = 0;
const ok = (fn) => {
  fn();
  groups++;
};

// ── iPhone export (vCard 3.0): groups, typed phones, escaped address ───────
ok(() => {
  const card = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PRODID:-//Apple Inc.//iPhone OS 17.5//EN',
    'N:Rivera;Pat;;;',
    'FN:Pat Rivera',
    'ORG:Rivera Builders;',
    'item1.EMAIL;type=INTERNET;type=pref:pat@example.com',
    'item1.X-ABLabel:_$!<Work>!$_',
    'TEL;type=WORK;type=VOICE:(503) 555-0100',
    'TEL;type=CELL;type=VOICE;type=pref:+1 (360) 555-0123',
    'item2.ADR;type=HOME;type=pref:;;123 Main St\\, Unit 4;Canby;OR;97013;USA',
    'END:VCARD',
    '',
  ].join('\r\n');
  assert.deepEqual(parseVcards(card), [
    { name: 'Pat Rivera', phone: '+1 (360) 555-0123', email: 'pat@example.com', address: '123 Main St, Unit 4', city: 'Canby' },
  ]);
});

// ── Android / RFC 6350 (vCard 4.0): folded lines, tel: URI, no FN ──────────
ok(() => {
  const card = [
    'BEGIN:VCARD',
    'VERSION:4.0',
    'N:Lee;Dana;Q.;Dr.;Jr.',
    'TEL;TYPE=home;VALUE=uri:tel:+1-503-555-0188',
    'EMAIL:dana.lee',
    'EMAIL:dana@example.org',
    'NOTE:This is a very long note that should be folded by the exporter so that',
    '  the parser has to unfold it without losing the space',
    'ADR;TYPE=work:;Suite 9;500 Oak Ave;Vancouver;WA;98660;US',
    'END:VCARD',
  ].join('\n');
  const [contact] = parseVcards(card);
  assert.equal(contact.name, 'Dr. Dana Q. Lee Jr.', 'builds the name from N when FN is missing');
  assert.equal(contact.phone, '+1-503-555-0188', 'strips the tel: prefix');
  assert.equal(contact.email, 'dana@example.org', 'skips an invalid email and takes the next valid one');
  assert.equal(contact.address, 'Suite 9, 500 Oak Ave');
  assert.equal(contact.city, 'Vancouver');
});

// ── vCard 2.1 from an older Android: quoted-printable UTF-8 ────────────────
ok(() => {
  const card = [
    'BEGIN:VCARD',
    'VERSION:2.1',
    'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mu=C3=B1oz;Jos=C3=A9;;;',
    'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jos=C3=A9 Mu=C3=B1oz',
    'TEL;CELL:503-555-0144',
    'ADR;HOME;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;;45 Elm St =',
    'Apt 2;Molalla;OR;97038;',
    'END:VCARD',
  ].join('\r\n');
  const [contact] = parseVcards(card);
  assert.equal(contact.name, 'José Muñoz');
  assert.equal(contact.phone, '503-555-0144');
  assert.equal(contact.address, '45 Elm St Apt 2', 'a quoted-printable soft line break is joined');
  assert.equal(contact.city, 'Molalla');
});

// ── Choosing among several numbers and cards ───────────────────────────────
ok(() => {
  const two = [
    'BEGIN:VCARD\nVERSION:3.0\nFN:First One\nTEL;TYPE=WORK:111 222 3333\nTEL;TYPE=CELL:444 555 6666\nEND:VCARD',
    'BEGIN:VCARD\nVERSION:3.0\nFN:Second Two\nTEL:777 888 9999\nEND:VCARD',
  ].join('\n');
  const cards = parseVcards(two);
  assert.equal(cards.length, 2, 'an address-book file yields every contact');
  assert.equal(cards[0].phone, '444 555 6666', 'a mobile number is preferred over a work line');
  assert.equal(cards[1].phone, '777 888 9999', 'with no mobile, the first number is used');
  assert.equal(describeContact(cards[0]), 'First One · 444 555 6666');
  assert.equal(describeContact({ name: '', phone: '', email: 'x@y.co', address: '', city: '' }), 'No name · x@y.co');
});

// ── Hostile and broken input never throws ──────────────────────────────────
ok(() => {
  for (const bad of ['', 'just some text', 'BEGIN:VCARD', 'BEGIN:VCARD\nEND:VCARD', null, undefined, 42, {}, '﻿BEGIN:VCARD\nEND:VCARD']) {
    assert.deepEqual(parseVcards(bad), [], `no contacts from ${String(bad)}`);
  }
  // A card with only junk properties is dropped rather than imported empty.
  assert.deepEqual(parseVcards('BEGIN:VCARD\nNOTE:hi\nTEL:abc\nEMAIL:nope\nEND:VCARD'), []);
  // A byte-order mark and mixed line endings are fine.
  assert.equal(parseVcards('﻿BEGIN:VCARD\r\nFN:Bom Test\rEND:VCARD\n')[0].name, 'Bom Test');
  // Script in a field stays plain text for the page to put in an input's value.
  assert.equal(parseVcards('BEGIN:VCARD\nFN:<img src=x onerror=alert(1)>\nEND:VCARD')[0].name, '<img src=x onerror=alert(1)>');
  // Lengths are capped; a huge file is bounded by MAX_VCARDS, not parsed forever.
  assert.equal(parseVcards(`BEGIN:VCARD\nFN:${'x'.repeat(5000)}\nEND:VCARD`)[0].name.length, 120);
  const many = Array.from({ length: MAX_VCARDS + 50 }, (_, i) => `BEGIN:VCARD\nFN:P${i}\nEND:VCARD`).join('\n');
  assert.equal(parseVcards(many).length, MAX_VCARDS);
  // An invalid percent sequence in quoted-printable does not throw.
  assert.equal(parseVcards('BEGIN:VCARD\nFN;ENCODING=QUOTED-PRINTABLE:Bad=ZZ =\nEND:VCARD')[0].name.includes('Bad'), true);
});

// ── Browser Contact Picker ─────────────────────────────────────────────────
ok(() => {
  assert.deepEqual(
    fromPickerContact({
      name: ['  Pat  Rivera '],
      tel: ['', '(360) 555-0123', '503 555 0100'],
      email: ['bad', 'pat@example.com'],
      address: [{ addressLine: ['123 Main St', 'Unit 4'], city: 'Canby', region: 'OR', postalCode: '97013' }],
    }),
    { name: 'Pat Rivera', phone: '(360) 555-0123', email: '', address: '123 Main St, Unit 4', city: 'Canby' },
    'picker: first non-empty value of each field; an invalid first email is not silently swapped',
  );
  assert.equal(fromPickerContact({ tel: ['+1 360 555 0123'] }).phone, '+1 360 555 0123', 'a number alone is enough');
  for (const empty of [null, undefined, {}, { name: [''], tel: [], email: [] }, 'x', 7, { tel: ['abc'] }]) assert.equal(fromPickerContact(empty), null);
});

// ── The page and the parser agree ──────────────────────────────────────────
ok(() => {
  const page = readFileSync(`${root}src/pages/internal/jobs/new.astro`, 'utf8');
  for (const field of Object.values(CONTACT_FIELDS)) assert.ok(page.includes(`name="${field}"`), `new.astro has no input named ${field}`);
  for (const hook of ['data-contact-pick', 'data-contact-file', 'data-contact-status', 'data-contact-choose']) assert.ok(page.includes(hook), `new.astro is missing ${hook}`);
  assert.ok(page.includes("'ContactsManager' in window") && /contacts\.select\(/.test(page), 'the page offers the Contact Picker only where the browser has it');
  assert.ok(/data-contact-pick[^>]*\shidden/.test(page), 'the picker button starts hidden so unsupported browsers never see a dead button');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(page.match(/<script>[\s\S]*<\/script>/)?.[0] ?? ''), 'imported text is never written as HTML');
  assert.ok(!/fetch\([^)]*contact/i.test(page), 'contact data is not sent anywhere before the job is saved');
});

console.log(`contact import: ok (${groups} groups)`);
