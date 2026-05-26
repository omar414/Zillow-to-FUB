import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const ZILLOW_API_URL = process.env.ZILLOW_API_URL;
const ZILLOW_COOKIE = process.env.ZILLOW_COOKIE;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;

const SEEN_FILE = "./seen.json";

function loadSeen() {
  if (!fs.existsSync(SEEN_FILE)) return [];
  return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
}

function saveSeen(ids) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(ids, null, 2));
}

async function fetchZillowLeads() {
  const response = await axios.post(
    ZILLOW_API_URL,

    {
      clientTimeZone: "Asia/Beirut",
      folder: "INBOX",
      readRepliedStatus: "SHOW_ALL",
      renterProgressStatus: "SHOW_ALL"
    },

    {
      headers: {
        Cookie: ZILLOW_COOKIE,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
        Origin: "https://www.zillow.com",
        Referer: "https://www.zillow.com/rental-manager/inbox"
      }
    }
  );

  return response.data;
}


async function sendToZapier(lead) {
  await axios.post(ZAPIER_WEBHOOK_URL, lead);
}

async function checkLeads() {
  console.log("Checking Zillow leads...");

  const seen = loadSeen();
  const data = await fetchZillowLeads();

  const conversations =
    data?.conversations ||
    data?.data?.conversations ||
    data?.latestConversations ||
    [];

  for (const item of conversations) {
    const id = item.id || item.conversationId || item.linkedId;

    if (!id || seen.includes(id)) continue;

    const lead = {
      zillowConversationId: id,
      renterName: item.renterName || item.renter?.name || "",
      renterPhone: item.renterPhone || item.renter?.phone || "",
      renterEmail: item.renterEmail || item.renter?.email || "",
      propertyAddress:
        item.listingDetails?.displayAddress ||
        item.displayAddress ||
        "",
      status: item.statusLabel?.text || item.status || "",
      raw: item
    };

    console.log("New lead:", lead.renterName);

    await sendToZapier(lead);

    seen.push(id);
    saveSeen(seen);
  }
}

setInterval(() => {
  checkLeads().catch(err => {
    console.error("Lead check failed:", err.message);
  });
}, 2 * 60 * 1000);

app.get("/", (req, res) => {
  res.send("Zillow to Follow Up Boss poller is running.");
});

app.get("/run-now", async (req, res) => {
  try {
    await checkLeads();
    res.send("Checked Zillow leads.");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  checkLeads().catch(console.error);
});