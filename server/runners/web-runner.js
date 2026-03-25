// server/runners/web-runner.js
// Generates the Selenium WebDriver setup code for web tests.
// Supports both remote Selenium Grid (Docker) and local Chrome.

function getWebDriverSetupCode() {
  const remoteUrl = process.env.SELENIUM_REMOTE_URL;

  if (remoteUrl) {
    // Remote Selenium Grid (Docker setup)
    return `
  const seleniumUrl = process.env.SELENIUM_REMOTE_URL || "http://localhost:4444/wd/hub";
  const options = new chrome.Options();
  if (process.env.VISUAL_BROWSER !== "true") {
    options.addArguments("--headless=new","--disable-gpu","--no-sandbox","--window-size=1920,1080");
  }
  let driver;
  let failedCount = 0;
  let passedCount = 0;
  try {
    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).usingServer(seleniumUrl).build();
`;
  }

  // Local Chrome (Electron desktop app)
  return `
  const options = new chrome.Options();
  if (process.env.VISUAL_BROWSER !== "true") {
    options.addArguments("--headless=new","--disable-gpu","--window-size=1920,1080");
  }
  let driver;
  let failedCount = 0;
  let passedCount = 0;
  try {
    driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();
`;
}

function getWebDriverTeardownCode() {
  return `    await driver.quit();`;
}

function getWebDriverErrorTeardownCode() {
  return `    if (driver) await driver.quit();`;
}

module.exports = {
  getWebDriverSetupCode,
  getWebDriverTeardownCode,
  getWebDriverErrorTeardownCode,
};
