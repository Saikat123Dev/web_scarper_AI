import axios from 'axios';
import * as cheerio from 'cheerio';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { URL } from 'url';

const router = Router();

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
];

// Enhanced HTTP client with better headers and retry logic
const createAxiosInstance = (customHeaders = {}) => {
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  return axios.create({
    timeout: 30000,
    maxRedirects: 5,
    headers: {
      'User-Agent': randomUserAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      ...customHeaders
    },
    validateStatus: (status) => status >= 200 && status < 400
  });
};


class ContentExtractor {
  constructor(html, url) {
    this.$ = cheerio.load(html);
    this.url = url;
    this.contentSelectors = [
      'main article',
      'article',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.article-body',
      'main',
      '.content-body',
      '.main-content',
      '#content',
      '.content',
      '[role="main"]',
      '#main-content',
      '.story-content',
      '.text-content'
    ];
  }

  // Extract title with priority to H1 tags
  extractTitle() {
    const titleSelectors = [
      'h1',
      'title',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      '.post-title',
      '.entry-title',
      '.article-title',
      '.page-title',
      '.headline',
      '.title',
      '[itemprop="headline"]'
    ];

    for (const selector of titleSelectors) {
      const element = this.$(selector);
      if (element.length > 0) {
        const title = selector.startsWith('meta')
          ? element.attr('content')
          : element.first().text().trim();

        if (title && title.length > 0 && title.length < 300) {
          return this.cleanText(title);
        }
      }
    }
    return 'No title found';
  }

  // Extract structured content with headings and paragraphs
  extractStructuredContent() {
    const $body = this.$('body').clone();

    // Remove unwanted elements
    $body.find(`
      script, style, nav, footer, header, aside, iframe, form,
      .advertisement, .ad, .ads, .sidebar, .menu, .social, 
      .share, .comment, .comments, .related, .recommended, 
      .popup, .modal, [class*="ad"], [id*="ad"], [class*="sidebar"],
      [class*="menu"], [class*="nav"], [class*="cookie"], [class*="banner"],
      [role="navigation"], [role="banner"], [role="complementary"]
    `).remove();

    // Try to find main content container first
    for (const selector of this.contentSelectors) {
      const element = $body.find(selector);
      if (element.length > 0) {
        return this.extractFromElement(element);
      }
    }

    // Fallback to extracting from body
    return this.extractFromElement($body);
  }

  // Extract content from a specific element with structure
  extractFromElement($element) {
    const sections = [];
    let currentSection = { type: 'paragraph', content: '' };

    // Process all heading and content elements
    $element.find('h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre').each((i, elem) => {
      const tagName = elem.tagName.toLowerCase();
      const $elem = this.$(elem);
      const text = $elem.text().trim();

      if (!text) return;

      if (tagName.startsWith('h')) {
        // If we have accumulated content in current section, save it
        if (currentSection.content) {
          sections.push(currentSection);
          currentSection = { type: 'paragraph', content: '' };
        }

        // Add heading section
        const level = parseInt(tagName.substring(1));
        sections.push({
          type: 'heading',
          level: level,
          content: text
        });
      } else if (tagName === 'p') {
        // Add to current paragraph or start new one if too long
        if (currentSection.content.length + text.length < 1000) {
          currentSection.content += (currentSection.content ? '\n\n' : '') + text;
        } else {
          if (currentSection.content) {
            sections.push(currentSection);
          }
          currentSection = { type: 'paragraph', content: text };
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        // Process lists
        const listItems = [];
        $elem.find('li').each((liIdx, liElem) => {
          const liText = this.$(liElem).text().trim();
          if (liText) listItems.push(liText);
        });

        if (listItems.length > 0) {
          sections.push({
            type: tagName === 'ul' ? 'bullet_list' : 'numbered_list',
            items: listItems
          });
        }
      } else if (tagName === 'blockquote') {
        sections.push({
          type: 'quote',
          content: text
        });
      } else if (tagName === 'pre') {
        sections.push({
          type: 'code',
          content: text
        });
      }
    });

    // Add any remaining content
    if (currentSection.content) {
      sections.push(currentSection);
    }

    return sections;
  }

  // Extract metadata with additional fields
  extractMetadata() {
    const metadata = {
      description: '',
      keywords: '',
      author: '',
      publishDate: '',
      language: 'en',
      siteName: '',
      image: '',
      readingTime: 0
    };

    // Description
    metadata.description =
      this.$('meta[name="description"]').attr('content') ||
      this.$('meta[property="og:description"]').attr('content') ||
      this.$('meta[name="twitter:description"]').attr('content') ||
      this.$('meta[name="og:description"]').attr('content') || '';

    // Keywords
    metadata.keywords = this.$('meta[name="keywords"]').attr('content') || '';

    // Author
    metadata.author =
      this.$('meta[name="author"]').attr('content') ||
      this.$('meta[property="article:author"]').attr('content') ||
      this.$('[itemprop="author"]').attr('content') ||
      this.$('.author').first().text().trim() ||
      this.$('[rel="author"]').first().text().trim() ||
      this.$('[itemprop="author"]').first().text().trim() || '';

    // Publication date
    metadata.publishDate =
      this.$('meta[property="article:published_time"]').attr('content') ||
      this.$('meta[name="date"]').attr('content') ||
      this.$('meta[property="published_time"]').attr('content') ||
      this.$('time[datetime]').first().attr('datetime') ||
      this.$('time').first().text().trim() || '';

    // Language
    metadata.language =
      this.$('html').attr('lang') ||
      this.$('meta[http-equiv="content-language"]').attr('content') ||
      'en';

    // Site name
    metadata.siteName =
      this.$('meta[property="og:site_name"]').attr('content') ||
      this.$('meta[name="application-name"]').attr('content') || '';

    // Image
    metadata.image =
      this.$('meta[property="og:image"]').attr('content') ||
      this.$('meta[name="twitter:image"]').attr('content') ||
      this.$('meta[itemprop="image"]').attr('content') || '';

    return metadata;
  }

  // Generate plain text from structured content
  generatePlainText(structuredContent) {
    let text = '';

    structuredContent.forEach(section => {
      switch (section.type) {
        case 'heading':
          text += `${'#'.repeat(section.level)} ${section.content}\n\n`;
          break;
        case 'paragraph':
          text += `${section.content}\n\n`;
          break;
        case 'bullet_list':
          text += section.items.map(item => `• ${item}`).join('\n') + '\n\n';
          break;
        case 'numbered_list':
          text += section.items.map((item, i) => `${i + 1}. ${item}`).join('\n') + '\n\n';
          break;
        case 'quote':
          text += `> ${section.content}\n\n`;
          break;
        case 'code':
          text += `\`\`\`\n${section.content}\n\`\`\`\n\n`;
          break;
      }
    });

    return text.trim();
  }

  // Clean text content
  cleanText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .replace(/[^\w\s.,!?\-'"()]/g, '')
      .trim();
  }
}

// Optional dynamic rendering toggle (set ENABLE_BROWSER_RENDER=true in env and install playwright)
const ENABLE_BROWSER_RENDER = true
let playwrightChromium = null; // lazy loaded
let PLAYWRIGHT_AVAILABLE = false;

console.log(`[Scraper] ENABLE_BROWSER_RENDER env var: "${process.env.ENABLE_BROWSER_RENDER}"`);

(async () => {
  if (ENABLE_BROWSER_RENDER) {
    try {
      const pw = await import('playwright');
      playwrightChromium = pw.chromium;
      PLAYWRIGHT_AVAILABLE = true;
      console.log('[Scraper] Dynamic rendering enabled. Playwright loaded.');
    } catch (e) {
      console.warn('[Scraper] ENABLE_BROWSER_RENDER=true but Playwright not installed. Run: npm install playwright && npx playwright install chromium');
      console.warn('Error:', e.message);
    }
  } else {
    console.log('[Scraper] Dynamic rendering disabled (ENABLE_BROWSER_RENDER=false).');
  }
})();
async function getRenderedHtml(url) {
  if (!ENABLE_BROWSER_RENDER) { console.log('[Scraper] Dynamic render skipped (flag disabled)'); return null; }
  if (!PLAYWRIGHT_AVAILABLE) { console.log('[Scraper] Dynamic render skipped (Playwright missing)'); return null; }
  try {
    const browser = await playwrightChromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: userAgents[Math.floor(Math.random() * userAgents.length)] });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    // Wait for common content selectors OR timeout
    const sel = 'main, article, h1, #content, #root, #__next, div[role="main"], [data-reactroot]';
    await Promise.race([
      page.waitForSelector(sel, { timeout: 8000 }).catch(() => { }),
      page.waitForTimeout(4000)
    ]);
    // Give frameworks a bit more time to hydrate
    await page.waitForTimeout(1000);
    const html = await page.content();
    await browser.close();
    return html;
  } catch (e) {
    console.warn('Dynamic render failed:', e.message);
    return null;
  }
}

// Enhanced web scraper with beautiful formatting
class WebScraper {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 2000;
  }

  async scrapeUrl(url) {
    let lastError = null;
    let usedDynamic = false;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        console.log(`Scraping attempt ${attempt}/${this.maxRetries}: ${url}${usedDynamic ? ' (dynamic)' : ''}`);
        let html = await this.fetchWithRetry(url, attempt);
        let extractor = new ContentExtractor(html, url);
        let structuredContent = extractor.extractStructuredContent();
        let plainText = extractor.generatePlainText(structuredContent);
        let metadata = extractor.extractMetadata();
        const bodyTextLen = extractor.$('body').text().replace(/\s+/g, ' ').trim().length;
        const spaIndicators = extractor.$('#root, #__next, div#app, div#__nuxt, [data-reactroot]').length > 0;
        const tooShort = !plainText || plainText.length < 150 || bodyTextLen < 350 || structuredContent.length === 0;
        if (!usedDynamic && (tooShort || spaIndicators) && ENABLE_BROWSER_RENDER && PLAYWRIGHT_AVAILABLE) {
          console.log(`[Scraper] Sparse static HTML (plainLen=${plainText.length}, bodyLen=${bodyTextLen}, sections=${structuredContent.length}) -> trying dynamic render`);
          const rendered = await getRenderedHtml(url);
          if (rendered) {
            usedDynamic = true;
            extractor = new ContentExtractor(rendered, url);
            structuredContent = extractor.extractStructuredContent();
            plainText = extractor.generatePlainText(structuredContent);
            metadata = extractor.extractMetadata();
            console.log(`[Scraper] Dynamic render result: plainLen=${plainText.length}, sections=${structuredContent.length}`);
          } else {
            console.log('[Scraper] Dynamic render returned null');
          }
        }
        const wordCount = this.countWords(plainText);
        metadata.readingTime = Math.ceil(wordCount / 200);
        const result = { url, title: extractor.extractTitle(), content: plainText, structuredContent, metadata, timestamp: new Date().toISOString(), success: true, wordCount, scrapingAttempts: attempt, dynamicRendered: usedDynamic };
        const minLen = usedDynamic ? 40 : 100;
        if (!result.content || result.content.length < minLen) {
          throw new Error('Insufficient content extracted - content too short or empty');
        }
        console.log(`✅ Successfully scraped: ${url} (${result.wordCount} words) dynamic=${usedDynamic}`);
        return result;
      } catch (error) {
        lastError = error;
        console.log(`❌ Attempt ${attempt} failed for ${url}: ${error.message}`);
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          console.log(`⏳ Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }
      }
    }
    return { url, error: lastError?.message || 'Unknown error', success: false, timestamp: new Date().toISOString(), scrapingAttempts: this.maxRetries, dynamicRendered: usedDynamic };
  }

  // Enhanced fetch with multiple strategies
  async fetchWithRetry(url, attempt) {
    const strategies = [
      // Strategy 1: Standard request
      async () => {
        const axiosInstance = createAxiosInstance();
        const response = await axiosInstance.get(url);
        return response.data;
      },
      // Strategy 2: With referer
      async () => {
        const axiosInstance = createAxiosInstance({
          'Referer': 'https://www.google.com/',
          'Cache-Control': 'no-cache'
        });
        const response = await axiosInstance.get(url);
        return response.data;
      },
      // Strategy 3: Mobile user agent
      async () => {
        const axiosInstance = createAxiosInstance({
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        });
        const response = await axiosInstance.get(url);
        return response.data;
      }
    ];

    const strategyIndex = Math.min(attempt - 1, strategies.length - 1);
    return await strategies[strategyIndex]();
  }

  // Count words in content
  countWords(content) {
    if (!content) return 0;
    return content.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Scrape multiple URLs with proper concurrency control
  async scrapeMultipleUrls(urls, concurrent = 2) {
    const results = [];
    const batches = [];

    // Create batches
    for (let i = 0; i < urls.length; i += concurrent) {
      batches.push(urls.slice(i, i + concurrent));
    }

    console.log(`🚀 Starting batch scraping: ${urls.length} URLs in ${batches.length} batches`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`📦 Processing batch ${batchIndex + 1}/${batches.length}: ${batch.length} URLs`);

      const batchPromises = batch.map(url => this.scrapeUrl(url));
      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const scrapedData = result.value;
          results.push(scrapedData);
        } else {
          results.push({
            url: batch[index],
            error: result.reason?.message || 'Unknown error',
            success: false,
            timestamp: new Date().toISOString()
          });
        }
      });

      // Add delay between batches to be respectful
      if (batchIndex < batches.length - 1) {
        console.log(`⏳ Waiting 3s before next batch...`);
        await this.delay(3000);
      }
    }

    return results;
  }
}

// Enhanced PDF generation with beautiful formatting
function generatePDF(doc, title, structuredContent, metadata) {
  // Set document metadata
  doc.info['Title'] = title;
  if (metadata.author) doc.info['Author'] = metadata.author;
  if (metadata.publishDate) doc.info['CreationDate'] = new Date(metadata.publishDate);

  // Title page
  doc.font('Helvetica-Bold')
    .fontSize(24)
    .text(title, { align: 'center' });

  doc.moveDown(1);

  if (metadata.author) {
    doc.font('Helvetica')
      .fontSize(12)
      .text(`Author: ${metadata.author}`, { align: 'center' });
  }

  if (metadata.publishDate) {
    doc.fontSize(12)
      .text(`Published: ${new Date(metadata.publishDate).toLocaleDateString()}`, { align: 'center' });
  }

  doc.moveDown(2);

  // Add source URL
  doc.fontSize(10)
    .fillColor('#666')
    .text(`Source: ${metadata.url}`, { align: 'center' });

  // Add new page for content
  doc.addPage();

  // Process structured content
  structuredContent.forEach(section => {
    switch (section.type) {
      case 'heading':
        const headingSize = 20 - (section.level * 2);
        doc.font('Helvetica-Bold')
          .fontSize(headingSize)
          .fillColor('#333')
          .text(section.content, { paragraphGap: 5 });
        doc.moveDown(0.5);
        break;

      case 'paragraph':
        doc.font('Helvetica')
          .fontSize(11)
          .fillColor('#333')
          .text(section.content, {
            align: 'left',
            lineGap: 3,
            paragraphGap: 8,
            indent: 10
          });
        doc.moveDown(0.5);
        break;

      case 'bullet_list':
        doc.font('Helvetica')
          .fontSize(11)
          .fillColor('#333');
        section.items.forEach(item => {
          doc.text(`• ${item}`, {
            indent: 20,
            lineGap: 3,
            paragraphGap: 5
          });
        });
        doc.moveDown(0.5);
        break;

      case 'numbered_list':
        doc.font('Helvetica')
          .fontSize(11)
          .fillColor('#333');
        section.items.forEach((item, i) => {
          doc.text(`${i + 1}. ${item}`, {
            indent: 20,
            lineGap: 3,
            paragraphGap: 5
          });
        });
        doc.moveDown(0.5);
        break;

      case 'quote':
        try { doc.font('Helvetica-Oblique'); } catch (e) { doc.font('Helvetica'); }
        doc.fontSize(11)
          .fillColor('#555')
          .text(`"${section.content}"`, {
            align: 'center',
            indent: 30,
            lineGap: 5,
            paragraphGap: 10
          });
        doc.moveDown(1);
        break;

      case 'code':
        doc.font('Courier')
          .fontSize(10)
          .fillColor('#333')
          .text(section.content, {
            align: 'left',
            indent: 20,
            lineGap: 3,
            paragraphGap: 5
          });
        doc.moveDown(1);
        break;
    }
  });

  // Add footer with page numbers
  const range = doc.bufferedPageRange();
  const pageCount = range.count;

  for (let i = range.start; i < range.start + pageCount; i++) {
    doc.switchToPage(i);
    const pageNumber = i + 1;

    // Footer line
    doc.strokeColor('#ccc')
      .lineWidth(0.5)
      .moveTo(72, doc.page.height - 40)
      .lineTo(doc.page.width - 72, doc.page.height - 40)
      .stroke();

    // Footer text
    doc.fontSize(8)
      .fillColor('#666')
      .text(
        `Page ${pageNumber} of ${pageCount} • Generated on ${new Date().toLocaleDateString()}`,
        doc.page.margins.left,
        doc.page.height - 30,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: 'center'
        }
      );
  }
}

// Batch PDF generator for multiple URLs
function generateBatchPDF(results) {
  const doc = new PDFDocument({
    margins: { top: 50, bottom: 60, left: 72, right: 72 },
    bufferPages: true
  });

  // Cover page
  doc.font('Helvetica-Bold')
    .fontSize(28)
    .text('Batch Scraped Content', { align: 'center' });

  doc.moveDown(2);

  doc.font('Helvetica')
    .fontSize(14)
    .text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });

  doc.moveDown(1);

  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  doc.fontSize(12)
    .text(`Total URLs: ${results.length}`, { align: 'center' })
    .text(`Successful: ${successfulResults.length}`, { align: 'center' })
    .text(`Failed: ${failedResults.length}`, { align: 'center' });

  // Table of contents
  if (successfulResults.length > 0) {
    doc.addPage();
    doc.font('Helvetica-Bold')
      .fontSize(18)
      .text('Table of Contents', { align: 'center' });

    doc.moveDown(1);

    successfulResults.forEach((result, index) => {
      doc.font('Helvetica')
        .fontSize(11)
        .text(`${index + 1}. ${result.title}`, { indent: 20 });
      doc.fontSize(9)
        .fillColor('#666')
        .text(`   ${result.url}`, { indent: 20 });
      doc.fillColor('#333');
      doc.moveDown(0.3);
    });
  }

  // Content pages
  successfulResults.forEach((result, index) => {
    doc.addPage();

    // Article header
    doc.font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#333')
      .text(`${index + 1}. ${result.title}`);

    doc.moveDown(0.5);

    doc.font('Helvetica')
      .fontSize(10)
      .fillColor('#666')
      .text(`Source: ${result.url}`);

    doc.fontSize(10)
      .text(`Word Count: ${result.wordCount || 0} | Scraped: ${new Date(result.timestamp).toLocaleDateString()}`);

    doc.moveDown(1);

    // Add separator line
    doc.strokeColor('#ccc')
      .lineWidth(1)
      .moveTo(72, doc.y)
      .lineTo(doc.page.width - 72, doc.y)
      .stroke();

    doc.moveDown(1);

    // Content
    if (result.structuredContent) {
      result.structuredContent.forEach(section => {
        switch (section.type) {
          case 'heading':
            const headingSize = Math.max(12, 18 - (section.level * 2));
            doc.font('Helvetica-Bold')
              .fontSize(headingSize)
              .fillColor('#333')
              .text(section.content, { paragraphGap: 5 });
            doc.moveDown(0.5);
            break;

          case 'paragraph':
            doc.font('Helvetica')
              .fontSize(10)
              .fillColor('#333')
              .text(section.content, {
                align: 'left',
                lineGap: 2,
                paragraphGap: 6,
                indent: 10
              });
            doc.moveDown(0.3);
            break;

          case 'bullet_list':
            doc.font('Helvetica')
              .fontSize(10)
              .fillColor('#333');
            section.items.forEach(item => {
              doc.text(`• ${item}`, {
                indent: 20,
                lineGap: 2,
                paragraphGap: 3
              });
            });
            doc.moveDown(0.3);
            break;

          case 'numbered_list':
            doc.font('Helvetica')
              .fontSize(10)
              .fillColor('#333');
            section.items.forEach((item, i) => {
              doc.text(`${i + 1}. ${item}`, {
                indent: 20,
                lineGap: 2,
                paragraphGap: 3
              });
            });
            doc.moveDown(0.3);
            break;

          case 'quote':
            try { doc.font('Helvetica-Oblique'); } catch (e) { doc.font('Helvetica'); }
            doc.fontSize(10)
              .fillColor('#555')
              .text(`"${section.content}"`, {
                align: 'center',
                indent: 30,
                lineGap: 3,
                paragraphGap: 6
              });
            doc.moveDown(0.5);
            break;
        }
      });
    } else {
      // Fallback to plain content
      doc.font('Helvetica')
        .fontSize(10)
        .fillColor('#333')
        .text(result.content || 'No content available', {
          align: 'left',
          lineGap: 2,
          paragraphGap: 6
        });
    }
  });

  // Failed URLs summary
  if (failedResults.length > 0) {
    doc.addPage();
    doc.font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#cc0000')
      .text('Failed URLs', { align: 'center' });

    doc.moveDown(1);

    failedResults.forEach((result, index) => {
      doc.font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#333')
        .text(`${index + 1}. ${result.url}`);

      doc.font('Helvetica')
        .fontSize(10)
        .fillColor('#cc0000')
        .text(`Error: ${result.error}`, { indent: 20 });

      doc.moveDown(0.5);
    });
  }

  return doc;
}

// ROUTES

// Single URL scraping endpoint
router.post('/scrape', async (req, res) => {
  const { url } = req.body;
  const { format } = req.query;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required',
      example: { url: 'https://example.com' }
    });
  }

  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL format',
      provided: url
    });
  }

  try {
    const scraper = new WebScraper();
    const result = await scraper.scrapeUrl(url);

    if (!result.success) {
      return res.status(422).json({
        success: false,
        error: 'Scraping failed',
        details: result.error,
        url: result.url,
        attempts: result.scrapingAttempts
      });
    }

    // PDF format requested
    if (format === 'pdf') {
      try {
        const doc = new PDFDocument({
          margins: { top: 50, bottom: 60, left: 72, right: 72 },
          bufferPages: true
        });

        const filename = (result.title || 'scraped-content')
          .replace(/[^a-z0-9\s-]/gi, '')
          .replace(/\s+/g, '_')
          .toLowerCase()
          .substring(0, 50);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);

        doc.pipe(res);
        generatePDF(doc, result.title, result.structuredContent, {
          ...result.metadata,
          url: result.url
        });
        doc.end();

      } catch (pdfError) {
        console.error('PDF generation error:', pdfError);
        res.status(500).json({
          success: false,
          error: 'PDF generation failed',
          message: pdfError.message
        });
      }
    } else {
      // JSON format (default)
      return res.json({
        success: true,
        data: {
          url: result.url,
          title: result.title,
          content: result.content,
          metadata: result.metadata,
          wordCount: result.wordCount,
          readingTime: result.metadata.readingTime
        },
        stats: {
          contentLength: result.content.length,
          wordCount: result.wordCount,
          extractedAt: result.timestamp
        }
      });
    }

  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal scraping error',
      message: error.message
    });
  }
});

// Batch scraping endpoint with full content
router.post('/scrape/batch', async (req, res) => {
  const { urls, concurrent = 2 } = req.body;
  const { format } = req.query;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'URLs array is required',
      example: { urls: ['https://example1.com', 'https://example2.com'] }
    });
  }

  if (urls.length > 20) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 20 URLs allowed per batch',
      provided: urls.length
    });
  }

  if (concurrent > 5 || concurrent < 1) {
    return res.status(400).json({
      success: false,
      error: 'Concurrent value must be between 1 and 5',
      provided: concurrent
    });
  }

  // Validate all URLs
  const invalidUrls = [];
  urls.forEach((url, index) => {
    try {
      new URL(url);
    } catch (error) {
      invalidUrls.push({ index, url, error: 'Invalid URL format' });
    }
  });

  if (invalidUrls.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URLs found',
      invalidUrls: invalidUrls
    });
  }

  try {
    const scraper = new WebScraper();
    const results = await scraper.scrapeMultipleUrls(urls, concurrent);

    const stats = results.reduce((acc, result) => {
      if (result.success) {
        acc.successful++;
        acc.totalWords += result.wordCount || 0;
        acc.totalContent += result.content ? result.content.length : 0;
      } else {
        acc.failed++;
      }
      return acc;
    }, { successful: 0, failed: 0, totalWords: 0, totalContent: 0 });

    // PDF format requested
    if (format === 'pdf') {
      try {
        const doc = generateBatchPDF(results);

        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `batch-scraped-content-${timestamp}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        doc.pipe(res);
        doc.end();

      } catch (pdfError) {
        console.error('Batch PDF generation error:', pdfError);
        return res.status(500).json({
          success: false,
          error: 'Batch PDF generation failed',
          message: pdfError.message
        });
      }
    } else {
      // JSON format (default)
      return res.json({
        success: true,
        summary: {
          total: results.length,
          successful: stats.successful,
          failed: stats.failed,
          totalWords: stats.totalWords,
          totalContentLength: stats.totalContent
        },
        results: results.map(r => ({
          url: r.url,
          title: r.title,
          content: r.content,
          wordCount: r.wordCount,
          success: r.success,
          error: r.error,
          timestamp: r.timestamp
        })),
        processedAt: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Batch scraping error:', error);
    return res.status(500).json({
      success: false,
      error: 'Batch scraping failed',
      message: error.message
    });
  }
});

// Preview endpoint for single URL
router.post('/preview', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URL format'
    });
  }

  try {
    const scraper = new WebScraper();
    const result = await scraper.scrapeUrl(url);

    if (!result.success) {
      return res.status(422).json({
        success: false,
        error: 'Preview failed',
        details: result.error
      });
    }

    return res.json({
      success: true,
      url: result.url,
      title: result.title,
      preview: result.content.substring(0, 800) + (result.content.length > 800 ? '...' : ''),
      metadata: result.metadata,
      stats: {
        fullContentLength: result.content.length,
        wordCount: result.wordCount,
        readingTime: result.metadata.readingTime
      },
      extractedAt: result.timestamp
    });

  } catch (error) {
    console.error('Preview error:', error);
    return res.status(500).json({
      success: false,
      error: 'Preview failed',
      message: error.message
    });
  }
});

// NEW: Batch preview endpoint
router.post('/preview/batch', async (req, res) => {
  const { urls, concurrent = 2 } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'URLs array is required',
      example: { urls: ['https://example1.com', 'https://example2.com'] }
    });
  }

  if (urls.length > 20) {
    return res.status(400).json({
      success: false,
      error: 'Maximum 20 URLs allowed per batch',
      provided: urls.length
    });
  }

  if (concurrent > 5 || concurrent < 1) {
    return res.status(400).json({
      success: false,
      error: 'Concurrent value must be between 1 and 5',
      provided: concurrent
    });
  }

  // Validate all URLs
  const invalidUrls = [];
  urls.forEach((url, index) => {
    try {
      new URL(url);
    } catch (error) {
      invalidUrls.push({ index, url, error: 'Invalid URL format' });
    }
  });

  if (invalidUrls.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'Invalid URLs found',
      invalidUrls: invalidUrls
    });
  }

  try {
    const scraper = new WebScraper();
    const results = await scraper.scrapeMultipleUrls(urls, concurrent);

    const stats = results.reduce((acc, result) => {
      if (result.success) {
        acc.successful++;
        acc.totalWords += result.wordCount || 0;
        acc.totalContent += result.content ? result.content.length : 0;
      } else {
        acc.failed++;
      }
      return acc;
    }, { successful: 0, failed: 0, totalWords: 0, totalContent: 0 });

    // Transform results for preview (truncated content)
    const previewResults = results.map(result => {
      if (result.success) {
        return {
          url: result.url,
          title: result.title,
          preview: result.content ? result.content.substring(0, 500) + (result.content.length > 500 ? '...' : '') : '',
          wordCount: result.wordCount,
          success: result.success,
          timestamp: result.timestamp,
          stats: {
            fullContentLength: result.content ? result.content.length : 0,
            readingTime: result.metadata ? result.metadata.readingTime : 0
          }
        };
      } else {
        return {
          url: result.url,
          error: result.error,
          success: result.success,
          timestamp: result.timestamp,
          scrapingAttempts: result.scrapingAttempts
        };
      }
    });

    return res.json({
      success: true,
      summary: {
        total: results.length,
        successful: stats.successful,
        failed: stats.failed,
        totalWords: stats.totalWords,
        totalContentLength: stats.totalContent
      },
      results: previewResults,
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Batch preview error:', error);
    return res.status(500).json({
      success: false,
      error: 'Batch preview failed',
      message: error.message
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: '✅ Web Scraper API is running',
    version: '3.1.0',
    dynamicRendering: ENABLE_BROWSER_RENDER ? 'enabled' : 'disabled',
    dynamicHint: 'Set ENABLE_BROWSER_RENDER=true and install playwright for JS-heavy sites',
    features: [
      'Beautifully formatted content extraction',
      'Structured content with headings, paragraphs, lists',
      'Enhanced PDF generation with proper formatting',
      'Single URL scraping (JSON/PDF)',
      'Batch URL scraping (up to 20 URLs)',
      'Batch PDF generation with table of contents',
      'Content preview (single & batch)',
      'Comprehensive metadata extraction',
      'Reading time estimation',
      'Enhanced error handling & retries',
      'Rate limiting with configurable concurrency',
      'User agent rotation'
    ],
    endpoints: {
      scrape: 'POST /scrape - Scrape single URL (add ?format=pdf for PDF)',
      batchScrape: 'POST /scrape/batch - Scrape multiple URLs (add ?format=pdf for PDF)',
      preview: 'POST /preview - Get content preview',
      batchPreview: 'POST /preview/batch - Get batch content preview',
      health: 'GET /health - Health check'
    },
    limits: {
      batchSize: 20,
      maxConcurrent: 5,
      contentLimit: '50KB per URL',
      timeout: '30s per URL'
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
router.use((error, req, res, next) => {
  console.error('API Error:', error);

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'Content too large',
      message: 'The scraped content exceeds the maximum allowed size'
    });
  }

  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message
  });
});

export default router;