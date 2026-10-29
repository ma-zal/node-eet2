import { DOMParser, onErrorStopParsing, type Document, type Element } from '@xmldom/xmldom';
import { EET_NS, SOAP_ENV_NS } from './namespaces.js';

/** Varování o propustné chybě (element `<Varovani>`). */
export interface Warning {
  kod_varov: number;
  message: string;
}

/** Obsah odpovědi EET, ať jde o potvrzení, chybu nebo SOAP Fault. */
export type ParsedResponse =
  | {
      kind: 'potvrzeni';
      uuid_zpravy?: string;
      dat_prij?: string;
      pok: string;
      test: boolean;
      warnings: Warning[];
    }
  | {
      kind: 'chyba';
      uuid_zpravy?: string;
      dat_odmit?: string;
      kod: number;
      message: string;
      test: boolean;
      warnings: Warning[];
    }
  | {
      kind: 'fault';
      message: string;
    };

/** Odpověď nelze zpracovat (není XML, chybí očekávané elementy apod.). */
export class InvalidResponseError extends Error {
  override name = 'InvalidResponseError';
}

/** Načte XML dokument; při chybě parsování vyhodí {@link InvalidResponseError}. */
export function parseXmlDocument(xml: string): Document {
  try {
    const document = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'text/xml');
    if (!document.documentElement) {
      throw new Error('prázdný dokument');
    }
    return document;
  } catch (error) {
    throw new InvalidResponseError(`Odpověď není platné XML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Rozebere odpověď systému EET (technická specifikace, kap. 3.4 a 3.5).
 * Podpis odpovědi se tady neověřuje, viz `verifyResponseSignature()`.
 *
 * @throws {InvalidResponseError} pokud odpověď neobsahuje `<Odpoved>` ani SOAP Fault.
 */
export function parseResponse(xml: string): ParsedResponse {
  const document = parseXmlDocument(xml);

  const odpovedElements = document.getElementsByTagNameNS(EET_NS, 'Odpoved');
  if (odpovedElements.length === 0) {
    const faults = document.getElementsByTagNameNS(SOAP_ENV_NS, 'Fault');
    if (faults.length > 0) {
      const fault = faults[0];
      const faultString = childByLocalName(fault, 'faultstring');
      const faultCode = childByLocalName(fault, 'faultcode');
      return {
        kind: 'fault',
        message: normalizeText(faultString?.textContent) || normalizeText(faultCode?.textContent) || 'SOAP Fault bez popisu',
      };
    }
    throw new InvalidResponseError('Odpověď neobsahuje element Odpoved ani SOAP Fault.');
  }
  if (odpovedElements.length > 1) {
    throw new InvalidResponseError('Odpověď obsahuje více elementů Odpoved.');
  }
  const odpoved = odpovedElements[0];

  const hlavicka = eetChild(odpoved, 'Hlavicka');
  const potvrzeni = eetChild(odpoved, 'Potvrzeni');
  const chyba = eetChild(odpoved, 'Chyba');
  const warnings = eetChildren(odpoved, 'Varovani').map((element) => ({
    kod_varov: parseInteger(element.getAttribute('kod_varov'), 'kod_varov'),
    message: normalizeText(element.textContent),
  }));
  const uuidZpravy = optionalAttribute(hlavicka, 'uuid_zpravy');

  if (potvrzeni) {
    const pok = potvrzeni.getAttribute('pok');
    if (!pok) {
      throw new InvalidResponseError('Potvrzení neobsahuje potvrzovací kód (pok).');
    }
    return omitUndefined({
      kind: 'potvrzeni' as const,
      uuid_zpravy: uuidZpravy,
      dat_prij: optionalAttribute(hlavicka, 'dat_prij'),
      pok,
      test: parseBoolean(potvrzeni.getAttribute('test')),
      warnings,
    });
  }
  if (chyba) {
    return omitUndefined({
      kind: 'chyba' as const,
      uuid_zpravy: uuidZpravy,
      dat_odmit: optionalAttribute(hlavicka, 'dat_odmit'),
      kod: parseInteger(chyba.getAttribute('kod'), 'kod'),
      message: normalizeText(chyba.textContent),
      test: parseBoolean(chyba.getAttribute('test')),
      warnings,
    });
  }
  throw new InvalidResponseError('Odpověď neobsahuje Potvrzeni ani Chyba.');
}

function eetChildren(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === node.ELEMENT_NODE) {
      const element = node as Element;
      if (element.namespaceURI === EET_NS && element.localName === localName) {
        result.push(element);
      }
    }
  }
  return result;
}

function eetChild(parent: Element, localName: string): Element | undefined {
  return eetChildren(parent, localName)[0];
}

function childByLocalName(parent: Element, localName: string): Element | undefined {
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === node.ELEMENT_NODE && (node as Element).localName === localName) {
      return node as Element;
    }
  }
  return undefined;
}

function optionalAttribute(element: Element | undefined, name: string): string | undefined {
  return element?.getAttribute(name) || undefined;
}

function parseBoolean(value: string | null): boolean {
  return value === 'true' || value === '1';
}

function parseInteger(value: string | null, name: string): number {
  if (value === null || !/^-?\d{1,3}$/.test(value)) {
    throw new InvalidResponseError(`Neplatná hodnota ${name} v odpovědi: "${value ?? ''}".`);
  }
  return Number.parseInt(value, 10);
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
