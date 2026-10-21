'use strict';
// Which library a typed code block needs (docs/web.md, Markdown): highlight.js colours a fence whose
// language it knows, mermaid draws a ```mermaid fence, and every other fence stays the plain labelled
// block markdown.js drew. Nothing loads unless a rendered body holds a block that needs it. This module
// is the decision and what it rests on, the language names and the pinned versions; it loads nothing
// itself. The page (code-blocks-ui.js) brings its own loader, which reads the libraries from
// web/vendor, and the snapshot embeds this same file and brings one that reads them from cdnjs, at
// these versions. No DOM here: loaded as a plain <script> (one global, window.kanbanCodeLibs),
// embedded in the snapshot, and required directly by node --test.

const codeLibsModule = (() => {
  const MERMAID_VERSION = '12.2.0';
  const HIGHLIGHT_VERSION = '11.12.0';

  // highlight.js's common-languages build (web/vendor/highlight.js): each language it ships with the
  // other names it answers to. Plain text is left out, since colouring nothing needs no library.
  // code-libs.test.js holds this table to the vendored build.
  const HIGHLIGHT_LANGUAGES = {
    bash: ['sh', 'zsh'],
    c: ['h'],
    cpp: ['cc', 'c++', 'h++', 'hpp', 'hh', 'hxx', 'cxx'],
    csharp: ['cs', 'c#'],
    css: [],
    diff: ['patch'],
    go: ['golang'],
    graphql: ['gql'],
    ini: ['toml'],
    java: ['jsp'],
    javascript: ['js', 'jsx', 'mjs', 'cjs'],
    json: ['jsonc', 'json5'],
    kotlin: ['kt', 'kts', 'ktm', 'ktx'],
    less: [],
    lua: ['pluto'],
    makefile: ['mk', 'mak', 'make'],
    markdown: ['md', 'mkdown', 'mkd'],
    objectivec: ['mm', 'objc', 'obj-c', 'obj-c++', 'objective-c++'],
    perl: ['pl', 'pm'],
    php: [],
    'php-template': [],
    python: ['py', 'gyp', 'ipython'],
    'python-repl': ['pycon'],
    r: [],
    ruby: ['rb', 'gemspec', 'podspec', 'thor', 'irb'],
    rust: ['rs'],
    scss: [],
    shell: ['console', 'shellsession'],
    sql: [],
    swift: [],
    typescript: ['ts', 'tsx', 'mts', 'cts'],
    vbnet: ['vb'],
    wasm: [],
    xml: ['html', 'xhtml', 'rss', 'atom', 'xjb', 'xsd', 'xsl', 'plist', 'wsf', 'svg'],
    yaml: ['yml'],
  };

  const BY_NAME = new Map();
  for (const [name, aliases] of Object.entries(HIGHLIGHT_LANGUAGES)) {
    BY_NAME.set(name, name);
    for (const a of aliases) BY_NAME.set(a, name);
  }

  // The highlight.js language a fence's language names, or null when it names none.
  function highlightLanguage(lang) {
    return BY_NAME.get(String(lang == null ? '' : lang).toLowerCase()) || null;
  }

  function isMermaid(lang) {
    return String(lang == null ? '' : lang).toLowerCase() === 'mermaid';
  }

  // Which libraries a list of fence languages needs.
  function libsNeeded(langs) {
    return { highlight: langs.some((l) => highlightLanguage(l) !== null), mermaid: langs.some(isMermaid) };
  }

  // Hands each block to the loader for the library it needs and to none otherwise: blocks are
  // { lang, ... } and the loader has highlight(block, language) and mermaid(block), each of which
  // loads its library the first time it is asked. An untyped or unknown fence asks for nothing.
  function enhanceBlocks(blocks, loader) {
    for (const block of blocks) {
      if (isMermaid(block.lang)) loader.mermaid(block);
      else {
        const language = highlightLanguage(block.lang);
        if (language) loader.highlight(block, language);
      }
    }
  }

  // Where the snapshot reads the two libraries and highlight.js's light and dark themes from.
  function cdnUrls() {
    const host = 'https://cdnjs.cloudflare.com/ajax/libs';
    return {
      mermaid: `${host}/mermaid/${MERMAID_VERSION}/mermaid.min.js`,
      highlight: `${host}/highlight.js/${HIGHLIGHT_VERSION}/highlight.min.js`,
      light: `${host}/highlight.js/${HIGHLIGHT_VERSION}/styles/github.min.css`,
      dark: `${host}/highlight.js/${HIGHLIGHT_VERSION}/styles/github-dark.min.css`,
    };
  }

  return { MERMAID_VERSION, HIGHLIGHT_VERSION, HIGHLIGHT_LANGUAGES, highlightLanguage, isMermaid, libsNeeded, enhanceBlocks, cdnUrls };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = codeLibsModule;
} else {
  window.kanbanCodeLibs = codeLibsModule;
}
