#!/usr/bin/env node
// Inject JSON-LD schema + semantic <time> into each post, and (re)generate
// /llms.txt + /llms-full.txt from the live post content. Idempotent.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://grayoakjournal.com';
const AUTHOR = {
  name: 'Dr. Susan Ries Valashinas',
  alternateName: 'Dr. V',
  jobTitle: 'Veterinarian, Practice Owner',
  description: 'DVM, veterinary hospital owner, mentor, and writer on practice leadership.',
  linkedin: 'https://www.linkedin.com/in/susan-valashinas-dvm-91784b195/',
};
const MONTHS = {
  January: '01', February: '02', March: '03', April: '04', May: '05', June: '06',
  July: '07', August: '08', September: '09', October: '10', November: '11', December: '12',
};

function isoDate(human) {
  const m = human.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
  if (!m) throw new Error(`Bad date: ${human}`);
  return `${m[3]}-${MONTHS[m[1]]}-${m[2].padStart(2, '0')}`;
}

function listPostSlugs() {
  return readdirSync(ROOT)
    .filter((n) => {
      const p = join(ROOT, n);
      if (!statSync(p).isDirectory()) return false;
      if (n.startsWith('.') || n === 'tools') return false;
      try { return statSync(join(p, 'index.html')).isFile(); } catch { return false; }
    })
    .sort();
}

function extractField(html, re, fallback = '') {
  const m = html.match(re);
  return m ? m[1].trim() : fallback;
}

function parsePost(slug) {
  const path = join(ROOT, slug, 'index.html');
  const html = readFileSync(path, 'utf8');
  const titleRaw = extractField(html, /<title>([^<]+)<\/title>/);
  const title = titleRaw.replace(/\s*\|\s*Gray Oak Journal\s*$/, '');
  const description = extractField(html, /<meta name="description" content="([^"]+)"/);
  const keywords = extractField(html, /<meta name="keywords" content="([^"]+)"/);
  const heroSrc = extractField(html, /<img src="\.\.\/([^"]+\.(?:jpg|jpeg|png|webp))"/i);
  const articleSection = extractField(html, /<span class="post-tag">([^<]+)<\/span>/);
  // Match the human-readable date whether or not it's already wrapped in <time>.
  const dateHuman = extractField(
    html,
    /<p class="article-meta">(?:<time[^>]*>)?([A-Z][a-z]+ \d{1,2}, \d{4})/
  );
  const datePub = isoDate(dateHuman);

  // Article body: from <div class="article-body"> up to (not including) the
  // "— Dr. V" byline paragraph that closes every post. The byline <p> is
  // distinguishable by its inline style starting "margin-top:2rem".
  const bodyMatch = html.match(/<div class="article-body">([\s\S]*?)<p style="margin-top:2rem;[^>]*>[\s\S]*?Dr\. V/);
  const bodyHtml = bodyMatch ? bodyMatch[1] : '';

  const wordCount = bodyHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    slug, path, html,
    title, description, keywords, heroSrc, articleSection,
    dateHuman, datePub, bodyHtml, wordCount,
  };
}

function htmlBodyToMarkdown(bodyHtml) {
  let s = bodyHtml;
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${t.trim()}\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${t.trim()}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `\n\n> ${t.replace(/<[^>]+>/g, '').trim()}\n`);
  s = s.replace(/<div class="formula"[^>]*>([\s\S]*?)<\/div>/gi, (_, t) => `\n\n**${t.replace(/<[^>]+>/g, '').trim()}**\n`);
  s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${t}*`);
  s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${t}**`);
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n\n${t.trim()}`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&amp;/g, '&')
       .replace(/&times;/g, '×')
       .replace(/&rarr;/g, '→')
       .replace(/&middot;/g, '·')
       .replace(/&mdash;/g, '—')
       .replace(/&ndash;/g, '–')
       .replace(/&hellip;/g, '…')
       .replace(/&lsquo;|&rsquo;/g, "'")
       .replace(/&ldquo;|&rdquo;/g, '"')
       .replace(/&#x27;|&apos;/g, "'")
       .replace(/&quot;/g, '"');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function buildArticleSchema(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    image: `${SITE}/${post.heroSrc}`,
    datePublished: post.datePub,
    dateModified: post.datePub,
    inLanguage: 'en-US',
    articleSection: post.articleSection,
    keywords: post.keywords,
    wordCount: post.wordCount,
    author: {
      '@type': 'Person',
      name: AUTHOR.name,
      alternateName: AUTHOR.alternateName,
      jobTitle: AUTHOR.jobTitle,
      description: AUTHOR.description,
      sameAs: [AUTHOR.linkedin],
      url: `${SITE}/#about`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Gray Oak Journal',
      url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/tree-logo.png` },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE}/${post.slug}/`,
    },
  };
}

function buildBreadcrumbSchema(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Gray Oak Journal', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Essays', item: `${SITE}/#blog` },
      { '@type': 'ListItem', position: 3, name: post.title },
    ],
  };
}

const MARK_OPEN = '<!-- grayoak-seo-injection:start -->';
const MARK_CLOSE = '<!-- grayoak-seo-injection:end -->';
// Legacy single-comment marker from an earlier run — still removed if present.
const LEGACY_MARK = '<!-- grayoak-seo-injection -->';

function injectIntoPost(post) {
  const articleLd = JSON.stringify(buildArticleSchema(post), null, 2);
  const crumbLd = JSON.stringify(buildBreadcrumbSchema(post), null, 2);
  const insertion =
    `\n  ${MARK_OPEN}\n` +
    `  <meta property="article:published_time" content="${post.datePub}T00:00:00+00:00" />\n` +
    `  <meta property="article:author" content="${AUTHOR.name}" />\n` +
    `  <script type="application/ld+json">\n${articleLd}\n  </script>\n` +
    `  <script type="application/ld+json">\n${crumbLd}\n  </script>\n` +
    `  ${MARK_CLOSE}\n`;

  let html = post.html;
  let action = 'wrote';

  // Strip any previous injection (legacy or current) so re-runs refresh content.
  if (html.includes(MARK_OPEN) && html.includes(MARK_CLOSE)) {
    html = html.replace(
      new RegExp(`\\n?\\s*${MARK_OPEN.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\s\\S]*?${MARK_CLOSE.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\n?`),
      ''
    );
    action = 'refreshed';
  } else if (html.includes(LEGACY_MARK)) {
    // Legacy: marker is a single line followed by N lines of injected content,
    // ending just before the <link rel="canonical"> tag. Remove that block.
    html = html.replace(
      new RegExp(`\\n?\\s*${LEGACY_MARK.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\s\\S]*?(?=\\n\\s*<link rel="canonical")`),
      ''
    );
    action = 'refreshed';
  }

  if (!html.includes('<link rel="canonical"')) {
    throw new Error(`${post.slug}: canonical not found`);
  }
  html = html.replace(/(?=\n\s*<link rel="canonical")/, insertion);

  // Wrap visible date in <time> if not already wrapped
  if (!html.includes(`<time datetime="${post.datePub}">${post.dateHuman}</time>`)) {
    const escaped = post.dateHuman.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const dateLineRe = new RegExp(`(<p class="article-meta">)${escaped}`);
    if (!dateLineRe.test(html)) {
      throw new Error(`${post.slug}: date line not found`);
    }
    html = html.replace(dateLineRe, `$1<time datetime="${post.datePub}">${post.dateHuman}</time>`);
  }

  writeFileSync(post.path, html);
  return { action };
}

function buildLlmsTxt(posts) {
  const sorted = [...posts].sort((a, b) => b.datePub.localeCompare(a.datePub));
  const lines = [];
  lines.push('# Gray Oak Journal');
  lines.push('');
  lines.push('> Reflections on leadership, mentorship, and the practical challenges of guiding organizations and developing people. The ideas start in veterinary medicine, but they apply anywhere people lead people.');
  lines.push('');
  lines.push(`Author: ${AUTHOR.name}, DVM — veterinarian, hospital owner, mentor. [LinkedIn](${AUTHOR.linkedin})`);
  lines.push('');
  lines.push('Site: https://grayoakjournal.com');
  lines.push('');
  lines.push('## Essays');
  lines.push('');
  for (const p of sorted) {
    lines.push(`- [${p.title}](${SITE}/${p.slug}/): ${p.description}`);
  }
  lines.push('');
  lines.push('## About');
  lines.push('');
  lines.push(`- [About Dr. V & the Journal](${SITE}/#about)`);
  lines.push('');
  lines.push('## Optional');
  lines.push('');
  lines.push('- [Contact](mailto:grayoakjournal@gmail.com)');
  lines.push(`- [LinkedIn](${AUTHOR.linkedin})`);
  lines.push('');
  return lines.join('\n');
}

function buildLlmsFullTxt(posts) {
  const sorted = [...posts].sort((a, b) => b.datePub.localeCompare(a.datePub));
  const out = [];
  out.push('# Gray Oak Journal — Full Essay Corpus');
  out.push('');
  out.push('> Reflections on leadership, mentorship, and the practical challenges of guiding organizations and developing people. By Dr. Susan Ries Valashinas, DVM. https://grayoakjournal.com');
  out.push('');
  for (const p of sorted) {
    out.push('---');
    out.push('');
    out.push(`# ${p.title}`);
    out.push('');
    out.push(`**Author:** ${AUTHOR.name}`);
    out.push(`**Published:** ${p.datePub}`);
    out.push(`**Section:** ${p.articleSection}`);
    out.push(`**URL:** ${SITE}/${p.slug}/`);
    out.push('');
    out.push(htmlBodyToMarkdown(p.bodyHtml));
    out.push('');
  }
  return out.join('\n');
}

// ── Run ────────────────────────────────────────────────────────────────
const slugs = listPostSlugs();
console.log(`Found ${slugs.length} post directories`);

const posts = slugs.map(parsePost);
for (const p of posts) {
  const result = injectIntoPost(p);
  console.log(`  ${result.action}: ${p.slug} (${p.datePub}, ${p.wordCount} words)`);
}

// ── Homepage ──────────────────────────────────────────────────────────
const indexPath = join(ROOT, 'index.html');
let indexHtml = readFileSync(indexPath, 'utf8');
const HOME_OPEN = '<!-- grayoak-home-seo:start -->';
const HOME_CLOSE = '<!-- grayoak-home-seo:end -->';

const homeGraph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE}/#website`,
      name: 'Gray Oak Journal',
      url: SITE,
      description: 'Reflections on leadership, mentorship, and the practical challenges of guiding organizations and developing people. By Dr. Susan Ries Valashinas.',
      inLanguage: 'en-US',
      publisher: { '@id': `${SITE}/#organization` },
      author: { '@id': `${SITE}/#person-drv` },
    },
    {
      '@type': 'Organization',
      '@id': `${SITE}/#organization`,
      name: 'Gray Oak Journal',
      url: SITE,
      logo: { '@type': 'ImageObject', url: `${SITE}/tree-logo.png` },
      founder: { '@id': `${SITE}/#person-drv` },
    },
    {
      '@type': 'Person',
      '@id': `${SITE}/#person-drv`,
      name: AUTHOR.name,
      alternateName: AUTHOR.alternateName,
      jobTitle: 'Veterinarian, Practice Owner, Mentor',
      description: 'DVM, veterinary hospital owner, mentor, and writer on practice leadership, hiring, culture, and the parts of running a business nobody teaches in vet school.',
      sameAs: [AUTHOR.linkedin],
      knowsAbout: [
        'veterinary practice management',
        'veterinary leadership',
        'hospital culture',
        'team building',
        'mentorship',
        'client service',
      ],
      url: `${SITE}/#about`,
    },
  ],
};

const homeInsertion =
  `\n  ${HOME_OPEN}\n` +
  `  <script type="application/ld+json">\n${JSON.stringify(homeGraph, null, 2)}\n  </script>\n` +
  `  ${HOME_CLOSE}\n`;

// Refresh existing block or insert before canonical.
if (indexHtml.includes(HOME_OPEN) && indexHtml.includes(HOME_CLOSE)) {
  indexHtml = indexHtml.replace(
    new RegExp(`\\n?\\s*${HOME_OPEN.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\s\\S]*?${HOME_CLOSE.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\n?`),
    ''
  );
}
indexHtml = indexHtml.replace(/(?=\n\s*<link rel="canonical")/, homeInsertion);

// Wrap visible dates in the blog grid and inline article copies.
const dateRe = /(<p class="(?:post-meta|article-meta)">)(?!<time)([A-Z][a-z]+ \d{1,2}, \d{4})/g;
let dateWrapCount = 0;
indexHtml = indexHtml.replace(dateRe, (_, tag, dateHuman) => {
  dateWrapCount += 1;
  return `${tag}<time datetime="${isoDate(dateHuman)}">${dateHuman}</time>`;
});

writeFileSync(indexPath, indexHtml);
console.log(`Wrote index.html (${dateWrapCount} dates wrapped in <time>)`);

// ── LLMs index/corpus ─────────────────────────────────────────────────
writeFileSync(join(ROOT, 'llms.txt'), buildLlmsTxt(posts));
console.log(`Wrote llms.txt (${posts.length} essays indexed)`);

const fullTxt = buildLlmsFullTxt(posts);
writeFileSync(join(ROOT, 'llms-full.txt'), fullTxt);
console.log(`Wrote llms-full.txt (${fullTxt.length} bytes)`);

console.log('Done.');
