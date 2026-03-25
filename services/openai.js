const OpenAI = require('openai');
require('dotenv').config();

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getDayContext() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const hour = now.getHours();

  // Saturday night (after Shabbat ends, roughly after 20:00)
  if (day === 6 && hour >= 20) return 'motzei_shabbat';
  // Friday
  if (day === 5) return 'friday';

  return 'regular';
}

async function generateMessage({ Text, Link, join_link, channelId = 'fishing' }) {
  const dayContext = getDayContext();

  let dayInstruction = '';
  if (dayContext === 'friday') {
    dayInstruction = 'ההודעה נשלחת ביום שישי - הוסף ברכה לשבת בסוף ההודעה.';
  } else if (dayContext === 'motzei_shabbat') {
    dayInstruction = 'ההודעה נשלחת במוצאי שבת - הוסף ברכת שבוע טוב בסוף ההודעה (למשל: "שיהיה לנו שבוע מעולה" או "מי יתן והשבוע נתפוס מלא דגים").';
  }

  const promptStore = require('./promptStore');
  const prompt = promptStore.get(channelId)
    .replace('{{Text}}', Text)
    .replace('{{Link}}', Link)
    .replace('{{join_link}}', join_link)
    .replace('{{dayInstruction}}', dayInstruction);

  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
  });

  return response.choices[0].message.content.trim();
}

module.exports = { generateMessage };
