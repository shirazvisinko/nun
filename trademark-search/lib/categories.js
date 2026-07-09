/**
 * Focus-area definitions used to restrict search results to the domains
 * this app cares about: technology, accounting/finance, small business
 * services, and AI.
 *
 * Each category lists:
 *  - niceClasses: Nice Classification class numbers commonly used for
 *    goods/services in that domain.
 *  - keywords: lower-case terms matched against the trade mark's words and
 *    its goods/services descriptions.
 *
 * A trade mark matches a category when EITHER one of its classes is in
 * niceClasses AND at least one keyword appears in its text, OR a strong
 * keyword match occurs regardless of class. This keeps broad classes like
 * 35 (which covers everything from retail to advertising) from flooding
 * results with unrelated marks.
 */

const CATEGORIES = {
  tech: {
    id: 'tech',
    label: 'Technology & Software',
    niceClasses: [9, 38, 42],
    keywords: [
      'software', 'computer', 'technology', 'tech', 'digital', 'app',
      'application', 'platform', 'cloud', 'saas', 'data', 'internet',
      'online', 'web', 'website', 'mobile', 'electronic', 'it services',
      'information technology', 'cyber', 'network', 'telecommunications',
      'hosting', 'api', 'programming', 'developer', 'code',
    ],
  },
  accounting: {
    id: 'accounting',
    label: 'Accounting & Finance',
    niceClasses: [35, 36],
    keywords: [
      'accounting', 'accountant', 'bookkeeping', 'bookkeeper', 'tax',
      'taxation', 'audit', 'auditing', 'payroll', 'finance', 'financial',
      'invoicing', 'invoice', 'ledger', 'cpa', 'superannuation', 'banking',
      'budgeting', 'accounts payable', 'accounts receivable', 'bas agent',
      'financial planning', 'wealth management', 'insolvency',
    ],
  },
  smallbusiness: {
    id: 'smallbusiness',
    label: 'Small Business Services',
    niceClasses: [35],
    keywords: [
      'small business', 'business services', 'business advisory',
      'business consulting', 'business management', 'business administration',
      'startup', 'start-up', 'entrepreneur', 'sme', 'business coaching',
      'business support', 'business development', 'franchising', 'marketing',
      'business planning', 'sole trader', 'business mentoring',
    ],
  },
  ai: {
    id: 'ai',
    label: 'AI & Machine Learning',
    niceClasses: [9, 42],
    keywords: [
      'artificial intelligence', ' ai ', 'a.i.', 'machine learning',
      'deep learning', 'neural network', 'chatbot', 'chat bot',
      'natural language', 'nlp', 'llm', 'large language model',
      'generative', 'automation', 'automated', 'predictive analytics',
      'computer vision', 'robotics', 'intelligent', 'data science',
      'algorithm',
    ],
  },
};

const ALL_CATEGORY_IDS = Object.keys(CATEGORIES);

function normaliseText(text) {
  return ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
}

/**
 * Decide which categories a normalised trade mark record belongs to.
 * @param {object} mark - normalised record with .words, .classes (number[]),
 *   and .goodsServices (array of {classNumber, description}).
 * @returns {string[]} matching category ids (possibly empty).
 */
function categoriseMark(mark) {
  const textBlob = normaliseText(
    [
      mark.words,
      ...(mark.goodsServices || []).map((gs) => gs.description),
    ].join(' \n '),
  );
  const classes = (mark.classes || []).map(Number);

  const matches = [];
  for (const cat of Object.values(CATEGORIES)) {
    const classHit = classes.some((c) => cat.niceClasses.includes(c));
    const keywordHit = cat.keywords.some((kw) => textBlob.includes(kw));
    if (classHit && keywordHit) {
      matches.push(cat.id);
    }
  }
  return matches;
}

module.exports = { CATEGORIES, ALL_CATEGORY_IDS, categoriseMark };
