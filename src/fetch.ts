import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BROWSER_TIMEOUT_MS = 60_000;
const HEADLESS = true;

export async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": BROWSER_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed fetching ${url} (status ${response.status}).`);
  }

  return await response.text();
}

let stealthConfigured = false;

function browser() {
  // puppeteer-extra's types lag Puppeteer v24; narrow here instead of loosening the whole project.
  const instance = puppeteerExtra as unknown as {
    use: (plugin: unknown) => void;
    launch: (options: {
      headless: boolean;
      args: string[];
    }) => Promise<import("puppeteer").Browser>;
  };

  if (!stealthConfigured) {
    instance.use(StealthPlugin());
    stealthConfigured = true;
  }

  return instance;
}

/** halooglasi serves a bot challenge to plain HTTP clients; stealth Chromium clears it. */
export async function fetchHtmlWithBrowser(
  url: string,
  waitForSelector: string,
): Promise<string> {
  const instance = await browser().launch({
    headless: HEADLESS,
    // Chromium's sandbox needs privileges the container's non-root user lacks.
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await instance.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent(PAGE_USER_AGENT);
    page.setDefaultTimeout(BROWSER_TIMEOUT_MS);

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: BROWSER_TIMEOUT_MS,
    });
    await page.waitForSelector(waitForSelector, {
      timeout: BROWSER_TIMEOUT_MS,
    });

    return await page.content();
  } finally {
    await instance.close();
  }
}
