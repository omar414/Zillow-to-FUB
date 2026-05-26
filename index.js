import axios from "axios";
import { MongoClient } from "mongodb";

const ZILLOW_API_URL = process.env.ZILLOW_API_URL;
const ZILLOW_COOKIE = process.env.ZILLOW_COOKIE;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const MONGODB_URI = process.env.MONGODB_URI;

const client = new MongoClient(MONGODB_URI);

async function getSeenCollection() {
  await client.connect();
  return client.db("zillow_to_fub").collection("seen_messages");
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
  try {
    await axios.post(ZAPIER_WEBHOOK_URL, lead);
    return true;
  } catch (err) {
    console.error(
      "Zapier failed:",
      lead.renterName,
      err?.response?.data || err.message
    );
    return false;
  }
}

async function checkLeads() {
  console.log("Checking Zillow leads...");

  const seenCollection = await getSeenCollection();
  const data = await fetchZillowLeads();

  const conversations = extractConversations(data).slice(0, 10);

  console.log(`Fetched ${conversations.length} recent conversations`);

  for (const item of conversations) {
    const conversationId = item.conversationId || item.id || item.linkedId;
    const latestMessageDateMs = item.mostRecentMessage?.messageDateMs;

    if (!conversationId || !latestMessageDateMs) continue;

    const uniqueId = `${conversationId}_${latestMessageDateMs}`;

    const alreadySeen = await seenCollection.findOne({ uniqueId });

    if (alreadySeen) {
      console.log(`Skipped duplicate: ${item.renterName}`);
      continue;
    }

    const lead = {
      source: "Zillow",
      uniqueId,
      zillowConversationId: conversationId,
      renterName: item.renterName || "",
      renterPhone: item.renterPhone || "",
      renterEmail: item.renterEmail || "",
      propertyAddress: item.listingDetails?.displayAddress || "",
      listingAlias: item.listingDetails?.listingAlias || "",
      status: item.statusLabel?.text || "",
      latestMessage: item.mostRecentMessage?.message || "",
      latestMessageDateMs,
      hasUnreadMessage: item.hasUnreadMessage || false
    };

    console.log(`Sending to Zapier: ${lead.renterName} | ${lead.renterPhone}`);

    const sent = await sendToZapier(lead);

    if (!sent) {
      continue;
    }

    await seenCollection.insertOne({
      uniqueId,
      conversationId,
      renterName: lead.renterName,
      renterPhone: lead.renterPhone,
      propertyAddress: lead.propertyAddress,
      latestMessageDateMs,
      sentAt: new Date()
    });
  }
}

checkLeads()
  .then(async () => {
    console.log("Cron job complete");
    await client.close();
    process.exit(0);
  })
  .catch(async err => {
    console.error("Cron job failed:", err?.response?.data || err.message);
    await client.close();
    process.exit(1);
  });