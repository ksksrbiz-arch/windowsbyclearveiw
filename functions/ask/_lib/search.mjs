// DuckDuckGo has no official public search API — every free "DDG search"
// integration (including the well-known duckduckgo-search Python package)
// works by fetching the plain HTML results page instead. That's what this
// does. Brittle to DDG changing markup, but there's no better free option;
// this is called for general industry knowledge only (see the system
// prompt in chat.js) — a search hiccup should degrade to "no results",
// never break the chat.
const RESULT_RE = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const SNIPPET_RE = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function realUrl(ddgHref) {
  // DDG's HTML results wrap the destination in a redirect link:
  // //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
  try {
    const url = new URL(ddgHref, 'https://duckduckgo.com');
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : ddgHref;
  } catch {
    return ddgHref;
  }
}

/** Top N general-web results for a query. Never throws — returns [] on any
 *  failure so a search hiccup degrades gracefully rather than breaking the
 *  chat turn. */
export async function webSearch(query, limit = 4) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        // A browser UA — DDG's HTML endpoint blocks obvious non-browser
        // clients on some requests.
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const titles = [...html.matchAll(RESULT_RE)];
    const snippets = [...html.matchAll(SNIPPET_RE)];

    const results = [];
    for (let i = 0; i < titles.length && results.length < limit; i++) {
      const title = stripTags(titles[i][2]);
      const url = realUrl(titles[i][1]);
      const snippet = snippets[i] ? stripTags(snippets[i][1]) : '';
      if (!title || !url.startsWith('http')) continue;
      results.push({ title, url, snippet });
    }
    return results;
  } catch {
    return [];
  }
}
