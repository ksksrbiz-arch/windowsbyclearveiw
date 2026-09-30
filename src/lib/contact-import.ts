/**
 * Turns a contact from Mark's phone into the customer fields of a new job.
 *
 * Two sources, one result shape:
 *  - a .vcf (vCard) file, which every phone can produce, and
 *  - the browser Contact Picker, which only some browsers offer.
 *
 * Pure parsing with no DOM, no network and nothing stored: the page decides what
 * to do with the result, and nothing is saved until Mark saves the job. Only
 * erasable TypeScript is used so scripts/test-contact-import.mjs can import this
 * file directly (Node strips the types).
 */

export type ImportedContact = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
};

/** A vCard file is a few KB; anything this large is not a contact. */
export const MAX_VCARD_BYTES = 1_000_000;
/** More cards than this is an address-book export, not a single customer. */
export const MAX_VCARDS = 200;

const LIMITS = { name: 120, phone: 40, email: 160, address: 200, city: 80 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const squash = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function cleanPhone(value: string): string {
  const text = value.replace(/^tel:/i, '').replace(/[^\d+()\-.\s]/g, '');
  return squash(text, LIMITS.phone);
}

/** Decodes a vCard 2.1 quoted-printable value (older Android exports use it for any non-ASCII text). */
function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(value[i]));
    }
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

function unescapeValue(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, char: string) => (char === 'n' || char === 'N' ? ' ' : char));
}

/** Splits on semicolons that are not escaped, so "Smith\; Jones;Pat" stays two fields. */
function splitFields(value: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '\\' && i + 1 < value.length) {
      current += value[i] + value[i + 1];
      i++;
    } else if (value[i] === ';') {
      out.push(current);
      current = '';
    } else current += value[i];
  }
  out.push(current);
  return out;
}

type Property = { name: string; params: string[]; value: string };

function parseProperty(line: string): Property | null {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const name = rawName.split('.').pop()!.toUpperCase();
  const params = rawParams.map((param) => param.toUpperCase());
  let value = line.slice(colon + 1);
  if (params.some((param) => param.includes('QUOTED-PRINTABLE'))) value = decodeQuotedPrintable(value);
  return { name, params, value };
}

/** Joins folded lines: RFC 6350 folds (a leading space or tab) and vCard 2.1 quoted-printable soft breaks (a trailing "="). */
function unfold(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    if (previous !== undefined && /^[ \t]/.test(line)) out[out.length - 1] = previous + line.slice(1);
    else if (previous !== undefined && /QUOTED-PRINTABLE/i.test(previous) && previous.endsWith('=') && !/^\s*(BEGIN|END):VCARD\s*$/i.test(line)) out[out.length - 1] = previous.slice(0, -1) + line;
    else out.push(line);
  }
  return out;
}

const hasType = (params: string[], ...types: string[]) => params.some((param) => types.some((type) => param.includes(type)));

function contactFromCard(lines: string[]): ImportedContact | null {
  let formatted = '';
  let structured = '';
  let org = '';
  const phones: { number: string; mobile: boolean }[] = [];
  const emails: string[] = [];
  let adr: string[] | null = null;

  for (const line of lines) {
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === 'FN' && !formatted) formatted = unescapeValue(prop.value);
    else if (prop.name === 'N' && !structured) {
      const [family = '', given = '', additional = '', prefix = '', suffix = ''] = splitFields(prop.value).map(unescapeValue);
      structured = [prefix, given, additional, family, suffix].filter(Boolean).join(' ');
    } else if (prop.name === 'ORG' && !org) org = unescapeValue(splitFields(prop.value)[0] ?? '');
    else if (prop.name === 'TEL') {
      const number = cleanPhone(unescapeValue(prop.value));
      if (/\d/.test(number)) phones.push({ number, mobile: hasType(prop.params, 'CELL', 'MOBILE', 'IPHONE') });
    } else if (prop.name === 'EMAIL') {
      const email = squash(unescapeValue(prop.value), LIMITS.email);
      if (EMAIL.test(email)) emails.push(email);
    } else if (prop.name === 'ADR' && !adr) adr = splitFields(prop.value).map(unescapeValue);
  }

  const phone = (phones.find((entry) => entry.mobile) ?? phones[0])?.number ?? '';
  const street = adr ? [adr[1], adr[2]].map((part) => (part ?? '').trim()).filter(Boolean).join(', ') : '';
  const contact: ImportedContact = {
    name: squash(formatted || structured || org, LIMITS.name),
    phone,
    email: emails[0] ?? '',
    address: squash(street, LIMITS.address),
    city: squash(adr?.[3], LIMITS.city),
  };
  return contact.name || contact.phone || contact.email ? contact : null;
}

/**
 * Every usable contact in a vCard file (one card or an exported address book).
 * Never throws: text that is not vCard simply yields no contacts.
 */
export function parseVcards(text: string): ImportedContact[] {
  if (typeof text !== 'string' || !text) return [];
  const lines = unfold(text.replace(/^﻿/, ''));
  const cards: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') current = [];
    else if (upper === 'END:VCARD') {
      if (current) cards.push(current);
      current = null;
      if (cards.length >= MAX_VCARDS) break;
    } else if (current) current.push(line);
  }
  return cards.map(contactFromCard).filter((contact): contact is ImportedContact => contact !== null);
}

/** The shape the browser Contact Picker resolves with (every field is optional and may be empty). */
export type PickerContact = {
  name?: string[];
  tel?: string[];
  email?: string[];
  address?: { addressLine?: string[]; city?: string; region?: string; postalCode?: string }[];
};

export function fromPickerContact(picked: PickerContact | null | undefined): ImportedContact | null {
  if (!picked || typeof picked !== 'object') return null;
  const first = (values?: unknown[]): string => (Array.isArray(values) ? values.find((value) => typeof value === 'string' && value.trim()) ?? '' : '') as string;
  const address = Array.isArray(picked.address) ? picked.address[0] : undefined;
  const email = squash(first(picked.email), LIMITS.email);
  const phone = cleanPhone(first(picked.tel));
  const contact: ImportedContact = {
    name: squash(first(picked.name), LIMITS.name),
    phone: /\d/.test(phone) ? phone : '',
    email: EMAIL.test(email) ? email : '',
    address: squash(Array.isArray(address?.addressLine) ? address.addressLine.join(', ') : '', LIMITS.address),
    city: squash(address?.city, LIMITS.city),
  };
  return contact.name || contact.phone || contact.email ? contact : null;
}

/** Form field names (new job page) for each contact property. Changing one means changing jobs/new.astro too. */
export const CONTACT_FIELDS: Readonly<Record<keyof ImportedContact, string>> = {
  name: 'customerName',
  phone: 'customerPhone',
  email: 'customerEmail',
  address: 'customerAddress',
  city: 'customerCity',
};

/** One line to tell a person which contact they are looking at in a list. */
export function describeContact(contact: ImportedContact): string {
  return [contact.name || 'No name', contact.phone || contact.email].filter(Boolean).join(' · ');
}
