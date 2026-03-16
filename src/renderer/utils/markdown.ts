import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

const ALLOWED_TAGS = new Set([
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul'
]);

const STRIP_CONTENT_TAGS = new Set([
  'button',
  'form',
  'iframe',
  'input',
  'link',
  'meta',
  'object',
  'script',
  'select',
  'style',
  'textarea'
]);

const GLOBAL_ATTRIBUTES = new Set(['title']);
const TAG_ATTRIBUTES = new Map<string, Set<string>>([
  ['a', new Set(['href'])],
  ['img', new Set(['alt', 'src'])],
  ['td', new Set(['colspan', 'rowspan'])],
  ['th', new Set(['colspan', 'rowspan'])]
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(rawValue: string, tagName: 'a' | 'img'): boolean {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return false;
  }

  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return true;
  }

  const compact = trimmed.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (compact.startsWith('http://') || compact.startsWith('https://') || compact.startsWith('mailto:')) {
    return true;
  }

  if (tagName === 'img' && compact.startsWith('data:image/')) {
    return true;
  }

  return false;
}

function sanitizeAttribute(
  element: HTMLElement,
  attrName: string,
  attrValue: string
): [string, string] | undefined {
  const tagName = element.tagName.toLowerCase();
  if (!GLOBAL_ATTRIBUTES.has(attrName) && !TAG_ATTRIBUTES.get(tagName)?.has(attrName)) {
    return undefined;
  }

  if ((attrName === 'href' || attrName === 'src') && !isSafeUrl(attrValue, tagName as 'a' | 'img')) {
    return undefined;
  }

  return [attrName, attrValue.trim()];
}

function sanitizeNode(node: Node, document: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const source = node as HTMLElement;
  const tagName = source.tagName.toLowerCase();

  if (STRIP_CONTENT_TAGS.has(tagName)) {
    return null;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    const fragment = document.createDocumentFragment();
    Array.from(source.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(child, document);
      if (sanitizedChild) {
        fragment.appendChild(sanitizedChild);
      }
    });
    return fragment;
  }

  const target = document.createElement(tagName);
  Array.from(source.attributes).forEach((attribute) => {
    const sanitized = sanitizeAttribute(target, attribute.name.toLowerCase(), attribute.value);
    if (!sanitized) {
      return;
    }
    const [name, value] = sanitized;
    target.setAttribute(name, value);
  });

  if (tagName === 'a' && target.getAttribute('href')) {
    target.setAttribute('target', '_blank');
    target.setAttribute('rel', 'noopener noreferrer nofollow');
  }

  if (tagName === 'img' && target.getAttribute('src')) {
    target.setAttribute('loading', 'lazy');
    target.setAttribute('referrerpolicy', 'no-referrer');
  }

  Array.from(source.childNodes).forEach((child) => {
    const sanitizedChild = sanitizeNode(child, document);
    if (sanitizedChild) {
      target.appendChild(sanitizedChild);
    }
  });

  return target;
}

export function renderMarkdownSafely(content: string): string {
  const source = content || '';

  try {
    const html = marked.parse(source) as string;
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
      return escapeHtml(source).replace(/\n/g, '<br />');
    }

    const parser = new DOMParser();
    const parsed = parser.parseFromString(html, 'text/html');
    const clean = document.implementation.createHTMLDocument('');

    Array.from(parsed.body.childNodes).forEach((child) => {
      const sanitizedChild = sanitizeNode(child, clean);
      if (sanitizedChild) {
        clean.body.appendChild(sanitizedChild);
      }
    });

    return clean.body.innerHTML;
  } catch {
    return escapeHtml(source).replace(/\n/g, '<br />');
  }
}
