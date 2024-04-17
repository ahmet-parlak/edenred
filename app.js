const puppeteer = require("puppeteer");
const fs = require("fs");
const logger = require("./logger");

require("dotenv").config();

const maxDepartment = !isNaN(Number(process.env.MAX_DEPARTMENT))
  ? Number(process.env.MAX_DEPARTMENT) + 1
  : null;
const maxTown = !isNaN(Number(process.env.MAX_TOWN))
  ? Number(process.env.MAX_TOWN) + 1
  : null;
const jsonFileName = process.env.JSON_FILE_NAME ?? "data.json";
const browserGUI = process.env.BROWSER_GUI == "true" ? true : false;

(async () => {
  while (true) {
    try {
      const status = await fetchRestaurant();
      status
        ? console.log("✔️ Veri çekme işlemi başarıyla tamamlandı.")
        : console.log("❌ Veri çekme işlemi başarılı şekilde tamamlanamadı!");
      break;
    } catch (error) {
      console.log(`\n🛑 ${timestamp()}: ${error}`);
      console.log(
        "⚠️ Bir hata meydana geldi! Veri çekme işlemi tekrar başlatılıyor..."
      );
      continue;
    }
  }
})();

async function fetchRestaurant() {
  console.log(`${timestamp()} - Browser başlatılıyor...`);
  const browser = await puppeteer.launch({
    headless: !browserGUI,
    args: ["--window-position=-1280,0", "--window-size=1280,1024"],
  });
  let page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  const url = "https://www.edenred.com.tr/ticket-kartimi-nerede-kullanabilirim";

  await page.goto(url);

  /* Selectors */
  const departmentMenuBtnSelector = "#departmentCode-button";
  const departmentMenuSelector = "#departmentCode-menu";
  const departmentItemsSelector = "#departmentCode-menu > li";
  const townMenuBtnSelector = "#townCode-button";
  const townMenuSelector = "#townCode-menu";
  const townItemsSelector = "#townCode-menu > li";
  const submitBtnSelector = 'form[name="affiliateSearchForm"] [type="submit"] ';
  const resultsSelector = ".result-content";
  const acceptCookiesBtnSelector = "#onetrust-accept-btn-handler";

  /* Create/Read JSON File */
  let lastDepartment = null;
  if (fs.existsSync(jsonFileName)) {
    lastDepartment = await getLastKeyFromJSONFile();
  } else {
    const dataJSON = JSON.stringify({}, null, 2);
    fs.writeFile(jsonFileName, dataJSON, (err) => {
      if (err) {
        console.error("Hata oluştu:", err);
        return;
      }
      console.log(jsonFileName, " dosyası oluşturuldu.");
    });
  }

  /* Cookie Box */
  const acceptCookiesBtn = await page.waitForSelector(acceptCookiesBtnSelector);
  await acceptCookiesBtn.click();
  await delay(1000);

  /* Department */
  let departmentMenuBtn = await page.waitForSelector(departmentMenuBtnSelector);
  await departmentMenuBtn?.click();
  let departmentListItems = await page.$$(departmentItemsSelector);

  let departmentIndex = 1;
  /* If Last Department Exist */
  if (lastDepartment ?? false) {
    for (let i = 0; i < departmentListItems.length; i++) {
      const listItem = departmentListItems[i];
      const text = await listItem.evaluate((node) => node.textContent);
      if (text.includes(lastDepartment)) {
        departmentIndex = i + 1;
        break;
      }
    }
  }

  console.log(`${timestamp()} - Veri çekme işlemi başlıyor...`);

  for (
    let i = departmentIndex;
    i <
    (maxDepartment
      ? Math.min(maxDepartment, departmentListItems.length)
      : departmentListItems.length);
    i++
  ) {
    const departmentData = {};

    let departmentMenu = await page.$(
      departmentMenuSelector + '[aria-hidden="false"]'
    );
    if (!departmentMenu) {
      departmentMenuBtn = await page.waitForSelector(departmentMenuBtnSelector);
      await departmentMenuBtn.click();
    }
    departmentListItems = await page.$$(departmentItemsSelector);

    let department = await departmentListItems[i].$eval(
      "div",
      (div) => div.textContent
    );
    await departmentListItems[i].click();

    console.log(`${department}`);

    /* City */
    let townMenuBtn = await page.$(townMenuBtnSelector);
    await townMenuBtn.click();

    try {
      await page.waitForNetworkIdle({ timeout: 3000 });
    } catch (error) {}

    let townListItems = await page.$$(townItemsSelector);

    for (
      let index = 1;
      index <
      (maxTown
        ? Math.min(maxTown, townListItems.length)
        : townListItems.length);
      index++
    ) {
      let townMenu = await page.$(townMenuSelector + '[aria-hidden="false"]');
      if (!townMenu) {
        townMenuBtn = await page.waitForSelector(townMenuBtnSelector);
        await townMenuBtn.click();
        await delay(500);
      }

      townListItems = await page.$$(townItemsSelector);

      let town = await townListItems[index].$eval(
        "div",
        (div) => div.textContent
      );
      await townListItems[index].click();

      process.stdout.write(`﹂${town}`);

      const submitBtn = await page.waitForSelector(submitBtnSelector);
      await submitBtn.click();

      try {
        await page.waitForNavigation({
          waitUntil: "networkidle0",
          timeout: 7000,
        });
      } catch (error) {}
      await delay(1000);

      const townData = await page.$$eval(resultsSelector, (results) => {
        const data = [];
        results.map((result) => {
          const titleSelector = "span.result-title";
          const categorySelector = "span.result-category";
          const addressSelector = "span.result-address";

          const title = result?.querySelector(titleSelector)?.textContent;
          const category = result?.querySelector(categorySelector)?.textContent;
          const address = result?.querySelector(addressSelector)?.textContent;

          data.push({
            title,
            category,
            address,
          });
        });

        return data;
      });

      if (townData[0].title !== "Aradığınız Kriterlerde Sonuç Bulunamadı") {
        if (departmentData.hasOwnProperty(town)) {
          departmentData[town] = departmentData[town].concat(townData);
          process.stdout.write(`✔ ➤ Merged\n`);
        } else {
          departmentData[town] = townData;
          process.stdout.write(` ✔\n`);
        }
      } else {
        process.stdout.write(` ◌\n`);
      }

      await page.goBack();
    }

    await addDataToJSONFile(department, departmentData);
  }

  await browser.close();

  return true;
}

async function addDataToJSONFile(key, value) {
  fs.readFile(jsonFileName, "utf8", (err, data) => {
    if (err) {
      console.error("Dosya okunurken bir hata oluştu:", err);
      return;
    }

    const existingData = JSON.parse(data);

    existingData[key] = value;

    fs.writeFile(
      jsonFileName,
      JSON.stringify(existingData, null, 2),
      "utf8",
      (err) => {
        if (err) {
          console.error("Dosya yazılırken bir hata oluştu:", err);
          return;
        }
        console.log(`${timestamp()} - ${key} verisi JSON dosyasına eklendi.`);
      }
    );
  });
}

async function getLastKeyFromJSONFile() {
  try {
    const data = fs.readFileSync(jsonFileName, "utf8");
    const jsonData = JSON.parse(data);
    const keys = Object.keys(jsonData);

    return keys[keys.length - 1];
  } catch (err) {
    console.error("Dosya okunurken bir hata oluştu:", err);
    throw err;
  }
}

async function delay(ms = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  const currentDate = new Date();
  const options = { timeZone: "Europe/Istanbul" };
  return currentDate.toLocaleString("tr-TR", options);
}
