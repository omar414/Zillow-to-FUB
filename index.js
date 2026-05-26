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
  try {
    if (!fs.existsSync(SEEN_FILE)) return [];
    return JSON.parse(fs.readFileSync(SEEN_FILE, "utf8"));
  } catch {
    return [];
  }
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

function extractConversations(data) {
  return data?.response?.conversations || [];
}

async function sendToZapier(lead) {
  if (!ZAPIER_WEBHOOK_URL) {
    console.log("Missing ZAPIER_WEBHOOK_URL");
    return;
  }

  await axios.post(ZAPIER_WEBHOOK_URL, lead);
}

async function checkLeads() {
  console.log("Checking Zillow leads...");

  const seen = loadSeen();

  const data = await fetchZillowLeads();

  const conversations = extractConversations(data);

  console.log(`Fetched ${conversations.length} conversations`);

  for (const item of conversations) {
    const conversationId =
      item.conversationId ||
      item.id ||
      item.linkedId;

    const latestMessageDateMs =
      item.mostRecentMessage?.messageDateMs || "";

    const uniqueId =
      `${conversationId}_${latestMessageDateMs}`;

    if (!conversationId) continue;

    if (seen.includes(uniqueId)) {
      continue;
    }

    const lead = {
      source: "Zillow",

      zillowConversationId: conversationId,

      renterName:
        item.renterName ||
        item.renter?.name ||
        "",

      renterPhone:
        item.renterPhone ||
        item.renter?.phone ||
        "",

      renterEmail:
        item.renterEmail ||
        item.renter?.email ||
        "",

      propertyAddress:
        item.listingDetails?.displayAddress ||
        item.displayAddress ||
        "",

      listingAlias:
        item.listingDetails?.listingAlias ||
        "",

      status:
        item.statusLabel?.text ||
        item.status ||
        "",

      latestMessage:
        item.mostRecentMessage?.message ||
        "",

      latestMessageDateMs,

      hasUnreadMessage:
        item.hasUnreadMessage || false
    };

    console.log(
      `Sending to Zapier: ${lead.renterName} | ${lead.renterPhone}`
    );

    await sendToZapier(lead);

    seen.push(uniqueId);

    saveSeen(seen);
  }
}

setInterval(() => {
  checkLeads().catch(err => {
    console.error(
      "Lead check failed:",
      err?.response?.data || err.message
    );
  });
}, 12 * 60 * 1000);

app.get("/", (req, res) => {
  res.send("Zillow to Follow Up Boss poller is running.");
});

app.get("/run-now", async (req, res) => {
  try {
    await checkLeads();
    res.send("Checked Zillow leads.");
  } catch (err) {
    console.error(
      "Run-now failed:",
      err?.response?.data || err.message
    );

    res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  checkLeads().catch(err => {
    console.error(
      "Initial check failed:",
      err?.response?.data || err.message
    );
  });
});