/**
 * YAML Front Matter
 *
 * Generates extensive YAML front matter for exported Markdown files.
 * Combines the RSS article metadata, feed metadata, and metadata
 * extracted from the original web page by Defuddle.
 */

/**
 * Format a value as a YAML-safe string.
 *
 * Uses JSON.stringify for strings so special characters are handled
 * consistently. Non-string primitives pass through as literals.
 *
 * @param {*} value
 * @returns {string}
 */
function yamlValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '\n' + value.map((item) => `  - ${yamlValue(item)}`).join('\n');
  }
  return JSON.stringify(String(value));
}

/**
 * Build a front matter line if the value is present.
 *
 * @param {string} key
 * @param {*} value
 * @returns {string}
 */
function line(key, value) {
  const rendered = yamlValue(value);
  if (rendered.startsWith('\n')) {
    return `${key}:${rendered}`;
  }
  return `${key}: ${rendered}`;
}

/**
 * Generate YAML front matter for an article export.
 *
 * @param {object} article - The article from the RSS feed
 * @param {object} feed - The parent feed
 * @param {object} extracted - Metadata returned by Defuddle
 * @returns {string} YAML front matter wrapped in ---
 */
export function generateFrontMatter(article, feed, extracted) {
  const tags = article.tags && article.tags.length > 0
    ? article.tags.map((tag) => (typeof tag === 'string' ? tag : tag.name))
    : [];

  const authors = article.authors && article.authors.length > 0
    ? article.authors.map((author) => author.name || '')
    : extracted.author
      ? [extracted.author]
      : [];

  const lines = [
    '---',
    line('title', extracted.title || article.title || 'Untitled'),
    line('url', article.url || extracted.url || ''),
    line('source', feed.name || 'Untitled Feed'),
    line('feed_url', feed.url || ''),
    line('feed_id', feed.feedID || ''),
    line('article_id', article.articleID || ''),
    line('author', authors),
    line('published', article.datePublished
      ? article.datePublished.toISOString()
      : extracted.published || ''),
    line('date_imported', new Date().toISOString()),
    line('domain', extracted.domain || ''),
    line('site', extracted.site || ''),
    line('description', article.summary || extracted.description || ''),
    line('language', extracted.language || ''),
    line('word_count', extracted.wordCount || 0),
    line('image', article.imageURL || article.bannerImageURL || extracted.image || ''),
    line('favicon', extracted.favicon || ''),
    line('starred', Boolean(article.starred)),
    line('tags', tags),
    '---',
  ];

  return lines.join('\n');
}
