/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

type GlobalOptions = {
  browserNameForWorkarounds?: string;
};
let globalOptions: GlobalOptions = {};
export function setGlobalOptions(options: GlobalOptions) {
  globalOptions = options;
}
export function getGlobalOptions(): GlobalOptions {
  return globalOptions;
}

export function isInsideScope(scope: Node, element: Element | undefined): boolean {
  while (element) {
    if (scope.contains(element))
      return true;
    element = enclosingShadowHost(element);
  }
  return false;
}

export function enclosingElement(node: Node) {
  if (node.nodeType === 1 /* Node.ELEMENT_NODE */)
    return node as Element;
  return node.parentElement ?? undefined;
}

export function parentElementOrShadowHost(element: Element): Element | undefined {
  if (element.parentElement)
    return element.parentElement;
  if (!element.parentNode)
    return;
  if (element.parentNode.nodeType === 11 /* Node.DOCUMENT_FRAGMENT_NODE */ && (element.parentNode as ShadowRoot).host)
    return (element.parentNode as ShadowRoot).host;
}

export function enclosingShadowRootOrDocument(element: Element): Document | ShadowRoot | undefined {
  let node: Node = element;
  while (node.parentNode)
    node = node.parentNode;
  if (node.nodeType === 11 /* Node.DOCUMENT_FRAGMENT_NODE */ || node.nodeType === 9 /* Node.DOCUMENT_NODE */)
    return node as Document | ShadowRoot;
}

function enclosingShadowHost(element: Element): Element | undefined {
  while (element.parentElement)
    element = element.parentElement;
  return parentElementOrShadowHost(element);
}

// Assumption: if scope is provided, element must be inside scope's subtree.
export function closestCrossShadow(element: Element | undefined, css: string, scope?: Document | Element): Element | undefined {
  while (element) {
    const closest = element.closest(css);
    if (scope && closest !== scope && closest?.contains(scope))
      return;
    if (closest)
      return closest;
    element = enclosingShadowHost(element);
  }
}

export function getElementComputedStyle(element: Element, pseudo?: string): CSSStyleDeclaration | undefined {
  const cache = pseudo === '::before' ? cacheStyleBefore : pseudo === '::after' ? cacheStyleAfter : cacheStyle;
  if (cache && cache.has(element))
    return cache.get(element);
  const style = element.ownerDocument && element.ownerDocument.defaultView ? element.ownerDocument.defaultView.getComputedStyle(element, pseudo) : undefined;
  cache?.set(element, style);
  return style;
}

export function isElementStyleVisibilityVisible(element: Element, style?: CSSStyleDeclaration): boolean {
  style = style ?? getElementComputedStyle(element);
  if (!style)
    return true;
  // Element.checkVisibility checks for content-visibility and also looks at
  // styles up the flat tree including user-agent ShadowRoots, such as the
  // details element for example.
  // All the browser implement it, but WebKit has a bug which prevents us from using it:
  // https://bugs.webkit.org/show_bug.cgi?id=264733
  // @ts-ignore
  if (Element.prototype.checkVisibility && globalOptions.browserNameForWorkarounds !== 'webkit') {
    if (!element.checkVisibility())
      return false;
  } else {
    // Manual workaround for WebKit that does not have checkVisibility.
    const detailsOrSummary = element.closest('details,summary');
    if (detailsOrSummary !== element && detailsOrSummary?.nodeName === 'DETAILS' && !(detailsOrSummary as HTMLDetailsElement).open)
      return false;
  }
  if (style.visibility !== 'visible')
    return false;
  return true;
}

// Describes the element's position relative to the viewport
// 'visible' - element is at least partially within the viewport and not occluded
// 'visible:occluded' - element is in viewport but covered by another element
// 'offscreen:above' - element is completely above the viewport
// 'offscreen:below' - element is completely below the viewport
// 'offscreen:left' - element is completely to the left of the viewport
// 'offscreen:right' - element is completely to the right of the viewport
// 'offscreen:above-left', 'offscreen:above-right', etc. - element is in a corner
export type ViewportPosition = 'visible' | 'visible:occluded' | `offscreen:${string}`;

// Tags that never form a visible occluding overlay (script, style, etc.)
const NON_OCCLUDING_TAG_NAMES = new Set<string>(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE']);

export type Box = {
  visible: boolean;
  inline: boolean;
  rect?: DOMRect;
  // Note: we do not store the CSSStyleDeclaration object, because it is a live object
  // and changes values over time. This does not work for caching or comparing to the
  // old values. Instead, store all the properties separately.
  cursor?: CSSStyleDeclaration['cursor'];
  viewportPosition?: ViewportPosition;
};

export type MainFrameViewport = { offsetX: number, offsetY: number, width: number, height: number };

/**
 * Computes the viewport position of an element based on its bounding rect.
 * Returns the position relative to the current browser viewport.
 *
 * If mainFrameViewport is provided, calculates position relative to the main frame's viewport
 * by adding the cumulative offset to element coordinates and using main frame's viewport bounds.
 * This is used for elements inside child frames to determine their true visibility in the main viewport.
 */
export function computeViewportPosition(rect: DOMRect | undefined, element: Element, mainFrameViewport?: MainFrameViewport): ViewportPosition | undefined {
  if (!rect || (rect.width === 0 && rect.height === 0))
    return undefined;

  // 1. 无关 tag（script/style/meta 等）直接返回 undefined
  if (NON_OCCLUDING_TAG_NAMES.has(element.nodeName))
    return undefined;

  // 2. 利用原生 checkVisibility：不可见直接视为被遮挡
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility())
    return 'visible:occluded';

  const win = element.ownerDocument?.defaultView;
  if (!win)
    return undefined;

  let viewportLeft: number;
  let viewportTop: number;
  let viewportWidth: number;
  let viewportHeight: number;
  let elementLeft: number;
  let elementRight: number;
  let elementTop: number;
  let elementBottom: number;

  if (mainFrameViewport) {
    // Use main frame's viewport and add offset to element coordinates
    viewportLeft = 0;
    viewportTop = 0;
    viewportWidth = mainFrameViewport.width;
    viewportHeight = mainFrameViewport.height;
    // Transform element coordinates to main frame coordinate system
    elementLeft = rect.left + mainFrameViewport.offsetX;
    elementRight = rect.right + mainFrameViewport.offsetX;
    elementTop = rect.top + mainFrameViewport.offsetY;
    elementBottom = rect.bottom + mainFrameViewport.offsetY;
  } else {
    // Use current frame's viewport
    const visualViewport = win.visualViewport;
    viewportLeft = visualViewport?.offsetLeft ?? 0;
    viewportTop = visualViewport?.offsetTop ?? 0;
    viewportWidth = visualViewport?.width ?? win.innerWidth;
    viewportHeight = visualViewport?.height ?? win.innerHeight;
    elementLeft = rect.left;
    elementRight = rect.right;
    elementTop = rect.top;
    elementBottom = rect.bottom;
  }

  if (!viewportWidth || !viewportHeight)
    return undefined;

  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  // Check if the element intersects with the viewport
  const intersectsHorizontally = elementRight > viewportLeft && elementLeft < viewportRight;
  const intersectsVertically = elementBottom > viewportTop && elementTop < viewportBottom;

  // Element is at least partially within the viewport
  if (intersectsHorizontally && intersectsVertically) {
    // 3. elementFromPoint 遮挡检查：仅对视口内且有尺寸的元素执行
    const doc = element.ownerDocument;
    if (doc) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const topEl = doc.elementFromPoint(centerX, centerY);
      // 如果元素超大，导致centerX/centerY 超出视口，则会强制不视为遮挡，可能会导致部分遮挡的元素被误判为可见，不过结果可接受
      // 有时候父元素过大会导致子元素被遮挡，不过结果可接受
      if (topEl !== null && topEl !== element && !element.contains(topEl)) {
        return 'visible:occluded';
      }
    }
    return 'visible';
  }

  // Determine the direction(s) where the element is offscreen
  const directions: string[] = [];

  if (elementBottom <= viewportTop)
    directions.push('above');
  else if (elementTop >= viewportBottom)
    directions.push('below');

  if (elementRight <= viewportLeft)
    directions.push('left');
  else if (elementLeft >= viewportRight)
    directions.push('right');

  if (!directions.length)
    return 'visible';

  return `offscreen:${directions.join('-')}`;
}

export function computeBox(element: Element, mainFrameViewport?: MainFrameViewport): Box {
  // Note: this logic should be similar to waitForDisplayedAtStablePosition() to avoid surprises.
  const style = getElementComputedStyle(element);
  if (!style)
    return { visible: true, inline: false };
  const cursor = style.cursor;
  if (style.display === 'contents') {
    // display:contents is not rendered itself, but its child nodes are.
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1 /* Node.ELEMENT_NODE */ && isElementVisible(child as Element))
        return { visible: true, inline: false, cursor };
      if (child.nodeType === 3 /* Node.TEXT_NODE */ && isVisibleTextNode(child as Text))
        return { visible: true, inline: true, cursor };
    }
    return { visible: false, inline: false, cursor };
  }
  if (!isElementStyleVisibilityVisible(element, style))
    return { cursor, visible: false, inline: false };
  const rect = element.getBoundingClientRect();
  const viewportPosition = computeViewportPosition(rect, element, mainFrameViewport);
  return { rect, cursor, visible: rect.width > 0 && rect.height > 0, inline: style.display === 'inline', viewportPosition };
}

export function isElementVisible(element: Element): boolean {
  return computeBox(element).visible;
}

export function isVisibleTextNode(node: Text) {
  // https://stackoverflow.com/questions/1461059/is-there-an-equivalent-to-getboundingclientrect-for-text-nodes
  const range = node.ownerDocument.createRange();
  range.selectNode(node);
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function elementSafeTagName(element: Element) {
  const tagName = element.tagName;
  if (typeof tagName === 'string')  // Fast path.
    return tagName.toUpperCase();
  // Named inputs, e.g. <input name=tagName>, will be exposed as fields on the parent <form>
  // and override its properties.
  if (element instanceof HTMLFormElement)
    return 'FORM';
  // Elements from the svg namespace do not have uppercase tagName right away.
  return element.tagName.toUpperCase();
}

let cacheStyle: Map<Element, CSSStyleDeclaration | undefined> | undefined;
let cacheStyleBefore: Map<Element, CSSStyleDeclaration | undefined> | undefined;
let cacheStyleAfter: Map<Element, CSSStyleDeclaration | undefined> | undefined;
let cachesCounter = 0;

export function beginDOMCaches() {
  ++cachesCounter;
  cacheStyle ??= new Map();
  cacheStyleBefore ??= new Map();
  cacheStyleAfter ??= new Map();
}

export function endDOMCaches() {
  if (!--cachesCounter) {
    cacheStyle = undefined;
    cacheStyleBefore = undefined;
    cacheStyleAfter = undefined;
  }
}
